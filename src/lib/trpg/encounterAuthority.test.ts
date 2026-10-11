import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { creditPointsWithIds, getPointBalanceOnDb } from "@/lib/points";
import { CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL } from "@/lib/chatModels";
import { computeTrpgRoundPoints, TRPG_GM_USAGE_FALLBACK } from "./billing";
import { EVEN_STATS, createTrpgCampaign, joinTrpgCampaign, saveTrpgSheet, writeSheet } from "./engineCreate";
import {
  advanceTrpgCampaign,
  regenerateTrpgNarration,
  startTrpgCampaign,
  submitTrpgAction,
  type TrpgEngineDeps,
} from "./engineAdvance";
import { loadCampaignContext } from "./campaignContext";
import { acceptEncountersEnded, governedEncounters, resolveThreatStrikes } from "./encounterStrikes";
import { buildTrpgGmStructuredWireText } from "./gmStructuredOutput";
import { mergeMechanicsOwnedDelta } from "./mechanicsMerge";
import { resolveRoundMechanics } from "./mechanicsResolve";
import { loadEndedEncounterIds, loadOngoingEffects, loadMechanicsResolution, loadThreatStrikeCounts } from "./mechanicsStore";
import { applyPostGmOngoingSeeds, derivePostGmOngoingSeeds } from "./postGmOngoing";
import {
  emptyTrpgScenarioPlan,
  parseScenarioEncounters,
  parseTrpgScenarioPlan,
  serializeTrpgScenarioPlanForGm,
  type TrpgScenarioEncounter,
} from "./scenarioPlan";
import { mergeScenarioDraft, parseScenarioDraftJson } from "./scenarioDraft";
import { insertScenarioTemplate, updateScenarioTemplate } from "./scenarioTemplates";
import { TRPG_GM_STRUCTURED_RESPONSE_FORMAT } from "./gmStructuredOutput";
import { ensureTrpgTables } from "./schema";
import { insertParticipant } from "./store";
import type { TrpgSheetSnapshot } from "./types";

const PLAN = {
  startingSituation: "폐역에 도착한다",
  centralConflict: "유령 기차",
  goal: "기차를 막는다",
  endingConditions: ["기차를 멈춘다"],
};

const WOLF: TrpgScenarioEncounter = {
  id: "enc_hunter",
  name: "그림자 사냥꾼",
  kind: "enemy",
  damageClass: "MEDIUM",
  activateRound: 2,
  maxStrikes: 2,
  hitDc: 10,
  location: "복도",
};

function memoryDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, nickname TEXT, points INTEGER NOT NULL DEFAULT 0)`);
  db.prepare(`INSERT INTO users (id, email, nickname, points) VALUES (1,'a@t','host',5000)`).run();
  ensureTrpgTables(db);
  return db;
}

type Seat = { campaignId: number; hostId: number };

function hpOf(db: Database.Database, participantId: number): number {
  return (db.prepare(`SELECT hp FROM trpg_character_sheets WHERE participant_id=?`).get(participantId) as { hp: number }).hp;
}

function setup(db: Database.Database, encounters: TrpgScenarioEncounter[] | null) {
  const templateId =
    encounters === null
      ? undefined
      : insertScenarioTemplate(db, 7, {
          title: "폐역",
          summary: "유령 기차",
          content: "유령 기차를 기다린다.",
          visibility: "public",
          startLocation: "복도",
          scenarioPlan: { ...PLAN, ...(encounters.length ? { encounters } : {}) },
        });
  const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1, templateId });
  saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
  const hostId = (db.prepare(`SELECT id FROM trpg_participants WHERE campaign_id=?`).get(campaignId) as { id: number }).id;
  return { campaignId, hostId } satisfies Seat;
}

function gmWith(hostId: number, hp: number | null, narration = "복도의 공기가 무겁게 가라앉았다. GM: 무엇을 하겠는가."): string {
  return buildTrpgGmStructuredWireText(narration, {
    players: hp == null ? [] : [{ participantId: hostId, hp }],
    location: "복도",
    next_round_context: "다음",
    campaign_finished: false,
  });
}

function makeDeps(opts: { script: Array<number | null>; hostId: () => number; seenUsers?: string[]; d20?: number; die?: number }) {
  let call = 0;
  const deps: TrpgEngineDeps = {
    skipBilling: true,
    rollD20: () => opts.d20 ?? 15,
    rollDie: () => opts.die ?? 4,
    gmCall: async ({ user }) => {
      opts.seenUsers?.push(user);
      const hp = opts.script[call] ?? null;
      call += 1;
      return { text: gmWith(opts.hostId(), hp) };
    },
  };
  return deps;
}

async function playRound(db: Database.Database, seat: Seat, deps: TrpgEngineDeps, body: string) {
  submitTrpgAction(db, { campaignId: seat.campaignId, userId: 1, body, actionType: "investigate" });
  await advanceTrpgCampaign(db, { campaignId: seat.campaignId, userId: 1, deps });
}

describe("encounter authority: scenario source and parsing", () => {
  it("parses typed encounters and drops malformed, duplicate or out-of-range rows", () => {
    const rows = parseScenarioEncounters([
      WOLF,
      { ...WOLF, name: "중복 id" },
      { id: "bad_kind", name: "x", kind: "ally", damageClass: "LIGHT", activateRound: 1 },
      { id: "bad_class", name: "x", kind: "enemy", damageClass: "NONE", activateRound: 1 },
      { id: "bad_round", name: "x", kind: "enemy", damageClass: "LIGHT", activateRound: 0 },
      { id: "bad_dc", name: "x", kind: "enemy", damageClass: "LIGHT", activateRound: 1, hitDc: 99 },
      { id: "trap", name: "낙석", kind: "hazard", damageClass: "LIGHT", activateRound: 3, maxStrikes: 99, location: "지하" },
      { id: "no_place", name: "어디에나 있는 적", kind: "enemy", damageClass: "LIGHT", activateRound: 1 },
    ]);
    assert.deepEqual(rows.map((row) => row.id), ["enc_hunter", "trap"], "an encounter without a location is not a valid source");
    assert.equal(rows[1]?.maxStrikes, 6);
    assert.equal(rows[1]?.location, "지하");
  });

  it("a plan with encounters round-trips, and plans without them are unchanged", () => {
    const withEnc = parseTrpgScenarioPlan({ ...PLAN, encounters: [WOLF] });
    assert.deepEqual(withEnc?.encounters, [WOLF]);
    const without = parseTrpgScenarioPlan(PLAN);
    assert.equal(without && "encounters" in without, false);
  });

  it("model-generated scenario drafts never carry encounters", () => {
    const draft = parseScenarioDraftJson(
      JSON.stringify({ title: "t", summary: "s", ...PLAN, encounters: [WOLF] })
    );
    assert.equal("encounters" in draft.plan, false);
  });

  it("only a scenario-mode snapshot is a trusted source; sandbox director plans are not", () => {
    const db = memoryDb();
    const seat = setup(db, [WOLF]);
    return startTrpgCampaign(db, {
      campaignId: seat.campaignId,
      userId: 1,
      deps: makeDeps({ script: [null], hostId: () => seat.hostId }),
    }).then(() => {
      const ctx = loadCampaignContext(db, seat.campaignId)!;
      assert.equal(governedEncounters(ctx).length, 1);
      assert.equal(governedEncounters({ ...ctx, sourceMode: "sandbox" }).length, 0);
      assert.equal(governedEncounters({ ...ctx, scenarioSnapshot: null }).length, 0);
      assert.equal(governedEncounters(null).length, 0);
      db.close();
    });
  });
});

describe("encounter authority: real engine path", () => {
  it("A/B same campaign: no approved threat keeps HP; the approved enemy strikes an ignoring player", async () => {
    const db = memoryDb();
    const seat = setup(db, [WOLF]);
    const seen: string[] = [];
    const deps = makeDeps({ script: [null, 32, 39, 40, 10], hostId: () => seat.hostId, seenUsers: seen });
    await startTrpgCampaign(db, { campaignId: seat.campaignId, userId: 1, deps });
    assert.equal(hpOf(db, seat.hostId), 40);

    // Round 1: encounter not active yet. GM invents a drop 40 -> 32.
    await playRound(db, seat, deps, "문을 두드린다.");
    assert.equal(hpOf(db, seat.hostId), 40, "unapproved GM damage is not applied");

    // Round 2: approved enemy active; player ignores it. GM tries to under-report (39).
    await playRound(db, seat, deps, "벽의 낙서를 구경한다.");
    const r2 = loadMechanicsResolution(db, roundIdByNumber(db, seat.campaignId, 2))!;
    assert.equal(r2.threatStrikes?.length, 1);
    const strike = r2.threatStrikes![0]!;
    assert.equal(strike.hit, true);
    assert.equal(strike.targetParticipantId, seat.hostId);
    assert.equal(strike.dice?.amount, 8, "MEDIUM 1d6 with face 4 x hpUnit 2");
    assert.equal(hpOf(db, seat.hostId), 32, "server strike applied; GM's 39 did not override it");
    const gmUserRound2 = seen[seen.length - 1]!;
    assert.match(gmUserRound2, /THREAT_STRIKE 그림자 사냥꾼 → 렌/);
    assert.match(gmUserRound2, /ENCOUNTER_AUTHORITY/);

    // Round 3: second and last strike; GM tries to erase damage (40).
    await playRound(db, seat, deps, "주변을 둘러본다.");
    assert.equal(hpOf(db, seat.hostId), 24, "second strike applied; GM 40 ignored");

    // Round 4: budget exhausted; GM invents a drop (25) with no approved source.
    await playRound(db, seat, deps, "숨을 고른다.");
    assert.equal(hpOf(db, seat.hostId), 24, "no strike left, GM drop not applied");
    assert.deepEqual(loadThreatStrikeCounts(db, seat.campaignId, 0), { enc_hunter: 2 });
    db.close();
  });

  it("a miss deals no damage and is still narrated as a server result", async () => {
    const db = memoryDb();
    const seat = setup(db, [{ ...WOLF, hitDc: 20 }]);
    const seen: string[] = [];
    const deps = makeDeps({ script: [null, 10, 10], hostId: () => seat.hostId, d20: 15, seenUsers: seen });
    await startTrpgCampaign(db, { campaignId: seat.campaignId, userId: 1, deps });
    await playRound(db, seat, deps, "문을 두드린다.");
    await playRound(db, seat, deps, "소리를 듣는다.");
    assert.equal(hpOf(db, seat.hostId), 40);
    assert.match(seen[seen.length - 1]!, /MISS, no damage/);
    assert.deepEqual(loadThreatStrikeCounts(db, seat.campaignId, 0), { enc_hunter: 1 }, "an attempted strike spends the budget, hit or miss");
    db.close();
  });

  it("regeneration and duplicate completion leave HP, dice and strike counts unchanged", async () => {
    const db = memoryDb();
    const seat = setup(db, [WOLF]);
    const deps = makeDeps({ script: [null, 40, 40, 5], hostId: () => seat.hostId });
    await startTrpgCampaign(db, { campaignId: seat.campaignId, userId: 1, deps });
    await playRound(db, seat, deps, "문을 두드린다.");
    await playRound(db, seat, deps, "소리를 듣는다.");
    const roundId = roundIdByNumber(db, seat.campaignId, 2);
    const before = JSON.stringify(loadMechanicsResolution(db, roundId)!.threatStrikes);
    const hpBefore = hpOf(db, seat.hostId);
    await regenerateTrpgNarration(db, { campaignId: seat.campaignId, userId: 1, deps });
    assert.equal(hpOf(db, seat.hostId), hpBefore);
    assert.equal(JSON.stringify(loadMechanicsResolution(db, roundId)!.threatStrikes), before);
    assert.deepEqual(loadThreatStrikeCounts(db, seat.campaignId, 0), { enc_hunter: 1 });
    db.close();
  });

  it("campaigns without author-approved encounters keep the legacy GM HP path", async () => {
    for (const encounters of [null, []] as const) {
      const db = memoryDb();
      const seat = setup(db, encounters);
      const deps = makeDeps({ script: [null, 32], hostId: () => seat.hostId });
      await startTrpgCampaign(db, { campaignId: seat.campaignId, userId: 1, deps });
      await playRound(db, seat, deps, "문을 두드린다.");
      assert.equal(hpOf(db, seat.hostId), 32, `legacy GM HP preserved (${encounters === null ? "no template" : "no encounters"})`);
      db.close();
    }
  });

  it("2 humans + 2 AI, full engine: only a seat present at the threat's place is struck; a split-party seat and GM numbers are untouched", async () => {
    const db = memoryDb();
    db.prepare(`INSERT INTO users (id, email, nickname, points) VALUES (2,'b@t','태현',5000)`).run();
    const seat = setup(db, [{ ...WOLF, activateRound: 1 }]);
    const invite = (db.prepare(`SELECT invite_code FROM trpg_campaigns WHERE id=?`).get(seat.campaignId) as { invite_code: string }).invite_code;
    joinTrpgCampaign(db, { code: invite, userId: 2, nickname: "태현" });
    saveTrpgSheet(db, { campaignId: seat.campaignId, userId: 2, name: "태현", stats: EVEN_STATS });
    const human2 = (db.prepare(`SELECT id FROM trpg_participants WHERE campaign_id=? AND user_id=2`).get(seat.campaignId) as { id: number }).id;
    const ai: number[] = [];
    for (const [slot, name, place] of [[2, "유나", "복도"], [3, "카이", "지하"]] as const) {
      const id = insertParticipant(db, {
        campaignId: seat.campaignId,
        slotIndex: slot,
        kind: "ai_character",
        userId: null,
        characterId: null,
        displayName: name,
      });
      writeSheet(db, seat.campaignId, id, name, EVEN_STATS, place);
      ai.push(id);
    }
    const everyone = [seat.hostId, human2, ...ai];
    const deps = makeDeps({ script: [null, null], hostId: () => seat.hostId, die: 2 });
    deps.botCall = async () => ({ text: "조용히 주변을 살핀다." });
    deps.gmCall = async () => ({
      text: buildTrpgGmStructuredWireText("복도의 공기가 무겁게 가라앉았다. GM: 무엇을 하겠는가.", {
        players: everyone.map((participantId) => ({ participantId, hp: 5 })),
        location: "복도",
        next_round_context: "다음",
        campaign_finished: false,
      }),
    });
    await startTrpgCampaign(db, { campaignId: seat.campaignId, userId: 1, deps });
    const hpBeforeRound = everyone.map((id) => hpOf(db, id));
    assert.deepEqual(hpBeforeRound, [40, 40, 40, 40], "opening GM numbers are not trusted either");
    submitTrpgAction(db, { campaignId: seat.campaignId, userId: 1, body: "문을 두드린다.", actionType: "investigate" });
    submitTrpgAction(db, { campaignId: seat.campaignId, userId: 2, body: "주변을 둘러본다.", actionType: "investigate" });
    await advanceTrpgCampaign(db, { campaignId: seat.campaignId, userId: 1, deps });
    const strike = loadMechanicsResolution(db, roundIdByNumber(db, seat.campaignId, 1))!.threatStrikes![0]!;
    assert.deepEqual(strike.eligibleParticipantIds, [seat.hostId, human2, ai[0]!].sort((a, b) => a - b));
    assert.ok(strike.hit && strike.dice);
    for (const id of everyone) {
      const expected = id === strike.targetParticipantId ? 40 - strike.dice!.amount : 40;
      assert.equal(hpOf(db, id), expected, `participant ${id}: GM's HP 5 is ignored, only the server strike applies`);
    }
    assert.equal(hpOf(db, ai[1]!), 40, "split-party seat at another place is never targeted");
    db.close();
  });

  it("scene lifecycle: not struck before arriving, struck while present, safe after leaving", async () => {
    const db = memoryDb();
    const seat = setup(db, [{ ...WOLF, id: "enc_archive", name: "서고지기", activateRound: 1, maxStrikes: 6, location: "서고" }]);
    const moveTo = (location: string) => ({ players: [{ participantId: seat.hostId, location }], location });
    const rounds = [moveTo("복도"), moveTo("복도"), moveTo("서고"), moveTo("서고"), moveTo("복도"), moveTo("복도")];
    let call = 0;
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      rollD20: () => 15,
      rollDie: () => 4,
      gmCall: async () => {
        const row = rounds[call] ?? rounds[rounds.length - 1]!;
        call += 1;
        return {
          text: buildTrpgGmStructuredWireText("조용한 장면이 이어진다. GM: 무엇을 하겠는가.", {
            ...row,
            next_round_context: "다음",
            campaign_finished: false,
          }),
        };
      },
    };
    const act = async (body: string) => {
      submitTrpgAction(db, { campaignId: seat.campaignId, userId: 1, body, actionType: "free" });
      await advanceTrpgCampaign(db, { campaignId: seat.campaignId, userId: 1, deps });
    };
    const strikesIn = (n: number) => loadMechanicsResolution(db, roundIdByNumber(db, seat.campaignId, n))?.threatStrikes?.length ?? 0;
    await startTrpgCampaign(db, { campaignId: seat.campaignId, userId: 1, deps });
    await act("복도를 둘러본다.");
    await act("벽을 살핀다.");
    assert.equal(hpOf(db, seat.hostId), 40, "round >= activateRound alone does not attack a party in another place");
    assert.equal(strikesIn(1) + strikesIn(2), 0);
    await act("서고로 간다.");
    assert.equal(hpOf(db, seat.hostId), 40, "arrival round: strikes read the start-of-round place, so the party gets one round first");
    await act("서가를 살핀다.");
    assert.equal(strikesIn(4), 1, "present in the threat's place at round start: autonomous strike lands even though the player ignores it");
    assert.equal(hpOf(db, seat.hostId), 32);
    await act("복도로 간다.");
    assert.equal(strikesIn(5), 1, "the round the party leaves still resolves from where it stood");
    const afterLeaving = hpOf(db, seat.hostId);
    await act("복도에서 쉰다.");
    assert.equal(strikesIn(6), 0, "party left the place: the threat cannot reach it");
    assert.equal(hpOf(db, seat.hostId), afterLeaving);
    db.close();
  });

  it("a GM-only relocation into the threat's place is not accepted movement, so it creates no strike", async () => {
    const db = memoryDb();
    const seat = setup(db, [{ ...WOLF, activateRound: 1, location: "서고", maxStrikes: 6 }]);
    const deps = makeDeps({ script: [null, null, null], hostId: () => seat.hostId });
    deps.gmCall = async () => ({
      text: buildTrpgGmStructuredWireText("GM이 장면을 서고로 옮겼다고 서술한다. GM: 무엇을 하겠는가.", {
        players: [{ participantId: seat.hostId, location: "서고" }],
        location: "서고",
        next_round_context: "다음",
        campaign_finished: false,
      }),
    });
    await startTrpgCampaign(db, { campaignId: seat.campaignId, userId: 1, deps });
    const openingPlace = (db.prepare(`SELECT location FROM trpg_character_sheets WHERE participant_id=?`).get(seat.hostId) as { location: string }).location;
    assert.equal(openingPlace, "서고", "the opening is the one place the GM may set the starting scene");
    db.prepare(`UPDATE trpg_character_sheets SET location='복도' WHERE participant_id=?`).run(seat.hostId);
    await playRound(db, seat, deps, "복도에서 기다린다.");
    await playRound(db, seat, deps, "복도에서 기다린다.");
    assert.equal(
      (db.prepare(`SELECT location FROM trpg_character_sheets WHERE participant_id=?`).get(seat.hostId) as { location: string }).location,
      "복도",
      "movement owner rejected the GM-only relocation"
    );
    assert.equal(hpOf(db, seat.hostId), 40);
    assert.equal(loadThreatStrikeCounts(db, seat.campaignId, 0)["enc_hunter"] ?? 0, 0);
    db.close();
  });
});

