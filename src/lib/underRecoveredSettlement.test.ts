import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, it } from "node:test";
import { ensureAdminFinanceTables } from "./adminFinance";
import {
  BillingProductNotDeliveredError,
  UNDER_RECOVERED_OUTCOME,
  hasUnresolvedUnderRecoveredSettlement,
  settleChatTurnBillingExactlyOnce,
} from "./chatBillingSettlement";
import { shouldRejectMainRpGenerationReadOnly } from "./mainRpGenerationAdmission";
import { ensureChatBillingSettlementSchema } from "./chatBillingSettlementSchema";
import { creditPointsWithIds } from "./points";
import {
  ensureProviderCostLedgerSchema,
  listProviderCostEventsForAssistantMessage,
  recordMainGenerationProviderCost,
} from "./providerCostLedger";
import { resolveStoredTurnChargeEvidence } from "./storedTurnChargeEvidence";

function createFixtureDb(dbPath: string): Database.Database {
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
    CREATE TABLE IF NOT EXISTS point_gifts (id INTEGER PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS chat_image_generations (id INTEGER PRIMARY KEY);
    CREATE INDEX idx_messages_chat_request_id ON messages(chat_id, request_id);
    INSERT INTO users (id, points, creator_points) VALUES (1, 0, 0);
    INSERT INTO characters (id, creator_id, official) VALUES (1, NULL, 0);
    INSERT INTO chats (id, user_id, character_id) VALUES (1, 1, 1);
  `);
  ensureChatBillingSettlementSchema(db);
  ensureAdminFinanceTables(db);
  ensureProviderCostLedgerSchema(db);
  return db;
}

function seedSpendable(db: Database.Database, amount: number, pointType: "PAID" | "FREE" = "PAID"): void {
  db.prepare(`UPDATE point_transactions SET remaining_amount=0 WHERE user_id=1`).run();
  db.prepare(`DELETE FROM point_logs WHERE user_id=1`).run();
  if (amount > 0) {
    creditPointsWithIds(db, 1, amount, pointType, `seed ${amount}P`);
  } else {
    db.prepare(`UPDATE users SET points=0 WHERE id=1`).run();
  }
}

function insertAssistant(
  db: Database.Database,
  requestId: string,
  opts?: { content?: string; status?: string }
): number {
  const result = db
    .prepare(
      `INSERT INTO messages (chat_id, role, content, request_id, generation_status)
       VALUES (1, 'assistant', ?, ?, ?)`
    )
    .run(opts?.content ?? "정상 응답 본문", requestId, opts?.status ?? "completed");
  return Number(result.lastInsertRowid);
}

function countSettlements(db: Database.Database): number {
  return (db.prepare(`SELECT COUNT(*) AS c FROM chat_billing_settlements`).get() as { c: number }).c;
}

function countNegativeLogs(db: Database.Database): number {
  return (
    db.prepare(`SELECT COUNT(*) AS c FROM point_logs WHERE user_id=1 AND delta<0`).get() as {
      c: number;
    }
  ).c;
}

function userBalance(db: Database.Database): number {
  return (db.prepare(`SELECT points FROM users WHERE id=1`).get() as { points: number }).points;
}

function lotSnapshot(db: Database.Database): Array<{ point_type: string; remaining_amount: number }> {
  return db
    .prepare(
      `SELECT point_type, remaining_amount FROM point_transactions
       WHERE user_id=1 ORDER BY id`
    )
    .all() as Array<{ point_type: string; remaining_amount: number }>;
}

function assertLotsNonNegative(db: Database.Database): void {
  for (const lot of lotSnapshot(db)) {
    assert.ok(lot.remaining_amount >= 0, `lot ${lot.point_type} went negative`);
  }
}

function recordMainCost(
  db: Database.Database,
  assistantMessageId: number,
  requestId: string,
  providerRequestId: string,
  outcome: "success" | "failed_with_usage" | "failed_without_usage" = "success"
): { eventKey: string; recorded: boolean } {
  return recordMainGenerationProviderCost(
    {
      chatId: 1,
      assistantMessageId,
      generationSequence: 0,
      generationRequestId: requestId,
      provider: "cheaperinference",
      model: "deepseek-v4-pro-0813",
      requestKind: "main-rp",
      inputTokens: 1200,
      outputTokens: 800,
      cheaperInferenceBilledCostUsd: outcome === "failed_without_usage" ? undefined : 0.012,
      providerRequestId,
      outcome,
      persistInTests: true,
    },
    db
  );
}

function withFixture(
  run: (db: Database.Database) => void
): void {
  const dir = mkdtempSync(join(tmpdir(), "under-recovered-"));
  const dbPath = join(dir, "test.db");
  const db = createFixtureDb(dbPath);
  try {
    run(db);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("under-recovered settlement fixtures", () => {
  it("A 100P/800P keeps the product, records cost once, and persists under_recovered once", () => {
    withFixture((db) => {
      seedSpendable(db, 100, "PAID");
      const lotsBefore = lotSnapshot(db);
      const balanceBefore = userBalance(db);
      assert.equal(balanceBefore, 100);

      const requestId = "req_a_100_800";
      const msgId = insertAssistant(db, requestId);
      const firstCost = recordMainCost(db, msgId, requestId, "prov_a_100_800");
      const replayCost = recordMainCost(db, msgId, requestId, "prov_a_100_800");
      const settlement = settleChatTurnBillingExactlyOnce(db, {
        userId: 1,
        chatId: 1,
        requestId,
        assistantMessageId: msgId,
        requestedPoints: 800,
        reason: "100P user / 800P product",
      });
      const replay = settleChatTurnBillingExactlyOnce(db, {
        userId: 1,
        chatId: 1,
        requestId,
        assistantMessageId: msgId,
        requestedPoints: 800,
        reason: "same request replay",
      });

      assert.equal(firstCost.recorded, true);
      assert.equal(replayCost.recorded, false);
      assert.equal(listProviderCostEventsForAssistantMessage(msgId, db).length, 1);

      assert.equal(settlement.outcome, UNDER_RECOVERED_OUTCOME);
      assert.equal(settlement.appliedNewCharge, false);
      assert.equal(settlement.requestedPoints, 800);
      assert.equal(settlement.settledPoints, 0);
      assert.deepEqual(settlement.slices, []);
      assert.equal(replay.duplicate, true);
      assert.equal(replay.outcome, UNDER_RECOVERED_OUTCOME);
      assert.equal(replay.amountMismatch, undefined);
      assert.equal(countSettlements(db), 1);
      assert.equal(countNegativeLogs(db), 0);
      assert.equal(userBalance(db), 100);
      assert.deepEqual(lotSnapshot(db), lotsBefore);
      assertLotsNonNegative(db);

      const content = (
        db.prepare(`SELECT content, generation_status FROM messages WHERE id=?`).get(msgId) as {
          content: string;
          generation_status: string;
        }
      );
      assert.equal(content.content, "정상 응답 본문");
      assert.equal(content.generation_status, "completed");

      const evidence = resolveStoredTurnChargeEvidence(db, {
        userId: 1,
        chatId: 1,
        assistantMessageId: msgId,
        requestId,
        generationStatus: "completed",
        deductionSlicesRaw: "[]",
        usage: null,
      });
      assert.equal(evidence.status, "not_charged");
      assert.equal(evidence.settledPoints, 0);
      assert.equal(evidence.evidenceStatus, "complete");

      assert.equal(hasUnresolvedUnderRecoveredSettlement(db, 1), true);
      assert.equal(
        shouldRejectMainRpGenerationReadOnly(db, {
          userId: 1,
          chatId: 1,
          requestId,
        }),
        null
      );
      assert.equal(
        shouldRejectMainRpGenerationReadOnly(db, {
          userId: 1,
          chatId: 1,
          requestId: "req_new_turn",
        }),
        "under_recovered"
      );
      assert.equal(
        shouldRejectMainRpGenerationReadOnly(db, {
          userId: 1,
          chatId: null,
          requestId: "req_new_chat",
        }),
        "under_recovered"
      );
    });
  });

  it("B 100P/100P still charges exactly once with the same deduction shape", () => {
    withFixture((db) => {
      seedSpendable(db, 100, "PAID");
      const requestId = "req_b_100_100";
      const msgId = insertAssistant(db, requestId);
      const first = settleChatTurnBillingExactlyOnce(db, {
        userId: 1,
        chatId: 1,
        requestId,
        assistantMessageId: msgId,
        requestedPoints: 100,
        reason: "normal charge",
      });
      const replay = settleChatTurnBillingExactlyOnce(db, {
        userId: 1,
        chatId: 1,
        requestId,
        assistantMessageId: msgId,
        requestedPoints: 100,
        reason: "normal charge replay",
      });

      assert.equal(first.outcome, "charged");
      assert.equal(first.appliedNewCharge, true);
      assert.equal(first.settledPoints, 100);
      assert.equal(first.slices.length, 1);
      assert.equal(first.slices[0]?.pointType, "PAID");
      assert.equal(first.slices[0]?.amount, 100);
      assert.equal(replay.duplicate, true);
      assert.equal(replay.appliedNewCharge, false);
      assert.equal(countSettlements(db), 1);
      assert.equal(countNegativeLogs(db), 1);
      assert.equal(userBalance(db), 0);
      assertLotsNonNegative(db);
      assert.equal(hasUnresolvedUnderRecoveredSettlement(db, 1), false);
      assert.equal(
        shouldRejectMainRpGenerationReadOnly(db, {
          userId: 1,
          chatId: 1,
          requestId: "req_next",
        }),
        null
      );
    });
  });

  it("C empty/failed product is not under-recovered; cost records only when usage exists", () => {
    withFixture((db) => {
      seedSpendable(db, 100, "PAID");
      const emptyRequestId = "req_c_empty";
      const emptyId = insertAssistant(db, emptyRequestId, { content: "   ", status: "completed" });
      assert.throws(
        () =>
          settleChatTurnBillingExactlyOnce(db, {
            userId: 1,
            chatId: 1,
            requestId: emptyRequestId,
            assistantMessageId: emptyId,
            requestedPoints: 800,
            reason: "empty product",
          }),
        (err: unknown) =>
          err instanceof BillingProductNotDeliveredError && err.reason === "empty_product"
      );

      const failedRequestId = "req_c_failed";
      const failedId = insertAssistant(db, failedRequestId, {
        content: "",
        status: "interrupted",
      });
      const failedWithUsage = recordMainCost(
        db,
        failedId,
        failedRequestId,
        "prov_c_failed_usage",
        "failed_with_usage"
      );
      assert.throws(
        () =>
          settleChatTurnBillingExactlyOnce(db, {
            userId: 1,
            chatId: 1,
            requestId: failedRequestId,
            assistantMessageId: failedId,
            requestedPoints: 800,
            reason: "failed product",
          }),
        BillingProductNotDeliveredError
      );

      const noUsageId = insertAssistant(db, "req_c_no_usage", {
        content: "",
        status: "failed",
      });
      assert.equal(failedWithUsage.recorded, true);
      assert.equal(listProviderCostEventsForAssistantMessage(failedId, db).length, 1);
      assert.equal(listProviderCostEventsForAssistantMessage(noUsageId, db).length, 0);
      assert.equal(countSettlements(db), 0);
      assert.equal(hasUnresolvedUnderRecoveredSettlement(db, 1), false);
      assert.equal(userBalance(db), 100);
      assert.equal(countNegativeLogs(db), 0);
    });
  });

  it("D committed under-recovered gates new ids; in-flight check-then-act still races", () => {
    withFixture((db) => {
      seedSpendable(db, 100, "PAID");
      const firstId = insertAssistant(db, "req_d_first");
      const secondId = insertAssistant(db, "req_d_second");

      assert.equal(
        shouldRejectMainRpGenerationReadOnly(db, {
          userId: 1,
          chatId: 1,
          requestId: "req_d_first",
        }),
        null
      );
      assert.equal(
        shouldRejectMainRpGenerationReadOnly(db, {
          userId: 1,
          chatId: 1,
          requestId: "req_d_second",
        }),
        null
      );

      const first = settleChatTurnBillingExactlyOnce(db, {
        userId: 1,
        chatId: 1,
        requestId: "req_d_first",
        assistantMessageId: firstId,
        requestedPoints: 800,
        reason: "in-flight A",
      });
      const second = settleChatTurnBillingExactlyOnce(db, {
        userId: 1,
        chatId: 1,
        requestId: "req_d_second",
        assistantMessageId: secondId,
        requestedPoints: 800,
        reason: "in-flight B",
      });

      assert.equal(first.outcome, UNDER_RECOVERED_OUTCOME);
      assert.equal(second.outcome, UNDER_RECOVERED_OUTCOME);
      assert.equal(countSettlements(db), 2);
      assert.equal(userBalance(db), 100);
      assert.equal(countNegativeLogs(db), 0);

      assert.equal(
        shouldRejectMainRpGenerationReadOnly(db, {
          userId: 1,
          chatId: 1,
          requestId: "req_d_third",
        }),
        "under_recovered"
      );
      assert.equal(
        shouldRejectMainRpGenerationReadOnly(db, {
          userId: 1,
          chatId: null,
          requestId: "req_d_new_chat",
        }),
        "under_recovered"
      );
      assert.equal(
        shouldRejectMainRpGenerationReadOnly(db, {
          userId: 1,
          chatId: 1,
          requestId: "req_d_first",
        }),
        null
      );

      db.prepare(
        `UPDATE chat_billing_settlements SET refunded_at = datetime('now') WHERE outcome = ?`
      ).run(UNDER_RECOVERED_OUTCOME);
      assert.equal(hasUnresolvedUnderRecoveredSettlement(db, 1), true);
      assert.equal(
        shouldRejectMainRpGenerationReadOnly(db, {
          userId: 1,
          chatId: 1,
          requestId: "req_d_after_refunded_at",
        }),
        "under_recovered"
      );
    });
  });
});
