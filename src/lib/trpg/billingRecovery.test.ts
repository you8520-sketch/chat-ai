import assert from "node:assert/strict";
import { buildTrpgGmStructuredWireText } from "./gmStructuredOutput";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { creditPointsWithIds, getPointBalanceOnDb } from "@/lib/points";
import { CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL } from "@/lib/chatModels";
import { computeTrpgRoundPoints, TRPG_GM_USAGE_FALLBACK } from "./billing";
import { EVEN_STATS, createTrpgCampaign, joinTrpgCampaign, saveTrpgSheet } from "./engineCreate";
import { advanceTrpgCampaign, startTrpgCampaign, submitTrpgAction, type TrpgEngineDeps } from "./engineAdvance";
import { loadTrpgSnapshot } from "./engineSnapshot";
import { loadPendingGmResult } from "./pendingGmResult";
import { ensureTrpgTables } from "./schema";
import { parseTrpgStartFailureJson } from "./startFailure";
import type { TrpgBillingSubstage } from "./billingFailure";

const NARRATION = "문이 천천히 열린다. 먼지 냄새가 난다.";

function gmText(narration = NARRATION): string {
  return buildTrpgGmStructuredWireText(narration, {"players":[],"location":"문턱","next_round_context":"들어갈지","campaign_finished":false});
}

function installLedger(db: Database.Database): void {
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
}

function memoryDb(): Database.Database {
  const db = new Database(":memory:");
  ensureTrpgTables(db);
  installLedger(db);
  return db;
}

function usage() {
  return {
    modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
    inputTokens: TRPG_GM_USAGE_FALLBACK.inputTokens,
    outputTokens: TRPG_GM_USAGE_FALLBACK.outputTokens,
  };
}

function ensureUser(db: Database.Database, id: number, nickname: string): void {
  db.prepare(`INSERT OR IGNORE INTO users (id, email, nickname, points, creator_points) VALUES (?,?,?,0,0)`).run(
    id,
    `${nickname}@test.local`,
    nickname
  );
}

let gmCalls = 0;

function credit(db: Database.Database, userId: number, amount: number, type: "PAID" | "FREE"): void {
  ensureUser(db, userId, `u${userId}`);
  creditPointsWithIds(db, userId, amount, type, `test-credit-${type}`);
}

function roundRow(db: Database.Database, campaignId: number, roundNumber: number) {
  return db
    .prepare(
      `SELECT id, phase, billed, billed_points, usage_json, error_json, pending_gm_result_json
       FROM trpg_rounds WHERE campaign_id=? AND round_number=?`
    )
    .get(campaignId, roundNumber) as {
    id: number;
    phase: string;
    billed: number;
    billed_points: number;
    usage_json: string | null;
    error_json: string | null;
    pending_gm_result_json: string | null;
  };
}

function usageCount(raw: string | null): number {
  if (!raw) return 0;
  const parsed = JSON.parse(raw) as unknown[];
  return Array.isArray(parsed) ? parsed.length : 0;
}

function creatorCp(db: Database.Database, userId: number): number {
  const row = db.prepare(`SELECT creator_points FROM users WHERE id=?`).get(userId) as
    | { creator_points: number }
    | undefined;
  return Number(row?.creator_points ?? 0);
}

function earnings(db: Database.Database, roundId: number): number {
  const row = db
    .prepare(`SELECT COALESCE(SUM(reward_amount),0) AS n FROM trpg_creator_earnings WHERE round_id=?`)
    .get(roundId) as { n: number };
  return Number(row.n);
}

function gmMessage(db: Database.Database, roundId: number): string | null {
  const row = db.prepare(`SELECT narration FROM trpg_gm_messages WHERE round_id=?`).get(roundId) as
    | { narration: string }
    | undefined;
  return row?.narration ?? null;
}