function roundIdByNumber(db: Database.Database, campaignId: number, roundNumber: number): number {
  return (
    db.prepare(`SELECT id FROM trpg_rounds WHERE campaign_id=? AND round_number=?`).get(campaignId, roundNumber) as {
      id: number;
    }
  ).id;
}

function sheet(participantId: number, name: string, hp: number, location = "복도"): TrpgSheetSnapshot {
  return {
    participantId,
    name,
    playerName: name,
    level: 1,
    hp,
    maxHp: 40,
    stats: {},
    conditions: [],
    inventory: [],
    location,
    modifiersNote: "",
  } as TrpgSheetSnapshot;
}

describe("encounter authority: resolver and merge contracts", () => {
  const four = () =>
    new Map([
      [1, sheet(1, "인간A", 40)],
      [2, sheet(2, "인간B", 40)],
      [3, sheet(3, "유나", 40)],
      [4, sheet(4, "카이", 40)],
    ]);

  it("2 humans + 2 AI: exactly one eligible seat is struck and others keep HP and identity", () => {
    const sheets = four();
    const strikes = resolveThreatStrikes({
      encounters: [{ ...WOLF, activateRound: 1 }],
      roundNumber: 1,
      priorStrikes: {},
      sheets,
      rng: (sides) => (sides === 4 ? 3 : 3),
      rollD20: () => 18,
      baseDc: 12,
    });
    assert.equal(strikes.length, 1);
    assert.equal(strikes[0]!.targetParticipantId, 3);
    assert.deepEqual([...sheets.values()].map((row) => row.hp), [40, 40, 34, 40]);
  });

  it("downed seats and seats outside the encounter location are not eligible", () => {
    const sheets = new Map([
      [1, sheet(1, "인간A", 0, "지하")],
      [2, sheet(2, "인간B", 40, "복도")],
      [3, sheet(3, "유나", 40, "복도")],
    ]);
    const strikes = resolveThreatStrikes({
      encounters: [{ ...WOLF, activateRound: 1, location: "지하" }],
      roundNumber: 1,
      priorStrikes: {},
      sheets,
      rng: () => 1,
      rollD20: () => 20,
      baseDc: 12,
    });
    assert.deepEqual(strikes, [], "old-scene enemy cannot attack seats that left, nor a downed seat");
    assert.equal(sheets.get(2)!.hp, 40);
  });

  it("presence uses the movement owner's place matcher: refinements count, neighbouring places that merely contain the name do not", () => {
    const at = (location: string) => new Map([[1, sheet(1, "인간A", 40, location)]]);
    const strike = (location: string) =>
      resolveThreatStrikes({
        encounters: [{ ...WOLF, activateRound: 1, location: "서고" }],
        roundNumber: 1,
        priorStrikes: {},
        sheets: at(location),
        rng: () => 1,
        rollD20: () => 20,
        baseDc: 12,
      }).length;
    assert.equal(strike("서고"), 1);
    assert.equal(strike("지하 서고"), 1, "more specific label of the same place");
    assert.equal(strike("서고 내부"), 1, "interior suffix refines the place");
    assert.equal(strike("서고 앞 복도"), 0, "a corridor in front of the archive is not the archive");
    assert.equal(strike("복도"), 0);
    assert.equal(strike(""), 0, "unknown place is never a target");
  });

  it("multiple encounters resolve as separate source/target events without a stacking rule", () => {
    const sheets = four();
    const strikes = resolveThreatStrikes({
      encounters: [
        { ...WOLF, activateRound: 1, id: "a", name: "A" },
        { ...WOLF, activateRound: 1, id: "b", name: "B", kind: "hazard", damageClass: "LIGHT" },
      ],
      roundNumber: 1,
      priorStrikes: { a: 0 },
      sheets,
      rng: () => 1,
      rollD20: () => 20,
      baseDc: 12,
    });
    assert.deepEqual(strikes.map((row) => [row.encounterId, row.targetParticipantId, row.hit]), [
      ["a", 1, true],
      ["b", 1, true],
    ]);
  });

  it("trap/hazard source: a location-bound hazard damages exactly those in the area", () => {
    const sheets = new Map([
      [1, sheet(1, "인간A", 40, "함정 복도")],
      [2, sheet(2, "유나", 40, "안전한 방")],
    ]);
    const strikes = resolveThreatStrikes({
      encounters: [{ id: "trap", name: "낙석 함정", kind: "hazard", damageClass: "LIGHT", activateRound: 1, maxStrikes: 1, location: "함정 복도" }],
      roundNumber: 1,
      priorStrikes: {},
      sheets,
      rng: () => 2,
      rollD20: () => 20,
      baseDc: 12,
    });
    assert.equal(strikes[0]?.targetParticipantId, 1);
    assert.equal(sheets.get(2)!.hp, 40);
  });

  it("merge: GM decrease ignored under authority, GM heal of an unstruck seat kept, legacy unchanged without it", () => {
    const sheets = [sheet(1, "인간A", 30), sheet(2, "유나", 20)];
    const delta = {
      players: [
        { participantId: 1, hp: 10 },
        { participantId: 2, hp: 28 },
      ],
    };
    const governed = mergeMechanicsOwnedDelta(sheets, delta, null, { encounterAuthority: true });
    assert.equal(governed.ok && governed.next.find((row) => row.participantId === 1)!.hp, 30);
    assert.equal(governed.ok && governed.next.find((row) => row.participantId === 2)!.hp, 28);
    const legacy = mergeMechanicsOwnedDelta(sheets, delta, null);
    assert.equal(legacy.ok && legacy.next.find((row) => row.participantId === 1)!.hp, 10);
  });

  it("server strike beats a GM heal number on the struck seat; ticks and recovery owners still compose", () => {
    const sheets = new Map([[1, sheet(1, "인간A", 40)]]);
    const resolution = resolveRoundMechanics({
      campaignId: 1,
      roundId: 1,
      roundNumber: 1,
      sheets: [...sheets.values()],
      effects: [],
      actors: [
        {
          participantId: 1,
          name: "인간A",
          actionType: "investigate",
          body: "둘러본다",
          tier: "SUCCESS",
          d20: 12,
          modifier: 0,
          finalScore: 12,
          dc: 10,
          statKey: null,
        },
      ],
      flash: null,
      fallback: "gm_legacy",
      calledFlash: false,
      model: null,
      latencyMs: 0,
      baseDc: 12,
      rng: () => 3,
      recoveryRng: () => 20,
      encounters: [{ ...WOLF, activateRound: 1 }],
      priorThreatStrikes: {},
    });
    assert.equal(resolution.encounterAuthority, true);
    assert.equal(resolution.threatStrikes?.[0]?.hpAfter, 34);
    const merged = mergeMechanicsOwnedDelta(
      [sheet(1, "인간A", 40)],
      { players: [{ participantId: 1, hp: 40 }] },
      resolution
    );
    assert.equal(merged.ok && merged.next[0]!.hp, 34);
    const gmHeal = mergeMechanicsOwnedDelta(
      [sheet(1, "인간A", 40)],
      { players: [{ participantId: 1, hp: 39 }] },
      resolution
    );
    assert.equal(gmHeal.ok && gmHeal.next[0]!.hp, 34);
  });
});

