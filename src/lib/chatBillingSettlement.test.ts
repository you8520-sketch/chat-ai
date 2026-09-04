import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, it } from "node:test";
import {
  CHAT_TURN_CHARGE_KIND,
  isChatBillingSettlementUniqueConflict,
  isRetryableSettlementContention,
  readChatBillingSettlement,
  settleChatTurnBillingExactlyOnce,
} from "./chatBillingSettlement";
import { ensureChatBillingSettlementSchema, hasChatBillingSettlementSchema } from "./chatBillingSettlementSchema";
import { deductPointsOnDb, creditPointsWithIds, InsufficientPointsError } from "./points";
import { paidCreatorRewardSpend } from "./creatorPoints";
import { findTurnByRequestId } from "./streamingPersistence";
import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

function createSettlementTestDb(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      points REAL NOT NULL DEFAULT 0,
      creator_points REAL NOT NULL DEFAULT 0,
      creator_exclusive INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE characters (
      id INTEGER PRIMARY KEY,
      creator_id INTEGER,
      official INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE creator_earnings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      creator_id INTEGER NOT NULL,
      character_id INTEGER NOT NULL,
      message_id INTEGER NOT NULL UNIQUE,
      consumer_user_id INTEGER NOT NULL,
      points_spent REAL NOT NULL,
      reward_points REAL NOT NULL,
      reward_rate REAL NOT NULL,
      reversed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE creator_point_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      creator_id INTEGER NOT NULL,
      delta REAL NOT NULL,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE point_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      point_type TEXT NOT NULL,
      remaining_amount REAL NOT NULL,
      expires_at TEXT NOT NULL,
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
      user_message_id INTEGER,
      is_refunded INTEGER NOT NULL DEFAULT 0,
      usage TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE chats (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      character_id INTEGER NOT NULL
    );
    CREATE INDEX idx_messages_chat_request_id ON messages(chat_id, request_id);
    INSERT INTO users (id, points, creator_points) VALUES (1, 10000, 0), (2, 10000, 0);
    INSERT INTO users (id, points, creator_points, creator_exclusive) VALUES (99, 10000, 0, 1);
    INSERT INTO point_transactions (user_id, point_type, remaining_amount, expires_at)
      VALUES (1, 'PAID', 5000, '2030-01-01'), (1, 'FREE', 5000, '2030-06-01');
    INSERT INTO point_transactions (user_id, point_type, remaining_amount, expires_at)
      VALUES (2, 'PAID', 10000, '2030-01-01');
    INSERT INTO characters (id, creator_id, official) VALUES (1, 99, 0);
    INSERT INTO chats (id, user_id, character_id) VALUES (1, 1, 1), (2, 1, 1);
  `);
  ensureChatBillingSettlementSchema(db);
  return db;
}

function insertAssistant(
  db: Database.Database,
  chatId: number,
  requestId: string,
  deductionSlices: string | null = null
): number {
  const result = db
    .prepare(
      `INSERT INTO messages (chat_id, role, content, request_id, deduction_slices, generation_status)
       VALUES (?, 'assistant', 'answer', ?, ?, 'completed')`
    )
    .run(chatId, requestId, deductionSlices);
  return Number(result.lastInsertRowid);
}

function countSettlements(db: Database.Database): number {
  return (db.prepare(`SELECT COUNT(*) AS c FROM chat_billing_settlements`).get() as { c: number }).c;
}

function countNegativeLogs(db: Database.Database, userId = 1): number {
  return (
    db.prepare(`SELECT COUNT(*) AS c FROM point_logs WHERE user_id=? AND delta<0`).get(userId) as {
      c: number;
    }
  ).c;
}

function userBalance(db: Database.Database, userId = 1): number {
  return (db.prepare(`SELECT points FROM users WHERE id=?`).get(userId) as { points: number }).points;
}

describe("chatBillingSettlement — DB constraint", () => {
  it("DB_ENFORCED_REQUEST_IDEMPOTENCY: UNIQUE(user_id, chat_id, request_id, charge_kind)", () => {
    const dir = mkdtempSync(join(tmpdir(), "billing-settle-"));
    const dbPath = join(dir, "test.db");
    try {
      const db = createSettlementTestDb(dbPath);
      const msgId = insertAssistant(db, 1, "req_unique_1");
      settleChatTurnBillingExactlyOnce(db, {
        userId: 1,
        chatId: 1,
        requestId: "req_unique_1",
        assistantMessageId: msgId,
        requestedPoints: 100,
        reason: "test charge",
      });
      assert.throws(
        () =>
          db
            .prepare(
              `INSERT INTO chat_billing_settlements
               (user_id, chat_id, request_id, charge_kind, requested_points, settled_points, outcome)
               VALUES (1, 1, 'req_unique_1', 'chat_turn', 100, 100, 'charged')`
            )
            .run(),
        (err: unknown) => isChatBillingSettlementUniqueConflict(err)
      );
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("chatBillingSettlement — sequential duplicate", () => {
  it("request A twice → one settlement and one ledger charge", () => {
    const dir = mkdtempSync(join(tmpdir(), "billing-settle-"));
    const dbPath = join(dir, "test.db");
    try {
      const db = createSettlementTestDb(dbPath);
      const msgId = insertAssistant(db, 1, "req_seq_1");
      const first = settleChatTurnBillingExactlyOnce(db, {
        userId: 1,
        chatId: 1,
        requestId: "req_seq_1",
        assistantMessageId: msgId,
        requestedPoints: 100,
        reason: "first",
      });
      const second = settleChatTurnBillingExactlyOnce(db, {
        userId: 1,
        chatId: 1,
        requestId: "req_seq_1",
        assistantMessageId: msgId,
        requestedPoints: 100,
        reason: "second",
      });
      assert.equal(first.appliedNewCharge, true);
      assert.equal(second.appliedNewCharge, false);
      assert.equal(second.duplicate, true);
      assert.equal(countSettlements(db), 1);
      assert.equal(countNegativeLogs(db), 1);
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("chatBillingSettlement — two-connection sequential replay", () => {
  it("two WAL connections sequentially → one settlement and one ledger charge", () => {
    const dir = mkdtempSync(join(tmpdir(), "billing-settle-"));
    const dbPath = join(dir, "test.db");
    try {
      const db1 = createSettlementTestDb(dbPath);
      const db2 = new Database(dbPath);
      db2.pragma("journal_mode = WAL");
      ensureChatBillingSettlementSchema(db2);

      const msgId = insertAssistant(db1, 1, "req_concurrent_1");

      const read1 = findTurnByRequestId(db1, 1, "req_concurrent_1");
      const read2 = findTurnByRequestId(db2, 1, "req_concurrent_1");
      assert.equal(read1.alreadyBilled, false);
      assert.equal(read2.alreadyBilled, false);

      const result1 = settleChatTurnBillingExactlyOnce(db1, {
        userId: 1,
        chatId: 1,
        requestId: "req_concurrent_1",
        assistantMessageId: msgId,
        requestedPoints: 100,
        reason: "worker A",
      });
      const result2 = settleChatTurnBillingExactlyOnce(db2, {
        userId: 1,
        chatId: 1,
        requestId: "req_concurrent_1",
        assistantMessageId: msgId,
        requestedPoints: 100,
        reason: "worker B",
      });

      const applied = [result1.appliedNewCharge, result2.appliedNewCharge];
      assert.equal(applied.filter(Boolean).length, 1);
      assert.equal(applied.filter((v) => !v).length, 1);
      assert.equal(countSettlements(db1), 1);
      assert.equal(countNegativeLogs(db1), 1);

      db1.close();
      db2.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("chatBillingSettlement — same request different amount", () => {
  it("replay with higher computed cost keeps original settled amount", () => {
    const dir = mkdtempSync(join(tmpdir(), "billing-settle-"));
    const dbPath = join(dir, "test.db");
    try {
      const db = createSettlementTestDb(dbPath);
      const msgId = insertAssistant(db, 1, "req_amount_1");
      const first = settleChatTurnBillingExactlyOnce(db, {
        userId: 1,
        chatId: 1,
        requestId: "req_amount_1",
        assistantMessageId: msgId,
        requestedPoints: 100,
        reason: "first",
      });
      const replay = settleChatTurnBillingExactlyOnce(db, {
        userId: 1,
        chatId: 1,
        requestId: "req_amount_1",
        assistantMessageId: msgId,
        requestedPoints: 150,
        reason: "replay",
      });
      assert.equal(first.settledPoints, 100);
      assert.equal(replay.settledPoints, 100);
      assert.equal(replay.amountMismatch, true);
      assert.equal(countNegativeLogs(db), 1);
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("chatBillingSettlement — same request different message", () => {
  it("one settlement and one charge when assistant message ids differ", () => {
    const dir = mkdtempSync(join(tmpdir(), "billing-settle-"));
    const dbPath = join(dir, "test.db");
    try {
      const db = createSettlementTestDb(dbPath);
      const msgA = insertAssistant(db, 1, "req_msg_1");
      const first = settleChatTurnBillingExactlyOnce(db, {
        userId: 1,
        chatId: 1,
        requestId: "req_msg_1",
        assistantMessageId: msgA,
        requestedPoints: 100,
        reason: "message A",
      });
      const msgB = insertAssistant(db, 1, "req_msg_1");
      const replay = settleChatTurnBillingExactlyOnce(db, {
        userId: 1,
        chatId: 1,
        requestId: "req_msg_1",
        assistantMessageId: msgB,
        requestedPoints: 100,
        reason: "message B",
      });
      assert.equal(first.appliedNewCharge, true);
      assert.equal(replay.appliedNewCharge, false);
      assert.equal(countSettlements(db), 1);
      assert.equal(countNegativeLogs(db), 1);
      assert.equal(replay.assistantMessageMismatch, true);
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("chatBillingSettlement — regeneration", () => {
  it("different request ids on same assistant message create independent charges", () => {
    const dir = mkdtempSync(join(tmpdir(), "billing-settle-"));
    const dbPath = join(dir, "test.db");
    try {
      const db = createSettlementTestDb(dbPath);
      const assistantId = insertAssistant(db, 1, "req_regen_a");
      db.prepare(`UPDATE messages SET request_id='req_regen_b' WHERE id=?`).run(assistantId);

      const first = settleChatTurnBillingExactlyOnce(db, {
        userId: 1,
        chatId: 1,
        requestId: "req_regen_a",
        assistantMessageId: assistantId,
        requestedPoints: 100,
        reason: "regen A",
      });
      const second = settleChatTurnBillingExactlyOnce(db, {
        userId: 1,
        chatId: 1,
        requestId: "req_regen_b",
        assistantMessageId: assistantId,
        requestedPoints: 120,
        reason: "regen B",
      });
      assert.equal(first.appliedNewCharge, true);
      assert.equal(second.appliedNewCharge, true);
      assert.equal(countSettlements(db), 2);
      assert.equal(countNegativeLogs(db), 2);
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("chatBillingSettlement — different chats and users", () => {
  it("same request string in different chats is independent", () => {
    const dir = mkdtempSync(join(tmpdir(), "billing-settle-"));
    const dbPath = join(dir, "test.db");
    try {
      const db = createSettlementTestDb(dbPath);
      const msg1 = insertAssistant(db, 1, "shared_req");
      const msg2 = insertAssistant(db, 2, "shared_req");
      settleChatTurnBillingExactlyOnce(db, {
        userId: 1,
        chatId: 1,
        requestId: "shared_req",
        assistantMessageId: msg1,
        requestedPoints: 50,
        reason: "chat 1",
      });
      settleChatTurnBillingExactlyOnce(db, {
        userId: 1,
        chatId: 2,
        requestId: "shared_req",
        assistantMessageId: msg2,
        requestedPoints: 60,
        reason: "chat 2",
      });
      assert.equal(countSettlements(db), 2);
      assert.equal(countNegativeLogs(db), 2);
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("same request string for different users is independent", () => {
    const dir = mkdtempSync(join(tmpdir(), "billing-settle-"));
    const dbPath = join(dir, "test.db");
    try {
      const db = createSettlementTestDb(dbPath);
      db.exec(`INSERT INTO chats (id, user_id, character_id) VALUES (3, 2, 1)`);
      const msg1 = insertAssistant(db, 1, "shared_user_req");
      const msg3 = insertAssistant(db, 3, "shared_user_req");
      settleChatTurnBillingExactlyOnce(db, {
        userId: 1,
        chatId: 1,
        requestId: "shared_user_req",
        assistantMessageId: msg1,
        requestedPoints: 40,
        reason: "user 1",
      });
      settleChatTurnBillingExactlyOnce(db, {
        userId: 2,
        chatId: 3,
        requestId: "shared_user_req",
        assistantMessageId: msg3,
        requestedPoints: 40,
        reason: "user 2",
      });
      assert.equal(countSettlements(db), 2);
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("chatBillingSettlement — zero-cost replay", () => {
  it("0P settlement blocks later >0P retry for same request", () => {
    const dir = mkdtempSync(join(tmpdir(), "billing-settle-"));
    const dbPath = join(dir, "test.db");
    try {
      const db = createSettlementTestDb(dbPath);
      const msgId = insertAssistant(db, 1, "req_zero_1");
      const first = settleChatTurnBillingExactlyOnce(db, {
        userId: 1,
        chatId: 1,
        requestId: "req_zero_1",
        assistantMessageId: msgId,
        requestedPoints: 0,
        reason: "waived",
      });
      const replay = settleChatTurnBillingExactlyOnce(db, {
        userId: 1,
        chatId: 1,
        requestId: "req_zero_1",
        assistantMessageId: msgId,
        requestedPoints: 100,
        reason: "retry",
      });
      assert.equal(first.outcome, "waived");
      assert.equal(first.settledPoints, 0);
      assert.equal(replay.appliedNewCharge, false);
      assert.equal(replay.settledPoints, 0);
      assert.equal(countNegativeLogs(db), 0);
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("chatBillingSettlement — insufficient points", () => {
  it("failed charge leaves no settlement, logs, or balance mutation", () => {
    const dir = mkdtempSync(join(tmpdir(), "billing-settle-"));
    const dbPath = join(dir, "test.db");
    try {
      const db = createSettlementTestDb(dbPath);
      db.prepare(`UPDATE point_transactions SET remaining_amount=0`).run();
      creditPointsWithIds(db, 1, 10, "FREE", "tiny balance");
      const beforeBalance = userBalance(db);
      const msgId = insertAssistant(db, 1, "req_insufficient_1");
      assert.throws(
        () =>
          settleChatTurnBillingExactlyOnce(db, {
            userId: 1,
            chatId: 1,
            requestId: "req_insufficient_1",
            assistantMessageId: msgId,
            requestedPoints: 100,
            reason: "too much",
          }),
        InsufficientPointsError
      );
      assert.equal(countSettlements(db), 0);
      assert.equal(countNegativeLogs(db), 0);
      assert.equal(userBalance(db), beforeBalance);
      const slices = (
        db.prepare(`SELECT deduction_slices FROM messages WHERE id=?`).get(msgId) as {
          deduction_slices: string | null;
        }
      ).deduction_slices;
      assert.equal(slices, null);
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("chatBillingSettlement — legacy bridge", () => {
  it("predeploy billed message with slices creates legacy settlement without new charge", () => {
    const dir = mkdtempSync(join(tmpdir(), "billing-settle-"));
    const dbPath = join(dir, "test.db");
    try {
      const db = createSettlementTestDb(dbPath);
      const legacySlices = JSON.stringify([
        { transactionId: 1, pointType: "PAID", amount: 77 },
      ]);
      db.prepare(`UPDATE point_transactions SET remaining_amount=remaining_amount-77 WHERE id=1`).run();
      db.prepare(`UPDATE users SET points=points-77 WHERE id=1`).run();
      db.prepare(
        `INSERT INTO point_logs (user_id, delta, reason, message_id, chat_id) VALUES (1, -77, 'legacy', 1, 1)`
      ).run();
      const msgId = insertAssistant(db, 1, "req_legacy_1", legacySlices);
      const replay = settleChatTurnBillingExactlyOnce(db, {
        userId: 1,
        chatId: 1,
        requestId: "req_legacy_1",
        assistantMessageId: msgId,
        requestedPoints: 100,
        reason: "replay after deploy",
      });
      assert.equal(replay.appliedNewCharge, false);
      assert.equal(replay.source, "legacy_message_deduction_slices");
      assert.equal(replay.settledPoints, 77);
      assert.equal(countSettlements(db), 1);
      assert.equal(countNegativeLogs(db), 1);
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("malformed legacy slices fail closed without new charge", () => {
    const dir = mkdtempSync(join(tmpdir(), "billing-settle-"));
    const dbPath = join(dir, "test.db");
    try {
      const db = createSettlementTestDb(dbPath);
      const msgId = insertAssistant(db, 1, "req_malformed_1", "{not-valid-json");
      const replay = settleChatTurnBillingExactlyOnce(db, {
        userId: 1,
        chatId: 1,
        requestId: "req_malformed_1",
        assistantMessageId: msgId,
        requestedPoints: 100,
        reason: "replay",
      });
      assert.equal(replay.appliedNewCharge, false);
      assert.equal(replay.outcome, "legacy_malformed");
      assert.equal(replay.settledPoints, 0);
      assert.equal(countNegativeLogs(db), 0);
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("regen stale slices must not false-positive legacy bridge (197 requested, 49 stale)", () => {
    // Unit-level isolation for SETTLEMENT_LEGACY_PROVENANCE_GUARD only.
    // Production-equivalent integration uses bootstrapStreamingTurn — see
    // geminiPublishedBillingRegenRegression.test.ts (no SQL request_id substitute).
    const dir = mkdtempSync(join(tmpdir(), "billing-settle-"));
    const dbPath = join(dir, "test.db");
    try {
      const db = createSettlementTestDb(dbPath);
      const assistantId = insertAssistant(db, 1, "req_gemini_gen_a");
      const legacyGen = settleChatTurnBillingExactlyOnce(db, {
        userId: 1,
        chatId: 1,
        requestId: "req_gemini_gen_a",
        assistantMessageId: assistantId,
        requestedPoints: 49,
        reason: "legacy generation",
      });
      assert.equal(legacyGen.appliedNewCharge, true);
      assert.equal(legacyGen.settledPoints, 49);

      db.prepare(`UPDATE messages SET request_id='req_gemini_gen_b' WHERE id=?`).run(assistantId);

      const beforeBalance = userBalance(db);
      const publishedGen = settleChatTurnBillingExactlyOnce(db, {
        userId: 1,
        chatId: 1,
        requestId: "req_gemini_gen_b",
        assistantMessageId: assistantId,
        requestedPoints: 197,
        reason: "published generation",
      });

      assert.equal(publishedGen.appliedNewCharge, true);
      assert.equal(publishedGen.requestedPoints, 197);
      assert.equal(publishedGen.settledPoints, 197);
      assert.equal(publishedGen.outcome, "charged");
      assert.equal(publishedGen.source, "native");
      assert.equal(userBalance(db), beforeBalance - 197);
      assert.equal(countSettlements(db), 2);
      assert.equal(countNegativeLogs(db), 2);

      const slices = JSON.parse(
        (db.prepare(`SELECT deduction_slices FROM messages WHERE id=?`).get(assistantId) as {
          deduction_slices: string;
        }).deduction_slices
      ) as Array<{ amount: number }>;
      assert.equal(
        slices.reduce((sum, slice) => sum + slice.amount, 0),
        197
      );
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("chatBillingSettlement — crash window", () => {
  it("committed settlement replay does not charge again", () => {
    const dir = mkdtempSync(join(tmpdir(), "billing-settle-"));
    const dbPath = join(dir, "test.db");
    try {
      const db = createSettlementTestDb(dbPath);
      const msgId = insertAssistant(db, 1, "req_crash_1");
      const first = settleChatTurnBillingExactlyOnce(db, {
        userId: 1,
        chatId: 1,
        requestId: "req_crash_1",
        assistantMessageId: msgId,
        requestedPoints: 100,
        reason: "first",
      });
      assert.equal(first.appliedNewCharge, true);
      const slices = (
        db.prepare(`SELECT deduction_slices FROM messages WHERE id=?`).get(msgId) as {
          deduction_slices: string;
        }
      ).deduction_slices;
      assert.ok(slices && slices !== "[]");

      const replay = settleChatTurnBillingExactlyOnce(db, {
        userId: 1,
        chatId: 1,
        requestId: "req_crash_1",
        assistantMessageId: msgId,
        requestedPoints: 100,
        reason: "after crash",
      });
      assert.equal(replay.appliedNewCharge, false);
      assert.equal(countSettlements(db), 1);
      assert.equal(countNegativeLogs(db), 1);
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("chatBillingSettlement — FIFO parity", () => {
  it("settlement path produces same slices and balance as deductPointsOnDb", () => {
    const dir = mkdtempSync(join(tmpdir(), "billing-settle-"));
    const dbPath = join(dir, "test.db");
    try {
      const db = createSettlementTestDb(dbPath);
      const direct = deductPointsOnDb(db, 1, 120, "direct", { messageId: 1, chatId: 1 });

      const db2 = createSettlementTestDb(join(dir, "test2.db"));
      const msgId = insertAssistant(db2, 1, "req_fifo_1");
      const settled = settleChatTurnBillingExactlyOnce(db2, {
        userId: 1,
        chatId: 1,
        requestId: "req_fifo_1",
        assistantMessageId: msgId,
        requestedPoints: 120,
        reason: "settlement",
      });

      assert.deepEqual(settled.slices, direct.slices);
      assert.equal(settled.balance.total, direct.balance.total);
      db.close();
      db2.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("chatBillingSettlement — creator reward duplicate", () => {
  it("duplicate replay returns appliedNewCharge false for route reward guard", () => {
    const dir = mkdtempSync(join(tmpdir(), "billing-settle-"));
    const dbPath = join(dir, "test.db");
    try {
      const db = createSettlementTestDb(dbPath);
      const msgId = insertAssistant(db, 1, "req_reward_1");
      const first = settleChatTurnBillingExactlyOnce(db, {
        userId: 1,
        chatId: 1,
        requestId: "req_reward_1",
        assistantMessageId: msgId,
        requestedPoints: 100,
        reason: "first",
      });
      const replay = settleChatTurnBillingExactlyOnce(db, {
        userId: 1,
        chatId: 1,
        requestId: "req_reward_1",
        assistantMessageId: msgId,
        requestedPoints: 100,
        reason: "replay",
      });
      assert.equal(first.appliedNewCharge, true);
      assert.equal(replay.appliedNewCharge, false);
      assert.equal(countNegativeLogs(db), 1);
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("chatBillingSettlement — refund compatibility", () => {
  it("settlement persists deduction_slices on message for refund owners", () => {
    const dir = mkdtempSync(join(tmpdir(), "billing-settle-"));
    const dbPath = join(dir, "test.db");
    try {
      const db = createSettlementTestDb(dbPath);
      const msgId = insertAssistant(db, 1, "req_refund_1");
      const settled = settleChatTurnBillingExactlyOnce(db, {
        userId: 1,
        chatId: 1,
        requestId: "req_refund_1",
        assistantMessageId: msgId,
        requestedPoints: 50,
        reason: "charge",
      });
      const row = db.prepare(`SELECT deduction_slices FROM messages WHERE id=?`).get(msgId) as {
        deduction_slices: string;
      };
      const slices = JSON.parse(row.deduction_slices) as Array<{ amount: number }>;
      assert.ok(slices.length > 0);
      assert.equal(
        slices.reduce((sum, slice) => sum + slice.amount, 0),
        settled.settledPoints
      );
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("chatBillingSettlement — guarded message update", () => {
  it("stale worker cannot overwrite slices after regeneration changes request_id", () => {
    const dir = mkdtempSync(join(tmpdir(), "billing-settle-"));
    const dbPath = join(dir, "test.db");
    try {
      const db = createSettlementTestDb(dbPath);
      const assistantId = insertAssistant(db, 1, "req_old_worker");
      db.prepare(`UPDATE messages SET request_id='req_new_regen' WHERE id=?`).run(assistantId);

      settleChatTurnBillingExactlyOnce(db, {
        userId: 1,
        chatId: 1,
        requestId: "req_new_regen",
        assistantMessageId: assistantId,
        requestedPoints: 80,
        reason: "new regen",
      });

      const stale = settleChatTurnBillingExactlyOnce(db, {
        userId: 1,
        chatId: 1,
        requestId: "req_old_worker",
        assistantMessageId: assistantId,
        requestedPoints: 80,
        reason: "stale worker",
      });
      assert.equal(stale.appliedNewCharge, true);

      const currentSlices = (
        db.prepare(`SELECT deduction_slices, request_id FROM messages WHERE id=?`).get(assistantId) as {
          deduction_slices: string;
          request_id: string;
        }
      );
      assert.equal(currentSlices.request_id, "req_new_regen");
      const parsed = JSON.parse(currentSlices.deduction_slices) as Array<{ amount: number }>;
      assert.equal(parsed.reduce((s, x) => s + x.amount, 0), 80);
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("chatBillingSettlement — old raw path still double-charges (historical)", () => {
  it("deductPointsOnDb without settlement owner can still double-charge", () => {
    const dir = mkdtempSync(join(tmpdir(), "billing-settle-"));
    const dbPath = join(dir, "test.db");
    try {
      const db1 = createSettlementTestDb(dbPath);
      const db2 = new Database(dbPath);
      db2.pragma("journal_mode = WAL");
      const msgId = insertAssistant(db1, 1, "req_raw_unsafe");
      deductPointsOnDb(db1, 1, 50, "A", { messageId: msgId, chatId: 1 });
      deductPointsOnDb(db2, 1, 50, "B", { messageId: msgId, chatId: 1 });
      assert.equal(countNegativeLogs(db1), 2);
      db1.close();
      db2.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

const CONCURRENT_FORK_PATH = fileURLToPath(
  new URL("./chatBillingSettlement.concurrentFork.ts", import.meta.url)
);
const CONCURRENT_FORK_EXEC_ARGV = ["--conditions=react-server", "--import", "tsx"];

type ConcurrentWorkerResult =
  | {
      ok: true;
      appliedNewCharge: boolean;
      duplicate: boolean;
      settledPoints: number;
      settlementId: number;
    }
  | { ok: false; code: string; message: string; name: string };

function spawnSettlementFork(
  dbPath: string,
  input: {
    userId: number;
    chatId: number;
    requestId: string;
    assistantMessageId: number;
    requestedPoints: number;
    reason: string;
  }
): { child: ChildProcess; ready: Promise<void>; result: Promise<ConcurrentWorkerResult> } {
  const child = fork(CONCURRENT_FORK_PATH, [], {
    execArgv: CONCURRENT_FORK_EXEC_ARGV,
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });

  let readyResolve!: () => void;
  const ready = new Promise<void>((resolve) => {
    readyResolve = resolve;
  });

  const result = new Promise<ConcurrentWorkerResult>((resolve, reject) => {
    child.on("message", (message: Record<string, unknown>) => {
      if (message.type === "ready") {
        readyResolve();
        return;
      }
      if (message.type === "result") {
        if (message.ok === true) {
          resolve({
            ok: true,
            appliedNewCharge: Boolean(message.appliedNewCharge),
            duplicate: Boolean(message.duplicate),
            settledPoints: Number(message.settledPoints),
            settlementId: Number(message.settlementId),
          });
        } else {
          resolve({
            ok: false,
            code: String(message.code ?? "UNKNOWN"),
            message: String(message.message ?? "unknown"),
            name: String(message.name ?? "Error"),
          });
        }
      }
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code !== 0 && code !== null) reject(new Error(`fork exited ${code}`));
    });
  });

  return { child, ready, result };
}

function runConcurrentSettlementWorkers(
  dbPath: string,
  input: {
    userId: number;
    chatId: number;
    requestId: string;
    assistantMessageId: number;
    requestedPoints: number;
    reason: string;
  }
): Promise<ConcurrentWorkerResult[]> {
  const spawned = [0, 1].map(() => spawnSettlementFork(dbPath, input));
  return Promise.all(spawned.map((s) => s.ready)).then(async () => {
    for (const s of spawned) {
      s.child.send({ type: "start", dbPath, input });
    }
    const results = await Promise.all(spawned.map((s) => s.result));
    for (const s of spawned) {
      s.child.kill();
    }
    return results;
  });
}

describe("chatBillingSettlement — true overlapping duplicate workers", () => {
  it("TRUE_CONCURRENT_DUPLICATE_TEST_PASS: child_process forks overlap → one charge", async () => {
    const dir = mkdtempSync(join(tmpdir(), "billing-settle-"));
    const dbPath = join(dir, "test.db");
    try {
      const db = createSettlementTestDb(dbPath);
      const msgId = insertAssistant(db, 1, "req_true_concurrent");
      db.close();

      const input = {
        userId: 1,
        chatId: 1,
        requestId: "req_true_concurrent",
        assistantMessageId: msgId,
        requestedPoints: 100,
        reason: "overlap",
      };

      for (let iteration = 0; iteration < 3; iteration += 1) {
        if (iteration > 0) {
          const resetDb = new Database(dbPath);
          resetDb.exec(`
            DELETE FROM chat_billing_settlements;
            DELETE FROM point_logs;
            UPDATE point_transactions SET remaining_amount=5000 WHERE user_id=1 AND point_type='PAID';
            UPDATE users SET points=10000 WHERE id=1;
            UPDATE messages SET deduction_slices=NULL WHERE id=${msgId};
          `);
          resetDb.close();
        }

        const lastResults = await runConcurrentSettlementWorkers(dbPath, input);
        assert.equal(lastResults.length, 2);
        for (const result of lastResults) {
          assert.equal(result.ok, true, JSON.stringify(result));
        }
        const okResults = lastResults.filter((r): r is Extract<ConcurrentWorkerResult, { ok: true }> => r.ok);
        assert.equal(okResults.filter((r) => r.appliedNewCharge).length, 1);
        assert.equal(okResults.filter((r) => r.duplicate).length, 1);
        assert.equal(new Set(okResults.map((r) => r.settledPoints)).size, 1);

        const verifyDb = new Database(dbPath);
        assert.equal(countSettlements(verifyDb), 1);
        assert.equal(countNegativeLogs(verifyDb), 1);
        verifyDb.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("chatBillingSettlement — DB contention recovery", () => {
  it("DB_CONTENTION_RECOVERY_TEST_PASS: bounded retry survives lock holder", async () => {
    const dir = mkdtempSync(join(tmpdir(), "billing-settle-"));
    const dbPath = join(dir, "test.db");
    try {
      const db = createSettlementTestDb(dbPath);
      const msgId = insertAssistant(db, 1, "req_contention");
      db.close();

      const holdDb = new Database(dbPath);
      holdDb.pragma("journal_mode = WAL");
      holdDb.exec("BEGIN IMMEDIATE");

      const spawned = spawnSettlementFork(dbPath, {
        userId: 1,
        chatId: 1,
        requestId: "req_contention",
        assistantMessageId: msgId,
        requestedPoints: 60,
        reason: "contention",
      });

      await spawned.ready;
      spawned.child.send({ type: "start", dbPath, input: {
        userId: 1,
        chatId: 1,
        requestId: "req_contention",
        assistantMessageId: msgId,
        requestedPoints: 60,
        reason: "contention",
      }});
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 120);
      holdDb.exec("COMMIT");
      holdDb.close();

      const result = await spawned.result;
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.appliedNewCharge, true);

      const verifyDb = new Database(dbPath);
      assert.equal(countSettlements(verifyDb), 1);
      assert.equal(countNegativeLogs(verifyDb), 1);
      verifyDb.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("chatBillingSettlement — canonical duplicate constraint matcher", () => {
  it("NON_SETTLEMENT_CONSTRAINT_CAN_BE_CLASSIFIED_AS_DUPLICATE: false", () => {
    const foreignUnique = new Error("UNIQUE constraint failed: creator_earnings.message_id");
    (foreignUnique as Error & { code?: string }).code = "SQLITE_CONSTRAINT_UNIQUE";
    assert.equal(isChatBillingSettlementUniqueConflict(foreignUnique), false);

    const genericConstraint = new Error("CHECK constraint failed: point_type");
    (genericConstraint as Error & { code?: string }).code = "SQLITE_CONSTRAINT";
    assert.equal(isChatBillingSettlementUniqueConflict(genericConstraint), false);

    const settlementUnique = new Error(
      "UNIQUE constraint failed: chat_billing_settlements.user_id, chat_billing_settlements.chat_id, chat_billing_settlements.request_id, chat_billing_settlements.charge_kind"
    );
    (settlementUnique as Error & { code?: string }).code = "SQLITE_CONSTRAINT_UNIQUE";
    assert.equal(isChatBillingSettlementUniqueConflict(settlementUnique), true);
  });

  it("isRetryableSettlementContention recognizes busy/locked codes", () => {
    for (const code of ["SQLITE_BUSY", "SQLITE_BUSY_SNAPSHOT", "SQLITE_LOCKED"] as const) {
      const err = new Error(code);
      (err as Error & { code?: string }).code = code;
      assert.equal(isRetryableSettlementContention(err), true);
    }
  });
});

describe("chatBillingSettlement — claim-before-ledger safety", () => {
  it("UNIQUE_OR_CLAIM_CONFLICT_LEDGER_SAFETY: duplicate claim does not mutate ledger", () => {
    const dir = mkdtempSync(join(tmpdir(), "billing-settle-"));
    const dbPath = join(dir, "test.db");
    try {
      const db = createSettlementTestDb(dbPath);
      const msgId = insertAssistant(db, 1, "req_claim_safe");
      const beforeBalance = userBalance(db);
      const first = settleChatTurnBillingExactlyOnce(db, {
        userId: 1,
        chatId: 1,
        requestId: "req_claim_safe",
        assistantMessageId: msgId,
        requestedPoints: 90,
        reason: "first",
      });
      assert.equal(first.appliedNewCharge, true);
      const midBalance = userBalance(db);
      assert.ok(midBalance < beforeBalance);

      const second = settleChatTurnBillingExactlyOnce(db, {
        userId: 1,
        chatId: 1,
        requestId: "req_claim_safe",
        assistantMessageId: msgId,
        requestedPoints: 120,
        reason: "duplicate",
      });
      assert.equal(second.appliedNewCharge, false);
      assert.equal(userBalance(db), midBalance);
      assert.equal(countNegativeLogs(db), 1);
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("chatBillingSettlement — schema parity", () => {
  it("LOCAL_SETTLEMENT_SCHEMA_READY and verifier passes after ensure", () => {
    const db = new Database(":memory:");
    ensureChatBillingSettlementSchema(db);
    assert.equal(hasChatBillingSettlementSchema(db), true);
    db.close();
  });
});

describe("chatBillingSettlement — read helper", () => {
  it("readChatBillingSettlement returns committed settlement", () => {
    const dir = mkdtempSync(join(tmpdir(), "billing-settle-"));
    const dbPath = join(dir, "test.db");
    try {
      const db = createSettlementTestDb(dbPath);
      const msgId = insertAssistant(db, 1, "req_read_1");
      settleChatTurnBillingExactlyOnce(db, {
        userId: 1,
        chatId: 1,
        requestId: "req_read_1",
        assistantMessageId: msgId,
        requestedPoints: 30,
        reason: "charge",
      });
      const read = readChatBillingSettlement(db, 1, 1, "req_read_1", CHAT_TURN_CHARGE_KIND);
      assert.ok(read);
      assert.equal(read!.settledPoints, 30);
      assert.equal(read!.duplicate, true);
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("chatBillingSettlement — platform-funded widget route contract", () => {
  it("requestedPoints main-only (route #754) — settlement deducts main, not widget surcharge", () => {
    const dir = mkdtempSync(join(tmpdir(), "billing-settle-"));
    const dbPath = join(dir, "test.db");
    try {
      const db = createSettlementTestDb(dbPath);
      creditPointsWithIds(db, 1, 500, "PAID", "test seed");
      const msgId = insertAssistant(db, 1, "req_widget_main_only");
      const mainBillingCost = 60;
      const settled = settleChatTurnBillingExactlyOnce(db, {
        userId: 1,
        chatId: 1,
        requestId: "req_widget_main_only",
        assistantMessageId: msgId,
        requestedPoints: mainBillingCost,
        reason: "main RP only — widget platform-funded at route",
      });
      assert.equal(settled.settledPoints, mainBillingCost);
      assert.equal(paidCreatorRewardSpend(settled.slices), mainBillingCost);
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
