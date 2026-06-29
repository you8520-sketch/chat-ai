import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OPENROUTER_GEMINI_31_POINTS_PER_OUTPUT_TOKEN,
  GEMINI_31_WAIVER_SUCCESS_MIN_COST,
  computeOpenRouterTurnCost,
  computeTurnBilling,
  explainOpenRouterGeminiProTurnCost,
  resolveGemini31WaiverMinimumCharge,
} from "@/lib/points";
import { OPENROUTER_GEMINI_31_PRO_MODEL } from "@/lib/chatModels";

describe("OpenRouter Gemini 3.1 Pro billing", () => {
  const modelId = OPENROUTER_GEMINI_31_PRO_MODEL;

  it("uses 0.075P per output token", () => {
    assert.equal(OPENROUTER_GEMINI_31_POINTS_PER_OUTPUT_TOKEN, 0.075);
    assert.equal(GEMINI_31_WAIVER_SUCCESS_MIN_COST, 65);
  });

  it("token floor = outputTokens × 0.075", () => {
    const outputTokens = 2000;
    const explain = explainOpenRouterGeminiProTurnCost(1000, outputTokens, modelId);
    assert.equal(explain.charFloorKrw, Math.ceil(outputTokens * 0.075 - 1e-9));
    assert.equal(explain.costPlusMarginKrw, 0);
  });

  it("charges output token floor only", () => {
    const outputTokens = 2000;
    const lowUsage = computeOpenRouterTurnCost(100, outputTokens, modelId);
    const explain = explainOpenRouterGeminiProTurnCost(100, outputTokens, modelId);
    assert.equal(lowUsage, explain.total);
  });

  it("no user note surcharge when note body large", () => {
    const billing = computeTurnBilling({
      provider: "openrouter",
      openRouterModelId: modelId,
      inputTokens: 5000,
      outputTokens: 800,
      userContextChars: 8000,
      upstreamCostUsd: 0.05,
      apiPromptTokens: 5000,
      apiCompletionTokens: 800,
    });
    assert.equal(billing.contextSurcharge, 0);
    assert.equal(billing.multiplier, 1);
    assert.equal(billing.total, billing.baseCost);
  });

  it("waiver with meaningful text charges minimum 65P", () => {
    const min = resolveGemini31WaiverMinimumCharge(
      "유의미한 본문이 있는 응답입니다.",
      "forced_abort"
    );
    assert.equal(min, 65);
  });
});
