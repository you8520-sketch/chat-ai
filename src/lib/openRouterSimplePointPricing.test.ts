import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
  OPENROUTER_GEMINI_36_FLASH_MODEL,
  OPENROUTER_MUSE_SPARK_11_MODEL,
  OPENROUTER_TENCENT_HY3_MODEL,
} from "./chatModels";
import { resolveOpenRouterModelRates } from "./openRouterModelPricing";
import {
  OPENROUTER_MUSE_INPUT_POINTS_PER_TOKEN,
  OPENROUTER_MUSE_OUTPUT_POINTS_PER_TOKEN,
  resolveOpenRouterSimplePointPrices,
} from "./openRouterSimplePointPricing";

const FIXED_EFFECTIVE_KRW_PER_USD = 1492;

function assertTargetMargin(modelId: string, expectedMargin: number): void {
  const costs = resolveOpenRouterModelRates(modelId);
  const prices = resolveOpenRouterSimplePointPrices(
    modelId,
    FIXED_EFFECTIVE_KRW_PER_USD
  )!;
  const inputCostPerToken =
    (costs.inputUsdPerM * FIXED_EFFECTIVE_KRW_PER_USD) / 1_000_000;
  const outputCostPerToken =
    (costs.outputUsdPerM * FIXED_EFFECTIVE_KRW_PER_USD) / 1_000_000;

  assert.ok(
    Math.abs(1 - inputCostPerToken / prices.inputPointsPerToken - expectedMargin) <
      1e-12
  );
  assert.ok(
    Math.abs(1 - outputCostPerToken / prices.outputPointsPerToken - expectedMargin) <
      1e-12
  );
}

describe("OpenRouter exchange-rate simple-point pricing", () => {
  it("derives Hy3, DeepSeek V4 Pro, and Gemini 3.6 Flash prices from target margins", () => {
    assertTargetMargin(OPENROUTER_TENCENT_HY3_MODEL, 0.7);
    assertTargetMargin(OPENROUTER_DEEPSEEK_V4_PRO_MODEL, 0.65);
    assertTargetMargin(OPENROUTER_GEMINI_36_FLASH_MODEL, 0.5);
  });

  it("changes dynamic sale prices when the injected effective exchange rate changes", () => {
    const low = resolveOpenRouterSimplePointPrices(
      OPENROUTER_TENCENT_HY3_MODEL,
      1400
    )!;
    const high = resolveOpenRouterSimplePointPrices(
      OPENROUTER_TENCENT_HY3_MODEL,
      1600
    )!;

    assert.ok(high.inputPointsPerToken > low.inputPointsPerToken);
    assert.ok(high.outputPointsPerToken > low.outputPointsPerToken);
  });

  it("keeps Muse fixed regardless of the injected exchange rate", () => {
    const low = resolveOpenRouterSimplePointPrices(
      OPENROUTER_MUSE_SPARK_11_MODEL,
      1400
    )!;
    const high = resolveOpenRouterSimplePointPrices(
      OPENROUTER_MUSE_SPARK_11_MODEL,
      1600
    )!;

    assert.equal(low.inputPointsPerToken, OPENROUTER_MUSE_INPUT_POINTS_PER_TOKEN);
    assert.equal(low.outputPointsPerToken, OPENROUTER_MUSE_OUTPUT_POINTS_PER_TOKEN);
    assert.deepEqual(low, { ...high, effectiveKrwPerUsd: 1400 });
  });
});
