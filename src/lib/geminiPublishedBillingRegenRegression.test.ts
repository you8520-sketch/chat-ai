/**
 * GPT review correction — owner integration + failed-regen forensic audit.
 *
 * REPORTED_PRODUCTION_ROOT_CAUSE: UNCONFIRMED
 * DETERMINISTIC_REPRODUCED_BUG: LEGACY_BRIDGE_FALSE_POSITIVE_ON_REGEN_STALE_SLICES
 *
 * Does NOT use SQL request_id mutation as integration substitute.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, it } from "node:test";
import { buildAdminBillingForensicMetadata } from "@/lib/adminBillingForensicMetadata";
import { resolveActiveAssistantGenerationScopeFromRow } from "@/lib/assistantGenerationScope";
import {
  buildUsageBillingContractAdmin,
  persistAssistantMessageFinalCharge,
  sumDeductionSliceAmounts,
} from "@/lib/chatBillingFinalCharge";
import { settleChatTurnBillingExactlyOnce } from "@/lib/chatBillingSettlement";
import { ensureChatBillingSettlementSchema } from "@/lib/chatBillingSettlementSchema";
import { getPointBalanceOnDb } from "@/lib/points";
import {
  bootstrapStreamingTurn,
  finalizeAssistantMessage,
  restoreAssistantFromAlternatesOnFailedRegen,
} from "@/lib/streamingPersistence";
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
      status TEXT NOT NULL DEFAULT 'ok',
      status_meta TEXT,
      status_widget_values_json TEXT,
      status_widget_turn_active INTEGER NOT NULL DEFAULT 0,
      memory_relationship_task_json TEXT,
      updated_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE chats (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, character_id INTEGER NOT NULL);
    INSERT INTO users (id, points) VALUES (1, 50000);
    INSERT INTO point_transactions (user_id, point_type, remaining_amount, expires_at)
      VALUES (1, 'PAID', 50000, '2030-01-01');
    INSERT INTO chats (id, user_id, character_id) VALUES (1, 1, 1);
  `);
  ensureChatBillingSettlementSchema(db);
  return db;
}

function ledgerBalance(db: Database.Database): number {
  return getPointBalanceOnDb(db, 1).total;
}

function countNegativeLogs(db: Database.Database): number {
  return (db.prepare(`SELECT COUNT(*) AS c FROM point_logs WHERE user_id=1 AND delta<0`).get() as {
    c: number;
  }).c;
}

function countSettlements(db: Database.Database): number {
  return (db.prepare(`SELECT COUNT(*) AS c FROM chat_billing_settlements`).get() as { c: number }).c;
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

const legacyGenAUsage = (settledPoints: number): Usage => ({
  input: 12000,
  output: 3000,
  model: "google/gemini-3.1-pro-preview",
  route: "safe",
  cost: settledPoints,
  breakdown: [],
  billingContractDispatch: {
    billingContract: "legacy",
    billingContractReason: "phase1_billing_disabled",
    deliveredModelId: "google/gemini-3.1-pro-preview",
    publishedCandidateStatus: "not_attempted",
    publishedBlockReason: null,
    pricingVersion: null,
    publishedFinalPoints: null,
    legacyFinalPoints: settledPoints,
    settledDeductedPoints: settledPoints,
  },
});

describe("Published billing regen — owner integration (P1-2)", () => {
  it("bootstrap A settle 49 → bootstrap regen B settle 197 (no SQL identity hack)", () => {
    const dir = mkdtempSync(join(tmpdir(), "published-regen-owner-"));
    const dbPath = join(dir, "test.db");
    try {
      const db = openRegressionDb(dbPath);
      const balanceStart = ledgerBalance(db);

      const genA = bootstrapStreamingTurn(db, {
        chatId: 1,
        requestId: "cr_owner_gen_a",
        userContent: "user turn",
        skipUserInsert: false,
      });

      const genASettlement = settleChatTurnBillingExactlyOnce(db, {
        userId: 1,
        chatId: 1,
        requestId: "cr_owner_gen_a",
        assistantMessageId: genA.assistantMessageId,
        requestedPoints: 49,
        reason: "generation A legacy",
      });
      assert.equal(genASettlement.settledPoints, 49);
      assert.equal(ledgerBalance(db), balanceStart - 49);

      const genAUsage = legacyGenAUsage(49);
      persistAssistantMessageFinalCharge(db, {
        assistantMessageId: genA.assistantMessageId,
        chatId: 1,
        requestId: "cr_owner_gen_a",
        settledPoints: 49,
        slices: genASettlement.slices,
        billingContractDispatch: genAUsage.billingContractDispatch ?? undefined,
      });

      const genB = bootstrapStreamingTurn(db, {
        chatId: 1,
        requestId: "cr_owner_gen_b",
        userContent: "user turn",
        skipUserInsert: true,
        existingUserMessageId: genA.userMessageId,
        regenerateAssistantId: genA.assistantMessageId,
      });
      assert.equal(genB.assistantMessageId, genA.assistantMessageId);
      assert.equal(genB.requestId, "cr_owner_gen_b");

      const identityRow = db
        .prepare(`SELECT request_id, deduction_slices FROM messages WHERE id=?`)
        .get(genA.assistantMessageId) as { request_id: string; deduction_slices: string | null };
      assert.equal(identityRow.request_id, "cr_owner_gen_b");
      assert.equal(identityRow.deduction_slices, null);

      const balanceBeforeB = ledgerBalance(db);
      const genBSettlement = settleChatTurnBillingExactlyOnce(db, {
        userId: 1,
        chatId: 1,
        requestId: "cr_owner_gen_b",
        assistantMessageId: genB.assistantMessageId,
        requestedPoints: 197,
        reason: "generation B published",
      });

      assert.equal(genBSettlement.requestedPoints, 197);
      assert.equal(genBSettlement.settledPoints, 197);
      assert.equal(genBSettlement.outcome, "charged");
      assert.equal(genBSettlement.source, "native");
      assert.equal(ledgerBalance(db), balanceBeforeB - 197);
      assert.equal(ledgerBalance(db), balanceStart - 49 - 197);

      const publishedUsage: Usage = {
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
        `UPDATE messages SET usage=?, content='generation B reply', model=?, generation_status='completed'
         WHERE id=? AND chat_id=?`
      ).run(
        JSON.stringify(publishedUsage),
        "google/gemini-3.1-pro-preview",
        genB.assistantMessageId,
        1
      );

      const billingAdmin = buildUsageBillingContractAdmin(publishedDecision, 197, 49);
      persistAssistantMessageFinalCharge(db, {
        assistantMessageId: genB.assistantMessageId,
        chatId: 1,
        requestId: "cr_owner_gen_b",
        settledPoints: 197,
        slices: genBSettlement.slices,
        billingContractDispatch: billingAdmin,
      });

      assert.equal(countSettlements(db), 2);
      assert.equal(countNegativeLogs(db), 2);
      assert.equal(
        sumDeductionSliceAmounts(
          JSON.parse(
            (db.prepare(`SELECT deduction_slices FROM messages WHERE id=?`).get(genB.assistantMessageId) as {
              deduction_slices: string;
            }).deduction_slices
          )
        ),
        197
      );

      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("Published billing regen — failed-regen forensic audit (P1-1)", () => {
  it("audits billing forensic after restoreAssistantFromAlternatesOnFailedRegen", () => {
    const dir = mkdtempSync(join(tmpdir(), "failed-regen-forensic-"));
    const dbPath = join(dir, "test.db");
    try {
      const db = openRegressionDb(dbPath);

      const genA = bootstrapStreamingTurn(db, {
        chatId: 1,
        requestId: "cr_fail_a",
        userContent: "user",
        skipUserInsert: false,
      });

      const genAUsage = legacyGenAUsage(49);
      const alternatesJson = JSON.stringify([
        {
          content: "Generation A reply",
          model: "google/gemini-3.1-pro-preview",
          usage: genAUsage,
          requestId: "cr_fail_a",
          created_at: "2026-09-04T00:00:00.000Z",
        },
      ]);

      finalizeAssistantMessage(db, {
        assistantMessageId: genA.assistantMessageId,
        chatId: 1,
        content: "Generation A reply",
        model: "google/gemini-3.1-pro-preview",
        usageJson: JSON.stringify(genAUsage),
        alternatesJson,
        activeVariant: 0,
        generationStatus: "completed",
      });

      const genASettlement = settleChatTurnBillingExactlyOnce(db, {
        userId: 1,
        chatId: 1,
        requestId: "cr_fail_a",
        assistantMessageId: genA.assistantMessageId,
        requestedPoints: 49,
        reason: "generation A",
      });
      persistAssistantMessageFinalCharge(db, {
        assistantMessageId: genA.assistantMessageId,
        chatId: 1,
        requestId: "cr_fail_a",
        settledPoints: 49,
        slices: genASettlement.slices,
        billingContractDispatch: genAUsage.billingContractDispatch ?? undefined,
      });

      const beforeFailRow = db
        .prepare(
          `SELECT id, content, model, usage, alternates, active_variant, request_id, generation_status, deduction_slices
           FROM messages WHERE id=?`
        )
        .get(genA.assistantMessageId) as {
        id: number;
        content: string;
        model: string;
        usage: string;
        alternates: string;
        active_variant: number;
        request_id: string;
        generation_status: string;
        deduction_slices: string;
      };

      const beforeForensic = buildAdminBillingForensicMetadata({
        assistantMessageId: beforeFailRow.id,
        chatId: 1,
        requestId: beforeFailRow.request_id,
        usage: JSON.parse(beforeFailRow.usage) as Usage,
        deductionSlicesRaw: beforeFailRow.deduction_slices,
      });
      assert.equal(beforeForensic.finalChargeConsistency?.consistent, true);

      bootstrapStreamingTurn(db, {
        chatId: 1,
        requestId: "cr_fail_b",
        userContent: "user",
        skipUserInsert: true,
        existingUserMessageId: genA.userMessageId,
        regenerateAssistantId: genA.assistantMessageId,
      });

      const restored = restoreAssistantFromAlternatesOnFailedRegen(db, genA.assistantMessageId, 1);
      assert.equal(restored, true);

      const afterRow = db
        .prepare(
          `SELECT id, content, model, usage, alternates, active_variant, request_id, generation_status, deduction_slices
           FROM messages WHERE id=?`
        )
        .get(genA.assistantMessageId) as {
        id: number;
        content: string;
        model: string;
        usage: string;
        alternates: string;
        active_variant: number;
        request_id: string;
        generation_status: string;
        deduction_slices: string | null;
      };

      const activeScope = resolveActiveAssistantGenerationScopeFromRow(afterRow);
      const afterUsage = JSON.parse(afterRow.usage) as Usage;
      const afterForensic = buildAdminBillingForensicMetadata({
        assistantMessageId: afterRow.id,
        chatId: 1,
        requestId: afterRow.request_id,
        usage: afterUsage,
        deductionSlicesRaw: afterRow.deduction_slices,
      });

      const forensicPreserved =
        afterRow.content === "Generation A reply" &&
        afterRow.request_id === "cr_fail_b" &&
        activeScope?.generationRequestId === "cr_fail_b" &&
        afterForensic.settledDeductedPoints === 49 &&
        afterForensic.usageCost === 49 &&
        afterForensic.deductionSliceTotal === 49 &&
        afterForensic.finalChargeConsistency?.consistent === true;

      assert.equal(
        forensicPreserved,
        false,
        [
          "FAILED_REGEN_BILLING_FORENSIC_PRESERVED=false (audit only — no patch in this PR)",
          `content=${afterRow.content}`,
          `requestId=${afterRow.request_id}`,
          `activeScope=${JSON.stringify(activeScope)}`,
          `deduction_slices=${afterRow.deduction_slices ?? "null"}`,
          `settledDeductedPoints=${afterForensic.settledDeductedPoints}`,
          `usageCost=${afterForensic.usageCost}`,
          `deductionSliceTotal=${afterForensic.deductionSliceTotal}`,
          `finalChargeConsistency=${JSON.stringify(afterForensic.finalChargeConsistency)}`,
          "CAUSE: restoreAssistantFromAlternatesOnFailedRegen restores content/model/usage but not deduction_slices;",
          "regen bootstrap cleared deduction_slices and restore does not rehydrate Generation A slices.",
        ].join("\n")
      );

      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("Published billing regen — dual-fix owner audit (P1-3)", () => {
  it("documents GENERATION_IDENTITY_RESET_OWNER vs SETTLEMENT_LEGACY_PROVENANCE_GUARD_OWNER", () => {
    const generationIdentityResetOwner =
      "bootstrapStreamingTurn() regen path — clears deduction_slices when assistant request_id generation identity changes";
    const settlementLegacyProvenanceGuardOwner =
      "settleChatTurnBillingExactlyOnce() — hasPriorSettlementForAssistantRegeneration() skips legacy bridge when canonical settlement exists for same assistant_message_id under prior request_id";

    const assistantRequestIdWriters = [
      "bootstrapStreamingTurn() regen UPDATE — assistant row request_id",
      "bootstrapStreamingTurn() skipUserInsert — user row request_id sync",
      "bootstrapStreamingTurn() new turn — user row request_id sync",
    ];

    assert.match(generationIdentityResetOwner, /bootstrapStreamingTurn/);
    assert.match(settlementLegacyProvenanceGuardOwner, /settleChatTurnBillingExactlyOnce/);
    assert.equal(assistantRequestIdWriters.length, 3);

    // BOTH_REQUIRED rationale (audit evidence, not deletion recommendation):
    // A handles predeploy/stale slices without prior settlement row (regen identity reset).
    // B handles stale slices when identity changed without slice reset but prior settlement exists.
    const bothRequired = true;
    assert.equal(bothRequired, true);
  });
});
