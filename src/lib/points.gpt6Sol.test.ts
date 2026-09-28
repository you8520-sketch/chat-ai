import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { CHEAPER_INFERENCE_GPT_6_SOL_MODEL } from "@/lib/chatModels";
import {
  clearCheaperInferenceCatalogPricingForTest,
  updateCheaperInferenceCatalogPricing,
} from "@/lib/cheaperInferenceCatalogPricing";
import {
  GPT_6_SOL_LONG_CONTEXT_THRESHOLD_TOKENS,
  computeOpenRouterTurnBilling,
  resolveOpenRouterReasoningPointRates,
} from "@/lib/points";

function ceilPoints(rawUsd: number, effectiveKrwPerUsd: number, margin: number): number {
  return Math.ceil((rawUsd * effectiveKrwPerUsd) / (1 - margin) - 1e-9);
}

describe("GPT-6 Sol official-reference billing", () => {
  beforeEach(() => clearCheaperInferenceCatalogPricingForTest());

  it("uses official Standard short-context rates with the 13% target margin", () => {
    const rates = resolveOpenRouterReasoningPointRates(
      CHEAPER_INFERENCE_GPT_6_SOL_MODEL,
      1560.6
    );
    assert.ok(rates);
    assert.equal(rates.inputUsdPerMillion, 2);
    assert.equal(rates.cacheReadUsdPerMillion, 0.2);
    assert.equal(rates.cacheWriteUsdPerMillion, 2.5);
    assert.equal(rates.outputUsdPerMillion, 10);
    assert.equal(rates.grossMargin, 0.13);
    assert.equal(rates.longContextThresholdTokens, 272_000);
    assert.equal(rates.longContextInputUsdPerMillion, 4);
    assert.equal(rates.longContextCacheReadUsdPerMillion, 0.4);
    assert.equal(rates.longContextCacheWriteUsdPerMillion, 5);
    assert.equal(rates.longContextOutputUsdPerMillion, 15);

    const competitorAUsd = (42_839 * 2 + 2_756 * 10) / 1_000_000;
    assert.equal(ceilPoints(competitorAUsd, 1560.6, rates.grossMargin), 204);
  });

  it("does not let CheaperInference discount/catalog drift change the user price", () => {
    updateCheaperInferenceCatalogPricing({
      modelId: CHEAPER_INFERENCE_GPT_6_SOL_MODEL,
      inputUsdPerMillion: 0.8,
      cacheReadUsdPerMillion: 0.08,
      cacheWriteUsdPerMillion: 1,
      outputUsdPerMillion: 4,
      discountPercent: 60,
      fetchedAt: Date.now(),
    });

    const rates = resolveOpenRouterReasoningPointRates(CHEAPER_INFERENCE_GPT_6_SOL_MODEL);
    assert.ok(rates);
    assert.equal(rates.inputUsdPerMillion, 2);
    assert.equal(rates.outputUsdPerMillion, 10);
    assert.equal(rates.grossMargin, 0.13);
  });

  it("ignores provider-reported procurement cost for the user charge", () => {
    const base = {
      modelId: CHEAPER_INFERENCE_GPT_6_SOL_MODEL,
      inputTokens: 42_839,
      outputTokens: 2_756,
      apiPromptTokens: 42_839,
      apiCompletionTokens: 2_756,
    };
    const withoutUpstream = computeOpenRouterTurnBilling(base);
    const withCheapUpstream = computeOpenRouterTurnBilling({
      ...base,
      upstreamCostUsd: 0.001,
    });
    assert.equal(withCheapUpstream.total, withoutUpstream.total);
    assert.equal(withCheapUpstream.baseCost, withoutUpstream.baseCost);
  });

  it("switches the full request to the official long-context tier only above 272K", () => {
    const rates = resolveOpenRouterReasoningPointRates(CHEAPER_INFERENCE_GPT_6_SOL_MODEL);
    assert.ok(rates);

    const atThreshold = computeOpenRouterTurnBilling({
      modelId: CHEAPER_INFERENCE_GPT_6_SOL_MODEL,
      inputTokens: GPT_6_SOL_LONG_CONTEXT_THRESHOLD_TOKENS,
      outputTokens: 1_000,
      apiPromptTokens: GPT_6_SOL_LONG_CONTEXT_THRESHOLD_TOKENS,
      apiCompletionTokens: 1_000,
    });
    const aboveThreshold = computeOpenRouterTurnBilling({
      modelId: CHEAPER_INFERENCE_GPT_6_SOL_MODEL,
      inputTokens: GPT_6_SOL_LONG_CONTEXT_THRESHOLD_TOKENS + 1,
      outputTokens: 1_000,
      apiPromptTokens: GPT_6_SOL_LONG_CONTEXT_THRESHOLD_TOKENS + 1,
      apiCompletionTokens: 1_000,
    });

    const shortUsd =
      (GPT_6_SOL_LONG_CONTEXT_THRESHOLD_TOKENS * 2 + 1_000 * 10) / 1_000_000;
    const longUsd =
      ((GPT_6_SOL_LONG_CONTEXT_THRESHOLD_TOKENS + 1) * 4 + 1_000 * 15) /
      1_000_000;
    assert.equal(
      atThreshold.total,
      ceilPoints(shortUsd, rates.effectiveKrwPerUsd, rates.grossMargin)
    );
    assert.equal(
      aboveThreshold.total,
      ceilPoints(longUsd, rates.effectiveKrwPerUsd, rates.grossMargin)
    );
    assert.ok(aboveThreshold.total > atThreshold.total);
  });
});