describe("encounter authority: GM conditions do not create HP damage", () => {
  async function conditionRounds(opts: { governed: boolean; conditions: string[]; seed?: "POISON" }) {
    const db = memoryDb();
    const seat = setup(db, opts.governed ? [{ ...WOLF, id: "far", name: "먼 위협", location: "서고", activateRound: 1, maxStrikes: 6 }] : null);
    let call = 0;
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      rollD20: () => 3,
      rollDie: () => 4,
      gmCall: async () => {
        const players = call === 1 ? [{ participantId: seat.hostId, conditions: opts.conditions }] : [];
        call += 1;
        return {
          text: buildTrpgGmStructuredWireText("조용한 방이다. GM: 무엇을 하겠는가.", {
            players,
            location: "복도",
            next_round_context: "다음",
            campaign_finished: false,
          }),
        };
      },
    };
    await startTrpgCampaign(db, { campaignId: seat.campaignId, userId: 1, deps });
    if (opts.seed) {
      applyPostGmOngoingSeeds(db, { campaignId: seat.campaignId, roundNumber: 0, seeds: [{ participantId: seat.hostId, family: opts.seed }] });
    }
    await playRound(db, seat, deps, "방을 둘러본다.");
    const hpAfterGmRound = hpOf(db, seat.hostId);
    await playRound(db, seat, deps, "방을 더 둘러본다.");
    const conditions = JSON.parse(
      (db.prepare(`SELECT conditions_json FROM trpg_character_sheets WHERE participant_id=?`).get(seat.hostId) as { conditions_json: string }).conditions_json
    ) as string[];
    return {
      db,
      seat,
      hpAfterGmRound,
      hpAfterNextRound: hpOf(db, seat.hostId),
      effects: loadOngoingEffects(db, seat.campaignId),
      conditions,
    };
  }

  it("ungoverned campaign keeps the legacy promotion: GM 중독 becomes a ticking effect next round", async () => {
    const r = await conditionRounds({ governed: false, conditions: ["중독"] });
    assert.equal(r.effects.some((effect) => effect.stackKey === "poison"), true);
    assert.ok(r.hpAfterNextRound < r.hpAfterGmRound, "legacy tick damage");
    r.db.close();
  });

  it("governed campaign: GM 중독/출혈 stay narrative labels and never tick HP", async () => {
    const r = await conditionRounds({ governed: true, conditions: ["중독", "출혈"] });
    assert.deepEqual(r.effects, []);
    assert.equal(r.hpAfterGmRound, 40);
    assert.equal(r.hpAfterNextRound, 40);
    assert.ok(r.conditions.includes("중독") && r.conditions.includes("출혈"), "the RP condition text is preserved on the sheet");
    r.db.close();
  });

  it("governed campaign: a non-HP control condition (마비) is still promoted and an unrelated label is kept", async () => {
    const r = await conditionRounds({ governed: true, conditions: ["마비", "피로"] });
    assert.deepEqual(r.effects.map((effect) => effect.stackKey), ["paralysis"]);
    assert.equal(r.hpAfterNextRound, 40, "control effects do not cost HP");
    assert.ok(r.conditions.includes("피로"));
    r.db.close();
  });

  it("governed campaign: an already-approved ongoing effect keeps ticking", async () => {
    const r = await conditionRounds({ governed: true, conditions: [], seed: "POISON" });
    assert.ok(r.hpAfterGmRound < 40, "server-owned tick still lands in a governed campaign");
    const tick = loadMechanicsResolution(r.db, roundIdByNumber(r.db, r.seat.campaignId, 1))!.ongoingTicks;
    assert.equal(tick.length, 1);
    r.db.close();
  });

  it("seed derivation: server mode drops poison/bleed but not paralysis; default mode is unchanged", () => {
    const base = { startingSheets: [sheet(1, "인간A", 40)], delta: { players: [{ participantId: 1, conditions: ["중독", "출혈", "마비"] }] } };
    assert.deepEqual(derivePostGmOngoingSeeds(base).map((seed) => seed.family), ["POISON", "BLEED", "PARALYSIS"]);
    assert.deepEqual(derivePostGmOngoingSeeds({ ...base, hpHarmAuthority: "server" }).map((seed) => seed.family), ["PARALYSIS"]);
  });
});

