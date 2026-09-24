import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { BillingFxSnapshot } from "@/lib/billingFxSnapshot";
import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
  CLAUDE_OPUS_55_DISPLAY_NAME,
  isCheaperInferenceClaudeOpus55Model,
  MAIN_RP_USER_SELECTABLE_OPTIONS,
  selectedAILabel,
} from "@/lib/chatModels";
import { applyCheaperInferenceModelReasoningPolicy } from "@/lib/cheaperInferenceConfig";
import { getModelPricingPolicy } from "@/lib/modelPricingPolicy";
import { getModelPublishedPricingPolicy } from "@/lib/modelPublishedPricingPolicy";
import {
  buildOpus55RealizedProcurementMarginCandidateMatrix,
  buildOpus55ReferenceProductMarginMatrix,
  buildOpus55PrepProcurementCatalog,
  buildOpus55PrepPublishedPricing,
  buildOpus55PriceMatrix,
  computeOpus55InvariantUserProductCharge,
  computeOpus55PrepProductCharge,
  OPUS55_CI_CATALOG_EVIDENCE,
  OPUS55_REFERENCE_PRODUCT_MARGIN_CANDIDATES,
  OPUS55_COMMERCIAL_WORKLOADS,
  OPUS55_MARKET_BENCHMARKS,
  OPUS55_PREP_INPUT_TOKEN_WORKLOADS,
} from "@/lib/claudeOpus55PricingPrep";
import {
  OPUS55_CACHE_PATH_AUDIT,
  OPUS55_REASONING_CONTRACT_AUDIT,
} from "@/lib/opus55PricingEvidence";
import { resolveProcurementCostFromCatalog } from "@/lib/procurementCost";

const FX: BillingFxSnapshot = {
  mode: "daily_kst",
  dateKey: "2026-09-22",
  usdToKrw: 1530,
  effectiveKrwPerUsd: 1560.6,
  source: "api_daily",
  overseasFeeRate: 0.02,
  locked: true,
};

describe("Claude Opus 5.5 prep registry", () => {
  it("is exposed on Main RP picker after live rollout wiring", () => {
    assert.equal(
      MAIN_RP_USER_SELECTABLE_OPTIONS.some((option) => option.id === CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL),
      true
    );
  });

  it("uses CheaperInference wire id claude-opus-5.5", () => {
    assert.equal(CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL, "claude-opus-5.5");
    assert.equal(isCheaperInferenceClaudeOpus55Model("claude-opus-5.5"), true);
    assert.equal(selectedAILabel("claude-opus-5.5"), CLAUDE_OPUS_55_DISPLAY_NAME);
  });

  it("published applicability uses not_applicable cache semantics for USER PRODUCT invariant", () => {
    const publishedPolicy = getModelPublishedPricingPolicy(CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL);
    assert.equal(publishedPolicy?.cacheSemanticStatus, "not_applicable");
    assert.equal(publishedPolicy?.opusCacheTtlMode, undefined);
  });

  it("registers tracker policy with expected CI provider id", () => {
    const tracker = getModelPricingPolicy(CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL);
    assert.ok(tracker);
    assert.equal(tracker?.expectedProviderModelId, "claude-opus-5.5");
    assert.equal(tracker?.autoApply, false);
  });
});

describe("Opus 5.5 cache and reasoning evidence", () => {
  it("records production transport/read/write/hit proof while billed-USD saving stays UNVERIFIED", () => {
    const byStage = new Map(OPUS55_CACHE_PATH_AUDIT.map((row) => [row.stage, row.status]));
    assert.equal(
      byStage.get("CheaperInference request body (cache_control passthrough)"),
      "VERIFIED"
    );
    assert.equal(
      byStage.get("CI response usage cache_read / cache_write fields"),
      "VERIFIED"
    );
    assert.equal(byStage.get("Sequential cache hit evidence"), "VERIFIED");
    assert.equal(
      byStage.get("Cache hit → procurement cost decrease"),
      "UNVERIFIED"
    );
  });

  it("reasoning contract documents UNVERIFIED Opus 5.5 direct proof", () => {
    assert.equal(OPUS55_REASONING_CONTRACT_AUDIT.opus55DirectProof, "UNVERIFIED");
    const body = applyCheaperInferenceModelReasoningPolicy({
      model: CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
      messages: [],
    });
    assert.deepEqual(body.thinking, OPUS55_REASONING_CONTRACT_AUDIT.requestFields.thinking);
    assert.equal(body.reasoning_effort, OPUS55_REASONING_CONTRACT_AUDIT.requestFields.reasoning_effort);
  });
});

