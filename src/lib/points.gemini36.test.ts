import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GEMINI_36_WAIVER_SUCCESS_MIN_COST,
  OPENROUTER_SIMPLE_POINT_INPUT_SURCHARGE_PER_1000,
  computeOpenRouterTurnCost,
  computeTurnBilling,
  explainOpenRouterGemini36TurnCost,
  resolveOpenRouterSimplePointPrices,
  resolveGemini36WaiverMinimumCharge,
} from "@/lib/points";
import { OPENROUTER_GEMINI_36_FLASH_MODEL } from "@/lib/chatModels";

function expectedSimplePointCost(
  inputTokens: number,
  outputTokens: number,
  reasoningTokens: number
): number {
  const prices = resolveOpenRouterSimplePointPrices(
    OPENROUTER_GEMINI_36_FLASH_MODEL,
    1530
  )!;
  const inputTokCost = inputTokens * prices.inputPointsPerToken;
  const inputSurcharge =
    inputTokens >= 10000
      ? (inputTokens / 1000) * OPENROUTER_SIMPLE_POINT_INPUT_SURCHARGE_PER_1000
      : 0;
  const outputCost =
    (outputTokens + reasoningTokens) * prices.outputPointsPerToken;
  const total = inputTokCost + inputSurcharge + outputCost;
  return Number.isInteger(total) ? total : Math.ceil(total - 1e-9);
}

describe("OpenRouter Gemini 3.6 Flash dual-rate simple point billing", () => {
  const modelId = OPENROUTER_GEMINI_36_FLASH_MODEL;
  it("uses exchange-rate-derived token prices (50% target margin)", () => {
    const prices = resolveOpenRouterSimplePointPrices(modelId, 1530)!;
    assert.equal(prices.inputPointsPerToken, (1.5 * 1530) / 1_000_000 / 0.5);
    assert.equal(prices.outputPointsPerToken, (7.5 * 1530) / 1_000_000 / 0.5);
    assert.equal(prices.grossMargin, 0.5);
    assert.equal(GEMINI_36_WAIVER_SUCCESS_MIN_COST, 50);
  });

  it("charges inputP/tok + optional 0.5P/1k (≥10k) + outputP/tok", () => {
    const inputTokens = 20_000;
    const outputTokens = 2000;
    const expected = expectedSimplePointCost(inputTokens, outputTokens, 0);
    const explain = explainOpenRouterGemini36TurnCost(
      inputTokens,
      outputTokens,
      modelId
    );
    assert.equal(explain.rawCostKrw, 0);
    assert.equal(explain.charFloorKrw, 0);
    assert.equal(explain.costPlusMarginKrw, 0);
    assert.equal(explain.applied, "cost_plus_margin");
    assert.equal(explain.total, expected);
    assert.equal(computeOpenRouterTurnCost(inputTokens, outputTokens, modelId), expected);
  });

  it("ignores cache and upstream cost; bills reasoning with output", () => {
    const outputTokens = 400;
    const reasoningTokens = 2000;
    const withProviderDetails = explainOpenRouterGemini36TurnCost(
      100,
      outputTokens,
      modelId,
      undefined,
      undefined,
      reasoningTokens
    );
    const withoutProviderDetails = explainOpenRouterGemini36TurnCost(
      100,
      outputTokens,
      modelId
    );
    const billing = computeTurnBilling({
      provider: "openrouter",
      openRouterModelId: modelId,
      inputTokens: 100,
      outputTokens,
      reasoningTokens,
      upstreamCostUsd: 0.066,
      apiPromptTokens: 12_000,
      apiCompletionTokens: 2500,
      userContextChars: 8000,
    });
    const expectedWithReasoning = expectedSimplePointCost(100, outputTokens, reasoningTokens);
    const expectedWithoutReasoning = expectedSimplePointCost(100, outputTokens, 0);

    assert.equal(billing.contextSurcharge, 0);
    assert.equal(billing.total, withProviderDetails.total);
    assert.equal(withProviderDetails.total, expectedWithReasoning);
    assert.equal(withoutProviderDetails.total, expectedWithoutReasoning);
    assert.ok(withProviderDetails.total > withoutProviderDetails.total);
  });

  it("charges more when visible input grows", () => {
    const shortInput = computeOpenRouterTurnCost(5000, 400, modelId);
    const longInput = computeOpenRouterTurnCost(50_000, 400, modelId);
    assert.ok(longInput > shortInput);
  });

  it("bills reasoning tokens together with output tokens", () => {
    const inputTokens = 20_000;
    const outputTokens = 2000;
    const reasoningTokens = 1500;
    const expected = expectedSimplePointCost(inputTokens, outputTokens, reasoningTokens);
    const explain = explainOpenRouterGemini36TurnCost(
      inputTokens,
      outputTokens,
      modelId,
      undefined,
      undefined,
      reasoningTokens
    );
    assert.equal(explain.total, expected);
    assert.ok(explain.total > computeOpenRouterTurnCost(inputTokens, outputTokens, modelId));
  });

  it("charges the 50P waiver minimum for meaningful interrupted output", () => {
    const prose = "그는 창가에 서서 빗소리를 들었다. ".repeat(40);
    assert.equal(resolveGemini36WaiverMinimumCharge(prose, "forced_abort"), 50);
  });
});