describe("encounter authority: billing, composition and authoring", () => {
  function chargedDb(): Database.Database {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, nickname TEXT NOT NULL, points REAL NOT NULL DEFAULT 0, creator_points REAL NOT NULL DEFAULT 0);
      CREATE TABLE point_transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, point_type TEXT NOT NULL, remaining_amount REAL NOT NULL, expires_at TEXT NOT NULL);
      CREATE TABLE point_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, delta REAL NOT NULL, reason TEXT NOT NULL, message_id INTEGER, chat_id INTEGER);
      CREATE TABLE characters (id INTEGER PRIMARY KEY, name TEXT NOT NULL DEFAULT '', creator_id INTEGER, official INTEGER NOT NULL DEFAULT 0);
    `);
    db.prepare(`INSERT INTO users (id, email, nickname, points, creator_points) VALUES (1,'a@t','렌',0,0)`).run();
    ensureTrpgTables(db);
    return db;
  }
  const usage = () => ({
    modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
    inputTokens: TRPG_GM_USAGE_FALLBACK.inputTokens,
    outputTokens: TRPG_GM_USAGE_FALLBACK.outputTokens,
  });

  it("governed campaign: a billing fault then retry applies the strike once, bills once and never recalls the GM", async () => {
    const db = chargedDb();
    const seat = setup(db, [{ ...WOLF, activateRound: 1 }]);
    let gmCalls = 0;
    const play = (fault?: TrpgEngineDeps["billingFault"]): TrpgEngineDeps => ({
      skipBilling: false,
      billingFault: fault,
      rollD20: () => 15,
      rollDie: () => 4,
      gmCall: async () => {
        gmCalls += 1;
        return { text: gmWith(seat.hostId, 5), usage: usage() };
      },
    });
    await startTrpgCampaign(db, { campaignId: seat.campaignId, userId: 1, deps: { ...play(), skipBilling: true } });
    creditPointsWithIds(db, 1, computeTrpgRoundPoints([usage()]) + 200, "PAID", "test-credit-PAID");
    const before = getPointBalanceOnDb(db, 1).total;
    submitTrpgAction(db, { campaignId: seat.campaignId, userId: 1, body: "문을 두드린다.", actionType: "investigate" });
    await advanceTrpgCampaign(db, { campaignId: seat.campaignId, userId: 1, deps: play("billing_persist") });
    assert.equal(hpOf(db, seat.hostId), 40, "the faulted commit rolled back, including the strike");
    assert.equal(getPointBalanceOnDb(db, 1).total, before);
    const callsAfterFault = gmCalls;
    await advanceTrpgCampaign(db, { campaignId: seat.campaignId, userId: 1, deps: play() });
    assert.equal(gmCalls, callsAfterFault, "retry commits the pending GM result without a provider call");
    const roundId = roundIdByNumber(db, seat.campaignId, 1);
    const strikes = loadMechanicsResolution(db, roundId)!.threatStrikes!;
    assert.equal(strikes.length, 1);
    assert.equal(hpOf(db, seat.hostId), 40 - strikes[0]!.dice!.amount, "one server hit, GM's 5 ignored");
    const row = db.prepare(`SELECT billed, billed_points FROM trpg_rounds WHERE id=?`).get(roundId) as { billed: number; billed_points: number };
    assert.equal(row.billed, 1);
    const charged = before - getPointBalanceOnDb(db, 1).total;
    assert.equal(charged, row.billed_points);
    assert.ok(charged > 0);
    await advanceTrpgCampaign(db, { campaignId: seat.campaignId, userId: 1, deps: play() });
    assert.equal(before - getPointBalanceOnDb(db, 1).total, charged, "no second charge");
    assert.deepEqual(loadThreatStrikeCounts(db, seat.campaignId, 0), { enc_hunter: 1 });
    db.close();
  });

  it("governed ending through a billing fault and retry: ended once, strike once, one charge, no GM re-call, no strike next round", async () => {
    const db = chargedDb();
    const seat = setup(db, [{ ...WOLF, activateRound: 1, maxStrikes: 6 }]);
    let gmCalls = 0;
    const play = (fault?: TrpgEngineDeps["billingFault"]): TrpgEngineDeps => ({
      skipBilling: false,
      billingFault: fault,
      rollD20: () => 15,
      rollDie: () => 4,
      gmCall: async () => {
        gmCalls += 1;
        return {
          text: buildTrpgGmStructuredWireText("사냥꾼이 쓰러졌다. GM: 무엇을 하겠는가.", {
            players: [{ participantId: seat.hostId, hp: 40 }],
            location: "복도",
            next_round_context: "다음",
            campaign_finished: false,
            encountersEnded: ["enc_hunter"],
          }),
          usage: usage(),
        };
      },
    });
    await startTrpgCampaign(db, { campaignId: seat.campaignId, userId: 1, deps: { ...play(), skipBilling: true } });
    creditPointsWithIds(db, 1, (computeTrpgRoundPoints([usage()]) + 200) * 2, "PAID", "test-credit-PAID");
    const before = getPointBalanceOnDb(db, 1).total;
    submitTrpgAction(db, { campaignId: seat.campaignId, userId: 1, body: "맞서 싸운다.", actionType: "investigate" });
    await advanceTrpgCampaign(db, { campaignId: seat.campaignId, userId: 1, deps: play("billing_persist") });
    assert.deepEqual(loadEndedEncounterIds(db, seat.campaignId, 999), [], "the faulted commit rolled back the ending too");
    const callsAfterFault = gmCalls;
    await advanceTrpgCampaign(db, { campaignId: seat.campaignId, userId: 1, deps: play() });
    assert.equal(gmCalls, callsAfterFault);
    assert.deepEqual(loadEndedEncounterIds(db, seat.campaignId, 999), ["enc_hunter"]);
    assert.equal(logRows(db, seat), 2, "opening + round 1, one row each");
    const round1 = roundIdByNumber(db, seat.campaignId, 1);
    const strikes = loadMechanicsResolution(db, round1)!.threatStrikes!;
    assert.equal(strikes.length, 1);
    assert.equal(hpOf(db, seat.hostId), 40 - strikes[0]!.dice!.amount);
    const charged = before - getPointBalanceOnDb(db, 1).total;
    assert.equal((db.prepare(`SELECT billed FROM trpg_rounds WHERE id=?`).get(round1) as { billed: number }).billed, 1);
    await advanceTrpgCampaign(db, { campaignId: seat.campaignId, userId: 1, deps: play() });
    assert.equal(before - getPointBalanceOnDb(db, 1).total, charged, "duplicate advance does not charge again");
    assert.equal(logRows(db, seat), 2, "duplicate commit does not write a second ending");
    submitTrpgAction(db, { campaignId: seat.campaignId, userId: 1, body: "쉰다.", actionType: "investigate" });
    await advanceTrpgCampaign(db, { campaignId: seat.campaignId, userId: 1, deps: play() });
    assert.equal((loadMechanicsResolution(db, roundIdByNumber(db, seat.campaignId, 2))!.threatStrikes ?? []).length, 0);
    db.close();
  });

  it("an existing server tick and a strike in the same round both apply; GM numbers do not override either", async () => {
    const db = memoryDb();
    const seat = setup(db, [{ ...WOLF, activateRound: 1 }]);
    const deps = makeDeps({ script: [null, 40], hostId: () => seat.hostId, d20: 3, die: 4 });
    await startTrpgCampaign(db, { campaignId: seat.campaignId, userId: 1, deps });
    applyPostGmOngoingSeeds(db, { campaignId: seat.campaignId, roundNumber: 0, seeds: [{ participantId: seat.hostId, family: "POISON" }] });
    const deps2 = makeDeps({ script: [40], hostId: () => seat.hostId, d20: 15, die: 4 });
    await playRound(db, seat, deps2, "문을 두드린다.");
    const resolution = loadMechanicsResolution(db, roundIdByNumber(db, seat.campaignId, 1))!;
    const tick = resolution.ongoingTicks.reduce((sum, row) => sum + row.dice?.amount ?? 0, 0);
    const strike = resolution.threatStrikes![0]!.dice!.amount;
    assert.ok(tick > 0 && strike > 0);
    assert.equal(hpOf(db, seat.hostId), 40 - tick - strike);
    db.close();
  });

  it("the GM sees authored threats in the existing plan block, with their place", () => {
    const plan = parseTrpgScenarioPlan({ ...PLAN, encounters: [WOLF] })!;
    assert.match(serializeTrpgScenarioPlanForGm(plan), /그림자 사냥꾼 @ 복도/);
    assert.doesNotMatch(serializeTrpgScenarioPlanForGm(parseTrpgScenarioPlan(PLAN)), /승인된 위협/);
  });

  it("applying an AI draft in the editor keeps the author's encounters and never takes generated ones", () => {
    const merged = mergeScenarioDraft({
      mode: "fill_empty",
      existing: { title: "폐역", plan: { ...emptyTrpgScenarioPlan(), ...PLAN, encounters: [WOLF] } },
      generated: parseScenarioDraftJson(JSON.stringify({ title: "t", summary: "s", ...PLAN, encounters: [{ ...WOLF, id: "model" }] })),
    });
    assert.deepEqual(merged.plan.encounters, [WOLF]);
    const noAuthored = mergeScenarioDraft({
      mode: "fill_empty",
      existing: { title: "폐역", plan: { ...emptyTrpgScenarioPlan(), ...PLAN } },
      generated: parseScenarioDraftJson(JSON.stringify({ title: "t", summary: "s", ...PLAN, encounters: [WOLF] })),
    });
    assert.equal("encounters" in noAuthored.plan, false);
  });
});

type EndStep = { hp?: number | null; ended?: string[]; location?: string; extra?: Record<string, unknown> };

function scriptedGm(seat: Seat, steps: EndStep[], extraPlayers: number[] = []) {
  let call = 0;
  const deps: TrpgEngineDeps = {
    skipBilling: true,
    rollD20: () => 15,
    rollDie: () => 4,
    gmCall: async () => {
      const step = steps[call] ?? {};
      call += 1;
      const players = [seat.hostId, ...extraPlayers].map((participantId) => ({
        participantId,
        ...(step.hp != null ? { hp: step.hp } : {}),
        ...(step.location ? { location: step.location } : {}),
      }));
      return {
        text: buildTrpgGmStructuredWireText("복도의 공기가 무겁게 가라앉았다. GM: 무엇을 하겠는가.", {
          players,
          location: step.location ?? "복도",
          next_round_context: "다음",
          campaign_finished: false,
          ...(step.ended ? { encountersEnded: step.ended } : {}),
          ...(step.extra ?? {}),
        }),
      };
    },
  };
  return deps;
}

const strikesOf = (db: Database.Database, seat: Seat, n: number) =>
  loadMechanicsResolution(db, roundIdByNumber(db, seat.campaignId, n))?.threatStrikes ?? [];
const ended = (db: Database.Database, seat: Seat) => loadEndedEncounterIds(db, seat.campaignId, 999);
const logRows = (db: Database.Database, seat: Seat) =>
  (db.prepare(`SELECT COUNT(*) AS n FROM trpg_state_change_log WHERE campaign_id=?`).get(seat.campaignId) as { n: number }).n;
const HUNTER: TrpgScenarioEncounter = { ...WOLF, activateRound: 1, maxStrikes: 6 };

describe("encounter authority: suppress-only GM ending", () => {
  it("a same-place enemy strikes, the GM ends it with its id, and it never strikes again while the party stays", async () => {
    const db = memoryDb();
    const seat = setup(db, [HUNTER]);
    const deps = scriptedGm(seat, [{}, { hp: 40 }, { hp: 40, ended: ["enc_hunter"] }, { hp: 5 }, { hp: 5 }]);
    await startTrpgCampaign(db, { campaignId: seat.campaignId, userId: 1, deps });
    await playRound(db, seat, deps, "문을 두드린다.");
    assert.equal(hpOf(db, seat.hostId), 32);
    await playRound(db, seat, deps, "벽을 살핀다.");
    assert.equal(strikesOf(db, seat, 2).length, 1);
    assert.equal(hpOf(db, seat.hostId), 24, "round 2 strike was decided before narration; GM's 40 and its ending do not undo it");
    assert.deepEqual(loadEndedEncounterIds(db, seat.campaignId, 2), [], "round 2 itself cannot see an ending proposed in round 2");
    await playRound(db, seat, deps, "쓰러진 사냥꾼 곁에 머문다.");
    assert.equal(strikesOf(db, seat, 3).length, 0, "ended threat cannot strike the next round even with the party still there");
    assert.deepEqual(ended(db, seat), ["enc_hunter"]);
    assert.equal(hpOf(db, seat.hostId), 24);
    await playRound(db, seat, deps, "숨을 고른다.");
    assert.equal(hpOf(db, seat.hostId), 24, "GM HP 5 is still ignored: ending the only threat does not hand HP authority back");
    db.close();
  });

  it("without an ending id the narrated defeat is only text: npcsRemove / flags do not stop strikes", async () => {
    const db = memoryDb();
    const seat = setup(db, [HUNTER]);
    const deps = scriptedGm(seat, [{}, {}, { extra: { npcsRemove: ["그림자 사냥꾼"], flagsAdd: ["사냥꾼 처치됨"] } }, {}]);
    await startTrpgCampaign(db, { campaignId: seat.campaignId, userId: 1, deps });
    await playRound(db, seat, deps, "문을 두드린다.");
    await playRound(db, seat, deps, "맞서 싸운다.");
    await playRound(db, seat, deps, "쉰다.");
    assert.equal(strikesOf(db, seat, 3).length, 1);
    assert.deepEqual(ended(db, seat), []);
    db.close();
  });

  it("unknown ids and encounters nobody is near cannot be ended; a different encounter keeps striking and is not ended by mistake", async () => {
    const db = memoryDb();
    const far: TrpgScenarioEncounter = { ...HUNTER, id: "enc_archive", name: "서고지기", location: "서고" };
    const seat = setup(db, [HUNTER, far]);
    const deps = scriptedGm(seat, [{}, { ended: ["ghost", "enc_archive", "서고지기"] }, { ended: ["enc_hunter"] }, { location: "서고" }, {}, {}]);
    await startTrpgCampaign(db, { campaignId: seat.campaignId, userId: 1, deps });
    await playRound(db, seat, deps, "문을 두드린다.");
    assert.deepEqual(ended(db, seat), [], "unknown id, cross-scene id and a free-text name are all rejected");
    await playRound(db, seat, deps, "벽을 살핀다.");
    assert.deepEqual(strikesOf(db, seat, 2).map((row) => row.encounterId), ["enc_hunter"]);
    await playRound(db, seat, deps, "서고로 간다.");
    assert.deepEqual(ended(db, seat), ["enc_hunter"]);
    assert.deepEqual(strikesOf(db, seat, 3), [], "enc_hunter is ended and the party has not reached the archive yet");
    await playRound(db, seat, deps, "서가를 본다.");
    assert.deepEqual(strikesOf(db, seat, 4).map((row) => row.encounterId), ["enc_archive"], "the other place's threat was never ended");
    db.close();
  });

  it("two enemies in one place are independent: ending one leaves the other striking", async () => {
    const db = memoryDb();
    const other: TrpgScenarioEncounter = { ...HUNTER, id: "enc_hound", name: "그림자 사냥개" };
    const seat = setup(db, [HUNTER, other]);
    const deps = scriptedGm(seat, [{}, {}, { ended: ["enc_hunter"] }, {}]);
    await startTrpgCampaign(db, { campaignId: seat.campaignId, userId: 1, deps });
    await playRound(db, seat, deps, "문을 두드린다.");
    await playRound(db, seat, deps, "맞서 싸운다.");
    assert.equal(strikesOf(db, seat, 2).length, 2);
    await playRound(db, seat, deps, "사냥개를 경계한다.");
    assert.deepEqual(strikesOf(db, seat, 3).map((row) => row.encounterId), ["enc_hound"]);
    db.close();
  });

  it("a GM-invented enemy gets no HP authority, and ending it by id does nothing", async () => {
    const db = memoryDb();
    const seat = setup(db, [{ ...HUNTER, location: "서고" }]);
    const deps = scriptedGm(seat, [{}, { hp: 10, ended: ["new_goblin"], extra: { npcsAdd: ["새 고블린"], flagsAdd: ["고블린 습격"] } }, { hp: 10 }]);
    await startTrpgCampaign(db, { campaignId: seat.campaignId, userId: 1, deps });
    await playRound(db, seat, deps, "문을 두드린다.");
    await playRound(db, seat, deps, "문을 다시 두드린다.");
    assert.equal(hpOf(db, seat.hostId), 40);
    assert.deepEqual(ended(db, seat), []);
    assert.equal(strikesOf(db, seat, 1).length + strikesOf(db, seat, 2).length, 0);
    db.close();
  });

  it("the opening scene cannot pre-end an authored threat", async () => {
    const db = memoryDb();
    const seat = setup(db, [HUNTER]);
    const deps = scriptedGm(seat, [{ ended: ["enc_hunter"] }, {}]);
    await startTrpgCampaign(db, { campaignId: seat.campaignId, userId: 1, deps });
    await playRound(db, seat, deps, "문을 두드린다.");
    assert.equal(strikesOf(db, seat, 1).length, 1);
    assert.deepEqual(ended(db, seat), []);
    db.close();
  });

  it("an existing server tick and recovery keep working after the enemy is ended", async () => {
    const db = memoryDb();
    const seat = setup(db, [HUNTER]);
    const deps = scriptedGm(seat, [{}, { ended: ["enc_hunter"] }, {}]);
    await startTrpgCampaign(db, { campaignId: seat.campaignId, userId: 1, deps });
    applyPostGmOngoingSeeds(db, { campaignId: seat.campaignId, roundNumber: 0, seeds: [{ participantId: seat.hostId, family: "POISON" }] });
    await playRound(db, seat, deps, "문을 두드린다.");
    const round1 = loadMechanicsResolution(db, roundIdByNumber(db, seat.campaignId, 1))!;
    assert.equal(round1.ongoingTicks.length, 1, "server tick and strike compose in the ending round");
    assert.equal(round1.threatStrikes?.length, 1);
    const stillActive = loadOngoingEffects(db, seat.campaignId).some((effect) => effect.stackKey === "poison" && effect.remainingTicks !== 0);
    await playRound(db, seat, deps, "숨을 고른다.");
    const round2 = loadMechanicsResolution(db, roundIdByNumber(db, seat.campaignId, 2))!;
    assert.equal(round2.threatStrikes?.length ?? 0, 0);
    if (stillActive) assert.ok(round2.ongoingTicks.length + round2.recoveries.length > 0, "poison owner kept running after the ending");
    db.close();
  });

  it("2 humans + 2 AI: two encounters in two places end independently and never mix targets", async () => {
    const db = memoryDb();
    db.prepare(`INSERT INTO users (id, email, nickname, points) VALUES (2,'b@t','태현',5000)`).run();
    const w2: TrpgScenarioEncounter = { ...HUNTER, id: "enc_cellar", name: "지하 감시자", location: "지하" };
    const seat = setup(db, [HUNTER, w2]);
    const invite = (db.prepare(`SELECT invite_code FROM trpg_campaigns WHERE id=?`).get(seat.campaignId) as { invite_code: string }).invite_code;
    joinTrpgCampaign(db, { code: invite, userId: 2, nickname: "태현" });
    saveTrpgSheet(db, { campaignId: seat.campaignId, userId: 2, name: "태현", stats: EVEN_STATS });
    const human2 = (db.prepare(`SELECT id FROM trpg_participants WHERE campaign_id=? AND user_id=2`).get(seat.campaignId) as { id: number }).id;
    const ai: number[] = [];
    for (const [slot, name, place] of [[2, "유나", "복도"], [3, "카이", "지하"]] as const) {
      const id = insertParticipant(db, { campaignId: seat.campaignId, slotIndex: slot, kind: "ai_character", userId: null, characterId: null, displayName: name });
      writeSheet(db, seat.campaignId, id, name, EVEN_STATS, place);
      ai.push(id);
    }
    const deps = scriptedGm(seat, [{}, { ended: ["enc_cellar"] }, { ended: ["enc_hunter"] }, {}]);
    deps.botCall = async () => ({ text: "조용히 주변을 살핀다." });
    await startTrpgCampaign(db, { campaignId: seat.campaignId, userId: 1, deps });
    const act = async () => {
      submitTrpgAction(db, { campaignId: seat.campaignId, userId: 1, body: "주변을 둘러본다.", actionType: "investigate" });
      submitTrpgAction(db, { campaignId: seat.campaignId, userId: 2, body: "문을 살핀다.", actionType: "investigate" });
      await advanceTrpgCampaign(db, { campaignId: seat.campaignId, userId: 1, deps });
    };
    await act();
    const r1 = strikesOf(db, seat, 1);
    assert.deepEqual(r1.map((row) => row.encounterId).sort(), ["enc_cellar", "enc_hunter"]);
    const cellar = r1.find((row) => row.encounterId === "enc_cellar")!;
    const hall = r1.find((row) => row.encounterId === "enc_hunter")!;
    assert.deepEqual(cellar.eligibleParticipantIds, [ai[1]!], "the cellar threat can only reach the seat in the cellar");
    assert.deepEqual(hall.eligibleParticipantIds, [seat.hostId, human2, ai[0]!].sort((a, b) => a - b));
    assert.deepEqual(ended(db, seat), ["enc_cellar"]);
    const cellarSeatHp = hpOf(db, ai[1]!);
    await act();
    const r2 = strikesOf(db, seat, 2);
    assert.deepEqual(r2.map((row) => row.encounterId), ["enc_hunter"], "only the ended cellar threat stopped");
    assert.ok(r2[0]!.eligibleParticipantIds.every((id) => id !== ai[1]!));
    assert.equal(hpOf(db, ai[1]!), cellarSeatHp, "the cellar seat is untouched once its threat ended");
    await act();
    assert.deepEqual(ended(db, seat).sort(), ["enc_cellar", "enc_hunter"]);
    assert.equal(strikesOf(db, seat, 3).length, 0);
    db.close();
  });
});

describe("encounter authority: regeneration and pure ending rules", () => {
  it("regeneration neither adds nor removes an ending", async () => {
    const db = memoryDb();
    const seat = setup(db, [HUNTER]);
    const deps = scriptedGm(seat, [{}, {}, { ended: ["enc_hunter"] }, {}]);
    await startTrpgCampaign(db, { campaignId: seat.campaignId, userId: 1, deps });
    await playRound(db, seat, deps, "문을 두드린다.");
    await regenerateTrpgNarration(db, { campaignId: seat.campaignId, userId: 1, deps });
    assert.deepEqual(ended(db, seat), [], "a regenerated GM result proposing an ending is not committed state");
    const hp = hpOf(db, seat.hostId);
    const deps2 = scriptedGm(seat, [{ ended: ["enc_hunter"] }, { ended: [] }]);
    await playRound(db, seat, deps2, "벽을 살핀다.");
    assert.deepEqual(ended(db, seat), ["enc_hunter"]);
    const rows = logRows(db, seat);
    await regenerateTrpgNarration(db, { campaignId: seat.campaignId, userId: 1, deps: deps2 });
    assert.deepEqual(ended(db, seat), ["enc_hunter"], "regeneration cannot undo an accepted ending");
    assert.equal(logRows(db, seat), rows);
    assert.ok(hpOf(db, seat.hostId) < hp, "round 2 strike remained");
    db.close();
  });

  it("acceptEncountersEnded: only known, present, not-yet-ended ids are accepted, once", () => {
    const encounters = [HUNTER, { ...HUNTER, id: "enc_archive", name: "서고지기", location: "서고" }];
    const result = acceptEncountersEnded({
      proposed: ["enc_hunter", "enc_hunter", "enc_archive", "ghost", " enc_archive "],
      encounters,
      alreadyEnded: [],
      seatLocations: ["복도"],
    });
    assert.deepEqual(result.accepted, ["enc_hunter"]);
    assert.deepEqual(result.rejected.map((row) => `${row.id}:${row.reason}`), [
      "enc_hunter:duplicate",
      "enc_archive:not_in_scene",
      "ghost:unknown",
      "enc_archive:duplicate",
    ]);
    const again = acceptEncountersEnded({ proposed: ["enc_hunter"], encounters, alreadyEnded: ["enc_hunter"], seatLocations: ["복도"] });
    assert.deepEqual(again.accepted, []);
    assert.equal(again.rejected[0]?.reason, "already_ended");
    assert.deepEqual(acceptEncountersEnded({ proposed: undefined, encounters, alreadyEnded: [], seatLocations: ["복도"] }).accepted, []);
  });

  it("the GM-facing surfaces expose stable ids and the single typed field without a new prompt section", () => {
    const plan = parseTrpgScenarioPlan({ ...PLAN, encounters: [WOLF] })!;
    assert.match(serializeTrpgScenarioPlanForGm(plan), /\[enc_hunter\] 그림자 사냥꾼 @ 복도/);
    const props = (TRPG_GM_STRUCTURED_RESPONSE_FORMAT.json_schema.schema.properties.delta.properties as Record<string, unknown>);
    assert.ok("encountersEnded" in props);
  });
});

describe("encounter authority: malformed author config is rejected at the save boundary", () => {
  const base = { title: "폐역", summary: "유령 기차", content: "유령 기차를 기다린다.", visibility: "public" as const, startLocation: "복도" };
  const tryInsert = (db: Database.Database, encounters: unknown) =>
    insertScenarioTemplate(db, 7, { ...base, scenarioPlan: { ...PLAN, encounters } as never });
  const count = (db: Database.Database) => (db.prepare(`SELECT COUNT(*) AS n FROM trpg_scenario_templates`).get() as { n: number }).n;

  it("rejects each malformed encounter instead of silently dropping it", () => {
    const db = memoryDb();
    const bad: Array<[string, unknown, RegExp]> = [
      ["missing location", [{ ...WOLF, location: "" }], /장소\(location\)가 없습니다/],
      ["bad damage class", [{ ...WOLF, damageClass: "NONE" }], /damageClass/],
      ["bad activateRound", [{ ...WOLF, activateRound: 0 }], /activateRound/],
      ["bad hitDc", [{ ...WOLF, hitDc: 99 }], /hitDc/],
      ["duplicate id", [WOLF, { ...WOLF, name: "다른 적" }], /중복/],
      ["bad kind", [{ ...WOLF, kind: "ally" }], /kind/],
      ["maxStrikes over cap", [{ ...WOLF, maxStrikes: 99 }], /maxStrikes/],
      ["not an array", { id: "x" }, /목록 형식/],
      ["row not an object", ["적"], /객체 형식/],
      ["too many", Array.from({ length: 7 }, (_, i) => ({ ...WOLF, id: `e${i}`, name: `적${i}` })), /최대/],
      ["one bad row among good rows", [WOLF, { ...WOLF, id: "second", location: "" }], /#2/],
    ];
    for (const [label, encounters, pattern] of bad) {
      assert.throws(() => tryInsert(db, encounters), pattern, label);
    }
    assert.equal(count(db), 0, "nothing was stored");
    db.close();
  });

  it("also rejects on update and for a JSON-string plan; absent, null and empty encounters stay valid", () => {
    const db = memoryDb();
    const id = tryInsert(db, [WOLF]);
    assert.throws(
      () => updateScenarioTemplate(db, id, 7, { ...base, scenarioPlan: { ...PLAN, encounters: [{ ...WOLF, location: "" }] } as never }),
      /장소\(location\)/
    );
    assert.throws(
      () => insertScenarioTemplate(db, 7, { ...base, scenarioPlan: JSON.stringify({ ...PLAN, encounters: [{ ...WOLF, damageClass: "X" }] }) as never }),
      /damageClass/
    );
    for (const encounters of [undefined, null, []]) {
      assert.doesNotThrow(() => tryInsert(db, encounters));
    }
    const stored = db.prepare(`SELECT scenario_plan_json FROM trpg_scenario_templates WHERE id=?`).get(id) as { scenario_plan_json: string };
    assert.equal(parseTrpgScenarioPlan(stored.scenario_plan_json)?.encounters?.[0]?.location, "복도", "a rejected update leaves the stored plan intact");
    db.close();
  });

  it("rejects an explicitly passed unparsable JSON plan string instead of saving it without the plan", () => {
    const db = memoryDb();
    for (const broken of ['{"encounters":[{"id":"x"', "not json", '{"encounters": [}', "{'encounters': []}"]) {
      assert.throws(
        () => insertScenarioTemplate(db, 7, { ...base, scenarioPlan: broken as never }),
        /시나리오 계획\(scenarioPlan\) JSON을 읽을 수 없습니다/,
        broken
      );
    }
    assert.equal(count(db), 0, "nothing was stored");
    db.close();
  });

  it("an update with a broken JSON plan string is rejected and the stored valid encounters are preserved", () => {
    const db = memoryDb();
    const id = tryInsert(db, [WOLF]);
    const before = (db.prepare(`SELECT scenario_plan_json, updated_at FROM trpg_scenario_templates WHERE id=?`).get(id) as { scenario_plan_json: string; updated_at: string });
    assert.throws(
      () => updateScenarioTemplate(db, id, 7, { ...base, title: "바뀐 제목", scenarioPlan: '{"encounters":[{"id":"x"' as never }),
      /JSON을 읽을 수 없습니다/
    );
    const after = db.prepare(`SELECT title, scenario_plan_json, updated_at FROM trpg_scenario_templates WHERE id=?`).get(id) as { title: string; scenario_plan_json: string; updated_at: string };
    assert.equal(after.scenario_plan_json, before.scenario_plan_json);
    assert.equal(after.title, "폐역", "the rejected update changed nothing");
    assert.deepEqual(parseTrpgScenarioPlan(after.scenario_plan_json)?.encounters, [WOLF]);
    db.close();
  });

  it("valid JSON strings, empty/whitespace strings, and unset/null/empty encounters keep working", () => {
    const db = memoryDb();
    assert.doesNotThrow(() => insertScenarioTemplate(db, 7, { ...base, scenarioPlan: JSON.stringify({ ...PLAN, encounters: [WOLF] }) as never }));
    assert.doesNotThrow(() => insertScenarioTemplate(db, 7, { ...base, scenarioPlan: JSON.stringify(PLAN) as never }));
    assert.doesNotThrow(() => insertScenarioTemplate(db, 7, { ...base, scenarioPlan: JSON.stringify({ ...PLAN, encounters: null }) as never }));
    assert.doesNotThrow(() => insertScenarioTemplate(db, 7, { ...base, scenarioPlan: JSON.stringify({ ...PLAN, encounters: [] }) as never }));
    assert.doesNotThrow(() => insertScenarioTemplate(db, 7, { ...base, scenarioPlan: "   " as never }));
    assert.doesNotThrow(() => insertScenarioTemplate(db, 7, { ...base, scenarioPlan: "" as never }));
    assert.doesNotThrow(() => insertScenarioTemplate(db, 7, { ...base, scenarioPlan: undefined }));
    const stored = db.prepare(`SELECT scenario_plan_json FROM trpg_scenario_templates WHERE id=1`).get() as { scenario_plan_json: string };
    assert.deepEqual(parseTrpgScenarioPlan(stored.scenario_plan_json)?.encounters, [WOLF]);
    db.close();
  });

  it("a valid config still reaches governed play, and model drafts still cannot create or overwrite it", () => {
    const db = memoryDb();
    const id = tryInsert(db, [WOLF]);
    const stored = db.prepare(`SELECT scenario_plan_json FROM trpg_scenario_templates WHERE id=?`).get(id) as { scenario_plan_json: string };
    assert.deepEqual(parseTrpgScenarioPlan(stored.scenario_plan_json)?.encounters, [WOLF]);
    const merged = mergeScenarioDraft({
      mode: "regenerate_all",
      existing: { title: "폐역", plan: { ...emptyTrpgScenarioPlan(), ...PLAN, encounters: [WOLF] } },
      generated: parseScenarioDraftJson(JSON.stringify({ title: "t", summary: "s", ...PLAN, encounters: [{ ...WOLF, id: "model", location: "" }] })),
    });
    assert.deepEqual(merged.plan.encounters, [WOLF]);
    db.close();
  });
});