describe("Claude Opus 5.5 PRODUCT vs PROCUREMENT separation", () => {
  it("PRODUCT billing reference matches Anthropic list from CI catalog evidence", () => {
    const prep = buildOpus55PrepPublishedPricing(0.1);
    assert.equal(prep.billingReferenceInputUsdPerMillion, 4);
    assert.equal(prep.billingReferenceOutputUsdPerMillion, 20);
    assert.equal(prep.billingReferenceCacheReadUsdPerMillion, undefined);
  });

  it("PROCUREMENT catalog uses exact CI cache fields (not estimated ratios)", () => {
    const catalog = buildOpus55PrepProcurementCatalog();
    assert.equal(catalog.inputUsdPerMillion, 2.8);
    assert.equal(catalog.outputUsdPerMillion, 14);
    assert.equal(catalog.cacheReadUsdPerMillion, 2.8);
    assert.equal(catalog.cacheWriteUsdPerMillion, 2.8);
    assert.equal(catalog.discountPercent, 30);
    assert.equal(catalog.cacheReadUsdPerMillion, OPUS55_CI_CATALOG_EVIDENCE.fields.cache_read_input_per_million);
  });
});

describe("Claude Opus 5.5 user price absolute invariant", () => {
  const promptTokens = OPUS55_COMMERCIAL_WORKLOADS.elin.promptTokens;
  const outputTokens = OPUS55_COMMERCIAL_WORKLOADS.elin.outputTokens;
  const targetMargin = 0.4;

  const scenarios = [
    { label: "A zero cache", cacheReadTokens: 0, cacheWriteTokens: 0, upstreamCostUsd: undefined },
    { label: "B cache read 10k", cacheReadTokens: 10_000, cacheWriteTokens: 0, upstreamCostUsd: undefined },
    { label: "C cache read 50k", cacheReadTokens: 50_000, cacheWriteTokens: 0, upstreamCostUsd: undefined },
    { label: "D cache write", cacheReadTokens: 0, cacheWriteTokens: 5_000, upstreamCostUsd: undefined },
    { label: "E upstream cost", cacheReadTokens: 0, cacheWriteTokens: 0, upstreamCostUsd: 0.42 },
    { label: "F provider attempts", cacheReadTokens: 0, cacheWriteTokens: 0, upstreamCostUsd: undefined, providerAttemptCount: 4 },
  ] as const;

  for (const scenario of scenarios) {
    it(`${scenario.label} — USER PRODUCT P unchanged`, () => {
      const baseline = computeOpus55InvariantUserProductCharge({
        promptTokens,
        billableOutputTokens: outputTokens,
        targetMargin,
        fxSnapshot: FX,
      });
      const variant = computeOpus55InvariantUserProductCharge({
        promptTokens,
        billableOutputTokens: outputTokens,
        targetMargin,
        fxSnapshot: FX,
        cacheReadTokens: scenario.cacheReadTokens,
        cacheWriteTokens: scenario.cacheWriteTokens,
        upstreamCostUsd: scenario.upstreamCostUsd,
        providerAttemptCount: "providerAttemptCount" in scenario ? scenario.providerAttemptCount : 1,
      });
      assert.equal(baseline.status, "complete");
      assert.equal(variant.status, "complete");
      assert.equal(variant.snapshot.finalPoints, baseline.snapshot.finalPoints);
    });
  }

  it("procurement may differ with cache tokens but USER P stays fixed", () => {
    const catalog = buildOpus55PrepProcurementCatalog();
    const charge = computeOpus55PrepProductCharge({
      promptTokens: 45_000,
      outputTokens: 2_907,
      targetMargin: 0.12,
      fxSnapshot: FX,
    });
    assert.equal(charge.status, "complete");
    const withCacheRead = resolveProcurementCostFromCatalog({
      modelId: CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
      promptTokens: 45_000,
      outputTokens: 2_907,
      cacheReadTokens: 20_000,
      effectiveKrwPerUsd: FX.effectiveKrwPerUsd,
      catalog,
    })!;
    const noCache = resolveProcurementCostFromCatalog({
      modelId: CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
      promptTokens: 45_000,
      outputTokens: 2_907,
      effectiveKrwPerUsd: FX.effectiveKrwPerUsd,
      catalog,
    })!;
    assert.equal(withCacheRead.procurementCostKrw, noCache.procurementCostKrw);
  });
});

