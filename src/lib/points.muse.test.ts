import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MUSE_WAIVER_SUCCESS_MIN_COST,
  OPENROUTER_MUSE_INPUT_POINTS_PER_TOKEN,
  OPENROUTER_MUSE_OUTPUT_POINTS_PER_TOKEN,
  OPENROUTER_SIMPLE_POINT_INPUT_SURCHARGE_PER_1000,
  computeOpenRouterTurnCost,
  explainOpenRouterMuseTurnCost,
  resolveOpenRouterSimplePointPrices,
  resolveMuseWaiverMinimumCharge,
} from "@/lib/points";
import { OPENROUTER_MUSE_SPARK_11_MODEL } from "@/lib/chatModels";

function expectedSimplePointCost(
  inputTokens: number,
  outputTokens: number,
  reasoningTokens: number
): number {
  const prices = resolveOpenRouterSimplePointPrices(
    OPENROUTER_MUSE_SPARK_11_MODEL,
    9999
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

describe("Muse Spark 1.1 dual-rate simple point billing", () => {
  const modelId = OPENROUTER_MUSE_SPARK_11_MODEL;
  it("uses the configured token prices for the 60% target margin", () => {
    const prices = resolveOpenRouterSimplePointPrices(modelId, 9999)!;
    assert.equal(OPENROUTER_MUSE_INPUT_POINTS_PER_TOKEN, 0.0048);
    assert.equal(OPENROUTER_MUSE_OUTPUT_POINTS_PER_TOKEN, 0.0163);
    assert.equal(
      prices.inputPointsPerToken,
      OPENROUTER_MUSE_INPUT_POINTS_PER_TOKEN
    );
    assert.equal(
      prices.outputPointsPerToken,
      OPENROUTER_MUSE_OUTPUT_POINTS_PER_TOKEN
    );
    assert.equal(prices.grossMargin, 0.6);
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

  it("keeps the current 2,070-token billing basis and changes rates only", () => {
    const inputTokens = 15_233;
    const billedOutputTokensExcludingThinking = 1_863;
    const thinkingTokens = 207;
    assert.equal(billedOutputTokensExcludingThinking + thinkingTokens, 2_070);

    const expected = expectedSimplePointCost(
      inputTokens,
      billedOutputTokensExcludingThinking,
      thinkingTokens
    );
    const total = computeOpenRouterTurnCost(
      inputTokens,
      billedOutputTokensExcludingThinking,
      modelId,
      undefined,
      { reasoningTokens: thinkingTokens }
    );
    assert.equal(total, expected);
    assert.equal(total, 115);
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
