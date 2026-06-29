import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OPENROUTER_QWEN_POINTS_PER_OUTPUT_TOKEN,
  QWEN_WAIVER_SUCCESS_MIN_COST,
  computeOpenRouterTurnCost,
  explainOpenRouterQwenTurnCost,
  resolveQwenWaiverMinimumCharge,
} from "@/lib/points";
import { OPENROUTER_QWEN_37_MAX_MODEL } from "@/lib/chatModels";

describe("Qwen 3.7 billing", () => {
  const modelId = OPENROUTER_QWEN_37_MAX_MODEL;

  it("uses 0.062P per output token", () => {
    assert.equal(OPENROUTER_QWEN_POINTS_PER_OUTPUT_TOKEN, 0.062);
    assert.equal(QWEN_WAIVER_SUCCESS_MIN_COST, 50);
  });

  it("token floor = outputTokens × 0.062", () => {
    const outputTokens = 2000;
    const explain = explainOpenRouterQwenTurnCost(1000, outputTokens, modelId);
    assert.equal(explain.charFloorKrw, Math.ceil(outputTokens * 0.062 - 1e-9));
    assert.equal(explain.costPlusMarginKrw, 0);
  });

  it("charges output token floor only", () => {
    const outputTokens = 2000;
    const lowUsage = computeOpenRouterTurnCost(100, outputTokens, modelId);
    const explain = explainOpenRouterQwenTurnCost(100, outputTokens, modelId);
    assert.equal(lowUsage, explain.total);
  });

  it("waiver with meaningful text charges minimum 50P", () => {
    const min = resolveQwenWaiverMinimumCharge(
      "유의미한 본문이 있는 응답입니다.",
      "forced_abort"
    );
    assert.equal(min, 50);
  });
});
