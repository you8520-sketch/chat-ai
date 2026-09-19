import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL } from "@/lib/chatModels";
import {
  clearCheaperInferenceCatalogPricingForTest,
  updateCheaperInferenceCatalogPricing,
} from "@/lib/cheaperInferenceCatalogPricing";
import * as points from "@/lib/points";
import {
  CHEAPER_INFERENCE_GEMINI_37_FLASH_GROSS_MARGIN,
  computeOpenRouterTurnBilling,
  computeOpenRouterTurnCost,
  resolveOpenRouterReasoningPointRates,
} from "@/lib/points";
import { buildBillingReceipt, formatBillingReceiptText } from "@/lib/billingDisplay";

function expectedPoints(rawUsd: number, exchangeRate: number): number {
  return Math.ceil(
    (rawUsd * exchangeRate) /
      (1 - CHEAPER_INFERENCE_GEMINI_37_FLASH_GROSS_MARGIN) -
      1e-9
  );
}

describe("Gemini 3.7 Flash proportional billing", () => {
  const modelId = CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL;

  beforeEach(() => clearCheaperInferenceCatalogPricingForTest());

  it("joins the shared token-proportional owner at the existing 55% margin", () => {
    const rates = resolveOpenRouterReasoningPointRates(modelId);
    assert.ok(rates);
    assert.equal(rates.inputUsdPerMillion, 0.525);
    assert.equal(rates.cacheReadUsdPerMillion, 0.0525);
    assert.equal(rates.cacheWriteUsdPerMillion, 0.525);
    assert.equal(rates.outputUsdPerMillion, 2.625);
    assert.equal(rates.grossMargin, 0.55);

    const billing = computeOpenRouterTurnBilling({
      modelId,
      inputTokens: 50_000,
      outputTokens: 3_000,
      apiPromptTokens: 50_000,
      apiCompletionTokens: 3_000,
    });
    assert.equal(
      billing.total,
      expectedPoints(
        (50_000 * 0.525 + 3_000 * 2.625) / 1_000_000,
        rates.effectiveKrwPerUsd
      )
    );
  });

  it("removes the old 2.5K/4K/5.5K/7K/9K output price cliffs", () => {
    for (const edge of [2_500, 4_000, 5_500, 7_000, 9_000]) {
      const below = computeOpenRouterTurnCost(30_000, edge - 1, modelId);
      const at = computeOpenRouterTurnCost(30_000, edge, modelId);
      const above = computeOpenRouterTurnCost(30_000, edge + 1, modelId);
      assert.ok(at >= below);
      assert.ok(above >= at);
      assert.ok(at - below <= 1, `edge ${edge} must not jump by multiple points`);
      assert.ok(above - at <= 1, `edge ${edge} must not jump by multiple points`);
    }
  });

  it("input and output both change the price continuously, with final rounding only to 1P", () => {
    const base = computeOpenRouterTurnCost(30_000, 3_000, modelId);
    const plusOneInput = computeOpenRouterTurnCost(30_001, 3_000, modelId);
    const plusOneOutput = computeOpenRouterTurnCost(30_000, 3_001, modelId);
    assert.ok(plusOneInput >= base);
    assert.ok(plusOneOutput >= base);
    assert.ok(plusOneInput - base <= 1);
    assert.ok(plusOneOutput - base <= 1);

    const rates = resolveOpenRouterReasoningPointRates(modelId);
    assert.ok(rates);
    assert.ok(rates.inputPointsPerToken > 0);
    assert.ok(rates.outputPointsPerToken > rates.inputPointsPerToken);
  });

  it("live catalog and cache usage feed the same common cost-plus-margin formula", () => {
    updateCheaperInferenceCatalogPricing({
      modelId,
      inputUsdPerMillion: 0.525,
      cacheReadUsdPerMillion: 0.0525,
      cacheWriteUsdPerMillion: 0.525,
      outputUsdPerMillion: 2.625,
      discountPercent: 30,
      fetchedAt: Date.now(),
    });
    const cold = computeOpenRouterTurnBilling({
      modelId,
      inputTokens: 50_000,
      outputTokens: 3_000,
      cacheReadTokens: 0,
      apiPromptTokens: 50_000,
      apiCompletionTokens: 3_000,
    });
    const warm = computeOpenRouterTurnBilling({
      modelId,
      inputTokens: 50_000,
      outputTokens: 3_000,
      cacheReadTokens: 40_000,
      apiPromptTokens: 50_000,
      apiCompletionTokens: 3_000,
    });
    assert.ok(warm.total < cold.total, "cache discount should flow through the shared owner");
  });

  it("provider-reported upstream cost is authoritative, matching G3.1/Opus/DeepSeek", () => {
    const billing = computeOpenRouterTurnBilling({
      modelId,
      inputTokens: 50_000,
      outputTokens: 3_000,
      apiPromptTokens: 50_000,
      apiCompletionTokens: 3_000,
      upstreamCostUsd: 0.0315,
    });
    const rates = resolveOpenRouterReasoningPointRates(modelId);
    assert.ok(rates);
    assert.equal(
      billing.total,
      expectedPoints(0.0315, rates.effectiveKrwPerUsd)
    );
  });

  it("has no Gemini 3.7-specific stepped-price owner or receipt breakdown", () => {
    assert.equal("resolveGemini37FlashFinalUserCharge" in points, false);
    assert.equal("explainOpenRouterGemini37TurnCost" in points, false);

    const receipt = buildBillingReceipt({
      cost: 70,
      apiInputTokens: 53_823,
      apiOutputTokens: 4_444,
      modelLabel: "Gemini 3.7 Flash",
      model: modelId,
      provider: "cheaperinference" as const,
    });
    assert.ok(receipt);
    const admin = formatBillingReceiptText(receipt!);
    assert.doesNotMatch(admin, /base:|output surcharge:|long-context surcharge:/i);
    assert.match(admin, /Gemini 3\.7 Flash/);
  });
});
