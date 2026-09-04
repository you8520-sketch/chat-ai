import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL } from "@/lib/chatModels";
import { creditPointsWithIds, getPointBalanceOnDb } from "@/lib/points";
import { computeTrpgRoundPoints } from "./billing";
import { EVEN_STATS, createTrpgCampaign, saveTrpgSheet, writeSheet } from "./engineCreate";
import {
  advanceTrpgCampaign,
  startTrpgCampaign,
  submitTrpgAction,
  type TrpgEngineDeps,
} from "./engineAdvance";
import { TRPG_GM_DELTA_OPEN, TRPG_GM_NARRATION_OPEN } from "./gmPrompt";
import { loadPendingGmResult } from "./pendingGmResult";
import { ensureTrpgTables } from "./schema";
import { insertParticipant } from "./store";
import {
  loadBillableRoundUsage,
  loadRoundUsageEntries,
  tagBotRoundUsage,
  tagGmRoundUsage,
  toModelUsageCalls,
} from "./roundUsage";
import type { TrpgModelUsage } from "./billing";

const VALID_DELTA = JSON.stringify({
  players: [],
  location: "문턱",
  next_round_context: "다음",
  campaign_finished: false,
});

function gmText(narration: string): string {
  return `${TRPG_GM_NARRATION_OPEN}\n${narration}\n${TRPG_GM_DELTA_OPEN}\n${VALID_DELTA}`;
}

const BAD_GM = `${TRPG_GM_NARRATION_OPEN}\n실패한 장면`;

