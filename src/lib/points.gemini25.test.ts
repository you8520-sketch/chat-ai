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

  it("uses 0.065P per output token (same as Qwen)", () => {
    assert.equal(OPENROUTER_GEMINI_25_POINTS_PER_OUTPUT_TOKEN, 0.065);
    assert.equal(GEMINI_25_WAIVER_SUCCESS_MIN_COST, 50);
  });

  it("token floor = outputTokens × 0.065", () => {
    const outputTokens = 2000;
    const explain = explainOpenRouterGemini25TurnCost(1000, outputTokens, modelId);
    assert.equal(explain.charFloorKrw, Math.ceil(outputTokens * 0.065 - 1e-9));
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
    const withUpstream = explainOpenRouterGemini25TurnCost(100, 50, modelId, undefined, {
      upstreamCostUsd,
      apiPromptTokens: 12000,
      apiCompletionTokens: 2500,
    });
    assert.ok(withUpstream.rawCostKrw > 0);
    const billing = computeTurnBilling({
      provider: "openrouter",
      openRouterModelId: modelId,
      inputTokens: 8000,
      outputTokens: 400,
      upstreamCostUsd,
      apiPromptTokens: 12000,
      apiCompletionTokens: 2500,
      userContextChars: 8000,
    });
    assert.equal(billing.contextSurcharge, 0);
    assert.equal(billing.total, withUpstream.total);
  });

  it("waiver with meaningful text charges minimum 50P", () => {
    const min = resolveGemini25WaiverMinimumCharge(
      "유의미한 본문이 있는 응답입니다.",
      "forced_abort"
    );
    assert.equal(min, 50);
  });
});
