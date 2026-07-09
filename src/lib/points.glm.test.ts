import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OPENROUTER_GLM_POINTS_PER_OUTPUT_TOKEN,
  GLM_WAIVER_SUCCESS_MIN_COST,
  computeOpenRouterTurnCost,
  explainOpenRouterGlmTurnCost,
  resolveGlmWaiverMinimumCharge,
} from "@/lib/points";
import { OPENROUTER_GLM_52_MODEL } from "@/lib/chatModels";

describe("GLM 5.2 billing", () => {
  const modelId = OPENROUTER_GLM_52_MODEL;

  it("uses 0.028P per output token", () => {
    assert.equal(OPENROUTER_GLM_POINTS_PER_OUTPUT_TOKEN, 0.028);
    assert.equal(GLM_WAIVER_SUCCESS_MIN_COST, 50);
  });

  it("token floor = outputTokens × 0.028", () => {
    const outputTokens = 2000;
    const explain = explainOpenRouterGlmTurnCost(1000, outputTokens, modelId);
    assert.equal(explain.charFloorKrw, Math.ceil(outputTokens * 0.028 - 1e-9));
    assert.equal(explain.costPlusMarginKrw, 0);
  });

  it("charges output token floor only", () => {
    const outputTokens = 2000;
    const lowUsage = computeOpenRouterTurnCost(100, outputTokens, modelId);
    const explain = explainOpenRouterGlmTurnCost(100, outputTokens, modelId);
    assert.equal(lowUsage, explain.total);
  });

  it("waiver with meaningful text charges minimum 50P", () => {
    const prose = "그는 창가에 서서 빗소리를 들었다. ".repeat(40);
    const min = resolveGlmWaiverMinimumCharge(prose, "forced_abort");
    assert.equal(min, 50);
  });
});
