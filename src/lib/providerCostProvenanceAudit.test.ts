import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { describe, it } from "node:test";
import { buildAdminBillingReceiptV3 } from "@/lib/adminBillingReceiptV3";
import { buildAdminReceiptTurnSummary } from "@/lib/adminBillingReceiptTurnSummary";
import {
  resolveAdminReceiptPhysicalCallDiagnostic,
  resolveAdminReceiptCostAttribution,
} from "@/lib/adminBillingReceiptProvenance";
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

function settledInput(overrides: Record<string, unknown> = {}) {
  return {
    actualProvider: "cheaperinference",
    actualModel: "gpt-5.6-luna",
    inputTokens: 7712,
    outputTokens: 593,
    cheaperInferenceBilledCostUsd: LUNA_SHARED_USD,
    outcome: "success" as const,
    ...overrides,
  };
}

function ledgerRow(
  db: Database.Database,
  assistantMessageId: number,
  family: "main_generation" | "post_turn_shared_initial" | "memory_relationship" | "suggested_replies_repair",
  phase: "main_generation" | "sync_post_turn" | "async_post_turn",
  usd: number,
  model = "gpt-5.6-luna"
) {
  const ctx =
    phase === "main_generation"
      ? {
          chatId: 707,
          assistantMessageId,
          generationSequence: 0,
          family: "main_generation" as const,
          fundingClass: "user_funded" as const,
          executionPhase: "main_generation" as const,
          jobAttemptOrdinal: 1,
          requestedProvider: "cheaperinference",
          requestedModel: "openai/gpt-5.6-terra",
          requestKind: "main-generation",
          persistInTests: true,
        }
      : phase === "sync_post_turn"
        ? {
            ...buildPlatformSyncTurnLedgerContext({
              chatId: 707,
              assistantMessageId,
              family: "post_turn_shared_initial",
              requestedModel: model,
              requestKind: "background-post-turn-shared-initial",
            }),
            persistInTests: true,
          }
        : {
            ...buildPlatformAsyncTurnLedgerContext({
              chatId: 707,
              assistantMessageId,
              generationSequence: 0,
              family,
              jobAttemptOrdinal: 1,
            }),
            persistInTests: true,
          };
  const attempt = startProviderCostAttempt(ctx, db);
  finalizeProviderCostAttempt(
    attempt,
    settledInput({
      actualModel: phase === "main_generation" ? "openai/gpt-5.6-terra" : model,
      cheaperInferenceBilledCostUsd: usd,
      inputTokens: phase === "main_generation" ? 28649 : 7712,
      outputTokens: phase === "main_generation" ? 1965 : 593,
    }),
    db
  );
  return attempt;
}

