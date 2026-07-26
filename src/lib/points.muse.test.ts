import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MUSE_WAIVER_SUCCESS_MIN_COST,
  OPENROUTER_SIMPLE_POINT_OUTPUT_PRICES,
  OPENROUTER_MIN_TURN_COST,
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
  const price = OPENROUTER_SIMPLE_POINT_OUTPUT_PRICES[OPENROUTER_MUSE_SPARK_11_MODEL];
  const inputCost = inputTokens >= 10000 ? (inputTokens / 1000) * 0.5 : 0;
  const outputCost = (outputTokens + reasoningTokens) * price;
  const total = inputCost + outputCost;
  return Number.isInteger(total) ? total : Math.ceil(total - 1e-9);
}

describe("Muse Spark 1.1 simple point billing", () => {
  const modelId = OPENROUTER_MUSE_SPARK_11_MODEL;
  const price = OPENROUTER_SIMPLE_POINT_OUTPUT_PRICES[modelId];

  it("uses the configured output token price", () => {
    assert.equal(price, 0.0156);
    assert.equal(MUSE_WAIVER_SUCCESS_MIN_COST, 50);
  });

  it("charges input 0.5P/1k when input >= 10k and output price per token", () => {
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

  it("bills reasoning tokens together with output tokens", () => {
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
