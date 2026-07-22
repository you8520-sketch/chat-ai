import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OPENROUTER_DEEPSEEK_POINTS_PER_OUTPUT_TOKEN,
  computeOpenRouterTurnCost,
  explainOpenRouterDeepSeekTurnCost,
  openRouterInputTokenSurchargeKrw,
} from "@/lib/points";
import { OPENROUTER_DEEPSEEK_V4_PRO_MODEL } from "@/lib/chatModels";

describe("DeepSeek V4 Pro billing", () => {
  const modelId = OPENROUTER_DEEPSEEK_V4_PRO_MODEL;

  it("uses 0.018P per output token", () => {
    assert.equal(OPENROUTER_DEEPSEEK_POINTS_PER_OUTPUT_TOKEN, 0.018);
  });

  it("token charge = outputTokens × 0.018", () => {
    const inputTokens = 17_707;
    const outputTokens = 2013;
    const explain = explainOpenRouterDeepSeekTurnCost(inputTokens, outputTokens, modelId);
    assert.equal(explain.charFloorKrw, Math.ceil(outputTokens * 0.018 - 1e-9));
    assert.equal(explain.costPlusMarginKrw, 0);
    assert.equal(
      explain.inputSurchargeKrw,
      openRouterInputTokenSurchargeKrw(inputTokens, modelId)
    );
    assert.equal(
      explain.total,
      Math.max(Math.ceil(explain.charFloorKrw + explain.inputSurchargeKrw! - 1e-9), 5)
    );
  });

  it("charges output token floor only", () => {
    const outputTokens = 2013;
    const lowUsage = computeOpenRouterTurnCost(100, outputTokens, modelId);
    const explain = explainOpenRouterDeepSeekTurnCost(100, outputTokens, modelId);
    assert.equal(lowUsage, explain.total);
  });
});
