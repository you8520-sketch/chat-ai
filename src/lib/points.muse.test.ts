import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MUSE_WAIVER_SUCCESS_MIN_COST,
  OPENROUTER_MUSE_INPUT_POINTS_PER_TOKEN,
  OPENROUTER_MUSE_OUTPUT_POINTS_PER_TOKEN,
  OPENROUTER_SIMPLE_POINT_INPUT_PRICES,
  OPENROUTER_SIMPLE_POINT_INPUT_SURCHARGE_PER_1000,
  OPENROUTER_SIMPLE_POINT_OUTPUT_PRICES,
  computeOpenRouterTurnCost,
  explainOpenRouterMuseTurnCost,
  resolveMuseWaiverMinimumCharge,
} from "@/lib/points";
import { OPENROUTER_MUSE_SPARK_11_MODEL } from "@/lib/chatModels";

function expectedSimplePointCost(
  inputTokens: number,
  outputTokens: number,
  reasoningTokens: number
): number {
  const inputPrice = OPENROUTER_SIMPLE_POINT_INPUT_PRICES[OPENROUTER_MUSE_SPARK_11_MODEL];
  const outputPrice = OPENROUTER_SIMPLE_POINT_OUTPUT_PRICES[OPENROUTER_MUSE_SPARK_11_MODEL];
  const inputTokCost = inputTokens * inputPrice;
  const inputSurcharge =
    inputTokens >= 10000
      ? (inputTokens / 1000) * OPENROUTER_SIMPLE_POINT_INPUT_SURCHARGE_PER_1000
      : 0;
  const outputCost = (outputTokens + reasoningTokens) * outputPrice;
  const total = inputTokCost + inputSurcharge + outputCost;
  return Number.isInteger(total) ? total : Math.ceil(total - 1e-9);
}

describe("Muse Spark 1.1 dual-rate simple point billing", () => {
  const modelId = OPENROUTER_MUSE_SPARK_11_MODEL;
  const inputPrice = OPENROUTER_SIMPLE_POINT_INPUT_PRICES[modelId];
  const outputPrice = OPENROUTER_SIMPLE_POINT_OUTPUT_PRICES[modelId];

  it("uses the configured token prices for the 60% target margin", () => {
    assert.equal(OPENROUTER_MUSE_INPUT_POINTS_PER_TOKEN, 0.0048);
    assert.equal(OPENROUTER_MUSE_OUTPUT_POINTS_PER_TOKEN, 0.0163);
    assert.equal(inputPrice, OPENROUTER_MUSE_INPUT_POINTS_PER_TOKEN);
    assert.equal(outputPrice, OPENROUTER_MUSE_OUTPUT_POINTS_PER_TOKEN);
    assert.equal(MUSE_WAIVER_SUCCESS_MIN_COST, 50);
  });

  it("charges inputP/tok + existing large-context surcharge + outputP/tok", () => {
    const inputTokens = 20_000;
    const outputTokens = 2000;
    const expected = expectedSimplePointCost(inputTokens, outputTokens, 0);
    const explain = explainOpenRouterMuseTurnCost(inputTokens, outputTokens, modelId);
    assert.equal(explain.rawCostKrw, 0);
    assert.equal(explain.charFloorKrw, 0);
    assert.equal(explain.costPlusMarginKrw, 0);
    assert.equal(explain.applied, "cost_plus_margin");
    assert.equal(explain.total, expected);
    assert.equal(computeOpenRouterTurnCost(inputTokens, outputTokens, modelId), expected);
  });

  it("lands at 90P on the recommended Muse receipt shape", () => {
    const total = computeOpenRouterTurnCost(11_524, 1_142, modelId, undefined, {
      reasoningTokens: 624,
    });
    assert.equal(total, 90);
  });

  it("uses only the existing input/content/thinking token split from the current receipt", () => {
    const inputTokens = 15_233;
    const contentTokens = 1_159;
    const thinkingTokens = 207;
    const expected = expectedSimplePointCost(inputTokens, contentTokens, thinkingTokens);
    const total = computeOpenRouterTurnCost(inputTokens, contentTokens, modelId, undefined, {
      reasoningTokens: thinkingTokens,
    });
    assert.equal(total, expected);
    assert.equal(total, 104);
  });

  it("increases with visible input/output but not cache state", () => {
    const outputTokens = 2000;
    const shortNoCache = computeOpenRouterTurnCost(5000, outputTokens, modelId);
    const longNoCache = computeOpenRouterTurnCost(50_000, outputTokens, modelId);
    const longCacheHit = computeOpenRouterTurnCost(50_000, outputTokens, modelId, {
      cacheReadTokens: 18_000,
    });
    assert.ok(longNoCache > shortNoCache);
    assert.equal(longCacheHit, longNoCache);
  });

  it("bills thinking tokens with the same rate as output tokens", () => {
    const inputTokens = 20_000;
    const outputTokens = 2000;
    const reasoningTokens = 500;
    const expected = expectedSimplePointCost(inputTokens, outputTokens, reasoningTokens);
    const explain = explainOpenRouterMuseTurnCost(
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

  it("waiver with meaningful text charges minimum 50P", () => {
    const prose = "그는 창가에 서서 빗소리를 들었다. ".repeat(40);
    const min = resolveMuseWaiverMinimumCharge(prose, "forced_abort");
    assert.equal(min, 50);
  });
});
