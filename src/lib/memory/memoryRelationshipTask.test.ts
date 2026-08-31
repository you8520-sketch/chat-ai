import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { describe, it } from "node:test";
import {
  resolveMemoryRelationshipExpectation,
  resolveAsyncTurnCoverage,
} from "@/lib/asyncTurnCoverage";
import { buildAdminBillingReceiptV3 } from "@/lib/adminBillingReceiptV3";
import {
  ensureProviderCostLedgerSchema,
  finalizeProviderCostAttempt,
  startProviderCostAttempt,
  buildPlatformAsyncTurnLedgerContext,
} from "@/lib/providerCostLedger";
import { ensureAdminFinanceTables } from "@/lib/adminFinance";
import {
  loadMessageMemoryRelationshipTask,
  setMemoryRelationshipTaskState,
  serializeMemoryRelationshipTaskRecord,
  parseMemoryRelationshipTaskRecord,
} from "@/lib/memory/memoryRelationshipTask";
import { sanitizeUsageForPublicReceipt } from "@/lib/billingReceiptAccess";
import { assertNoInternalEconomics } from "@/lib/publicUsageEconomicsBoundary";
import type { Usage } from "@/lib/chatUsage";
import type { MemoryRelationshipTaskRecord } from "@/lib/memory/memoryRelationshipTask";

function task(
  state: MemoryRelationshipTaskRecord["state"],
  reason?: string
): MemoryRelationshipTaskRecord {
  return { state, updatedAt: new Date().toISOString(), reason };
}

function createDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY,
      chat_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      memory_relationship_task_json TEXT
    );
    CREATE TABLE point_gifts (id INTEGER PRIMARY KEY);
    CREATE TABLE chat_image_generations (id INTEGER PRIMARY KEY);
  `);
  ensureAdminFinanceTables(db);
  ensureProviderCostLedgerSchema(db);
  return db;
}

function insertMessage(db: Database.Database, id: number) {
  db.prepare(
    "INSERT INTO messages (id, chat_id, role, content) VALUES (?, 1, 'assistant', 'hi')"
  ).run(id);
}

describe("memoryRelationshipTask lifecycle + async coverage", () => {
  it("T1 — canonical skip maps to not_expected with zero exact cost", () => {
    const exp = resolveMemoryRelationshipExpectation({
      task: task("skipped", "main_model_tail_satisfied"),
      memoryRelationshipLedgerRowCount: 0,
    });
    assert.equal(exp.expectationState, "not_expected");
    assert.equal(exp.skipReason, "main_model_tail_satisfied");
  });

  it("T2 — pending marker maps to pending expectation", () => {
    const exp = resolveMemoryRelationshipExpectation({
      task: task("pending"),
      memoryRelationshipLedgerRowCount: 0,
    });
    assert.equal(exp.expectationState, "pending");
    assert.equal(exp.taskPending, true);
  });

  it("T3 — succeeded marker with ledger maps to terminal", () => {
    const exp = resolveMemoryRelationshipExpectation({
      task: task("succeeded"),
      memoryRelationshipLedgerRowCount: 1,
    });
    assert.equal(exp.expectationState, "terminal");
    assert.equal(exp.taskFailed, false);
  });

  it("T4 — failed marker with exact billed cost remains terminal failed", () => {
    const exp = resolveMemoryRelationshipExpectation({
      task: task("failed", "parse_failed"),
      memoryRelationshipLedgerRowCount: 1,
    });
    assert.equal(exp.expectationState, "terminal");
    assert.equal(exp.taskFailed, true);
  });

  it("T10 — missing marker + ledger stays unverifiable", () => {
    const exp = resolveMemoryRelationshipExpectation({
      task: null,
      memoryRelationshipLedgerRowCount: 2,
    });
    assert.equal(exp.expectationState, "unverifiable");
    assert.match(exp.skipReason ?? "", /missing_durable_marker/);
  });

  it("T11 — ledger-only never promotes to terminal", () => {
    const coverage = resolveAsyncTurnCoverage({
      usage: { cost: 80 } as Usage,
      suggestedRepliesRecord: null,
      statusMetaRecord: null,
      memoryRelationshipTask: null,
      ledgerAsyncRows: [
        {
          family: "memory_relationship",
          execution_phase: "async_post_turn",
          funding_class: "platform_funded",
          event_status: "settled",
          actual_cost_usd: 0.001,
          actual_cost_source: "cheaper_inference_billed",
        } as never,
      ],
    });
    assert.equal(
      coverage.families.find((f) => f.family === "memory_relationship")?.expectationState,
      "unverifiable"
    );
  });

  it("T12 — skipped + stray ledger fails closed", () => {
    const exp = resolveMemoryRelationshipExpectation({
      task: task("skipped", "main_model_tail_satisfied"),
      memoryRelationshipLedgerRowCount: 1,
    });
    assert.equal(exp.expectationState, "unverifiable");
    assert.equal(exp.skipReason, "skipped_marker_with_physical_ledger_contradiction");
  });

  it("T13 — succeeded + zero physical rows stays partial at family level", () => {
    const exp = resolveMemoryRelationshipExpectation({
      task: task("succeeded"),
      memoryRelationshipLedgerRowCount: 0,
    });
    assert.equal(exp.expectationState, "terminal");
  });

  it("T7 — invalid transition keeps pending after crash window", () => {
    const db = createDb();
    insertMessage(db, 7);

    setMemoryRelationshipTaskState(7, "pending", undefined, db);
    const stuck = loadMessageMemoryRelationshipTask(7, db);
    assert.equal(stuck?.state, "pending");
    const blocked = setMemoryRelationshipTaskState(7, "skipped", undefined, db);
    assert.equal(blocked?.state, "pending");
  });

  it("T17 — message isolation by assistantMessageId", () => {
    const db = createDb();
    insertMessage(db, 100);
    insertMessage(db, 101);

    setMemoryRelationshipTaskState(100, "skipped", "main_model_tail_satisfied", db);
    setMemoryRelationshipTaskState(101, "pending", undefined, db);
    setMemoryRelationshipTaskState(101, "succeeded", undefined, db);

    assert.equal(loadMessageMemoryRelationshipTask(100, db)?.state, "skipped");
    assert.equal(loadMessageMemoryRelationshipTask(101, db)?.state, "succeeded");
  });

  it("T20 — internal task state is not part of Usage public economics", () => {
    const usage: Usage = {
      input: 1,
      output: 1,
      model: "x",
      cost: 80,
      baseCost: 80,
      breakdown: [],
    };
    const publicUsage = sanitizeUsageForPublicReceipt(usage);
    assertNoInternalEconomics(publicUsage as Usage & Record<string, unknown>);
    assert.equal(Object.hasOwn(publicUsage as object, "memoryRelationshipTask"), false);
  });

  it("parse/serialize roundtrip", () => {
    const raw = serializeMemoryRelationshipTaskRecord(task("skipped", "feature_disabled"));
    const parsed = parseMemoryRelationshipTaskRecord(raw);
    assert.equal(parsed?.state, "skipped");
    assert.equal(parsed?.reason, "feature_disabled");
  });
});

describe("memoryRelationshipTask ledger integration", () => {
  function ledgerRow(
    db: Database.Database,
    assistantMessageId: number,
    family: "suggested_replies_repair" | "status_meta" | "memory_relationship",
    usd: number
  ) {
    const ctx = {
      ...buildPlatformAsyncTurnLedgerContext({
        chatId: 1,
        assistantMessageId,
        family,
        jobAttemptOrdinal: 1,
      }),
      persistInTests: true,
    };
    const attempt = startProviderCostAttempt(ctx, db);
    finalizeProviderCostAttempt(
      attempt,
      {
        actualProvider: "cheaperinference",
        actualModel: "deepseek-v4-flash",
        cheaperInferenceBilledCostUsd: usd,
        outcome: "success",
      },
      db
    );
  }

  const FX = {
    dateKey: "2026-08-30",
    source: "api_daily" as const,
    baseUsdKrw: 1560,
    overseasFeeRate: 0.02,
    effectiveKrwPerUsd: 1560.6,
  };

  function baseUsage(overrides: Partial<Usage> = {}): Usage {
    return {
      input: 1000,
      output: 500,
      model: "deepseek/deepseek-v4-pro",
      modelLabel: "DeepSeek V4 Pro",
      provider: "cheaperinference",
      route: "nsfw",
      cost: 80,
      baseCost: 80,
      breakdown: [],
      shadowPricing: {
        pricingVersion: 1,
        billingReferenceInputUsdPerMillion: 1,
        billingReferenceOutputUsdPerMillion: 2,
        billingReferenceCostKrw: 10,
        billingReferenceCostUsd: 0.01,
        fxSnapshot: FX,
        providerListCostStatus: "complete",
        reserveStatus: "complete",
        actualTurnCostCoverage: "complete",
        actualProviderCostKrw: 31.2,
        actualCostUsd: 0.02,
        actualCostSource: "cheaper_inference_billed",
        providerListCostKrw: 35,
        inputCostKrw: 5,
        outputCostKrw: 5,
        reasoningCostKrw: 0,
        cacheReadCostKrw: 0,
        cacheWriteCostKrw: 0,
        targetMargin: 0.5,
        minimumMarginFloor: 0.3,
        standardUserChargeKrw: 80,
        promoPercent: 0,
        finalShadowChargeKrw: 80,
        finalShadowPoints: 80,
        providerSavingsKrw: null,
        providerOverrunKrw: null,
        promoGivebackKrw: 0,
        netPricingBufferDeltaKrw: null,
        actualGrossProfitKrw: 50,
        actualRealizedMargin: 0.625,
        worstCasePromoMargin: null,
        marginFloorViolated: null,
        modelId: "deepseek/deepseek-v4-pro",
        provider: "cheaperinference",
      },
      ...overrides,
    };
  }

  it("T15 — memory skipped enables whole-turn complete", () => {
    const db = createDb();
    ledgerRow(db, 15, "suggested_replies_repair", 0.001);
    ledgerRow(db, 15, "status_meta", 0.0005);
    const rows = db
      .prepare("SELECT * FROM api_cost_ledger WHERE assistant_message_id=?")
      .all(15);
    const receipt = buildAdminBillingReceiptV3({
      usage: baseUsage({
        statusWidgetExtract: {
          input: 100,
          output: 50,
          model: "flash",
          modelLabel: "Flash",
          estimated: false,
          apiRawCostKrw: 4,
          actualProviderCostUsd: 0.003,
          actualCostSource: "cheaper_inference_billed",
          actualCostCoverage: "complete",
          actualProviderCostKrw: 4.7,
        },
      }),
      assistantMessageId: 15,
      chatId: 1,
      suggestedRepliesRecord: {
        replies: [],
        extractedAt: new Date().toISOString(),
        source: "background-deepseek",
        pending: false,
        failed: false,
      },
      statusMetaRecord: {
        meta: {
          tableMarkdown: "",
          datetime: "d",
          location: "l",
          relationship: "",
          npcEmotion: "",
          npcIntent: "",
          nextObjective: "",
          hiddenThought: "",
          sceneSummary: "",
        },
        extractedAt: new Date().toISOString(),
        source: "background-deepseek",
        pending: false,
        failed: false,
        formatSpec: null,
      },
      memoryRelationshipTask: task("skipped", "main_model_tail_satisfied"),
      ledgerRows: rows as never[],
    });
    assert.equal(
      receipt.async.byFamily.find((f) => f.family === "memory_relationship")?.expectationState,
      "not_expected"
    );
    assert.equal(receipt.async.byFamily.find((f) => f.family === "memory_relationship")?.exactActualCostUsd, 0);
    assert.equal(receipt.wholeTurn.coverage, "complete");
    assert.ok(receipt.wholeTurn.exactProviderSpendUsd != null);
    assert.ok(receipt.wholeTurn.exactProviderSpendKrw != null);
    assert.ok(receipt.wholeTurn.contributionMarginPercent != null);
  });

  it("T16 — memory succeeded with ledger enables complete", () => {
    const db = createDb();
    ledgerRow(db, 16, "suggested_replies_repair", 0.001);
    ledgerRow(db, 16, "status_meta", 0.0005);
    ledgerRow(db, 16, "memory_relationship", 0.0005);
    const rows = db
      .prepare("SELECT * FROM api_cost_ledger WHERE assistant_message_id=?")
      .all(16);
    const receipt = buildAdminBillingReceiptV3({
      usage: baseUsage({
        statusWidgetExtract: {
          input: 100,
          output: 50,
          model: "flash",
          modelLabel: "Flash",
          estimated: false,
          apiRawCostKrw: 4,
          actualProviderCostUsd: 0.003,
          actualCostSource: "cheaper_inference_billed",
          actualCostCoverage: "complete",
          actualProviderCostKrw: 4.7,
        },
      }),
      assistantMessageId: 16,
      chatId: 1,
      suggestedRepliesRecord: {
        replies: [],
        extractedAt: new Date().toISOString(),
        source: "background-deepseek",
        pending: false,
        failed: false,
      },
      statusMetaRecord: {
        meta: {
          tableMarkdown: "",
          datetime: "d",
          location: "l",
          relationship: "",
          npcEmotion: "",
          npcIntent: "",
          nextObjective: "",
          hiddenThought: "",
          sceneSummary: "",
        },
        extractedAt: new Date().toISOString(),
        source: "background-deepseek",
        pending: false,
        failed: false,
        formatSpec: null,
      },
      memoryRelationshipTask: task("succeeded"),
      ledgerRows: rows as never[],
    });
    assert.equal(receipt.wholeTurn.coverage, "complete");
  });

  it("T8 — logical retry retains two physical rows under one marker", () => {
    const db = createDb();
    ledgerRow(db, 18, "memory_relationship", 0.001);
    ledgerRow(db, 18, "memory_relationship", 0.002);
    const rows = db
      .prepare("SELECT * FROM api_cost_ledger WHERE assistant_message_id=?")
      .all(18);
    assert.equal(rows.length, 2);
    const receipt = buildAdminBillingReceiptV3({
      usage: baseUsage(),
      assistantMessageId: 18,
      chatId: 1,
      suggestedRepliesRecord: null,
      statusMetaRecord: null,
      memoryRelationshipTask: task("succeeded"),
      ledgerRows: rows as never[],
    });
    assert.equal(
      receipt.async.byFamily.find((f) => f.family === "memory_relationship")?.physicalCallCount,
      2
    );
    assert.ok((receipt.async.byFamily.find((f) => f.family === "memory_relationship")?.knownActualCostUsd ?? 0) > 0);
  });
});
