import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { CHEAPER_INFERENCE_GPT_61_SOL_MODEL } from "@/lib/chatModels";
import {
  clearCheaperInferenceCatalogPricingForTest,
  updateCheaperInferenceCatalogPricing,
} from "@/lib/cheaperInferenceCatalogPricing";
import { normalizeBillableUsage } from "@/lib/billingUsage";
import type { BillingFxSnapshot } from "@/lib/billingFxSnapshot";
import {
  CHEAPER_INFERENCE_GPT_61_SOL_GROSS_MARGIN,
  CHEAPER_INFERENCE_GPT_61_SOL_LONG_CONTEXT_THRESHOLD_TOKENS,
  computeOpenRouterTurnBilling,
  resolveOpenRouterReasoningPointRates,
} from "@/lib/points";
import { getPublishedPricing } from "@/lib/publishedModelPricing";
import {
  computePublishedStandardPreviewPoints,
  computePublishedUserChargeWithSnapshot,
} from "@/lib/publishedUserCharge";

const FX: BillingFxSnapshot = {
  mode: "daily_kst",
  dateKey: "2026-10-02",
  usdToKrw: 1530,
  effectiveKrwPerUsd: 1560.6,
  source: "api_daily",
  overseasFeeRate: 0.02,
  locked: true,
};

function expectedPoints(rawUsd: number, exchangeRate: number): number {
  return Math.ceil((rawUsd * exchangeRate) / (1 - CHEAPER_INFERENCE_GPT_61_SOL_GROSS_MARGIN) - 1e-9);
}

