import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OPENROUTER_DEEPSEEK_GROSS_MARGIN,
  OPENROUTER_DEEPSEEK_POINTS_PER_OUTPUT_TOKEN,
  computeOpenRouterTurnCost,
  explainOpenRouterDeepSeekTurnCost,
} from "@/lib/points";
import { OPENROUTER_DEEPSEEK_V4_PRO_MODEL } from "@/lib/chatModels";

describe("DeepSeek V4 Pro billing", () => {
  const modelId = OPENROUTER_DEEPSEEK_V4_PRO_MODEL;

  it("uses 0.022P per output token and 55% gross margin floor", () => {
    assert.equal(OPENROUTER_DEEPSEEK_POINTS_PER_OUTPUT_TOKEN, 0.022);
    assert.equal(OPENROUTER_DEEPSEEK_GROSS_MARGIN, 0.55);
  });

  it("token floor = outputTokens × 0.022", () => {
    const outputTokens = 2013;
    const explain = explainOpenRouterDeepSeekTurnCost(17_707, outputTokens, modelId);
    assert.equal(explain.charFloorKrw, Math.ceil(outputTokens * 0.022 - 1e-9));
  });

  it("margin charge = rawCost ÷ 0.45", () => {
    const explain = explainOpenRouterDeepSeekTurnCost(100, 500, modelId);
    const marginDivisor = 1 - OPENROUTER_DEEPSEEK_GROSS_MARGIN;
    assert.equal(
      explain.costPlusMarginKrw,
      Math.ceil(explain.rawCostKrw / marginDivisor - 1e-9)
    );
  });

  it("charges max(token floor, margin on API cost)", () => {
    const lowUsage = computeOpenRouterTurnCost(100, 2013, modelId);
    const explain = explainOpenRouterDeepSeekTurnCost(100, 2013, modelId);
    assert.equal(lowUsage, Math.max(explain.charFloorKrw, explain.costPlusMarginKrw, 5));
  });
});