async function startSolo(
  db: Database.Database,
  opts?: { secondUser?: boolean; attachCharacterCreator?: number }
): Promise<{ campaignId: number; budget: number }> {
  ensureUser(db, 1, "렌");
  const campaignId = createTrpgCampaign(db, {
    hostUserId: 1,
    hostNickname: "렌",
    viewerUserId: 1,
  });
  if (opts?.attachCharacterCreator) {
    ensureUser(db, opts.attachCharacterCreator, "작가");
    db.prepare(`INSERT INTO characters (id, name, creator_id, official) VALUES (10, '동료', ?, 0)`).run(
      opts.attachCharacterCreator
    );
    db.prepare(`UPDATE trpg_participants SET character_id=10 WHERE campaign_id=? AND user_id=1`).run(campaignId);
  }
  saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
  if (opts?.secondUser) {
    ensureUser(db, 2, "태현");
    const invite = (
      db.prepare(`SELECT invite_code FROM trpg_campaigns WHERE id=?`).get(campaignId) as { invite_code: string }
    ).invite_code;
    joinTrpgCampaign(db, { code: invite, userId: 2, nickname: "태현" });
    saveTrpgSheet(db, { campaignId, userId: 2, name: "태현", stats: EVEN_STATS });
  }
  const opening: TrpgEngineDeps = {
    skipBilling: true,
    rollD20: () => 16,
    gmCall: async () => {
      gmCalls += 1;
      return { text: gmText("시작 장면."), usage: usage() };
    },
  };
  await startTrpgCampaign(db, { campaignId, userId: 1, deps: opening });
  const budget = computeTrpgRoundPoints([usage()]) + 200;
  return { campaignId, budget };
}

function playDeps(fault?: TrpgEngineDeps["billingFault"]): TrpgEngineDeps {
  return {
    skipBilling: false,
    billingFault: fault,
    rollD20: () => 16,
    gmCall: async () => {
      gmCalls += 1;
      return { text: gmText(), usage: usage() };
    },
  };
}

async function submitAndAdvance(
  db: Database.Database,
  campaignId: number,
  fault?: TrpgEngineDeps["billingFault"],
  extraHumans: number[] = []
) {
  const deps = playDeps(fault);
  submitTrpgAction(db, { campaignId, userId: 1, body: "문을 민다." });
  for (const userId of extraHumans) {
    submitTrpgAction(db, { campaignId, userId, body: "뒤를 본다." });
  }
  return advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
}