describe("GPT-6.1 Sol official published and fallback pricing", () => {
  beforeEach(() => clearCheaperInferenceCatalogPricingForTest());

  it("pins official Standard short rates and 45% target margin", () => {
    const published = getPublishedPricing(CHEAPER_INFERENCE_GPT_61_SOL_MODEL);
    assert.equal(published.billingReferenceInputUsdPerMillion, 2);
    assert.equal(published.billingReferenceCacheReadUsdPerMillion, 0.1);
    assert.equal(published.billingReferenceCacheWriteUsdPerMillion, 2.5);
    assert.equal(published.billingReferenceOutputUsdPerMillion, 10);
    assert.equal(published.targetMargin, 0.45);
    assert.equal(published.publishedLongContextMinPromptTokens, 272_000);

    const rates = resolveOpenRouterReasoningPointRates(CHEAPER_INFERENCE_GPT_61_SOL_MODEL);
    assert.ok(rates);
    assert.equal(rates.inputUsdPerMillion, 2);
    assert.equal(rates.cacheReadUsdPerMillion, 0.1);
    assert.equal(rates.cacheWriteUsdPerMillion, 2.5);
    assert.equal(rates.outputUsdPerMillion, 10);
    assert.equal(rates.grossMargin, 0.45);
    assert.equal(rates.longContextThresholdTokens, CHEAPER_INFERENCE_GPT_61_SOL_LONG_CONTEXT_THRESHOLD_TOKENS);
    assert.equal(rates.longContextInputUsdPerMillion, 4);
    assert.equal(rates.longContextOutputUsdPerMillion, 15);
  });

  it("does not let a CI 25% catalog discount change Sol user rates", () => {
    updateCheaperInferenceCatalogPricing({
      modelId: CHEAPER_INFERENCE_GPT_61_SOL_MODEL,
      inputUsdPerMillion: 1.486373,
      cacheReadUsdPerMillion: 0.074319,
      cacheWriteUsdPerMillion: 1.857967,
      outputUsdPerMillion: 7.431866,
      discountPercent: 25.68,
      fetchedAt: Date.now(),
    });
    const rates = resolveOpenRouterReasoningPointRates(CHEAPER_INFERENCE_GPT_61_SOL_MODEL);
    assert.ok(rates);
    assert.equal(rates.inputUsdPerMillion, 2);
    assert.equal(rates.outputUsdPerMillion, 10);
  });

  it("ignores provider-reported procurement cost for user charge", () => {
    const billing = computeOpenRouterTurnBilling({
      modelId: CHEAPER_INFERENCE_GPT_61_SOL_MODEL,
      inputTokens: 20_000,
      outputTokens: 2_000,
      apiPromptTokens: 20_000,
      apiCompletionTokens: 2_000,
      upstreamCostUsd: 0.01,
    });
    const rates = resolveOpenRouterReasoningPointRates(CHEAPER_INFERENCE_GPT_61_SOL_MODEL);
    assert.ok(rates);
    assert.equal(
      billing.total,
      expectedPoints((20_000 * 2 + 2_000 * 10) / 1_000_000, rates.effectiveKrwPerUsd)
    );
  });

  it("uses official long-context rates only above 272K exclusive", () => {
    const atBoundary = computeOpenRouterTurnBilling({
      modelId: CHEAPER_INFERENCE_GPT_61_SOL_MODEL,
      inputTokens: 272_000,
      outputTokens: 1_000,
      apiPromptTokens: 272_000,
      apiCompletionTokens: 1_000,
    });
    const above = computeOpenRouterTurnBilling({
      modelId: CHEAPER_INFERENCE_GPT_61_SOL_MODEL,
      inputTokens: 272_001,
      outputTokens: 1_000,
      apiPromptTokens: 272_001,
      apiCompletionTokens: 1_000,
    });
    const rates = resolveOpenRouterReasoningPointRates(CHEAPER_INFERENCE_GPT_61_SOL_MODEL)!;
    assert.equal(
      atBoundary.total,
      expectedPoints((272_000 * 2 + 1_000 * 10) / 1_000_000, rates.effectiveKrwPerUsd)
    );
    assert.equal(
      above.total,
      expectedPoints((272_001 * 4 + 1_000 * 15) / 1_000_000, rates.effectiveKrwPerUsd)
    );
    assert.ok(above.total > atBoundary.total);
  });

  it("does not double-count reasoning already included in completion tokens", () => {
    const included = computeOpenRouterTurnBilling({
      modelId: CHEAPER_INFERENCE_GPT_61_SOL_MODEL,
      inputTokens: 10_000,
      outputTokens: 800,
      reasoningTokens: 200,
      apiPromptTokens: 10_000,
      apiCompletionTokens: 800,
    });
    const sameWithoutExtra = computeOpenRouterTurnBilling({
      modelId: CHEAPER_INFERENCE_GPT_61_SOL_MODEL,
      inputTokens: 10_000,
      outputTokens: 800,
      apiPromptTokens: 10_000,
      apiCompletionTokens: 800,
    });
    assert.equal(included.total, sameWithoutExtra.total);
  });

  it("published charge applies cache read/write separately and long-context 2x/1.5x", () => {
    const shortCache = computePublishedUserChargeWithSnapshot({
      modelId: CHEAPER_INFERENCE_GPT_61_SOL_MODEL,
      usage: normalizeBillableUsage({
        modelId: CHEAPER_INFERENCE_GPT_61_SOL_MODEL,
        promptTokens: 10_000,
        cacheReadTokens: 4_000,
        cacheWriteTokens: 1_000,
        outputTokens: 1_000,
      }),
      usageCoverage: "complete",
      fxSnapshot: FX,
      adjustment: { kind: "none" },
    });
    assert.equal(shortCache.status, "complete");
    if (shortCache.status === "complete") {
      const expected = computePublishedStandardPreviewPoints({
        modelId: CHEAPER_INFERENCE_GPT_61_SOL_MODEL,
        promptTokens: 10_000,
        outputTokens: 1_000,
        cacheReadTokens: 4_000,
        cacheWriteTokens: 1_000,
        effectiveKrwPerUsd: FX.effectiveKrwPerUsd,
      });
      assert.equal(shortCache.snapshot.finalPoints, expected);
      assert.equal(shortCache.snapshot.reasoningAccounting, "none");
      assert.equal(shortCache.snapshot.billableOutputTokens, 1_000);
    }

    const longCtx = computePublishedUserChargeWithSnapshot({
      modelId: CHEAPER_INFERENCE_GPT_61_SOL_MODEL,
      usage: normalizeBillableUsage({
        modelId: CHEAPER_INFERENCE_GPT_61_SOL_MODEL,
        promptTokens: 272_001,
        outputTokens: 1_000,
      }),
      usageCoverage: "complete",
      fxSnapshot: FX,
      adjustment: { kind: "none" },
    });
    assert.equal(longCtx.status, "complete");
    if (longCtx.status === "complete") {
      const expected = computePublishedStandardPreviewPoints({
        modelId: CHEAPER_INFERENCE_GPT_61_SOL_MODEL,
        promptTokens: 272_001,
        outputTokens: 1_000,
        effectiveKrwPerUsd: FX.effectiveKrwPerUsd,
      });
      assert.equal(longCtx.snapshot.finalPoints, expected);
      assert.ok((expected ?? 0) > 0);
    }
  });
});
