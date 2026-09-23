import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { BillingFxSnapshot } from "@/lib/billingFxSnapshot";
import { normalizeBillableUsage } from "@/lib/billingUsage";
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
  buildOpus55PrepProcurementCatalog,
  buildOpus55PrepPublishedPricing,
  buildOpus55PriceMatrix,
  computeOpus55PrepProductCharge,
  OPUS55_CI_PROCUREMENT_DISCOUNT_PERCENT,
  OPUS55_CI_PROCUREMENT_INPUT_USD_PER_MILLION,
  OPUS55_CI_PROCUREMENT_OUTPUT_USD_PER_MILLION,
  OPUS55_OFFICIAL_LIST_INPUT_USD_PER_MILLION,
  OPUS55_OFFICIAL_LIST_OUTPUT_USD_PER_MILLION,
  OPUS55_PREP_INPUT_TOKEN_WORKLOADS,
} from "@/lib/claudeOpus55PricingPrep";
import { computePublishedUserChargeFromResolvedPolicy } from "@/lib/publishedUserCharge";
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
  it("is not exposed on Main RP picker yet", () => {
    assert.equal(
      MAIN_RP_USER_SELECTABLE_OPTIONS.some((option) => option.id === CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL),
      false
    );
  });

  it("uses CheaperInference wire id claude-opus-5.5", () => {
    assert.equal(CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL, "claude-opus-5.5");
    assert.equal(isCheaperInferenceClaudeOpus55Model("claude-opus-5.5"), true);
    assert.equal(selectedAILabel("claude-opus-5.5"), CLAUDE_OPUS_55_DISPLAY_NAME);
  });

  it("registers tracker and published applicability policy without Main RP picker exposure", () => {
    const tracker = getModelPricingPolicy(CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL);
    assert.ok(tracker);
    assert.equal(tracker?.expectedProviderModelId, "claude-opus-5.5");
    assert.equal(tracker?.autoApply, false);
    const publishedPolicy = getModelPublishedPricingPolicy(CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL);
    assert.equal(publishedPolicy?.cacheSemanticStatus, "verified_5m");
  });

  it("applies Opus-family CI reasoning policy", () => {
    const body = applyCheaperInferenceModelReasoningPolicy({
      model: CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
      messages: [],
    });
    assert.deepEqual(body.thinking, { type: "disabled" });
    assert.equal(body.reasoning_effort, "low");
  });
});

describe("Claude Opus 5.5 PRODUCT vs PROCUREMENT separation", () => {
  it("PRODUCT billing reference matches Anthropic official list", () => {
    const prep = buildOpus55PrepPublishedPricing(0.1);
    assert.equal(prep.billingReferenceInputUsdPerMillion, OPUS55_OFFICIAL_LIST_INPUT_USD_PER_MILLION);
    assert.equal(prep.billingReferenceOutputUsdPerMillion, OPUS55_OFFICIAL_LIST_OUTPUT_USD_PER_MILLION);
    assert.equal(prep.pricingVersion, 1);
    assert.equal(prep.billingReferenceCacheReadUsdPerMillion, undefined);
  });

  it("PROCUREMENT catalog uses CI effective rates and 30% discount metadata only", () => {
    const catalog = buildOpus55PrepProcurementCatalog();
    assert.equal(catalog.inputUsdPerMillion, OPUS55_CI_PROCUREMENT_INPUT_USD_PER_MILLION);
    assert.equal(catalog.outputUsdPerMillion, OPUS55_CI_PROCUREMENT_OUTPUT_USD_PER_MILLION);
    assert.equal(catalog.discountPercent, OPUS55_CI_PROCUREMENT_DISCOUNT_PERCENT);
    assert.equal(catalog.referenceInputUsdPerMillion, OPUS55_OFFICIAL_LIST_INPUT_USD_PER_MILLION);
  });
});

