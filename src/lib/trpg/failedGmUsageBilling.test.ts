import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL } from "@/lib/chatModels";
import { creditPointsWithIds, getPointBalanceOnDb } from "@/lib/points";
import { computeTrpgRoundPoints } from "./billing";
import { EVEN_STATS, createTrpgCampaign, saveTrpgSheet, writeSheet } from "./engineCreate";
import {
  advanceTrpgCampaign,
  regenerateTrpgNarration,
  startTrpgCampaign,
  submitTrpgAction,
  type TrpgEngineDeps,
} from "./engineAdvance";
import { buildTrpgGmStructuredWireText } from "./gmStructuredOutput";
import { loadPendingGmResult } from "./pendingGmResult";
import { ensureTrpgTables } from "./schema";
import { insertParticipant } from "./store";
import {
  loadBillableRerollUsage,
  loadBillableRoundUsage,
  loadRerollUsageEntries,
  loadRoundUsageEntries,
  tagBotRoundUsage,
  tagGmRoundUsage,
  toModelUsageCalls,
} from "./roundUsage";
import type { TrpgModelUsage } from "./billing";

const VALID_DELTA = {
  players: [],
  location: "문턱",
  next_round_context: "다음",
  campaign_finished: false,
};

function gmText(narration: string): string {
  return buildTrpgGmStructuredWireText(narration, VALID_DELTA);
}

