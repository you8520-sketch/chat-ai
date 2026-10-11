import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { EVEN_STATS, createTrpgCampaign, saveTrpgSheet, writeSheet } from "./engineCreate";
import {
  advanceTrpgCampaign,
  regenerateTrpgNarration,
  startTrpgCampaign,
  submitTrpgAction,
  type TrpgEngineDeps,
} from "./engineAdvance";
import { loadCampaignContext } from "./campaignContext";
import { governedEncounters, resolveThreatStrikes } from "./encounterStrikes";
import { buildTrpgGmStructuredWireText } from "./gmStructuredOutput";
import { mergeMechanicsOwnedDelta } from "./mechanicsMerge";
import { resolveRoundMechanics } from "./mechanicsResolve";
import { loadMechanicsResolution, loadThreatStrikeCounts } from "./mechanicsStore";
import { parseScenarioEncounters, parseTrpgScenarioPlan, type TrpgScenarioEncounter } from "./scenarioPlan";
import { parseScenarioDraftJson } from "./scenarioDraft";
import { insertScenarioTemplate } from "./scenarioTemplates";
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
    ]);
    assert.deepEqual(rows.map((row) => row.id), ["enc_hunter", "trap"]);
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

  it("1 human + 2 AI seats: only the picked seat is struck; other seats are untouched", async () => {
    const db = memoryDb();
    const seat = setup(db, [{ ...WOLF, activateRound: 1 }]);
    const ai: number[] = [];
    for (const [slot, name] of [[1, "유나"], [2, "카이"]] as const) {
      const id = insertParticipant(db, {
        campaignId: seat.campaignId,
        slotIndex: slot,
        kind: "ai_character",
        userId: null,
        characterId: null,
        displayName: name,
      });
      writeSheet(db, seat.campaignId, id, name, EVEN_STATS, "");
      ai.push(id);
    }
    const deps = makeDeps({ script: [null, 10], hostId: () => seat.hostId, die: 2 });
    deps.botCall = async () => ({ text: "조용히 주변을 살핀다." });
    await startTrpgCampaign(db, { campaignId: seat.campaignId, userId: 1, deps });
    await playRound(db, seat, deps, "문을 두드린다.");
    const strike = loadMechanicsResolution(db, roundIdByNumber(db, seat.campaignId, 1))!.threatStrikes![0]!;
    assert.deepEqual(strike.eligibleParticipantIds, [seat.hostId, ...ai].sort((a, b) => a - b));
    const struck = strike.targetParticipantId;
    for (const id of [seat.hostId, ...ai]) {
      assert.equal(hpOf(db, id), id === struck ? 40 - 4 : 40, `participant ${id}`);
    }
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