describe("TRPG post-GM billing recovery", () => {
  it("records billing substages and never recalls GM on billing faults", async () => {
    const faults: TrpgBillingSubstage[] = [
      "pricing_quote",
      "point_deduction",
      "creator_reward",
      "economics_observation",
      "billing_persist",
    ];
    for (const fault of faults) {
      gmCalls = 0;
      const db = memoryDb();
      const { campaignId, budget } = await startSolo(db, {
        attachCharacterCreator: fault === "creator_reward" ? 99 : undefined,
      });
      const openingCalls = gmCalls;
      credit(db, 1, budget, fault === "creator_reward" ? "PAID" : "FREE");
      const snap = await submitAndAdvance(db, campaignId, fault);
      assert.equal(snap.round.phase, "ERROR_RECOVERY");
      assert.equal(snap.gmFailureKind, "billing_error");
      assert.equal(snap.gmFailureBillingSubstage, fault);
      assert.ok(snap.gmFailureBillingErrorCode);
      assert.equal(snap.hasPendingGmResult, true);
      assert.match(snap.gmFailureHint ?? "", /라운드 과금 실패/);
      assert.doesNotMatch(snap.gmFailureHint ?? "", /billing fault|SQLITE_|sk-|OPENROUTER/);
      const row = roundRow(db, campaignId, 1);
      const failure = parseTrpgStartFailureJson(row.error_json);
      assert.equal(failure?.kind, "billing_error");
      assert.equal(failure?.stage, "billing");
      assert.equal(failure?.billingSubstage, fault);
      assert.ok(failure?.billingErrorCode);
      assert.ok(loadPendingGmResult(db, row.id));
      assert.equal(gmMessage(db, row.id), null);
      assert.equal(row.billed, 0);
      assert.equal(gmCalls, openingCalls + 1);
      const guest = loadTrpgSnapshot(db, campaignId, 2);
      assert.notEqual(guest?.hasPendingGmResult, true);
      assert.equal(JSON.stringify(snap).includes("pending_gm_result_json"), false);
      db.close();
    }
  });

  it("rolls back every payer after the second deduction throws", async () => {
    gmCalls = 0;
    const db = memoryDb();
    const { campaignId, budget } = await startSolo(db, { secondUser: true });
    const before1 = (() => {
      credit(db, 1, budget, "FREE");
      credit(db, 2, budget, "FREE");
      return {
        one: getPointBalanceOnDb(db, 1).total,
        two: getPointBalanceOnDb(db, 2).total,
      };
    })();
    const snap = await submitAndAdvance(db, campaignId, "after_first_deduction", [2]);
    assert.equal(snap.round.phase, "ERROR_RECOVERY");
    assert.equal(snap.gmFailureBillingSubstage, "point_deduction");
    assert.equal(getPointBalanceOnDb(db, 1).total, before1.one);
    assert.equal(getPointBalanceOnDb(db, 2).total, before1.two);
    assert.equal(roundRow(db, campaignId, 1).billed, 0);
    db.close();
  });

  it("rolls back creator CP when a later billing stage throws", async () => {
    gmCalls = 0;
    const db = memoryDb();
    const { campaignId, budget } = await startSolo(db, { attachCharacterCreator: 99 });
    credit(db, 1, budget, "PAID");
    const beforeCp = creatorCp(db, 99);
    const snap = await submitAndAdvance(db, campaignId, "economics_observation");
    const row = roundRow(db, campaignId, 1);
    assert.equal(snap.round.phase, "ERROR_RECOVERY");
    assert.equal(snap.gmFailureBillingSubstage, "economics_observation");
    assert.equal(creatorCp(db, 99), beforeCp);
    assert.equal(earnings(db, row.id), 0);
    db.close();
  });

  it("retries billing from the pending GM result without a new model call or double charge", async () => {
    gmCalls = 0;
    const db = memoryDb();
    const { campaignId, budget } = await startSolo(db, { attachCharacterCreator: 99 });
    credit(db, 1, budget, "PAID");
    const before = getPointBalanceOnDb(db, 1).total;
    const beforeCp = creatorCp(db, 99);
    await submitAndAdvance(db, campaignId, "billing_persist");
    const failed = roundRow(db, campaignId, 1);
    const afterFail = getPointBalanceOnDb(db, 1).total;
    assert.equal(afterFail, before);
    assert.equal(creatorCp(db, 99), beforeCp);
    assert.equal(usageCount(failed.usage_json), 1);
    const callsAfterFail = gmCalls;

    const retried = await advanceTrpgCampaign(db, {
      campaignId,
      userId: 1,
      deps: playDeps(),
    });
    assert.equal(gmCalls, callsAfterFail);
    assert.equal(retried.round.phase, "ACTION_INPUT");
    assert.equal(retried.hasPendingGmResult, false);
    const done = roundRow(db, campaignId, 1);
    assert.equal(done.phase, "ROUND_COMPLETE");
    assert.equal(done.billed, 1);
    assert.ok(done.billed_points > 0);
    assert.equal(usageCount(done.usage_json), 1);
    assert.equal(gmMessage(db, done.id), NARRATION);
    assert.equal(loadPendingGmResult(db, done.id), null);
    const charged = before - getPointBalanceOnDb(db, 1).total;
    assert.equal(charged, done.billed_points);
    const cp = creatorCp(db, 99);
    assert.ok(cp > beforeCp);
    assert.equal(earnings(db, done.id), cp - beforeCp);

    const again = await advanceTrpgCampaign(db, {
      campaignId,
      userId: 1,
      deps: playDeps(),
    });
    assert.equal(again.round.phase, "ACTION_INPUT");
    assert.equal(getPointBalanceOnDb(db, 1).total, before - charged);
    assert.equal(creatorCp(db, 99), cp);
    assert.equal(usageCount(roundRow(db, campaignId, 1).usage_json), 1);
    db.close();
  });
});