describe("provider cost provenance audit — regression A–F", () => {
  it("A — Terra main + exactly one sync Shared Initial Luna: margin available", () => {
    const db = createLedgerDb();
    ledgerRow(db, 4022, "main_generation", "main_generation", TERRA_MAIN_USD);
    ledgerRow(db, 4022, "post_turn_shared_initial", "sync_post_turn", LUNA_SHARED_USD);
    const rows = db.prepare("SELECT * FROM api_cost_ledger WHERE assistant_message_id=?").all(4022);

    const receipt = buildAdminBillingReceiptV3({
      usage: terraUsage(),
      assistantMessageId: 4022,
      chatId: 707,
      suggestedRepliesRecord: validSuggestedRecord(),
      statusMetaRecord: disabledStatusMetaRecord(),
      memoryRelationshipTask: memoryTask("skipped", "shared_initial_satisfied"),
      ledgerRows: rows as never[],
    });

    assert.equal(receipt.wholeTurn.mainExact, true);
    assert.equal(receipt.wholeTurn.syncExact, true);
    assert.equal(receipt.async.coverage, "complete");
    assert.equal(receipt.wholeTurn.coverage, "complete");
    assert.equal(receipt.async.physicalCallCount, 0);
    assert.ok(Math.abs((receipt.wholeTurn.exactProviderSpendUsd ?? 0) - (TERRA_MAIN_USD + LUNA_SHARED_USD)) < 1e-9);
    const summary = buildAdminReceiptTurnSummary(receipt);
    assert.notEqual(summary.marginPercent, null);
    assert.equal(summary.marginUnavailableReason, null);
  });

  it("A′ — sync shared initial ledger satisfies async when usage flag missing", () => {
    const db = createLedgerDb();
    ledgerRow(db, 4022, "main_generation", "main_generation", TERRA_MAIN_USD);
    ledgerRow(db, 4022, "post_turn_shared_initial", "sync_post_turn", LUNA_SHARED_USD);
    const rows = db.prepare("SELECT * FROM api_cost_ledger WHERE assistant_message_id=?").all(4022);
    const usage = terraUsage({
      statusWidgetExtract: {
        ...terraUsage().statusWidgetExtract!,
        postTurnSharedInitial: undefined,
      },
    });

    const receipt = buildAdminBillingReceiptV3({
      usage,
      assistantMessageId: 4022,
      chatId: 707,
      suggestedRepliesRecord: validSuggestedRecord(),
      statusMetaRecord: disabledStatusMetaRecord(),
      memoryRelationshipTask: memoryTask("succeeded"),
      ledgerRows: rows as never[],
    });

    const memoryFamily = receipt.async.byFamily.find((f) => f.family === "memory_relationship");
    assert.equal(memoryFamily?.expectationState, "not_expected");
    assert.equal(receipt.async.coverage, "complete");
    assert.equal(receipt.wholeTurn.coverage, "complete");
  });

  it("B — Terra + Shared Luna + turn-causal async Luna: provenance on every call, exact sum", () => {
    const db = createLedgerDb();
    ledgerRow(db, 4022, "main_generation", "main_generation", TERRA_MAIN_USD);
    ledgerRow(db, 4022, "post_turn_shared_initial", "sync_post_turn", LUNA_SHARED_USD);
    ledgerRow(db, 4022, "memory_relationship", "async_post_turn", 0.0017);
    const rows = db.prepare("SELECT * FROM api_cost_ledger WHERE assistant_message_id=?").all(4022);

    const receipt = buildAdminBillingReceiptV3({
      usage: terraUsage(),
      assistantMessageId: 4022,
      chatId: 707,
      suggestedRepliesRecord: validSuggestedRecord(),
      statusMetaRecord: disabledStatusMetaRecord(),
      memoryRelationshipTask: memoryTask("succeeded"),
      ledgerRows: rows as never[],
    });

    assert.equal(receipt.async.physicalCallCount, 1);
    assert.ok(receipt.async.events?.every((ev) => ev.canonicalOwner != null));
    assert.ok(Math.abs((receipt.wholeTurn.exactProviderSpendUsd ?? 0) - (TERRA_MAIN_USD + LUNA_SHARED_USD + 0.0017)) < 1e-9);
  });

  it("C — derived cache Luna: assistant_message_id null, global attribution", () => {
    const db = createLedgerDb();
    const requestId = `dc-${randomUUID()}`;
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
      .prepare("SELECT * FROM api_cost_ledger WHERE provider_request_id=?")
      .get(requestId) as never;
    const diagnostic = resolveAdminReceiptPhysicalCallDiagnostic(row);
    assert.equal((row as { assistant_message_id: number | null }).assistant_message_id, null);
    assert.equal(diagnostic.costAttribution, "global_background");
    assert.equal(diagnostic.canonicalOwner, "OTHER_ASYNC");
    assert.equal(
      resolveAdminReceiptCostAttribution(row as never),
      "global_background"
    );
  });

  it("D — failed derived cache retry: retry ordinal increments, no double-write", () => {
    const db = createLedgerDb();
    const requestId = `dc-retry-${randomUUID()}`;
    const first = recordBackgroundProviderCost(
      {
        provider: "cheaperinference",
        model: "gpt-5.6-luna",
        requestKind: "background-prompt-translation",
        costCenter: "asset",
        inputTokens: 100,
        outputTokens: 10,
        cheaperInferenceBilledCostUsd: 0.0001,
        providerRequestId: requestId,
        persistInTests: true,
      },
      db
    );
    const second = recordBackgroundProviderCost(
      {
        provider: "cheaperinference",
        model: "gpt-5.6-luna",
        requestKind: "background-prompt-translation",
        costCenter: "asset",
        inputTokens: 100,
        outputTokens: 10,
        cheaperInferenceBilledCostUsd: 0.0001,
        providerRequestId: requestId,
        persistInTests: true,
      },
      db
    );
    assert.equal(first.recorded, true);
    assert.equal(second.recorded, false);
    const count = db
      .prepare("SELECT COUNT(*) AS c FROM api_cost_ledger WHERE provider_request_id=?")
      .get(requestId) as { c: number };
    assert.equal(count.c, 1);
  });

  it("E — unknown terminal async state keeps margin fail-closed", () => {
    const receipt = buildAdminBillingReceiptV3({
      usage: terraUsage({ statusWidgetExtract: undefined }),
      assistantMessageId: 4022,
      chatId: 707,
      suggestedRepliesRecord: null,
      statusMetaRecord: null,
      memoryRelationshipTask: null,
      ledgerRows: [],
    });
    const summary = buildAdminReceiptTurnSummary(receipt);
    assert.equal(summary.marginPercent, null);
    assert.match(summary.marginUnavailableReason ?? "", /Async 비용 검증 불가/);
  });

  it("F — explicit no-provider terminal state does not fabricate partial known total", () => {
    const receipt = buildAdminBillingReceiptV3({
      usage: terraUsage({ statusWidgetExtract: undefined }),
      assistantMessageId: 4022,
      chatId: 707,
      suggestedRepliesRecord: {
        replies: [],
        extractedAt: new Date().toISOString(),
        source: "background-deepseek",
        pending: false,
        failed: true,
        terminalReason: "original_turn_ineligible",
      },
      statusMetaRecord: disabledStatusMetaRecord(),
      memoryRelationshipTask: memoryTask("skipped", "feature_disabled"),
      ledgerRows: [],
    });
    assert.equal(receipt.async.coverage, "complete");
    assert.equal(receipt.async.exactActualCostUsd, 0);
    assert.notEqual(receipt.wholeTurn.coverage, "complete");
    const summary = buildAdminReceiptTurnSummary(receipt);
    assert.equal(summary.marginPercent, null);
  });
});
