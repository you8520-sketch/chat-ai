import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveStatusMetaExpectation,
  resolveAsyncTurnCoverage,
} from "@/lib/asyncTurnCoverage";
import { resolveStatusMetaExtractionEnabled } from "@/lib/statusMeta/displayPolicy";
import { resolveStatusWindowPolicyFromSources } from "@/lib/statusWindowNotePolicy";
import type { StatusMetaRecord } from "@/lib/statusMeta/types";
import type { Usage } from "@/lib/chatUsage";
import { buildAdminBillingReceiptV3 } from "@/lib/adminBillingReceiptV3";
import { buildAdminReceiptTurnSummary } from "@/lib/adminBillingReceiptTurnSummary";
import type { ProviderCostLedgerRow } from "@/lib/providerCostLedger";
import type { MemoryRelationshipTaskRecord } from "@/lib/memory/memoryRelationshipTask";

function disabledRecord(
  overrides: Partial<StatusMetaRecord> = {}
): StatusMetaRecord {
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
    terminalReason: "extraction_disabled",
    generationSequence: 1,
    generationRequestId: "req-test",
    ...overrides,
  };
}

function terminalMetaRecord(): StatusMetaRecord {
  return {
    meta: {
      tableMarkdown: "|a|b|\n|-|-|\n|1|2|",
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
    generationSequence: 1,
    generationRequestId: "req-test",
  };
}

describe("Status Meta async expectation — regression S1–S8", () => {
  it("S1 — extraction disabled durable marker: not_expected, no margin blocker", () => {
    const result = resolveStatusMetaExpectation({
      record: disabledRecord(),
      statusMetaLedgerRowCount: 0,
    });
    assert.equal(result.expectationState, "not_expected");
    assert.equal(result.skipReason, "status_meta_extraction_disabled");
  });

  it("S2 — expected=true but record absent: unverifiable", () => {
    const result = resolveStatusMetaExpectation({
      record: null,
      statusMetaLedgerRowCount: 0,
    });
    assert.equal(result.expectationState, "unverifiable");
    assert.equal(result.skipReason, "missing_status_meta_record");
  });

  it("S3 — expected=true, pending record: pending", () => {
    const result = resolveStatusMetaExpectation({
      record: {
        ...terminalMetaRecord(),
        meta: { ...terminalMetaRecord().meta, tableMarkdown: "" },
        pending: true,
      },
      statusMetaLedgerRowCount: 0,
    });
    assert.equal(result.expectationState, "pending");
    assert.equal(result.taskPending, true);
  });

  it("S4 — expected=true, terminal record + exact ledger: terminal family with settled cost", () => {
    const statusMeta = resolveStatusMetaExpectation({
      record: terminalMetaRecord(),
      statusMetaLedgerRowCount: 1,
    });
    assert.equal(statusMeta.expectationState, "terminal");
    assert.equal(statusMeta.taskFailed, false);
  });

  it("S5 — extraction disabled but physical status_meta ledger row: unverifiable contradiction", () => {
    const result = resolveStatusMetaExpectation({
      record: disabledRecord(),
      statusMetaLedgerRowCount: 1,
    });
    assert.equal(result.expectationState, "unverifiable");
    assert.equal(result.skipReason, "extraction_disabled_with_physical_ledger_contradiction");
  });

  it("S6 — legacy turn with no durable expectation evidence: unverifiable", () => {
    const result = resolveStatusMetaExpectation({
      record: null,
      statusMetaLedgerRowCount: 0,
    });
    assert.equal(result.expectationState, "unverifiable");
  });

  it("S7 — regen generation scope: disabled marker scoped to generation 1 only", () => {
    const gen0 = disabledRecord({ generationSequence: 0, generationRequestId: "req-0" });
    const gen1 = disabledRecord({ generationSequence: 1, generationRequestId: "req-1" });
    assert.notEqual(gen0.generationSequence, gen1.generationSequence);
    assert.equal(
      resolveStatusMetaExpectation({ record: gen1, statusMetaLedgerRowCount: 0 })
        .expectationState,
      "not_expected"
    );
  });

  it("S8 — Shared Initial physical evidence alone does not auto-satisfy Status Meta", () => {
    const coverage = resolveAsyncTurnCoverage({
      usage: {
        statusWidgetExtract: { postTurnSharedInitial: true } as Usage["statusWidgetExtract"],
      } as Usage,
      suggestedRepliesRecord: null,
      statusMetaRecord: null,
      memoryRelationshipTask: null,
      ledgerAsyncRows: [
        {
          family: "post_turn_shared_initial",
          event_status: "settled",
          actual_cost_usd: 0.001,
        } as ProviderCostLedgerRow,
      ],
    });
    const statusMeta = coverage.families.find((f) => f.family === "status_meta");
    assert.equal(statusMeta?.expectationState, "unverifiable");
    assert.equal(statusMeta?.skipReason, "missing_status_meta_record");
  });
});

describe("Status Meta policy reproduction — production-equivalent widget ON", () => {
  it("status widget active forces everyTurn false and disables Status Meta extraction", () => {
    const policy = resolveStatusWindowPolicyFromSources({
      userNote: "다음상태창을 본문하단에 출력해라\n💡 NPC의 속마음 한 줄",
      statusWidgetActive: true,
    });
    assert.equal(policy.everyTurn, false);

    const enabled = resolveStatusMetaExtractionEnabled({
      htmlReplacesMarkdownStatus: false,
      htmlVisualCardStanding: false,
      htmlVisualCardEnabled: false,
      chatOocRpUnrelated: false,
      statusWindowEveryTurn: policy.everyTurn,
      userMessage: "hello",
    });
    assert.equal(enabled, false);
  });

  it("production-equivalent receipt: disabled marker clears Status Meta margin blocker", () => {
    const FX = {
      dateKey: "2026-09-17",
      source: "api_daily" as const,
      baseUsdKrw: 1560,
      overseasFeeRate: 0.02,
      effectiveKrwPerUsd: 1560.6,
    };
    const MAIN_USD = 0.018729;
    const LUNA_USD = 0.000942;
    const usage: Usage = {
      input: 31_385,
      output: 3_051,
      model: "deepseek/deepseek-v4-pro",
      modelLabel: "DeepSeek V4 Pro",
      provider: "cheaperinference",
      route: "nsfw",
      cost: 77,
      baseCost: 77,
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
        actualProviderCostKrw: Math.round(MAIN_USD * FX.effectiveKrwPerUsd * 10) / 10,
        actualCostUsd: MAIN_USD,
        actualCostSource: "cheaper_inference_usage_api",
        providerListCostKrw: 35,
        inputCostKrw: 5,
        outputCostKrw: 5,
        reasoningCostKrw: 0,
        cacheReadCostKrw: 0,
        cacheWriteCostKrw: 0,
        targetMargin: 0.65,
        minimumMarginFloor: 0.3,
        standardUserChargeKrw: 77,
        promoPercent: 0,
        finalShadowChargeKrw: 77,
        finalShadowPoints: 77,
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
      statusWidgetExtract: {
        input: 400,
        output: 120,
        model: "gpt-5.6-luna",
        modelLabel: "GPT-5.6 Luna (공유 초기: 상태창 + 추천입력)",
        estimated: false,
        apiRawCostKrw: 1,
        callCount: 1,
        postTurnSharedInitial: true,
        actualProviderCostUsd: LUNA_USD,
        actualCostSource: "cheaper_inference_billed",
        actualCostCoverage: "complete",
        actualProviderCostKrw: Math.round(LUNA_USD * FX.effectiveKrwPerUsd * 10) / 10,
      },
    };
    const mainRow = {
      event_key: "main-gen",
      event_status: "settled",
      family: "main_generation",
      funding_class: "user_funded",
      execution_phase: "main_generation",
      actual_cost_usd: MAIN_USD,
      actual_cost_source: "cheaper_inference_usage_api",
      exact: true,
      incomplete: false,
      generation_sequence: 1,
    } as unknown as ProviderCostLedgerRow;

    const memoryTask = (
      state: MemoryRelationshipTaskRecord["state"],
      reason?: string
    ): MemoryRelationshipTaskRecord => ({
      state,
      updatedAt: new Date().toISOString(),
      reason,
    });

    const receipt = buildAdminBillingReceiptV3({
      usage,
      assistantMessageId: 4016,
      chatId: 1,
      suggestedRepliesRecord: {
        replies: [
          { kind: "escalate", text: "a".repeat(72) },
          { kind: "soften", text: "b".repeat(72) },
          { kind: "pivot", text: "c".repeat(72) },
        ],
        extractedAt: new Date().toISOString(),
        source: "background-deepseek",
        pending: false,
        failed: false,
      },
      statusMetaRecord: disabledRecord(),
      memoryRelationshipTask: memoryTask("skipped", "shared_initial_satisfied"),
      ledgerRows: [mainRow],
    });

    const statusMetaFamily = receipt.async.byFamily.find((f) => f.family === "status_meta");
    assert.equal(statusMetaFamily?.expectationState, "not_expected");
    const summary = buildAdminReceiptTurnSummary(receipt);
    assert.doesNotMatch(summary.marginUnavailableReason ?? "", /Status Meta/);
    assert.ok(Math.abs(receipt.wholeTurn.knownProviderSpendUsd - (MAIN_USD + LUNA_USD)) < 1e-9);
  });
});
