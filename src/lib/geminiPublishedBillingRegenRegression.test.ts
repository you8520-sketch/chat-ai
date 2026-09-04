/**
 * P0 regression: Published Phase1 Gemini 197P vs stale regen legacy slices (49P).
 * Pre-fix main reproduces requested=197 settled=49 via legacy_already_billed.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, it } from "node:test";
import {
  buildUsageBillingContractAdmin,
  persistAssistantMessageFinalCharge,
  sumDeductionSliceAmounts,
} from "@/lib/chatBillingFinalCharge";
import { settleChatTurnBillingExactlyOnce } from "@/lib/chatBillingSettlement";
import { ensureChatBillingSettlementSchema } from "@/lib/chatBillingSettlementSchema";
import { bootstrapStreamingTurn } from "@/lib/streamingPersistence";
import type { Usage } from "@/lib/chatUsage";
import type { ChatBillingContractDecision } from "@/lib/chatBillingContractDispatch";

function openRegressionDb(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, points REAL NOT NULL DEFAULT 0);
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
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      request_id TEXT,
      usage TEXT,
      deduction_slices TEXT,
      alternates TEXT,
      active_variant INTEGER,
      generation_status TEXT,
      user_message_id INTEGER,
      is_refunded INTEGER NOT NULL DEFAULT 0,
      status_meta TEXT,
      status_widget_values_json TEXT,
      status_widget_turn_active INTEGER NOT NULL DEFAULT 0,
      memory_relationship_task_json TEXT,
      updated_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE chats (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, character_id INTEGER NOT NULL);
    INSERT INTO users (id, points) VALUES (1, 100000);
    INSERT INTO point_transactions (user_id, point_type, remaining_amount, expires_at)
      VALUES (1, 'PAID', 50000, '2030-01-01');
    INSERT INTO chats (id, user_id, character_id) VALUES (1, 1, 1);
  `);
  ensureChatBillingSettlementSchema(db);
  return db;
}

const publishedDecision: ChatBillingContractDecision = {
  contract: "published_phase1",
  points: 197,
  publishedSnapshot: {} as ChatBillingContractDecision extends { publishedSnapshot: infer S }
    ? S
    : never,
  reason: "phase1_live_grade",
  telemetry: {
    billingContract: "published_phase1",
    billingContractReason: "phase1_live_grade",
    deliveredModelId: "google/gemini-3.1-pro-preview",
    publishedCandidateStatus: "resolved",
    publishedBlockReason: null,
    pricingVersion: 2,
  },
};

describe("Gemini Published billing — regen stale slice regression (matrix A/E)", () => {
  it("matrix A: published 197 settles 197 with usage/receipt parity after regen bootstrap", () => {
    const dir = mkdtempSync(join(tmpdir(), "gemini-published-regen-"));
    const dbPath = join(dir, "test.db");
    try {
      const db = openRegressionDb(dbPath);

      const boot = bootstrapStreamingTurn(db, {
        chatId: 1,
        requestId: "cr_gemini_gen_a",
        userContent: "user turn",
        skipUserInsert: false,
      });

      const legacySettlement = settleChatTurnBillingExactlyOnce(db, {
        userId: 1,
        chatId: 1,
        requestId: "cr_gemini_gen_a",
        assistantMessageId: boot.assistantMessageId,
        requestedPoints: 49,
        reason: "legacy candidate generation",
      });
      assert.equal(legacySettlement.settledPoints, 49);

      bootstrapStreamingTurn(db, {
        chatId: 1,
        requestId: "cr_gemini_gen_b",
        userContent: "user turn",
        skipUserInsert: true,
        existingUserMessageId: boot.userMessageId,
        regenerateAssistantId: boot.assistantMessageId,
      });

      const cleared = db
        .prepare(`SELECT deduction_slices FROM messages WHERE id=?`)
        .get(boot.assistantMessageId) as { deduction_slices: string | null };
      assert.equal(cleared.deduction_slices, null);

      const usageRecord: Usage = {
        input: 27061,
        output: 6247,
        model: "google/gemini-3.1-pro-preview",
        route: "safe",
        cost: 197,
        baseCost: 49,
        breakdown: [],
        upstreamCostUsd: 0.0903602,
      };
      db.prepare(
        `UPDATE messages SET usage=?, content='assistant reply', model=?, generation_status='completed'
         WHERE id=? AND chat_id=?`
      ).run(
        JSON.stringify(usageRecord),
        "google/gemini-3.1-pro-preview",
        boot.assistantMessageId,
        1
      );

      const settlement = settleChatTurnBillingExactlyOnce(db, {
        userId: 1,
        chatId: 1,
        requestId: "cr_gemini_gen_b",
        assistantMessageId: boot.assistantMessageId,
        requestedPoints: 197,
        reason: "published generation",
      });

      assert.equal(settlement.requestedPoints, 197);
      assert.equal(settlement.settledPoints, 197);
      assert.equal(settlement.outcome, "charged");
      assert.equal(settlement.source, "native");

      const billingAdmin = buildUsageBillingContractAdmin(publishedDecision, 197, 49);
      const consistency = persistAssistantMessageFinalCharge(db, {
        assistantMessageId: boot.assistantMessageId,
        chatId: 1,
        requestId: "cr_gemini_gen_b",
        settledPoints: 197,
        slices: settlement.slices,
        billingContractDispatch: billingAdmin,
      });
      assert.equal(consistency.consistent, true);

      const row = db
        .prepare(`SELECT usage, deduction_slices FROM messages WHERE id=?`)
        .get(boot.assistantMessageId) as { usage: string; deduction_slices: string };
      const usage = JSON.parse(row.usage) as Usage;
      assert.equal(usage.cost, 197);
      assert.equal(usage.billingContractDispatch?.publishedFinalPoints, 197);
      assert.equal(usage.billingContractDispatch?.settledDeductedPoints, 197);
      assert.equal(sumDeductionSliceAmounts(JSON.parse(row.deduction_slices)), 197);

      const settlementRow = db
        .prepare(
          `SELECT requested_points, settled_points, outcome, source FROM chat_billing_settlements
           WHERE chat_id=1 AND request_id='cr_gemini_gen_b'`
        )
        .get() as {
        requested_points: number;
        settled_points: number;
        outcome: string;
        source: string;
      };
      assert.equal(settlementRow.requested_points, 197);
      assert.equal(settlementRow.settled_points, 197);
      assert.equal(settlementRow.outcome, "charged");
      assert.equal(settlementRow.source, "native");

      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
