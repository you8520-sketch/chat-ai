/**
 * PRE-FIX evidence for 100P vs 800P fail-closed settlement.
 * Current main behavior only. Not a post-fix contract.
 *
 * After a later BUGFIX, replace these expectations with the new
 * under-recovered / named-error cases. Do not keep the source
 * assertions that require the route to lack InsufficientPointsError.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, it } from "node:test";
import { settleChatTurnBillingExactlyOnce } from "./chatBillingSettlement";
import { ensureChatBillingSettlementSchema } from "./chatBillingSettlementSchema";
import {
  creditPointsWithIds,
  getPointBalanceOnDb,
  InsufficientPointsError,
  MIN_POINTS_TO_CHAT,
} from "./points";

const REPO_ROOT = join(import.meta.dirname, "..", "..");

function createBaselineDb(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      points REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE point_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      point_type TEXT NOT NULL,
      remaining_amount REAL NOT NULL,
      expires_at TEXT NOT NULL,
      source TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE point_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      delta REAL NOT NULL,
      reason TEXT NOT NULL,
      message_id INTEGER,
      chat_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      request_id TEXT,
      deduction_slices TEXT,
      generation_status TEXT,
      usage TEXT,
      is_refunded INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE chats (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL
    );
    INSERT INTO users (id, points) VALUES (1, 0);
    INSERT INTO chats (id, user_id) VALUES (1, 1);
  `);
  ensureChatBillingSettlementSchema(db);
  return db;
}

function insertCompletedAssistant(
  db: Database.Database,
  requestId: string,
  content = "durable 800P-class assistant product"
): number {
  const result = db
    .prepare(
      `INSERT INTO messages (chat_id, role, content, request_id, generation_status)
       VALUES (1, 'assistant', ?, ?, 'completed')`
    )
    .run(content, requestId);
  return Number(result.lastInsertRowid);
}

function countSettlements(db: Database.Database): number {
  return (db.prepare(`SELECT COUNT(*) AS c FROM chat_billing_settlements`).get() as { c: number }).c;
}

function countNegativeLogs(db: Database.Database): number {
  return (db.prepare(`SELECT COUNT(*) AS c FROM point_logs WHERE user_id=1 AND delta<0`).get() as { c: number }).c;
}

function lotRemainings(db: Database.Database): Array<{ point_type: string; remaining_amount: number; source: string | null }> {
  return db
    .prepare(
      `SELECT point_type, remaining_amount, source FROM point_transactions WHERE user_id=1 ORDER BY id`
    )
    .all() as Array<{ point_type: string; remaining_amount: number; source: string | null }>;
}

function withDb(fn: (db: Database.Database) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "overdraft-baseline-"));
  const db = createBaselineDb(join(dir, "test.db"));
  try {
    fn(db);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("overdraft baseline — 100P vs 800P fail-closed", () => {
  it("100P FREE vs 800P charge leaves product, no settlement, no ledger mutation", () => {
    withDb((db) => {
      creditPointsWithIds(db, 1, 100, "FREE", "fixture 100P");
      const before = getPointBalanceOnDb(db, 1);
      assert.equal(before.total, 100);
      assert.equal(before.free, 100);
      assert.equal(before.paid, 0);
      assert.ok(before.total >= MIN_POINTS_TO_CHAT, "entry gate would allow this turn");

      const msgId = insertCompletedAssistant(db, "req_100_vs_800");
      assert.throws(
        () =>
          settleChatTurnBillingExactlyOnce(db, {
            userId: 1,
            chatId: 1,
            requestId: "req_100_vs_800",
            assistantMessageId: msgId,
            requestedPoints: 800,
            reason: "fixture 800P actual charge",
          }),
        InsufficientPointsError
      );

      const after = getPointBalanceOnDb(db, 1);
      assert.equal(after.total, 100);
      assert.equal(after.free, 100);
      assert.equal(countSettlements(db), 0);
      assert.equal(countNegativeLogs(db), 0);
      const row = db
        .prepare(`SELECT generation_status, deduction_slices, is_refunded FROM messages WHERE id=?`)
        .get(msgId) as {
        generation_status: string;
        deduction_slices: string | null;
        is_refunded: number;
      };
      assert.equal(row.generation_status, "completed");
      assert.equal(row.deduction_slices, null);
      assert.equal(row.is_refunded, 0);
      assert.deepEqual(lotRemainings(db), [
        { point_type: "FREE", remaining_amount: 100, source: null },
      ]);
    });
  });

  it("same request_id replay also fails — no unpaid settlement marker", () => {
    withDb((db) => {
      creditPointsWithIds(db, 1, 100, "FREE", "fixture 100P");
      const msgId = insertCompletedAssistant(db, "req_100_vs_800_replay");
      const input = {
        userId: 1,
        chatId: 1,
        requestId: "req_100_vs_800_replay",
        assistantMessageId: msgId,
        requestedPoints: 800,
        reason: "fixture 800P",
      };
      assert.throws(() => settleChatTurnBillingExactlyOnce(db, input), InsufficientPointsError);
      assert.throws(() => settleChatTurnBillingExactlyOnce(db, input), InsufficientPointsError);
      assert.equal(countSettlements(db), 0);
      assert.equal(getPointBalanceOnDb(db, 1).total, 100);
      assert.ok(getPointBalanceOnDb(db, 1).total >= MIN_POINTS_TO_CHAT);
    });
  });

  it("PAID 40 + FREE 60 vs 800P fails without mixing types into a negative lot", () => {
    withDb((db) => {
      creditPointsWithIds(db, 1, 40, "PAID", "paid lot");
      creditPointsWithIds(db, 1, 60, "FREE", "free lot");
      assert.equal(getPointBalanceOnDb(db, 1).total, 100);
      const msgId = insertCompletedAssistant(db, "req_mixed_100_vs_800");
      assert.throws(
        () =>
          settleChatTurnBillingExactlyOnce(db, {
            userId: 1,
            chatId: 1,
            requestId: "req_mixed_100_vs_800",
            assistantMessageId: msgId,
            requestedPoints: 800,
            reason: "mixed 800",
          }),
        InsufficientPointsError
      );
      const lots = lotRemainings(db);
      assert.equal(lots.length, 2);
      assert.equal(lots[0]?.point_type, "PAID");
      assert.equal(lots[0]?.remaining_amount, 40);
      assert.equal(lots[1]?.point_type, "FREE");
      assert.equal(lots[1]?.remaining_amount, 60);
      assert.equal(countSettlements(db), 0);
      assert.equal(countNegativeLogs(db), 0);
    });
  });

  it("100P vs 100P still settles exactly once (control)", () => {
    withDb((db) => {
      creditPointsWithIds(db, 1, 100, "FREE", "exact cover");
      const msgId = insertCompletedAssistant(db, "req_100_vs_100");
      const first = settleChatTurnBillingExactlyOnce(db, {
        userId: 1,
        chatId: 1,
        requestId: "req_100_vs_100",
        assistantMessageId: msgId,
        requestedPoints: 100,
        reason: "exact cover",
      });
      assert.equal(first.outcome, "charged");
      assert.equal(first.settledPoints, 100);
      assert.equal(first.appliedNewCharge, true);
      assert.equal(getPointBalanceOnDb(db, 1).total, 0);
      const replay = settleChatTurnBillingExactlyOnce(db, {
        userId: 1,
        chatId: 1,
        requestId: "req_100_vs_100",
        assistantMessageId: msgId,
        requestedPoints: 100,
        reason: "replay",
      });
      assert.equal(replay.appliedNewCharge, false);
      assert.equal(replay.duplicate, true);
      assert.equal(countSettlements(db), 1);
      assert.equal(countNegativeLogs(db), 1);
    });
  });

  it("candidate cap boundary: 100P vs 1100P (1000 overdraft + balance) also fail-closes today", () => {
    withDb((db) => {
      creditPointsWithIds(db, 1, 100, "FREE", "cap probe");
      const msgId = insertCompletedAssistant(db, "req_over_cap");
      assert.throws(
        () =>
          settleChatTurnBillingExactlyOnce(db, {
            userId: 1,
            chatId: 1,
            requestId: "req_over_cap",
            assistantMessageId: msgId,
            requestedPoints: 1101,
            reason: "above candidate 1000P overdraft",
          }),
        InsufficientPointsError
      );
      assert.equal(getPointBalanceOnDb(db, 1).total, 100);
      assert.equal(countSettlements(db), 0);
    });
  });
});

describe("overdraft baseline — CURRENT_MAIN source snapshot", () => {
  it("PRE-FIX: chat route uses 80P entry floor and does not special-case InsufficientPointsError", () => {
    const route = readFileSync(join(REPO_ROOT, "src/app/api/chat/route.ts"), "utf8");
    assert.match(route, /pointBalance\.total < MIN_POINTS_TO_CHAT/);
    assert.match(route, /status:\s*402/);
    assert.equal((route.match(/\bsettleChatTurnBillingExactlyOnce\s*\(/g) ?? []).length, 1);
    assert.doesNotMatch(route, /InsufficientPointsError/);
    const settlementIdx = route.indexOf("settleChatTurnBillingExactlyOnce(");
    const providerCostIdx = route.indexOf("recordMainGenerationProviderCost(");
    assert.ok(settlementIdx > 0 && providerCostIdx > settlementIdx);
  });

  it("ledger deduct never writes negative remaining_amount; credit never offsets a missing overdraft", () => {
    const points = readFileSync(join(REPO_ROOT, "src/lib/points.ts"), "utf8");
    assert.match(points, /export const MIN_POINTS_TO_CHAT = 80/);
    assert.match(points, /if \(remaining > 0\.001\) \{\s*throw new InsufficientPointsError/s);
    assert.match(points, /if \(rounded <= 0\) return null/);
    assert.doesNotMatch(points, /overdraft/i);
    const settlement = readFileSync(join(REPO_ROOT, "src/lib/chatBillingSettlement.ts"), "utf8");
    assert.match(settlement, /if \(err instanceof InsufficientPointsError\) throw err/);
    const refund = readFileSync(join(REPO_ROOT, "src/lib/refund.ts"), "utf8");
    assert.match(refund, /if \(msg\.is_refunded\)/);
    assert.match(refund, /SET refunded_at = datetime\('now'\)/);
  });
});
