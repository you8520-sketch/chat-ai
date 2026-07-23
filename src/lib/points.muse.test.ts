import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OPENROUTER_MUSE_GROSS_MARGIN,
  OPENROUTER_MIN_TURN_COST,
  MUSE_WAIVER_SUCCESS_MIN_COST,
  computeOpenRouterTurnCost,
  explainOpenRouterMuseTurnCost,
  resolveMuseWaiverMinimumCharge,
} from "@/lib/points";
import { OPENROUTER_MUSE_SPARK_11_MODEL } from "@/lib/chatModels";
import { resolveOpenRouterBillingRawCostKrw } from "@/lib/billingRawCost";

describe("Muse Spark 1.1 billing", () => {
  const modelId = OPENROUTER_MUSE_SPARK_11_MODEL;

  it("uses one 55% gross-margin owner", () => {
    assert.equal(OPENROUTER_MUSE_GROSS_MARGIN, 0.55);
    assert.equal(MUSE_WAIVER_SUCCESS_MIN_COST, 50);
  });

  it("charges standard list input and visible output divided by 0.45", () => {
    const inputTokens = 20_000;
    const outputTokens = 2000;
    const raw = resolveOpenRouterBillingRawCostKrw({
      promptTokens: inputTokens,
      outputTokens,
      modelId,
    });
    const expected = Math.max(
      OPENROUTER_MIN_TURN_COST,
      Math.ceil(raw / (1 - OPENROUTER_MUSE_GROSS_MARGIN) - 1e-9)
    );
    const explain = explainOpenRouterMuseTurnCost(inputTokens, outputTokens, modelId);
    assert.equal(explain.rawCostKrw, raw);
    assert.equal(explain.charFloorKrw, 0);
    assert.equal(explain.costPlusMarginKrw, expected);
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

  it("waiver with meaningful text charges minimum 50P", () => {
    const prose = "그는 창가에 서서 빗소리를 들었다. ".repeat(40);
    const min = resolveMuseWaiverMinimumCharge(prose, "forced_abort");
    assert.equal(min, 50);
  });
});
