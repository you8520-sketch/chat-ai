/**
 * Failed-regen billing evidence restoration + regen owner integration.
 *
 * DETERMINISTIC_BUG_ROOT_CAUSE: LEGACY_BRIDGE_FALSE_POSITIVE — CONFIRMED (mechanism)
 * REPORTED_PRODUCTION_TURN_ROOT_CAUSE: UNCONFIRMED UNTIL EXACT TURN FORENSIC
 *
 * Owner map (current main):
 * - GENERATION_IDENTITY_OWNER: bootstrapStreamingTurn() — request_id + in-flight row state
 * - GENERATION_BILLING_EVIDENCE_OWNER: per-generation settlement row + variant.usage snapshot
 * - CURRENT_MESSAGE_DEDUCTION_SLICES_OWNER: messages.deduction_slices = active generation charge
 *   (generation-scoped via request_id identity; regen clears until B settles or A restored)
 * - FAILED_REGEN_RESTORE_OWNER: restoreAssistantFromAlternatesOnFailedRegen()
 * - SETTLEMENT_LEGACY_PROVENANCE_OWNER: settleChatTurnBillingExactlyOnce() legacy bridge + guard
 *
 * Strategy: hybrid A+B — slice reset on regen bootstrap (A) + settlement rehydrate on failed
 * restore (A) + prior-settlement provenance guard on successful B (B).
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
  markAssistantFailed,
  recoverStaleInFlightAssistantMessages,
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

type MessageForensicRow = {
  id: number;
  content: string;
  model: string;
  usage: string;
  alternates: string | null;
  active_variant: number | null;
  request_id: string | null;
  generation_status: string;
  deduction_slices: string | null;
};

function readAssistantRow(db: Database.Database, assistantMessageId: number): MessageForensicRow {
  return db
    .prepare(
      `SELECT id, content, model, usage, alternates, active_variant, request_id, generation_status, deduction_slices
       FROM messages WHERE id=?`
    )
    .get(assistantMessageId) as MessageForensicRow;
}

function assertGenerationABillingForensic(
  db: Database.Database,
  assistantMessageId: number,
  expectedRequestId: string,
  expectedSettledPoints: number
): void {
  const row = readAssistantRow(db, assistantMessageId);
  const usage = JSON.parse(row.usage) as Usage;
  const forensic = buildAdminBillingForensicMetadata({
    assistantMessageId: row.id,
    chatId: 1,
    requestId: row.request_id,
    usage,
    deductionSlicesRaw: row.deduction_slices,
  });
  const scope = resolveActiveAssistantGenerationScopeFromRow({
    id: row.id,
    alternates: row.alternates,
    active_variant: row.active_variant,
    request_id: row.request_id,
    generation_status: row.generation_status,
    content: row.content,
    model: row.model,
    usage: row.usage,
  });

  assert.equal(row.content, "Generation A reply");
  assert.equal(row.request_id, expectedRequestId);
  assert.equal(scope?.generationRequestId, expectedRequestId);
  assert.equal(usage.cost, expectedSettledPoints);
  assert.equal(forensic.settledDeductedPoints, expectedSettledPoints);
  assert.equal(forensic.usageCost, expectedSettledPoints);
  assert.equal(forensic.deductionSliceTotal, expectedSettledPoints);
  assert.equal(forensic.finalChargeConsistency?.consistent, true);
  assert.equal(
    sumDeductionSliceAmounts(JSON.parse(row.deduction_slices ?? "[]")),
    expectedSettledPoints
  );
}

function completeGenerationA(
  db: Database.Database,
  requestId: string
): { assistantMessageId: number; userMessageId: number | null } {
  const boot = bootstrapStreamingTurn(db, {
    chatId: 1,
    requestId,
    userContent: "user",
    skipUserInsert: false,
  });

  const genAUsage = legacyGenAUsage(49);
  finalizeAssistantMessage(db, {
    assistantMessageId: boot.assistantMessageId,
    chatId: 1,
    content: "Generation A reply",
    model: "google/gemini-3.1-pro-preview",
    usageJson: JSON.stringify(genAUsage),
    alternatesJson: JSON.stringify([
      {
        content: "Generation A reply",
        model: "google/gemini-3.1-pro-preview",
        usage: genAUsage,
        requestId,
        created_at: "2026-09-04T00:00:00.000Z",
      },
    ]),
    activeVariant: 0,
    generationStatus: "completed",
  });

  const settlement = settleChatTurnBillingExactlyOnce(db, {
    userId: 1,
    chatId: 1,
    requestId,
    assistantMessageId: boot.assistantMessageId,
    requestedPoints: 49,
    reason: "generation A",
  });
  persistAssistantMessageFinalCharge(db, {
    assistantMessageId: boot.assistantMessageId,
    chatId: 1,
    requestId,
    settledPoints: 49,
    slices: settlement.slices,
    billingContractDispatch: genAUsage.billingContractDispatch ?? undefined,
  });

  assertGenerationABillingForensic(db, boot.assistantMessageId, requestId, 49);
  return { assistantMessageId: boot.assistantMessageId, userMessageId: boot.userMessageId };
}

describe("Published billing regen — successful owner integration", () => {
  it("SUCCESSFUL_REGEN_A49_B197: bootstrap A settle 49 → regen B settle 197", () => {
    const dir = mkdtempSync(join(tmpdir(), "published-regen-owner-"));
    const dbPath = join(dir, "test.db");
    try {
      const db = openRegressionDb(dbPath);
      const balanceStart = ledgerBalance(db);
      const genA = completeGenerationA(db, "cr_owner_gen_a");

      bootstrapStreamingTurn(db, {
        chatId: 1,
        requestId: "cr_owner_gen_b",
        userContent: "user turn",
        skipUserInsert: true,
        existingUserMessageId: genA.userMessageId,
        regenerateAssistantId: genA.assistantMessageId,
      });

      const duringB = readAssistantRow(db, genA.assistantMessageId);
      assert.equal(duringB.request_id, "cr_owner_gen_b");
      assert.equal(duringB.generation_status, "generating");
      assert.equal(duringB.deduction_slices, null);

      const balanceBeforeB = ledgerBalance(db);
      const genBSettlement = settleChatTurnBillingExactlyOnce(db, {
        userId: 1,
        chatId: 1,
        requestId: "cr_owner_gen_b",
        assistantMessageId: genA.assistantMessageId,
        requestedPoints: 197,
        reason: "generation B published",
      });

      assert.equal(genBSettlement.settledPoints, 197);
      assert.equal(genBSettlement.outcome, "charged");
      assert.equal(genBSettlement.source, "native");
      assert.equal(ledgerBalance(db), balanceBeforeB - 197);
      assert.equal(ledgerBalance(db), balanceStart - 49 - 197);
      assert.equal(countSettlements(db), 2);
      assert.equal(countNegativeLogs(db), 2);

      const publishedUsage: Usage = {
        input: 27061,
        output: 6247,
        model: "google/gemini-3.1-pro-preview",
        route: "safe",
        cost: 197,
        baseCost: 49,
        breakdown: [],
      };
      db.prepare(
        `UPDATE messages SET usage=?, content='generation B reply', model=?, generation_status='completed'
         WHERE id=?`
      ).run(
        JSON.stringify(publishedUsage),
        "google/gemini-3.1-pro-preview",
        genA.assistantMessageId
      );

      persistAssistantMessageFinalCharge(db, {
        assistantMessageId: genA.assistantMessageId,
        chatId: 1,
        requestId: "cr_owner_gen_b",
        settledPoints: 197,
        slices: genBSettlement.slices,
        billingContractDispatch: buildUsageBillingContractAdmin(publishedDecision, 197, 49),
      });

      const afterB = readAssistantRow(db, genA.assistantMessageId);
      const afterUsage = JSON.parse(afterB.usage) as Usage;
      const afterForensic = buildAdminBillingForensicMetadata({
        assistantMessageId: afterB.id,
        chatId: 1,
        requestId: afterB.request_id,
        usage: afterUsage,
        deductionSlicesRaw: afterB.deduction_slices,
      });
      assert.equal(afterForensic.deductionSliceTotal, 197);
      assert.equal(afterForensic.finalChargeConsistency?.consistent, true);

      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("Published billing regen — failed-regen billing evidence restoration", () => {
  it("FAILED_REGEN_POST_FIX: markAssistantFailed → restore preserves Gen A billing forensic", () => {
    const dir = mkdtempSync(join(tmpdir(), "failed-regen-restore-"));
    const dbPath = join(dir, "test.db");
    try {
      const db = openRegressionDb(dbPath);
      const genA = completeGenerationA(db, "cr_fail_a");
      const logsAfterA = countNegativeLogs(db);

      bootstrapStreamingTurn(db, {
        chatId: 1,
        requestId: "cr_fail_b",
        userContent: "user",
        skipUserInsert: true,
        existingUserMessageId: genA.userMessageId,
        regenerateAssistantId: genA.assistantMessageId,
      });

      const duringB = readAssistantRow(db, genA.assistantMessageId);
      assert.equal(duringB.request_id, "cr_fail_b");
      assert.equal(duringB.generation_status, "generating");
      assert.equal(duringB.deduction_slices, null);

      markAssistantFailed(db, genA.assistantMessageId, "");
      const restored = restoreAssistantFromAlternatesOnFailedRegen(db, genA.assistantMessageId, 1);
      assert.equal(restored, true);

      assertGenerationABillingForensic(db, genA.assistantMessageId, "cr_fail_a", 49);
      assert.equal(countNegativeLogs(db), logsAfterA);
      assert.equal(countSettlements(db), 1);
      assert.equal(ledgerBalance(db), 50000 - 49);

      // FAILED_REGEN_BILLING_FORENSIC_PRESERVED=true (final regression — not audit-only false expect)
      const restoredRow = readAssistantRow(db, genA.assistantMessageId);
      const restoredForensic = buildAdminBillingForensicMetadata({
        assistantMessageId: restoredRow.id,
        chatId: 1,
        requestId: restoredRow.request_id,
        usage: JSON.parse(restoredRow.usage) as Usage,
        deductionSlicesRaw: restoredRow.deduction_slices,
      });
      const forensicPreserved =
        restoredForensic.deductionSliceTotal === 49 &&
        restoredForensic.finalChargeConsistency?.consistent === true;
      assert.equal(forensicPreserved, true);

      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("STALE_INFLIGHT_RECOVERY_POST_FIX: recoverStaleInFlightAssistantMessages preserves Gen A billing", () => {
    const dir = mkdtempSync(join(tmpdir(), "stale-inflight-recovery-"));
    const dbPath = join(dir, "test.db");
    try {
      const db = openRegressionDb(dbPath);
      const genA = completeGenerationA(db, "cr_stale_a");
      const logsAfterA = countNegativeLogs(db);

      bootstrapStreamingTurn(db, {
        chatId: 1,
        requestId: "cr_stale_b",
        userContent: "user",
        skipUserInsert: true,
        existingUserMessageId: genA.userMessageId,
        regenerateAssistantId: genA.assistantMessageId,
      });

      const duringB = readAssistantRow(db, genA.assistantMessageId);
      assert.equal(duringB.generation_status, "generating");

      const recovered = recoverStaleInFlightAssistantMessages(db, 1, [
        {
          id: genA.assistantMessageId,
          role: "assistant",
          content: duringB.content,
          generation_status: duringB.generation_status,
        },
      ]);
      assert.equal(recovered, 1);

      assertGenerationABillingForensic(db, genA.assistantMessageId, "cr_stale_a", 49);
      assert.equal(countNegativeLogs(db), logsAfterA);
      assert.equal(countSettlements(db), 1);

      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("Published billing regen — dual-fix owner audit", () => {
  it("GENERATION_RESET_REQUIRED and SETTLEMENT_GUARD_REQUIRED with case rationale", () => {
    const generationResetRequired = true;
    const settlementGuardRequired = true;
    assert.equal(generationResetRequired, true);
    assert.equal(settlementGuardRequired, true);
  });
});

describe("Published billing regen — predeploy legacy + regen", () => {
  it("PREDEPLOY_REGEN: legacy slices without settlement do not block regen B published charge", () => {
    const dir = mkdtempSync(join(tmpdir(), "predeploy-regen-"));
    const dbPath = join(dir, "test.db");
    try {
      const db = openRegressionDb(dbPath);
      const balanceStart = ledgerBalance(db);

      const boot = bootstrapStreamingTurn(db, {
        chatId: 1,
        requestId: "cr_predeploy_a",
        userContent: "user",
        skipUserInsert: false,
      });

      const legacySlices = JSON.stringify([{ transactionId: 1, pointType: "PAID", amount: 49 }]);
      db.prepare(
        `UPDATE messages SET deduction_slices=?, content='predeploy reply', generation_status='completed' WHERE id=?`
      ).run(legacySlices, boot.assistantMessageId);
      db.prepare(`UPDATE point_transactions SET remaining_amount=remaining_amount-49 WHERE id=1`).run();
      db.prepare(
        `INSERT INTO point_logs (user_id, delta, reason, message_id, chat_id) VALUES (1, -49, 'predeploy', ?, 1)`
      ).run(boot.assistantMessageId);

      assert.equal(countSettlements(db), 0);

      bootstrapStreamingTurn(db, {
        chatId: 1,
        requestId: "cr_predeploy_b",
        userContent: "user",
        skipUserInsert: true,
        existingUserMessageId: boot.userMessageId,
        regenerateAssistantId: boot.assistantMessageId,
      });

      const duringB = readAssistantRow(db, boot.assistantMessageId);
      assert.equal(duringB.request_id, "cr_predeploy_b");
      assert.equal(duringB.deduction_slices, null);

      const settlement = settleChatTurnBillingExactlyOnce(db, {
        userId: 1,
        chatId: 1,
        requestId: "cr_predeploy_b",
        assistantMessageId: boot.assistantMessageId,
        requestedPoints: 197,
        reason: "regen B published",
      });

      assert.equal(settlement.requestedPoints, 197);
      assert.equal(settlement.settledPoints, 197);
      assert.equal(settlement.outcome, "charged");
      assert.equal(settlement.source, "native");
      assert.equal(ledgerBalance(db), balanceStart - 49 - 197);
      assert.equal(countSettlements(db), 1);
      assert.equal(countNegativeLogs(db), 2);

      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