function memoryDb(): Database.Database {
  const db = new Database(":memory:");
  ensureTrpgTables(db);
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      email TEXT,
      nickname TEXT NOT NULL,
      points REAL NOT NULL DEFAULT 0,
      creator_points REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE point_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      point_type TEXT NOT NULL,
      remaining_amount REAL NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE TABLE point_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      delta REAL NOT NULL,
      reason TEXT NOT NULL,
      message_id INTEGER,
      chat_id INTEGER
    );
  `);
  db.prepare(`INSERT INTO users (id, email, nickname, points, creator_points) VALUES (1,'a@t','렌',0,0)`).run();
  return db;
}

function roundByNumber(db: Database.Database, campaignId: number, roundNumber: number) {
  return db
    .prepare(`SELECT id, phase, billed, billed_points, usage_json FROM trpg_rounds WHERE campaign_id=? AND round_number=?`)
    .get(campaignId, roundNumber) as {
    id: number;
    phase: string;
    billed: number;
    billed_points: number;
    usage_json: string | null;
  };
}

function usage(inputTokens: number, outputTokens: number): TrpgModelUsage {
  return {
    modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
    inputTokens,
    outputTokens,
  };
}

const BOT1 = tagBotRoundUsage(usage(1000, 100));
const BOT2 = tagBotRoundUsage(usage(2000, 100));
const GM_FAIL = usage(3000, 300);
const GM_OK = usage(4000, 400);

async function setupTwoBotCampaign(db: Database.Database, budget: number): Promise<number> {
  const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1 });
  saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
  for (const [idx, name] of ["유나", "민수"].entries()) {
    const botId = insertParticipant(db, {
      campaignId,
      slotIndex: idx + 1,
      kind: "ai_character",
      userId: null,
      characterId: null,
      displayName: name,
    });
    writeSheet(db, campaignId, botId, name, EVEN_STATS, "");
  }
  creditPointsWithIds(db, 1, budget, "PAID", "test-budget");
  const opening: TrpgEngineDeps = {
    skipBilling: true,
    rollD20: () => 14,
    botCall: async () => ({ text: "유나.\n\n<<<INTENT>>>\n행동." }),
    gmCall: async () => ({ text: gmText("오프닝."), usage: usage(500, 50) }),
  };
  await startTrpgCampaign(db, { campaignId, userId: 1, deps: opening });
  return campaignId;
}

describe("failed GM usage billing isolation", () => {
  it("T1 — normal Bot1+Bot2+GM success billing unchanged", async () => {
    const db = memoryDb();
    let botIdx = 0;
    const bots = [BOT1, BOT2];
    const budget = computeTrpgRoundPoints([BOT1, BOT2, GM_OK]) + 500;
    const campaignId = await setupTwoBotCampaign(db, budget);
    let gmCalls = 0;
    const deps: TrpgEngineDeps = {
      rollD20: () => 14,
      botCall: async () => {
        const u = bots[botIdx++] ?? BOT2;
        return { text: "유나.\n\n<<<INTENT>>>\n행동.", usage: u };
      },
      gmCall: async () => {
        gmCalls += 1;
        return { text: gmText("성공 장면."), usage: GM_OK };
      },
    };
    submitTrpgAction(db, { campaignId, userId: 1, body: "앞으로." });
    const before = getPointBalanceOnDb(db, 1).total;
    const snap = await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    const round = roundByNumber(db, campaignId, 1);
    const expected = computeTrpgRoundPoints(toModelUsageCalls(loadBillableRoundUsage(db, round.id)));
    assert.equal(snap.round.phase, "ACTION_INPUT");
    assert.equal(round.billed, 1);
    assert.equal(round.billed_points, expected);
    assert.equal(getPointBalanceOnDb(db, 1).total, before - expected);
    assert.equal(gmCalls, 1);
    db.close();
  });

  it("T2 — parse fail then manual retry bills bots + successful GM only", async () => {
    const db = memoryDb();
    let botIdx = 0;
    const bots = [BOT1, BOT2];
    const budget =
      computeTrpgRoundPoints(toModelUsageCalls([BOT1, BOT2, tagGmRoundUsage(GM_OK, "x")])) +
      computeTrpgRoundPoints(toModelUsageCalls([tagGmRoundUsage(GM_FAIL, "y")])) +
      500;
    const campaignId = await setupTwoBotCampaign(db, budget);
    let gmCalls = 0;
    const deps: TrpgEngineDeps = {
      rollD20: () => 14,
      botCall: async () => {
        const u = bots[botIdx++] ?? BOT2;
        return { text: "유나.\n\n<<<INTENT>>>\n행동.", usage: u };
      },
      gmCall: async () => {
        gmCalls += 1;
        if (gmCalls === 1) return { text: BAD_GM, usage: GM_FAIL, finishReason: "stop" };
        return { text: gmText("재시도 성공."), usage: GM_OK, finishReason: "stop" };
      },
    };
    submitTrpgAction(db, { campaignId, userId: 1, body: "앞으로." });
    const snapFail = await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    const roundFail = roundByNumber(db, campaignId, 1);
    assert.equal(snapFail.round.phase, "ERROR_RECOVERY");
    assert.equal(roundFail.billed, 0);
    assert.equal(loadPendingGmResult(db, roundFail.id), null);
    assert.equal(loadRoundUsageEntries(db, roundFail.id).length, 3);

    const before = getPointBalanceOnDb(db, 1).total;
    const snapOk = await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    const roundOk = roundByNumber(db, campaignId, 1);
    const actual = loadRoundUsageEntries(db, roundOk.id);
    const billable = loadBillableRoundUsage(db, roundOk.id);
    assert.equal(actual.length, 4);
    assert.equal(billable.length, 3);
    assert.equal(snapOk.round.phase, "ACTION_INPUT");
    assert.equal(roundOk.billed, 1);
    const expectedBill = computeTrpgRoundPoints(toModelUsageCalls(loadBillableRoundUsage(db, roundOk.id)));
    assert.equal(roundOk.billed_points, expectedBill);
    assert.equal(getPointBalanceOnDb(db, 1).total, before - expectedBill);
    assert.equal(gmCalls, 2);
    db.close();
  });

  it("T4 — abnormal finish with usage then retry excludes failed GM from user bill", async () => {
    const db = memoryDb();
    let botIdx = 0;
    const bots = [BOT1, BOT2];
    const budget = 50_000;
    const campaignId = await setupTwoBotCampaign(db, budget);
    let gmCalls = 0;
    const deps: TrpgEngineDeps = {
      rollD20: () => 14,
      botCall: async () => {
        const u = bots[botIdx++] ?? BOT2;
        return { text: "유나.\n\n<<<INTENT>>>\n행동.", usage: u };
      },
      gmCall: async () => {
        gmCalls += 1;
        if (gmCalls === 1) {
          return { text: gmText("중단."), usage: GM_FAIL, finishReason: "length" };
        }
        return { text: gmText("복구."), usage: GM_OK, finishReason: "stop" };
      },
    };
    submitTrpgAction(db, { campaignId, userId: 1, body: "앞으로." });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    const round = roundByNumber(db, campaignId, 1);
    const billable = loadBillableRoundUsage(db, round.id);
    assert.equal(loadRoundUsageEntries(db, round.id).length, 4);
    assert.equal(billable.length, 3);
    assert.equal(
      round.billed_points,
      computeTrpgRoundPoints(toModelUsageCalls(loadBillableRoundUsage(db, round.id)))
    );
    db.close();
  });

  it("T7 — pending recovery bills exactly once without new provider call", async () => {
    const db = memoryDb();
    const budget = computeTrpgRoundPoints([BOT1, GM_OK]) + 500;
    const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1 });
    saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
    creditPointsWithIds(db, 1, budget, "PAID", "test-budget");
    let gmCalls = 0;
    const openingGmCall = async () => ({ text: gmText("오프닝."), usage: usage(500, 50) });
    const deps: TrpgEngineDeps = {
      skipBilling: false,
      billingFault: "billing_persist",
      rollD20: () => 14,
      botCall: async () => ({ text: "유나.\n\n<<<INTENT>>>\n행동.", usage: BOT1 }),
      gmCall: openingGmCall,
    };
    await startTrpgCampaign(db, {
      campaignId,
      userId: 1,
      deps: { ...deps, skipBilling: true, billingFault: undefined, gmCall: openingGmCall },
    });
    deps.gmCall = async () => {
      gmCalls += 1;
      return { text: gmText("저장 실패 전 GM."), usage: GM_OK };
    };
    submitTrpgAction(db, { campaignId, userId: 1, body: "앞으로." });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(gmCalls, 1);
    const round = roundByNumber(db, campaignId, 1);
    assert.equal(round.phase, "ERROR_RECOVERY");
    assert.ok(loadPendingGmResult(db, round.id));

    const before = getPointBalanceOnDb(db, 1).total;
    const retryDeps: TrpgEngineDeps = { ...deps, billingFault: undefined };
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps: retryDeps });
    assert.equal(gmCalls, 1);
    const done = roundByNumber(db, campaignId, 1);
    assert.equal(done.billed, 1);
    assert.equal(done.billed_points, computeTrpgRoundPoints(toModelUsageCalls(loadBillableRoundUsage(db, done.id))));
    assert.equal(getPointBalanceOnDb(db, 1).total, before - done.billed_points);
    db.close();
  });
});
