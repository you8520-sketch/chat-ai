import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OPENROUTER_DEEPSEEK_POINTS_PER_OUTPUT_TOKEN,
  computeOpenRouterTurnCost,
  explainOpenRouterDeepSeekTurnCost,
} from "@/lib/points";
import { OPENROUTER_DEEPSEEK_V4_PRO_MODEL } from "@/lib/chatModels";

describe("DeepSeek V4 Pro billing", () => {
  const modelId = OPENROUTER_DEEPSEEK_V4_PRO_MODEL;

  it("uses 0.022P per output token", () => {
    assert.equal(OPENROUTER_DEEPSEEK_POINTS_PER_OUTPUT_TOKEN, 0.022);
  });

  it("token charge = outputTokens × 0.022", () => {
    const outputTokens = 2013;
    const explain = explainOpenRouterDeepSeekTurnCost(17_707, outputTokens, modelId);
    assert.equal(explain.charFloorKrw, Math.ceil(outputTokens * 0.022 - 1e-9));
    assert.equal(explain.costPlusMarginKrw, 0);
    assert.equal(explain.total, Math.max(explain.charFloorKrw, 5));
  });

  it("charges output token floor only", () => {
    const outputTokens = 2013;
    const lowUsage = computeOpenRouterTurnCost(100, outputTokens, modelId);
    const explain = explainOpenRouterDeepSeekTurnCost(100, outputTokens, modelId);
    assert.equal(lowUsage, explain.total);
  });
});
