import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { CHEAPER_INFERENCE_GPT_56_TERRA_MODEL } from "@/lib/chatModels";
import {
  clearCheaperInferenceCatalogPricingForTest,
  updateCheaperInferenceCatalogPricing,
} from "@/lib/cheaperInferenceCatalogPricing";
import {
  CHEAPER_INFERENCE_GPT_56_TERRA_GROSS_MARGIN,
  computeOpenRouterTurnBilling,
  computeOpenRouterTurnCost,
  resolveOpenRouterReasoningPointRates,
} from "@/lib/points";

function expectedPoints(rawUsd: number, exchangeRate: number): number {
  return Math.ceil(
    (rawUsd * exchangeRate) /
      (1 - CHEAPER_INFERENCE_GPT_56_TERRA_GROSS_MARGIN) -
      1e-9
  );
}

describe("GPT-5.6 Terra proportional billing", () => {
  beforeEach(() => clearCheaperInferenceCatalogPricingForTest());

  it("uses the shared token-proportional owner at 50% gross margin", () => {
    const rates = resolveOpenRouterReasoningPointRates(
      CHEAPER_INFERENCE_GPT_56_TERRA_MODEL
    );
    assert.ok(rates);
    assert.equal(rates.inputUsdPerMillion, 2);
    assert.equal(rates.cacheReadUsdPerMillion, 0.2);
    assert.equal(rates.cacheWriteUsdPerMillion, 2);
    assert.equal(rates.outputUsdPerMillion, 12);
    assert.equal(rates.grossMargin, 0.5);

    const billing = computeOpenRouterTurnBilling({
      modelId: CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
      inputTokens: 200_000,
      outputTokens: 100_000,
      cacheReadTokens: 100_000,
      apiPromptTokens: 200_000,
      apiCompletionTokens: 100_000,
    });
    assert.equal(
      billing.total,
      expectedPoints(
        (100_000 * 2 + 100_000 * 0.2 + 100_000 * 12) / 1_000_000,
        rates.effectiveKrwPerUsd
      )
    );
  });

  it("uses live CheaperInference rates without tier boundaries", () => {
    updateCheaperInferenceCatalogPricing({
      modelId: CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
      inputUsdPerMillion: 0.8,
      cacheReadUsdPerMillion: 0.08,
      cacheWriteUsdPerMillion: 1,
      outputUsdPerMillion: 4.8,
      discountPercent: 60,
      fetchedAt: Date.now(),
    });
    const rates = resolveOpenRouterReasoningPointRates(
      CHEAPER_INFERENCE_GPT_56_TERRA_MODEL
    );
    assert.ok(rates);
    assert.equal(rates.inputUsdPerMillion, 0.8);
    assert.equal(rates.outputUsdPerMillion, 4.8);

    const a = computeOpenRouterTurnCost(33_881, 3_683, CHEAPER_INFERENCE_GPT_56_TERRA_MODEL);
    const b = computeOpenRouterTurnCost(33_881, 3_684, CHEAPER_INFERENCE_GPT_56_TERRA_MODEL);
    assert.ok(b >= a);
    assert.ok(b - a <= 1, "one output token must never trigger a multi-point tier jump");
  });

  it("provider-reported actual cost uses the same 50% margin owner", () => {
    const billing = computeOpenRouterTurnBilling({
      modelId: CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
      inputTokens: 33_881,
      outputTokens: 3_683,
      apiPromptTokens: 33_881,
      apiCompletionTokens: 3_683,
      upstreamCostUsd: 0.04478,
    });
    const rates = resolveOpenRouterReasoningPointRates(
      CHEAPER_INFERENCE_GPT_56_TERRA_MODEL
    );
    assert.ok(rates);
    assert.equal(
      billing.total,
      expectedPoints(0.04478, rates.effectiveKrwPerUsd)
    );
  });
});