describe("Claude Opus 5.5 reference product margin matrix", () => {
  it("includes ELIN and T-POT workloads for 35/40/45% PRODUCT targetMargins", () => {
    const matrix = buildOpus55ReferenceProductMarginMatrix({ fxSnapshot: FX });
    assert.equal(matrix.length, 2 * OPUS55_REFERENCE_PRODUCT_MARGIN_CANDIDATES.length);
    for (const margin of OPUS55_REFERENCE_PRODUCT_MARGIN_CANDIDATES) {
      const elin = matrix.find((r) => r.workloadKey === "elin" && r.targetMargin === margin);
      const tpot = matrix.find((r) => r.workloadKey === "tpot" && r.targetMargin === margin);
      assert.ok(elin?.userChargePoints != null);
      assert.ok(tpot?.userChargePoints != null);
      assert.equal(elin?.promptTokens, 73_763);
      assert.equal(elin?.outputTokens, 5_334);
      assert.equal(tpot?.promptTokens, 58_654);
      assert.equal(tpot?.outputTokens, 4_644);
    }
  });

  it("includes market benchmarks with correct kinds", () => {
    assert.ok(OPUS55_MARKET_BENCHMARKS.some((b) => b.id === "elin_opus55_a"));
    assert.ok(OPUS55_MARKET_BENCHMARKS.some((b) => b.id === "tpot_opus55_hypothetical"));
    assert.ok(OPUS55_MARKET_BENCHMARKS.some((b) => b.id === "crack_perceived"));
    const matrix = buildOpus55ReferenceProductMarginMatrix({ fxSnapshot: FX, targetMargins: [0.4] });
    const elin = matrix.find((r) => r.workloadKey === "elin")!;
    const elinBench = elin.marketComparisons.find((c) => c.benchmarkId === "elin_opus55_a");
    assert.equal(elinBench?.referenceKrw, 729.6);
    const hypo = elin.marketComparisons.find((c) => c.benchmarkId === "tpot_opus55_hypothetical");
    assert.equal(hypo?.kind, "HYPOTHETICAL_SCENARIO");
    assert.equal(hypo?.referencePoints, 736.8);
  });
});

describe("Claude Opus 5.5 realized procurement margin candidates", () => {
  it("30/35/40% candidates are below reference PRODUCT 35% on ELIN workload", () => {
    const realized = buildOpus55RealizedProcurementMarginCandidateMatrix({ fxSnapshot: FX });
    const elinBalanced = realized.find(
      (r) => r.promptTokens === 73_763 && r.targetRealizedGrossMargin === 0.35
    );
    const product35 = buildOpus55ReferenceProductMarginMatrix({ fxSnapshot: FX, targetMargins: [0.35] }).find(
      (r) => r.workloadKey === "elin"
    );
    assert.ok(elinBalanced && product35?.userChargePoints != null);
    assert.ok(elinBalanced.finalPoints < product35.userChargePoints!);
  });
});

describe("Claude Opus 5.5 exploratory price matrix", () => {
  it("generates char preset grid", () => {
    const matrix = buildOpus55PriceMatrix({ targetMargin: 0.12, fxSnapshot: FX });
    assert.equal(matrix.length, OPUS55_PREP_INPUT_TOKEN_WORKLOADS.length * 5);
  });
});