/** Truncated structured JSON — parse/integrity failure under #839 contract. */
const BAD_GM_PARSE = `{"narration":"실패한 장면"`;

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
    CREATE TABLE characters (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      creator_id INTEGER,
      official INTEGER NOT NULL DEFAULT 0
    );
  `);
  db.prepare(`INSERT INTO users (id, email, nickname, points, creator_points) VALUES (1,'a@t','렌',0,0)`).run();
  return db;
}

function roundByNumber(db: Database.Database, campaignId: number, roundNumber: number) {
  return db
    .prepare(
      `SELECT id, phase, billed, billed_points, usage_json, gm_reroll_usage_json, billing_breakdown_json
       FROM trpg_rounds WHERE campaign_id=? AND round_number=?`
    )
    .get(campaignId, roundNumber) as {
    id: number;
    phase: string;
    billed: number;
    billed_points: number;
    usage_json: string | null;
    gm_reroll_usage_json: string | null;
    billing_breakdown_json: string | null;
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
const REROLL_FAIL = usage(2500, 250);
const REROLL_OK = usage(2600, 260);

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

async function completeRoundOne(
  db: Database.Database,
  campaignId: number,
  deps: TrpgEngineDeps
): Promise<{ roundId: number; beforeBalance: number }> {
  let botIdx = 0;
  const bots = [BOT1, BOT2];
  const playDeps: TrpgEngineDeps = {
    ...deps,
    rollD20: () => 14,
    botCall: async () => {
      const u = bots[botIdx++] ?? BOT2;
      return { text: "유나.\n\n<<<INTENT>>>\n행동.", usage: u };
    },
  };
  submitTrpgAction(db, { campaignId, userId: 1, body: "앞으로." });
  const before = getPointBalanceOnDb(db, 1).total;
  await advanceTrpgCampaign(db, { campaignId, userId: 1, deps: playDeps });
  const round = roundByNumber(db, campaignId, 1);
  return { roundId: round.id, beforeBalance: before };
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
        if (gmCalls === 1) return { text: BAD_GM_PARSE, usage: GM_FAIL, finishReason: "stop" };
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

  it("T3 — integrity failure then retry excludes failed GM from user bill", async () => {
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
          return { text: gmText("필터."), usage: GM_FAIL, finishReason: "content_filter" };
        }
        return { text: gmText("복구."), usage: GM_OK, finishReason: "stop" };
      },
    };
    submitTrpgAction(db, { campaignId, userId: 1, body: "앞으로." });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    const round = roundByNumber(db, campaignId, 1);
    assert.equal(loadRoundUsageEntries(db, round.id).length, 4);
    assert.equal(loadBillableRoundUsage(db, round.id).length, 3);
    assert.equal(
      round.billed_points,
      computeTrpgRoundPoints(toModelUsageCalls(loadBillableRoundUsage(db, round.id)))
    );
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

  it("T5 — multiple failed GM generations + success bills only committed GM", async () => {
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
        if (gmCalls <= 2) return { text: BAD_GM_PARSE, usage: GM_FAIL, finishReason: "stop" };
        return { text: gmText("세 번째 성공."), usage: GM_OK, finishReason: "stop" };
      },
    };
    submitTrpgAction(db, { campaignId, userId: 1, body: "앞으로." });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    const round = roundByNumber(db, campaignId, 1);
    assert.equal(loadRoundUsageEntries(db, round.id).length, 5);
    assert.equal(loadBillableRoundUsage(db, round.id).length, 3);
    db.close();
  });

  it("T6 — stale GM generation never bills when another generation committed", async () => {
    const db = memoryDb();
    const budget = computeTrpgRoundPoints([BOT1, BOT2, GM_OK, GM_FAIL]) + 500;
    const campaignId = await setupTwoBotCampaign(db, budget);
    let botIdx = 0;
    const bots = [BOT1, BOT2];
    let gmCalls = 0;
    const deps: TrpgEngineDeps = {
      rollD20: () => 14,
      botCall: async () => {
        const u = bots[botIdx++] ?? BOT2;
        return { text: "유나.\n\n<<<INTENT>>>\n행동.", usage: u };
      },
      gmCall: async () => {
        gmCalls += 1;
        if (gmCalls === 1) return { text: BAD_GM_PARSE, usage: GM_FAIL, finishReason: "stop" };
        return { text: gmText("최종."), usage: GM_OK, finishReason: "stop" };
      },
    };
    submitTrpgAction(db, { campaignId, userId: 1, body: "앞으로." });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    const round = roundByNumber(db, campaignId, 1);
    const committed = db
      .prepare(`SELECT gm_committed_generation_id FROM trpg_rounds WHERE id=?`)
      .get(round.id) as { gm_committed_generation_id: string | null };
    assert.ok(committed.gm_committed_generation_id);
    const stale = loadRoundUsageEntries(db, round.id).filter(
      (row) => row.seat === "gm" && row.generationId !== committed.gm_committed_generation_id
    );
    assert.ok(stale.length >= 1);
    for (const row of stale) {
      assert.equal(
        loadBillableRoundUsage(db, round.id).some((b) => b.generationId === row.generationId),
        false
      );
    }
    assert.equal(loadBillableRoundUsage(db, round.id).length, 3);
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

  it("T11 — failed GM does not inflate creator reward on zero user charge", async () => {
    const db = memoryDb();
    db.prepare(`INSERT INTO users (id, email, nickname, points, creator_points) VALUES (2,'b@t','작가',0,0)`).run();
    db.prepare(`INSERT INTO characters (id, name, creator_id, official) VALUES (10, '동료', 2, 0)`).run();
    const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1 });
    db.prepare(`UPDATE trpg_participants SET character_id=10 WHERE campaign_id=? AND user_id=1`).run(campaignId);
    saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
    creditPointsWithIds(db, 1, 50_000, "PAID", "test-budget");
    await startTrpgCampaign(db, {
      campaignId,
      userId: 1,
      deps: { skipBilling: true, gmCall: async () => ({ text: gmText("오프닝."), usage: usage(500, 50) }) },
    });
    let gmCalls = 0;
    const deps: TrpgEngineDeps = {
      rollD20: () => 14,
      botCall: async () => ({ text: "유나.\n\n<<<INTENT>>>\n행동.", usage: BOT1 }),
      gmCall: async () => {
        gmCalls += 1;
        if (gmCalls === 1) return { text: BAD_GM_PARSE, usage: GM_FAIL, finishReason: "stop" };
        return { text: gmText("성공."), usage: GM_OK, finishReason: "stop" };
      },
    };
    submitTrpgAction(db, { campaignId, userId: 1, body: "앞으로." });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    const cpAfterFail = db.prepare(`SELECT creator_points FROM users WHERE id=2`).get() as {
      creator_points: number;
    };
    assert.equal(cpAfterFail.creator_points, 0);
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    const cpAfterSuccess = db.prepare(`SELECT creator_points FROM users WHERE id=2`).get() as {
      creator_points: number;
    };
    assert.ok(cpAfterSuccess.creator_points > 0);
    db.close();
  });

  it("T12 / R1 — successful reroll bills reroll usage exactly once", async () => {
    const db = memoryDb();
    const budget = 50_000;
    const campaignId = await setupTwoBotCampaign(db, budget);
    let gmCalls = 0;
    const deps: TrpgEngineDeps = {
      skipBilling: false,
      rollD20: () => 14,
      botCall: async () => ({ text: "유나.\n\n<<<INTENT>>>\n행동.", usage: BOT1 }),
      gmCall: async () => {
        gmCalls += 1;
        return { text: gmText(`라운드 ${gmCalls}.`), usage: GM_OK, finishReason: "stop" };
      },
    };
    const { beforeBalance } = await completeRoundOne(db, campaignId, deps);
    const roundBefore = roundByNumber(db, campaignId, 1);
    const balanceBeforeReroll = getPointBalanceOnDb(db, 1).total;
    await regenerateTrpgNarration(db, { campaignId, userId: 1, deps });
    const expectedReroll = computeTrpgRoundPoints([GM_OK]);
    const balanceAfter = getPointBalanceOnDb(db, 1).total;
    assert.equal(balanceBeforeReroll - balanceAfter, expectedReroll);
    assert.equal(beforeBalance - balanceAfter, roundBefore.billed_points + expectedReroll);
    const roundAfter = roundByNumber(db, campaignId, 1);
    assert.equal(gmCalls, 2);
    assert.equal(roundAfter.billed_points, roundBefore.billed_points + expectedReroll);
    db.close();
  });

  it("T13 / R2 — failed reroll parse then success bills only successful reroll", async () => {
    const db = memoryDb();
    const campaignId = await setupTwoBotCampaign(db, 50_000);
    let gmCalls = 0;
    let rerollCalls = 0;
    const deps: TrpgEngineDeps = {
      rollD20: () => 14,
      botCall: async () => ({ text: "유나.\n\n<<<INTENT>>>\n행동.", usage: BOT1 }),
      gmCall: async () => {
        gmCalls += 1;
        return { text: gmText("라운드."), usage: GM_OK, finishReason: "stop" };
      },
    };
    await completeRoundOne(db, campaignId, deps);
    const round = roundByNumber(db, campaignId, 1);
    const before = getPointBalanceOnDb(db, 1).total;
    const rerollDeps: TrpgEngineDeps = {
      ...deps,
      gmCall: async () => {
        rerollCalls += 1;
        if (rerollCalls === 1) return { text: BAD_GM_PARSE, usage: REROLL_FAIL, finishReason: "stop" };
        return { text: gmText("리롤 성공."), usage: REROLL_OK, finishReason: "stop" };
      },
    };
    await assert.rejects(
      () => regenerateTrpgNarration(db, { campaignId, userId: 1, deps: rerollDeps }),
      /GM output|structured|parse/i
    );
    assert.equal(loadRerollUsageEntries(db, round.id).length, 1);
    assert.equal(loadBillableRerollUsage(db, round.id, "any").length, 0);
    await regenerateTrpgNarration(db, { campaignId, userId: 1, deps: rerollDeps });
    const committed = db
      .prepare(`SELECT gm_committed_generation_id FROM trpg_rounds WHERE id=?`)
      .get(round.id) as { gm_committed_generation_id: string };
    const actual = loadRerollUsageEntries(db, round.id);
    const billable = loadBillableRerollUsage(db, round.id, committed.gm_committed_generation_id);
    assert.equal(actual.length, 2);
    assert.equal(billable.length, 1);
    assert.equal(
      getPointBalanceOnDb(db, 1).total,
      before - computeTrpgRoundPoints(toModelUsageCalls(billable))
    );
    db.close();
  });

  it("T14 / R4 — multiple failed rerolls then success preserves actual but bills one", async () => {
    const db = memoryDb();
    const campaignId = await setupTwoBotCampaign(db, 50_000);
    const deps: TrpgEngineDeps = {
      rollD20: () => 14,
      botCall: async () => ({ text: "유나.\n\n<<<INTENT>>>\n행동.", usage: BOT1 }),
      gmCall: async () => ({ text: gmText("라운드."), usage: GM_OK, finishReason: "stop" }),
    };
    await completeRoundOne(db, campaignId, deps);
    const round = roundByNumber(db, campaignId, 1);
    let rerollCalls = 0;
    const rerollDeps: TrpgEngineDeps = {
      ...deps,
      gmCall: async () => {
        rerollCalls += 1;
        if (rerollCalls <= 2) return { text: BAD_GM_PARSE, usage: REROLL_FAIL, finishReason: "stop" };
        return { text: gmText("리롤 성공."), usage: REROLL_OK, finishReason: "stop" };
      },
    };
    await assert.rejects(() => regenerateTrpgNarration(db, { campaignId, userId: 1, deps: rerollDeps }));
    await assert.rejects(() => regenerateTrpgNarration(db, { campaignId, userId: 1, deps: rerollDeps }));
    await regenerateTrpgNarration(db, { campaignId, userId: 1, deps: rerollDeps });
    const committed = db
      .prepare(`SELECT gm_committed_generation_id FROM trpg_rounds WHERE id=?`)
      .get(round.id) as { gm_committed_generation_id: string };
    assert.equal(loadRerollUsageEntries(db, round.id).length, 3);
    assert.equal(loadBillableRerollUsage(db, round.id, committed.gm_committed_generation_id).length, 1);
    db.close();
  });
});
