import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OPENROUTER_SIMPLE_POINT_INPUT_PRICES,
  OPENROUTER_SIMPLE_POINT_INPUT_SURCHARGE_PER_1000,
  OPENROUTER_SIMPLE_POINT_OUTPUT_PRICES,
  computeOpenRouterTurnBilling,
  computeOpenRouterTurnCost,
  explainOpenRouterTencentHy3TurnCost,
} from "@/lib/points";
import { OPENROUTER_TENCENT_HY3_MODEL } from "@/lib/chatModels";

function expectedSimplePointCost(
  inputTokens: number,
  outputTokens: number,
  reasoningTokens: number
): number {
  const inputPrice = OPENROUTER_SIMPLE_POINT_INPUT_PRICES[OPENROUTER_TENCENT_HY3_MODEL];
  const outputPrice = OPENROUTER_SIMPLE_POINT_OUTPUT_PRICES[OPENROUTER_TENCENT_HY3_MODEL];
  const inputTokCost = inputTokens * inputPrice;
  const inputSurcharge =
    inputTokens >= 10000
      ? (inputTokens / 1000) * OPENROUTER_SIMPLE_POINT_INPUT_SURCHARGE_PER_1000
      : 0;
  const outputCost = (outputTokens + reasoningTokens) * outputPrice;
  const total = inputTokCost + inputSurcharge + outputCost;
  return Number.isInteger(total) ? total : Math.ceil(total - 1e-9);
}

describe("Tencent Hy3 dual-rate simple point billing", () => {
  const modelId = OPENROUTER_TENCENT_HY3_MODEL;
  const inputPrice = OPENROUTER_SIMPLE_POINT_INPUT_PRICES[modelId];
  const outputPrice = OPENROUTER_SIMPLE_POINT_OUTPUT_PRICES[modelId];

  it("uses the configured dual-rate token prices (70% target margin)", () => {
    assert.equal(inputPrice, 0.00071);
    assert.equal(outputPrice, 0.003);
  });

  it("charges inputP/tok + optional 0.5P/1k (≥10k) + outputP/tok", () => {
    const inputTokens = 17_707;
    const outputTokens = 2013;
    const expected = expectedSimplePointCost(inputTokens, outputTokens, 0);
    const explain = explainOpenRouterTencentHy3TurnCost(
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

  it("charges the same points for the same tokens regardless of cache or provider cost", () => {
    const inputTokens = 20_000;
    const outputTokens = 2000;
    const noCache = computeOpenRouterTurnCost(inputTokens, outputTokens, modelId);
    const cacheHit = computeOpenRouterTurnCost(inputTokens, outputTokens, modelId, {
      cacheReadTokens: 18_000,
    });
    const cheapCached = computeOpenRouterTurnBilling({
      modelId,
      inputTokens,
      outputTokens,
      upstreamCostUsd: 0.001,
    });
    const expensiveUncached = computeOpenRouterTurnBilling({
      modelId,
      inputTokens,
      outputTokens,
      upstreamCostUsd: 0.1,
    });

    assert.equal(cacheHit, noCache);
    assert.equal(cheapCached.total, noCache);
    assert.equal(expensiveUncached.total, noCache);
  });

  it("bills reasoning tokens together with output tokens", () => {
    const inputTokens = 20_000;
    const outputTokens = 2000;
    const reasoningTokens = 1000;
    const expected = expectedSimplePointCost(inputTokens, outputTokens, reasoningTokens);
    const billing = computeOpenRouterTurnBilling({
      modelId,
      inputTokens,
      outputTokens,
      reasoningTokens,
    });

    assert.equal(billing.total, expected);
    assert.ok(billing.total > computeOpenRouterTurnCost(inputTokens, outputTokens, modelId));
  });
});