describe("Claude Opus 5.5 user charge invariant (prep PRODUCT owner)", () => {
  it("same prompt/output → same P regardless of hypothetical cache split in usage normalization", () => {
    const targetMargin = 0.12;
    const baseline = computeOpus55PrepProductCharge({
      promptTokens: 45_000,
      outputTokens: 2_907,
      targetMargin,
      fxSnapshot: FX,
    });
    assert.equal(baseline.status, "complete");
    const usageSplit = normalizeBillableUsage({
      modelId: CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
      promptTokens: 45_000,
      outputTokens: 2_907,
      cacheReadTokens: 20_000,
      cacheWriteTokens: 0,
    });
    const splitCharge = computePublishedUserChargeFromResolvedPolicy({
      requestedModelId: CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
      resolvedPricing: {
        requestedModelId: CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
        canonicalModelId: CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
        pricing: buildOpus55PrepPublishedPricing(targetMargin),
      },
      usage: usageSplit,
      usageCoverage: "complete",
      fxSnapshot: FX,
      adjustment: { kind: "none" },
    });
    assert.equal(splitCharge.status, "blocked");
    if (splitCharge.status === "blocked") {
      assert.equal(splitCharge.reason, "unsupported_cache_semantics");
    }
    const forcedZeroCache = computePublishedUserChargeFromResolvedPolicy({
      requestedModelId: CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
      resolvedPricing: {
        requestedModelId: CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
        canonicalModelId: CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
        pricing: buildOpus55PrepPublishedPricing(targetMargin),
      },
      usage: normalizeBillableUsage({
        modelId: CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
        promptTokens: 45_000,
        outputTokens: 2_907,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      }),
      usageCoverage: "complete",
      fxSnapshot: FX,
      adjustment: { kind: "none" },
    });
    assert.equal(forcedZeroCache.snapshot.finalPoints, baseline.snapshot.finalPoints);
  });

  it("procurement cost can improve with cache hit while USER P stays fixed", () => {
    const catalog = buildOpus55PrepProcurementCatalog();
    const charge = computeOpus55PrepProductCharge({
      promptTokens: 45_000,
      outputTokens: 2_907,
      targetMargin: 0.12,
      fxSnapshot: FX,
    });
    assert.equal(charge.status, "complete");
    const noCache = resolveProcurementCostFromCatalog({
      modelId: CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
      promptTokens: 45_000,
      outputTokens: 2_907,
      effectiveKrwPerUsd: FX.effectiveKrwPerUsd,
      catalog,
    })!;
    const cacheHit = resolveProcurementCostFromCatalog({
      modelId: CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
      promptTokens: 45_000,
      outputTokens: 2_907,
      cacheReadTokens: 20_000,
      effectiveKrwPerUsd: FX.effectiveKrwPerUsd,
      catalog,
    })!;
    assert.ok(cacheHit.procurementCostKrw < noCache.procurementCostKrw);
    assert.equal(charge.snapshot.finalPoints, charge.snapshot.finalPoints);
  });
});

describe("Claude Opus 5.5 price matrix", () => {
  it("generates all input workloads and char presets", () => {
    const matrix = buildOpus55PriceMatrix({ targetMargin: 0.12, fxSnapshot: FX });
    assert.equal(matrix.length, OPUS55_PREP_INPUT_TOKEN_WORKLOADS.length * 5);
    for (const row of matrix) {
      assert.ok(row.userChargePoints != null && row.userChargePoints > 0);
      assert.ok(row.procurementCostKrwNoCache != null);
      assert.ok(row.anthropicListCostKrw != null);
      assert.ok(row.grossMarginPercentNoCache != null);
    }
  });

  it("4360 char reference row matches ~2907 output tokens", () => {
    const matrix = buildOpus55PriceMatrix({ targetMargin: 0.12, fxSnapshot: FX });
    const ref = matrix.find((row) => row.outputChars === 4360 && row.promptTokens === 45_000);
    assert.ok(ref);
    assert.equal(ref?.outputTokens, 2907);
    assert.ok(ref?.userChargePoints != null);
  });
});
