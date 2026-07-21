import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OPENROUTER_GEMINI_25_POINTS_PER_OUTPUT_TOKEN,
  GEMINI_25_WAIVER_SUCCESS_MIN_COST,
  computeOpenRouterTurnCost,
  computeTurnBilling,
  explainOpenRouterGemini25TurnCost,
  resolveGemini25WaiverMinimumCharge,
} from "@/lib/points";
import { OPENROUTER_GEMINI_25_PRO_MODEL } from "@/lib/chatModels";

describe("OpenRouter Gemini 2.5 Pro billing", () => {
  const modelId = OPENROUTER_GEMINI_25_PRO_MODEL;

  it("uses 0.06P per output token", () => {
    assert.equal(OPENROUTER_GEMINI_25_POINTS_PER_OUTPUT_TOKEN, 0.06);
    assert.equal(GEMINI_25_WAIVER_SUCCESS_MIN_COST, 50);
  });

  it("token floor = outputTokens × 0.06", () => {
    const outputTokens = 2000;
    const explain = explainOpenRouterGemini25TurnCost(1000, outputTokens, modelId);
    assert.equal(explain.charFloorKrw, Math.ceil(outputTokens * 0.06 - 1e-9));
    assert.equal(explain.costPlusMarginKrw, 0);
  });

  it("charges output token floor only", () => {
    const outputTokens = 2000;
    const lowUsage = computeOpenRouterTurnCost(100, outputTokens, modelId);
    const explain = explainOpenRouterGemini25TurnCost(100, outputTokens, modelId);
    assert.equal(lowUsage, explain.total);
  });

  it("charges from upstream USD for receipt raw cost only", () => {
    const upstreamCostUsd = 0.066;
    const outputTokens = 400;
    const withUpstream = explainOpenRouterGemini25TurnCost(100, outputTokens, modelId, undefined, {
      upstreamCostUsd,
      apiPromptTokens: 12000,
      apiCompletionTokens: 2500,
    });
    assert.ok(withUpstream.rawCostKrw > 0);
    const billing = computeTurnBilling({
      provider: "openrouter",
      openRouterModelId: modelId,
      inputTokens: 8000,
      outputTokens,
      upstreamCostUsd,
      apiPromptTokens: 12000,
      apiCompletionTokens: 2500,
      userContextChars: 8000,
    });
    assert.equal(billing.contextSurcharge, 0);
    assert.equal(billing.total, withUpstream.total);
  });

  it("waiver with meaningful text charges minimum 50P", () => {
    const prose = "그는 창가에 서서 빗소리를 들었다. ".repeat(40);
    const min = resolveGemini25WaiverMinimumCharge(prose, "forced_abort");
    assert.equal(min, 50);
  });
});
