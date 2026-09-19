import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { describe, it } from "node:test";
import { buildAdminBillingReceiptV3 } from "@/lib/adminBillingReceiptV3";
import { buildAdminReceiptCompactViewModel } from "@/lib/adminBillingReceiptV3Shared";
import { buildAdminReceiptTurnSummary } from "@/lib/adminBillingReceiptTurnSummary";
import { resolveAdminReceiptPhysicalCallDiagnostic } from "@/lib/adminBillingReceiptProvenance";
import {
  resolveMemoryRelationshipExpectation,
  resolveAsyncTurnCoverage,
} from "@/lib/asyncTurnCoverage";
import { filterLedgerRowsForGenerationScope } from "@/lib/assistantGenerationScope";
import { ensureAdminFinanceTables } from "@/lib/adminFinance";
import {
  buildPlatformAsyncTurnLedgerContext,
  buildPlatformSyncTurnLedgerContext,
  ensureProviderCostLedgerSchema,
  finalizeProviderCostAttempt,
  recordBackgroundProviderCost,
  startProviderCostAttempt,
} from "@/lib/providerCostLedger";
import type { Usage } from "@/lib/chatUsage";
import type { MemoryRelationshipTaskRecord } from "@/lib/memory/memoryRelationshipTask";

const FX = {
  dateKey: "2026-09-17",
  source: "api_daily" as const,
  baseUsdKrw: 1560,
  overseasFeeRate: 0.02,
  effectiveKrwPerUsd: 1560.6,
};

const TERRA_MAIN_USD = 0.038081;
const LUNA_SHARED_USD = 0.001056;

function memoryTask(
  state: MemoryRelationshipTaskRecord["state"],
  reason?: string
): MemoryRelationshipTaskRecord {
  return { state, updatedAt: new Date().toISOString(), reason };
}

function padReply(seed: string, length = 72): string {
  return `${seed}${"가".repeat(Math.max(0, length - seed.length))}`.slice(0, length);
}

function validSuggestedRecord() {
  return {
    replies: [
      { kind: "escalate" as const, text: padReply("*소매를 잡으며* \"그걸 지금 말이라고 해?\" ") },
      { kind: "soften" as const, text: padReply("*숨을 고르며* \"일단 여기 앉아서 천천히 얘기하자.\" ") },
      { kind: "pivot" as const, text: padReply("*창밖을 가리키며* \"저기 새로 생긴 카페, 같이 가볼래?\" ") },
    ],
    extractedAt: new Date().toISOString(),
    source: "background-deepseek",
    pending: false,
    failed: false,
  };
}

function disabledStatusMetaRecord() {
  return {
    meta: {
      tableMarkdown: "",
      datetime: "",
      location: "",
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
    terminalReason: "extraction_disabled" as const,
  };
}

function terraUsage(overrides: Partial<Usage> = {}): Usage {
  return {
    input: 28_649,
    output: 1_965,
    model: "openai/gpt-5.6-terra",
    modelLabel: "GPT-5.6 Terra",
    provider: "cheaperinference",
    route: "nsfw",
    cost: 108,
    baseCost: 108,
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
      actualProviderCostKrw: Math.round(TERRA_MAIN_USD * FX.effectiveKrwPerUsd * 10) / 10,
      actualCostUsd: TERRA_MAIN_USD,
      actualCostSource: "cheaper_inference_billed",
      providerListCostKrw: 35,
      inputCostKrw: 5,
      outputCostKrw: 5,
      reasoningCostKrw: 0,
      cacheReadCostKrw: 0,
      cacheWriteCostKrw: 0,
      targetMargin: 0.5,
      minimumMarginFloor: 0.3,
      standardUserChargeKrw: 108,
      promoPercent: 0,
      finalShadowChargeKrw: 108,
      finalShadowPoints: 108,
      providerSavingsKrw: null,
      providerOverrunKrw: null,
      promoGivebackKrw: 0,
      netPricingBufferDeltaKrw: null,
      actualGrossProfitKrw: 50,
      actualRealizedMargin: 0.625,
      worstCasePromoMargin: null,
      marginFloorViolated: null,
      modelId: "openai/gpt-5.6-terra",
      provider: "cheaperinference",
    },
    statusWidgetExtract: {
      input: 7_712,
      output: 593,
      model: "gpt-5.6-luna",
      modelLabel: "GPT-5.6 Luna (공유 초기)",
      estimated: false,
      apiRawCostKrw: 2,
      callCount: 1,
      postTurnSharedInitial: true,
      actualProviderCostUsd: LUNA_SHARED_USD,
      actualCostSource: "cheaper_inference_billed",
      actualCostCoverage: "complete",
      actualProviderCostKrw: Math.round(LUNA_SHARED_USD * FX.effectiveKrwPerUsd * 10) / 10,
    },
    ...overrides,
  };
}

function createLedgerDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE IF NOT EXISTS point_gifts (id INTEGER PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS chat_image_generations (id INTEGER PRIMARY KEY);
  `);
  ensureAdminFinanceTables(db);
  ensureProviderCostLedgerSchema(db);
  return db;
}

function ledgerRow(
  db: Database.Database,
  assistantMessageId: number,
  family: "main_generation" | "post_turn_shared_initial" | "memory_relationship" | "suggested_replies_repair",
  phase: "main_generation" | "sync_post_turn" | "async_post_turn",
  usd: number,
  opts?: { generationSequence?: number; model?: string; providerRequestId?: string }
) {
  const generationSequence = opts?.generationSequence ?? 0;
  const model = opts?.model ?? "gpt-5.6-luna";
  const ctx =
    phase === "main_generation"
      ? {
          chatId: 707,
          assistantMessageId,
          generationSequence,
          family: "main_generation" as const,
          fundingClass: "user_funded" as const,
          executionPhase: "main_generation" as const,
          jobAttemptOrdinal: 1,
          requestedProvider: "cheaperinference",
          requestedModel: "openai/gpt-5.6-terra",
          requestKind: "main-generation",
          providerRequestId: opts?.providerRequestId ?? null,
          persistInTests: true,
        }
      : phase === "sync_post_turn"
        ? {
            ...buildPlatformSyncTurnLedgerContext({
              chatId: 707,
              assistantMessageId,
              generationSequence,
              family: "post_turn_shared_initial",
              requestedModel: model,
              requestKind: "background-post-turn-shared-initial",
            }),
            providerRequestId: opts?.providerRequestId ?? null,
            persistInTests: true,
          }
        : {
            ...buildPlatformAsyncTurnLedgerContext({
              chatId: 707,
              assistantMessageId,
              generationSequence,
              family,
              jobAttemptOrdinal: 1,
            }),
            providerRequestId: opts?.providerRequestId ?? null,
            persistInTests: true,
          };
  const attempt = startProviderCostAttempt(ctx, db);
  finalizeProviderCostAttempt(
    attempt,
    {
      actualProvider: "cheaperinference",
      actualModel: phase === "main_generation" ? "openai/gpt-5.6-terra" : model,
      inputTokens: phase === "main_generation" ? 28_649 : 7_712,
      outputTokens: phase === "main_generation" ? 1_965 : 593,
      cheaperInferenceBilledCostUsd: usd,
      providerRequestId: opts?.providerRequestId ?? null,
      outcome: "success",
    },
    db
  );
  return attempt;
}

function build4022Receipt(input: {
  memoryRelationshipTask: MemoryRelationshipTaskRecord | null;
  suggestedPending?: boolean;
  ledgerRows: unknown[];
}) {
  return buildAdminBillingReceiptV3({
    usage: terraUsage(),
    assistantMessageId: 4022,
    chatId: 707,
    suggestedRepliesRecord: input.suggestedPending
      ? {
          replies: [],
          extractedAt: new Date().toISOString(),
          source: "background-deepseek",
          pending: true,
          failed: false,
        }
      : validSuggestedRecord(),
    statusMetaRecord: disabledStatusMetaRecord(),
    memoryRelationshipTask: input.memoryRelationshipTask,
    ledgerRows: input.ledgerRows as never[],
  });
}

describe("provider cost correction — production fixture A", () => {
  it("A — canonical shared-success durable state completes whole turn", () => {
    const db = createLedgerDb();
    ledgerRow(db, 4022, "main_generation", "main_generation", TERRA_MAIN_USD);
    ledgerRow(db, 4022, "post_turn_shared_initial", "sync_post_turn", LUNA_SHARED_USD, {
      providerRequestId: "cr_mu8fq9k4_6mmh8aww-aux-1",
    });
    const rows = db.prepare("SELECT * FROM api_cost_ledger WHERE assistant_message_id=?").all(4022);

    const receipt = build4022Receipt({
      memoryRelationshipTask: memoryTask("skipped", "shared_initial_satisfied"),
      ledgerRows: rows,
    });

    assert.equal(receipt.wholeTurn.mainExact, true);
    assert.equal(receipt.wholeTurn.syncExact, true);
    assert.equal(receipt.async.coverage, "complete");
    assert.equal(receipt.wholeTurn.coverage, "complete");
    assert.ok(Math.abs((receipt.wholeTurn.exactProviderSpendUsd ?? 0) - (TERRA_MAIN_USD + LUNA_SHARED_USD)) < 1e-9);
    const summary = buildAdminReceiptTurnSummary(receipt);
    assert.notEqual(summary.marginPercent, null);
    assert.equal(summary.marginUnavailableReason, null);
  });
});

describe("provider cost correction — receipt lifecycle B", () => {
  it("B — pending durable tasks yield partial; terminal skipped state yields complete", () => {
    const db = createLedgerDb();
    ledgerRow(db, 4022, "main_generation", "main_generation", TERRA_MAIN_USD);
    ledgerRow(db, 4022, "post_turn_shared_initial", "sync_post_turn", LUNA_SHARED_USD);
    const rows = db.prepare("SELECT * FROM api_cost_ledger WHERE assistant_message_id=?").all(4022);

    const t1 = build4022Receipt({
      memoryRelationshipTask: memoryTask("pending"),
      suggestedPending: true,
      ledgerRows: rows,
    });
    assert.equal(t1.async.coverage, "pending");
    assert.equal(t1.wholeTurn.coverage, "pending");
    assert.equal(buildAdminReceiptTurnSummary(t1).marginPercent, null);

    const t2 = build4022Receipt({
      memoryRelationshipTask: memoryTask("skipped", "shared_initial_satisfied"),
      ledgerRows: rows,
    });
    assert.equal(t2.async.coverage, "complete");
    assert.equal(t2.wholeTurn.coverage, "complete");
    assert.notEqual(buildAdminReceiptTurnSummary(t2).marginPercent, null);
  });
});

describe("provider cost correction — generation scope C/D", () => {
  it("C — matching generation sync shared row is included in scoped receipt", () => {
    const db = createLedgerDb();
    ledgerRow(db, 4022, "main_generation", "main_generation", TERRA_MAIN_USD, {
      generationSequence: 1,
    });
    ledgerRow(db, 4022, "post_turn_shared_initial", "sync_post_turn", LUNA_SHARED_USD, {
      generationSequence: 1,
      providerRequestId: "req-gen-1-shared",
    });
    const allRows = db.prepare("SELECT * FROM api_cost_ledger WHERE assistant_message_id=?").all(4022);
    const { scopedRows } = filterLedgerRowsForGenerationScope(allRows as never[], {
      assistantMessageId: 4022,
      generationSequence: 1,
      generationRequestId: "cr_mu8fq9k4_6mmh8aww",
    });
    assert.equal(scopedRows.length, 2);
    const receipt = build4022Receipt({
      memoryRelationshipTask: memoryTask("skipped", "shared_initial_satisfied"),
      ledgerRows: scopedRows,
    });
    assert.ok((receipt.syncPhysicalEvents?.length ?? 0) >= 1);
    assert.equal(receipt.syncPhysicalEvents?.[0]?.providerRequestId, "req-gen-1-shared");
  });

  it("D — stale generation shared row must not satisfy current generation", () => {
    const db = createLedgerDb();
    ledgerRow(db, 4022, "main_generation", "main_generation", TERRA_MAIN_USD, {
      generationSequence: 1,
    });
    ledgerRow(db, 4022, "post_turn_shared_initial", "sync_post_turn", LUNA_SHARED_USD, {
      generationSequence: 0,
    });
    const allRows = db.prepare("SELECT * FROM api_cost_ledger WHERE assistant_message_id=?").all(4022);
    const { scopedRows, hasOtherGenerationRows } = filterLedgerRowsForGenerationScope(
      allRows as never[],
      { assistantMessageId: 4022, generationSequence: 1, generationRequestId: "req-gen-1" }
    );
    assert.equal(hasOtherGenerationRows, true);
    assert.equal(scopedRows.length, 1);
    assert.equal(scopedRows[0]?.family, "main_generation");
  });
});

describe("provider cost correction — relationship invariants R1–R5", () => {
  it("R1 — shared success => skipped/shared_initial_satisfied + zero standalone rows", () => {
    const result = resolveMemoryRelationshipExpectation({
      task: memoryTask("skipped", "shared_initial_satisfied"),
      memoryRelationshipLedgerRowCount: 0,
    });
    assert.equal(result.expectationState, "not_expected");
    assert.equal(result.skipReason, "shared_initial_satisfied");
  });

  it("R2 — shared invalid => skipped/shared_section_invalid_no_retry + zero standalone rows", () => {
    const result = resolveMemoryRelationshipExpectation({
      task: memoryTask("skipped", "shared_section_invalid_no_retry"),
      memoryRelationshipLedgerRowCount: 0,
    });
    assert.equal(result.expectationState, "not_expected");
    assert.equal(result.skipReason, "shared_section_invalid_no_retry");
  });

  it("R3 — standalone extraction => succeeded + >=1 physical row is terminal", () => {
    const result = resolveMemoryRelationshipExpectation({
      task: memoryTask("succeeded"),
      memoryRelationshipLedgerRowCount: 1,
    });
    assert.equal(result.expectationState, "terminal");
    assert.equal(result.taskFailed, false);
  });

  it("R4 — succeeded + zero rows without shared semantic proof => fail-closed unverifiable", () => {
    const result = resolveMemoryRelationshipExpectation({
      task: memoryTask("succeeded"),
      memoryRelationshipLedgerRowCount: 0,
    });
    assert.equal(result.expectationState, "unverifiable");
    assert.equal(result.skipReason, "succeeded_marker_without_physical_ledger_evidence");
  });

  it("R5 — shared physical row alone does not satisfy relationship expectation", () => {
    const coverage = resolveAsyncTurnCoverage({
      usage: terraUsage({ statusWidgetExtract: undefined }),
      suggestedRepliesRecord: null,
      statusMetaRecord: null,
      memoryRelationshipTask: null,
      ledgerAsyncRows: [],
      scopedLedgerRows: [
        {
          family: "post_turn_shared_initial",
          execution_phase: "sync_post_turn",
          event_status: "settled",
          actual_cost_usd: LUNA_SHARED_USD,
        } as never,
      ],
    });
    const rel = coverage.families.find((f) => f.family === "memory_relationship");
    assert.equal(rel?.expectationState, "unverifiable");
  });
});

describe("provider cost correction — receipt tests E–G", () => {
  it("E — standalone relationship call is counted in async physical totals", () => {
    const db = createLedgerDb();
    ledgerRow(db, 4022, "main_generation", "main_generation", TERRA_MAIN_USD);
    ledgerRow(db, 4022, "post_turn_shared_initial", "sync_post_turn", LUNA_SHARED_USD);
    ledgerRow(db, 4022, "memory_relationship", "async_post_turn", 0.0017);
    const rows = db.prepare("SELECT * FROM api_cost_ledger WHERE assistant_message_id=?").all(4022);
    const receipt = build4022Receipt({
      memoryRelationshipTask: memoryTask("succeeded"),
      ledgerRows: rows,
    });
    assert.equal(receipt.async.physicalCallCount, 1);
    assert.ok(Math.abs(receipt.async.knownActualCostUsd - 0.0017) < 1e-9);
  });

  it("F — failed_without_usage async row keeps async coverage fail-closed", () => {
    const db = createLedgerDb();
    ledgerRow(db, 4022, "main_generation", "main_generation", TERRA_MAIN_USD);
    const ctx = {
      ...buildPlatformAsyncTurnLedgerContext({
        chatId: 707,
        assistantMessageId: 4022,
        generationSequence: 0,
        family: "memory_relationship",
        jobAttemptOrdinal: 1,
      }),
      persistInTests: true,
    };
    const attempt = startProviderCostAttempt(ctx, db);
    finalizeProviderCostAttempt(
      attempt,
      {
        actualProvider: "cheaperinference",
        actualModel: "gpt-5.6-luna",
        outcome: "failed_without_usage",
      },
      db
    );
    const rows = db.prepare("SELECT * FROM api_cost_ledger WHERE assistant_message_id=?").all(4022);
    const receipt = build4022Receipt({
      memoryRelationshipTask: memoryTask("failed"),
      ledgerRows: rows,
    });
    assert.notEqual(receipt.async.coverage, "complete");
    assert.equal(buildAdminReceiptTurnSummary(receipt).marginPercent, null);
  });

  it("G — sync auxiliary provenance comes from ledger row, not hardcoded display", () => {
    const db = createLedgerDb();
    ledgerRow(db, 4022, "main_generation", "main_generation", TERRA_MAIN_USD);
    ledgerRow(db, 4022, "post_turn_shared_initial", "sync_post_turn", LUNA_SHARED_USD, {
      providerRequestId: "ledger-prov-req-99",
    });
    const rows = db.prepare("SELECT * FROM api_cost_ledger WHERE assistant_message_id=?").all(4022);
    const receipt = build4022Receipt({
      memoryRelationshipTask: memoryTask("skipped", "shared_initial_satisfied"),
      ledgerRows: rows,
    });
    const vm = buildAdminReceiptCompactViewModel(receipt);
    const syncAux = vm.auxiliaryCalls.find((c) => c.label.includes("공유 초기"));
    assert.ok(syncAux);
    assert.equal(syncAux.providerRequestId, "ledger-prov-req-99");
    assert.equal(syncAux.canonicalOwner, "STATUS_WIDGET");
    assert.equal(syncAux.trigger, "sync_post_turn");
    assert.equal(syncAux.requestKind, "background-post-turn-shared-initial");

    const row = rows.find((r) => r.family === "post_turn_shared_initial") as never;
    const diagnostic = resolveAdminReceiptPhysicalCallDiagnostic(row);
    assert.equal(syncAux.canonicalOwner, diagnostic.canonicalOwner);
    assert.equal(syncAux.requestKind, diagnostic.requestKind);
  });
});

describe("provider cost correction — unknown Luna status", () => {
  it("records background ledger without chat linkage — identity remains unconfirmed", () => {
    const db = createLedgerDb();
    const requestId = `bg-${randomUUID()}`;
    recordBackgroundProviderCost(
      {
        provider: "cheaperinference",
        model: "gpt-5.6-luna",
        requestKind: "background-prompt-translation",
        costCenter: "asset",
        inputTokens: 8553,
        outputTokens: 1655,
        cheaperInferenceBilledCostUsd: 0.0017,
        providerRequestId: requestId,
        persistInTests: true,
      },
      db
    );
    const row = db
      .prepare("SELECT assistant_message_id, request_kind FROM api_cost_ledger WHERE provider_request_id=?")
      .get(requestId) as { assistant_message_id: number | null; request_kind: string };
    assert.equal(row.assistant_message_id, null);
    assert.equal(row.request_kind, "background-prompt-translation");
  });
});
