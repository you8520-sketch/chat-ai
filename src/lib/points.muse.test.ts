import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OPENROUTER_MUSE_POINTS_PER_OUTPUT_TOKEN,
  MUSE_WAIVER_SUCCESS_MIN_COST,
  computeOpenRouterTurnCost,
  explainOpenRouterMuseTurnCost,
  resolveMuseWaiverMinimumCharge,
} from "@/lib/points";
import { OPENROUTER_MUSE_SPARK_11_MODEL } from "@/lib/chatModels";

describe("Muse Spark 1.1 billing", () => {
  const modelId = OPENROUTER_MUSE_SPARK_11_MODEL;

  it("uses 0.06P per output token", () => {
    assert.equal(OPENROUTER_MUSE_POINTS_PER_OUTPUT_TOKEN, 0.06);
    assert.equal(MUSE_WAIVER_SUCCESS_MIN_COST, 50);
  });

  it("token floor = outputTokens × 0.06", () => {
    const outputTokens = 2000;
    const explain = explainOpenRouterMuseTurnCost(1000, outputTokens, modelId);
    assert.equal(explain.charFloorKrw, Math.ceil(outputTokens * 0.06 - 1e-9));
    assert.equal(explain.costPlusMarginKrw, 0);
  });

  it("charges output token floor only", () => {
    const outputTokens = 2000;
    const lowUsage = computeOpenRouterTurnCost(100, outputTokens, modelId);
    const explain = explainOpenRouterMuseTurnCost(100, outputTokens, modelId);
    assert.equal(lowUsage, explain.total);
  });

  it("waiver with meaningful text charges minimum 50P", () => {
    const prose = "그는 창가에 서서 빗소리를 들었다. ".repeat(40);
    const min = resolveMuseWaiverMinimumCharge(prose, "forced_abort");
    assert.equal(min, 50);
  });
});
