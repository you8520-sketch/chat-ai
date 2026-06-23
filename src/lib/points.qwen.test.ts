import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OPENROUTER_QWEN_GROSS_MARGIN,
  OPENROUTER_QWEN_POINTS_PER_OUTPUT_TOKEN,
  computeOpenRouterTurnCost,
  explainOpenRouterQwenTurnCost,
} from "@/lib/points";
import { OPENROUTER_QWEN_37_MAX_MODEL } from "@/lib/chatModels";

describe("Qwen 3.7 billing", () => {
  const modelId = OPENROUTER_QWEN_37_MAX_MODEL;

  it("uses 0.07P per output token and 45% gross margin floor", () => {
    assert.equal(OPENROUTER_QWEN_POINTS_PER_OUTPUT_TOKEN, 0.07);
    assert.equal(OPENROUTER_QWEN_GROSS_MARGIN, 0.45);
  });

  it("token floor = outputTokens × 0.07", () => {
    const outputTokens = 2000;
    const explain = explainOpenRouterQwenTurnCost(1000, outputTokens, modelId);
    assert.equal(explain.charFloorKrw, Math.ceil(outputTokens * 0.07 - 1e-9));
  });

  it("margin charge = rawCost ÷ 0.55", () => {
    const explain = explainOpenRouterQwenTurnCost(100, 500, modelId);
    const marginDivisor = 1 - OPENROUTER_QWEN_GROSS_MARGIN;
    assert.equal(
      explain.costPlusMarginKrw,
      Math.ceil(explain.rawCostKrw / marginDivisor - 1e-9)
    );
  });

  it("charges max(token floor, margin on API cost)", () => {
    const outputTokens = 2000;
    const lowUsage = computeOpenRouterTurnCost(100, outputTokens, modelId);
    const explain = explainOpenRouterQwenTurnCost(100, outputTokens, modelId);
    assert.equal(lowUsage, Math.max(explain.charFloorKrw, explain.costPlusMarginKrw, 5));
  });
});
