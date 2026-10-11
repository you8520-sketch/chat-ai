import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { creditPointsWithIds, getPointBalanceOnDb } from "@/lib/points";
import { CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL } from "@/lib/chatModels";
import { computeTrpgRoundPoints, TRPG_GM_USAGE_FALLBACK } from "./billing";
import { loadAcceptedRoundLocation, loadCampaignLedger } from "./campaignLedger";
import { EVEN_STATS, createTrpgCampaign, joinTrpgCampaign, saveTrpgSheet, writeSheet } from "./engineCreate";
import {
  advanceTrpgCampaign,
  regenerateTrpgNarration,
  startTrpgCampaign,
  submitTrpgAction,
  type TrpgEngineDeps,
} from "./engineAdvance";
import { buildTrpgGmStructuredWireText } from "./gmStructuredOutput";
import { loadMechanicsResolution } from "./mechanicsStore";
import { buildCampaignMemoryPrompt } from "./memory";
import type { TrpgScenarioEncounter } from "./scenarioPlan";
import { insertScenarioTemplate } from "./scenarioTemplates";
import { ensureTrpgTables } from "./schema";
import { insertParticipant } from "./store";

/**
 * Real-engine proof for #1541: declared movement reaches ledger, sheets, accepted-round snapshot and
 * next-round hook together; the #1555 server strike follows where each seat really is.
 */

const LIGHTHOUSE = "곶 끝의 등대";
const GUARD: TrpgScenarioEncounter = {
  id: "enc_watch",
  name: "등대 감시자",
  kind: "enemy",
  damageClass: "MEDIUM",
  activateRound: 1,
  maxStrikes: 6,
  hitDc: 10,
  location: LIGHTHOUSE,
};
const PLAN = {
  startingSituation: "항구에 도착한다",
  centralConflict: "사라진 어선",
  goal: "등대의 비밀을 밝힌다",
  endingConditions: ["비밀을 밝힌다"],
};

function memoryDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, nickname TEXT, points INTEGER NOT NULL DEFAULT 0)`);
  db.prepare(`INSERT INTO users (id, email, nickname, points) VALUES (1,'a@t','렌',5000)`).run();
  db.prepare(`INSERT INTO users (id, email, nickname, points) VALUES (2,'b@t','현',5000)`).run();
  ensureTrpgTables(db);
  return db;
}

function setup(db: Database.Database, startLocation = "마레노 부두") {
  const templateId = insertScenarioTemplate(db, 7, {
    title: "마레노",
    summary: "해무의 항구",
    content: "항구도시에서 사건을 쫓는다.",
    visibility: "public",
    startLocation,
    scenarioPlan: { ...PLAN, encounters: [GUARD] },
  });
  const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1, templateId });
  saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
  const hostId = (db.prepare(`SELECT id FROM trpg_participants WHERE campaign_id=?`).get(campaignId) as { id: number }).id;
  return { campaignId, hostId };
}

const sheetAt = (db: Database.Database, participantId: number) =>
  db.prepare(`SELECT location, hp FROM trpg_character_sheets WHERE participant_id=?`).get(participantId) as {
    location: string;
    hp: number;
  };

function roundId(db: Database.Database, campaignId: number, n: number): number {
  return (
    db.prepare(`SELECT id FROM trpg_rounds WHERE campaign_id=? AND round_number=?`).get(campaignId, n) as { id: number }
  ).id;
}

type Step = { location: string; hook: string; seats?: Record<number, string>; extra?: Record<string, unknown> };

function scriptedGm(everyone: () => number[], steps: Step[]) {
  let call = 0;
  const deps = {
    skipBilling: true,
    rollD20: () => 15,
    rollDie: () => 4,
    botCall: async () => ({ text: "조용히 주변을 살핀다." }),
    gmCall: async (_args?: unknown) => {
      const step = steps[Math.min(call, steps.length - 1)]!;
      call += 1;
      return {
        text: buildTrpgGmStructuredWireText("해무가 짙게 깔린 장면이 이어진다. GM: 무엇을 하겠는가.", {
          players: everyone().map((participantId) => ({
            participantId,
            location: step.seats?.[participantId] ?? step.location,
          })),
          location: step.location,
          next_round_context: step.hook,
          campaign_finished: false,
          ...step.extra,
        }),
      };
    },
  } satisfies TrpgEngineDeps;
  return deps;
}

describe("movement authority: real engine path (#1541)", () => {
  it("a declared route persists to ledger, sheet, accepted-round snapshot and hook, and the enemy tracks the party", async () => {
    const db = memoryDb();
    const { campaignId, hostId } = setup(db);
    const steps: Step[] = [
      { location: "마레노 부두", hook: "부두에 선다." },
      { location: "곶 끝의 등대 외곽", hook: "렌은 등대 외곽에 도착했다." },
      { location: "곶 끝의 등대 내부", hook: "렌은 등대 안으로 올랐다." },
      { location: "곶 끝의 등대 내부", hook: "렌은 등대 안을 살핀다." },
      { location: "세관 청사 1층", hook: "렌은 세관에 들어섰다." },
      { location: "세관 청사 1층", hook: "렌은 세관 서류를 살핀다." },
      { location: "곶 끝의 등대 내부", hook: "GM이 임의로 등대로 되돌렸다." },
      {
        location: "곶 끝의 등대 내부",
        hook: "세관 서류 사이에서 밀수 장부가 나왔다. 렌은 등대 안으로 되돌아갔다.",
        extra: { npcsAdd: ["세관 직원: 밀수 장부를 보여 주었다"] },
      },
    ];
    const deps = scriptedGm(() => [hostId], steps);
    await startTrpgCampaign(db, { campaignId, userId: 1, deps });
    const play = async (body: string) => {
      submitTrpgAction(db, { campaignId, userId: 1, body, actionType: "free" });
      await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    };
    const strikes = (n: number) => loadMechanicsResolution(db, roundId(db, campaignId, n))?.threatStrikes?.length ?? 0;

    await play("곶 끝의 등대로 이동한다.");
    assert.equal(loadCampaignLedger(db, campaignId).location, "곶 끝의 등대 외곽");
    assert.equal(sheetAt(db, hostId).location, "곶 끝의 등대 외곽");
    assert.equal(loadAcceptedRoundLocation(db, roundId(db, campaignId, 1)), "곶 끝의 등대 외곽");
    assert.equal(loadCampaignLedger(db, campaignId).nextRoundContext, "렌은 등대 외곽에 도착했다.");

    await play("등대 위로 올라가 바다 쪽을 살핀다.");
    assert.equal(loadCampaignLedger(db, campaignId).location, "곶 끝의 등대 내부");
    assert.equal(sheetAt(db, hostId).location, "곶 끝의 등대 내부");
    assert.equal(strikes(2), 0, "round 2 starts at 외곽, which is not the threat's place");
    assert.equal(sheetAt(db, hostId).hp, 40);

    await play("등대 안을 둘러본다.");
    assert.equal(strikes(3), 1, "round 3 starts inside the lighthouse: the approved enemy attacks on its own");
    const hpAfterStrike = sheetAt(db, hostId).hp;
    assert.ok(hpAfterStrike < 40);

    await play("지금까지 알아낸 것을 정리하고, 다음에 가 볼 곳을 정해 세관으로 향한다.");
    assert.equal(loadCampaignLedger(db, campaignId).location, "세관 청사 1층");
    assert.equal(sheetAt(db, hostId).location, "세관 청사 1층");
    assert.equal(loadAcceptedRoundLocation(db, roundId(db, campaignId, 4)), "세관 청사 1층");
    assert.equal(strikes(4), 1, "the round the party leaves still resolves from where it stood");
    const hpAfterLeaving = sheetAt(db, hostId).hp;

    await play("세관 서류를 살핀다.");
    assert.equal(strikes(5), 0, "the party left the scene: its enemy cannot reach it");
    assert.equal(sheetAt(db, hostId).hp, hpAfterLeaving);
    assert.equal(loadCampaignLedger(db, campaignId).nextRoundContext, "렌은 세관 서류를 살핀다.");

    await play("세관 사무실의 장부를 정리한다.");
    assert.equal(loadCampaignLedger(db, campaignId).location, "세관 청사 1층", "the GM alone cannot send the party back");
    assert.equal(sheetAt(db, hostId).location, "세관 청사 1층");
    assert.equal(loadCampaignLedger(db, campaignId).nextRoundContext, "", "no stale or refused hook is kept");
    assert.equal(strikes(6), 0, "a scene the party already left does not attack it");
    assert.equal(sheetAt(db, hostId).hp, hpAfterLeaving);
    assert.equal(loadAcceptedRoundLocation(db, roundId(db, campaignId, 6)), "세관 청사 1층");

    await play("세관 서류를 더 뒤진다.");
    assert.equal(loadCampaignLedger(db, campaignId).location, "세관 청사 1층");
    assert.equal(loadCampaignLedger(db, campaignId).nextRoundContext, "");
    assert.deepEqual(
      loadCampaignLedger(db, campaignId).npcs,
      ["세관 직원: 밀수 장부를 보여 주었다"],
      "the clue found in place survives through the typed ledger, not the refused hook"
    );
    assert.equal(strikes(7), 0);
    db.close();
  });

  it("a refused exterior-to-interior relocation reaches the next prompt as the server's place, without the false entry, and keeps the typed clues", async () => {
    const db = memoryDb();
    const { campaignId, hostId } = setup(db, "곶 끝의 등대 외곽");
    const deps = scriptedGm(() => [hostId], [
      { location: "곶 끝의 등대 외곽", hook: "등대 외곽에 도착했다." },
      {
        location: "곶 끝의 등대 내부",
        hook: "렌은 등대 내부에 들어갔다. 외곽에서 종소리가 울렸다.",
        extra: { npcsAdd: ["종지기: 열쇠는 등대지기가 가졌다"], flagsAdd: ["종소리가 울렸다"] },
      },
      { location: "곶 끝의 등대 외곽", hook: "경비를 계속 선다." },
    ]);
    await startTrpgCampaign(db, { campaignId, userId: 1, deps });
    submitTrpgAction(db, { campaignId, userId: 1, body: "등대 외곽에서 경비를 선다.", actionType: "free" });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    const ledger = loadCampaignLedger(db, campaignId);
    assert.equal(ledger.location, "곶 끝의 등대 외곽");
    assert.equal(sheetAt(db, hostId).location, "곶 끝의 등대 외곽");
    assert.equal(loadAcceptedRoundLocation(db, roundId(db, campaignId, 1)), "곶 끝의 등대 외곽");
    assert.equal(ledger.nextRoundContext, "");
    const prompt = buildCampaignMemoryPrompt(db, campaignId);
    assert.match(prompt, /location=곶 끝의 등대 외곽/);
    assert.doesNotMatch(prompt, /\[NEXT DECISION\]/, "no stale and no refused hook is re-injected as the next decision");
    assert.match(prompt, /npcs: 종지기: 열쇠는 등대지기가 가졌다/);
    assert.match(prompt, /flags: 종소리가 울렸다/);
    assert.equal(loadMechanicsResolution(db, roundId(db, campaignId, 1))?.threatStrikes?.length ?? 0, 0);
    db.close();
  });

  it("2 humans + 2 AI move apart: each seat follows only its own declaration and only seats inside are struck", async () => {
    const db = memoryDb();
    const { campaignId, hostId } = setup(db);
    const invite = (db.prepare(`SELECT invite_code FROM trpg_campaigns WHERE id=?`).get(campaignId) as { invite_code: string })
      .invite_code;
    joinTrpgCampaign(db, { code: invite, userId: 2, nickname: "현" });
    saveTrpgSheet(db, { campaignId, userId: 2, name: "현", stats: EVEN_STATS });
    const human2 = (db.prepare(`SELECT id FROM trpg_participants WHERE campaign_id=? AND user_id=2`).get(campaignId) as { id: number }).id;
    const ai: number[] = [];
    for (const [slot, name] of [[2, "서하"], [3, "도윤"]] as const) {
      const id = insertParticipant(db, {
        campaignId,
        slotIndex: slot,
        kind: "ai_character",
        userId: null,
        characterId: null,
        displayName: name,
      });
      writeSheet(db, campaignId, id, name, EVEN_STATS, "마레노 부두");
      ai.push(id);
    }
    const everyone = [hostId, human2, ...ai];
    const aiBodies = new Map<number, string>([
      [ai[0]!, "렌을 따라 곶 끝의 등대로 이동한다."],
      [ai[1]!, "부두에 남아 짐을 지킨다."],
    ]);
    const deps = scriptedGm(() => everyone, [
      { location: "마레노 부두", hook: "부두." },
      { location: LIGHTHOUSE, hook: "등대 앞." },
      { location: LIGHTHOUSE, hook: "등대 안." },
    ]);
    let botTurn = 0;
    deps.botCall = async () => {
      const seat = ai[botTurn % ai.length]!;
      botTurn += 1;
      return { text: aiBodies.get(seat) ?? "주변을 살핀다." };
    };
    await startTrpgCampaign(db, { campaignId, userId: 1, deps });
    submitTrpgAction(db, { campaignId, userId: 1, body: "곶 끝의 등대로 이동한다.", actionType: "free" });
    submitTrpgAction(db, { campaignId, userId: 2, body: "부두 게시판을 살핀다.", actionType: "investigate" });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    const where = (id: number) => sheetAt(db, id).location;
    assert.equal(where(hostId), LIGHTHOUSE);
    assert.equal(where(human2), "마레노 부두", "the second human only read the notice board");
    assert.equal(where(ai[0]!), LIGHTHOUSE, "the AI that declared it follows");
    assert.equal(where(ai[1]!), "마레노 부두", "the AI that stayed is not moved by the GM's group placement");
    assert.equal(loadCampaignLedger(db, campaignId).nextRoundContext, "", "the GM's group-move hook is not kept when two seats stayed");

    submitTrpgAction(db, { campaignId, userId: 1, body: "등대 안을 살핀다.", actionType: "investigate" });
    submitTrpgAction(db, { campaignId, userId: 2, body: "부두를 살핀다.", actionType: "investigate" });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    const strike = loadMechanicsResolution(db, roundId(db, campaignId, 2))!.threatStrikes![0]!;
    assert.deepEqual(
      strike.eligibleParticipantIds,
      [hostId, ai[0]!].sort((a, b) => a - b),
      "only the seats that really stand in the lighthouse can be targeted"
    );
    db.close();
  });

  it("regeneration after an accepted move leaves ledger, sheet, snapshot and hook unchanged", async () => {
    const db = memoryDb();
    const { campaignId, hostId } = setup(db);
    const deps = scriptedGm(() => [hostId], [
      { location: "마레노 부두", hook: "부두." },
      { location: "마레노 어시장", hook: "렌은 어시장에 도착했다." },
      { location: "선원 조합 회관", hook: "재생성 서술이 임의로 장소를 바꿨다." },
    ]);
    await startTrpgCampaign(db, { campaignId, userId: 1, deps });
    submitTrpgAction(db, { campaignId, userId: 1, body: "어시장으로 가서 상인들에게 소문을 묻는다.", actionType: "persuade" });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    const id = roundId(db, campaignId, 1);
    const snapshotOf = () => ({
      ledger: loadCampaignLedger(db, campaignId),
      sheet: sheetAt(db, hostId).location,
      accepted: loadAcceptedRoundLocation(db, id),
    });
    const before = snapshotOf();
    assert.equal(before.ledger.location, "마레노 어시장");
    assert.equal(before.sheet, "마레노 어시장");
    await regenerateTrpgNarration(db, { campaignId, userId: 1, deps });
    assert.deepEqual(snapshotOf(), before);
    db.close();
  });

  it("a billing fault then retry persists the declared move once, bills once and never recalls the GM", async () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, nickname TEXT NOT NULL, points REAL NOT NULL DEFAULT 0, creator_points REAL NOT NULL DEFAULT 0);
      CREATE TABLE point_transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, point_type TEXT NOT NULL, remaining_amount REAL NOT NULL, expires_at TEXT NOT NULL);
      CREATE TABLE point_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, delta REAL NOT NULL, reason TEXT NOT NULL, message_id INTEGER, chat_id INTEGER);
      CREATE TABLE characters (id INTEGER PRIMARY KEY, name TEXT NOT NULL DEFAULT '', creator_id INTEGER, official INTEGER NOT NULL DEFAULT 0);
    `);
    db.prepare(`INSERT INTO users (id, email, nickname, points, creator_points) VALUES (1,'a@t','렌',0,0)`).run();
    ensureTrpgTables(db);
    const { campaignId, hostId } = setup(db);
    const usage = () => ({
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      inputTokens: TRPG_GM_USAGE_FALLBACK.inputTokens,
      outputTokens: TRPG_GM_USAGE_FALLBACK.outputTokens,
    });
    let gmCalls = 0;
    const base = scriptedGm(() => [hostId], [
      { location: "마레노 부두", hook: "부두." },
      { location: "마레노 어시장", hook: "렌은 어시장에 도착했다." },
    ]);
    const play = (fault?: TrpgEngineDeps["billingFault"]): TrpgEngineDeps => ({
      ...base,
      skipBilling: false,
      billingFault: fault,
      gmCall: async (args) => {
        gmCalls += 1;
        return { ...(await base.gmCall(args)), usage: usage() };
      },
    });
    await startTrpgCampaign(db, { campaignId, userId: 1, deps: { ...play(), skipBilling: true } });
    creditPointsWithIds(db, 1, computeTrpgRoundPoints([usage()]) + 200, "PAID", "test-credit-PAID");
    const before = getPointBalanceOnDb(db, 1).total;
    submitTrpgAction(db, { campaignId, userId: 1, body: "어시장으로 가서 상인들에게 소문을 묻는다.", actionType: "persuade" });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps: play("billing_persist") });
    assert.equal(loadCampaignLedger(db, campaignId).location, "마레노 부두", "the faulted commit rolled back the move too");
    assert.equal(getPointBalanceOnDb(db, 1).total, before);
    const callsAfterFault = gmCalls;
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps: play() });
    assert.equal(gmCalls, callsAfterFault, "retry commits the pending GM result without a provider call");
    assert.equal(loadCampaignLedger(db, campaignId).location, "마레노 어시장");
    assert.equal(sheetAt(db, hostId).location, "마레노 어시장");
    const row = db
      .prepare(`SELECT billed, billed_points FROM trpg_rounds WHERE id=?`)
      .get(roundId(db, campaignId, 1)) as { billed: number; billed_points: number };
    assert.equal(row.billed, 1);
    const charged = before - getPointBalanceOnDb(db, 1).total;
    assert.equal(charged, row.billed_points);
    assert.ok(charged > 0);
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps: play() });
    assert.equal(before - getPointBalanceOnDb(db, 1).total, charged, "no second charge");
    assert.equal(loadCampaignLedger(db, campaignId).location, "마레노 어시장");
    db.close();
  });
});
