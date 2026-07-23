import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OPENROUTER_GEMINI_25_GROSS_MARGIN,
  OPENROUTER_MIN_TURN_COST,
  GEMINI_25_WAIVER_SUCCESS_MIN_COST,
  computeOpenRouterTurnCost,
  computeTurnBilling,
  explainOpenRouterGemini25TurnCost,
  resolveGemini25WaiverMinimumCharge,
} from "@/lib/points";
import { OPENROUTER_GEMINI_25_PRO_MODEL } from "@/lib/chatModels";
import { resolveOpenRouterBillingRawCostKrw } from "@/lib/billingRawCost";

describe("OpenRouter Gemini 2.5 Pro billing", () => {
  const modelId = OPENROUTER_GEMINI_25_PRO_MODEL;

  it("uses one 55% gross-margin owner", () => {
    assert.equal(OPENROUTER_GEMINI_25_GROSS_MARGIN, 0.55);
    assert.equal(GEMINI_25_WAIVER_SUCCESS_MIN_COST, 50);
  });

  it("charges standard list input and visible output divided by 0.45", () => {
    const inputTokens = 20_000;
    const outputTokens = 2000;
    const raw = resolveOpenRouterBillingRawCostKrw({
      promptTokens: inputTokens,
      outputTokens,
      modelId,
    });
    const expected = Math.max(
      OPENROUTER_MIN_TURN_COST,
      Math.ceil(raw / (1 - OPENROUTER_GEMINI_25_GROSS_MARGIN) - 1e-9)
    );
    const explain = explainOpenRouterGemini25TurnCost(inputTokens, outputTokens, modelId);
    assert.equal(explain.rawCostKrw, raw);
    assert.equal(explain.charFloorKrw, 0);
    assert.equal(explain.costPlusMarginKrw, expected);
    assert.equal(explain.total, expected);
    assert.equal(computeOpenRouterTurnCost(inputTokens, outputTokens, modelId), expected);
  });

  it("uses visible usage while ignoring provider cost, cache, and hidden reasoning", () => {
    const upstreamCostUsd = 0.066;
    const outputTokens = 400;
    const withUpstream = explainOpenRouterGemini25TurnCost(100, outputTokens, modelId, undefined, {
      upstreamCostUsd,
      apiPromptTokens: 12000,
      apiCompletionTokens: 2500,
    });
    assert.ok(withUpstream.rawCostKrw > 0);
    const withoutUpstream = explainOpenRouterGemini25TurnCost(100, outputTokens, modelId);
    const billing = computeTurnBilling({
      provider: "openrouter",
      openRouterModelId: modelId,
      inputTokens: 100,
      outputTokens,
      upstreamCostUsd,
      apiPromptTokens: 12000,
      apiCompletionTokens: 2500,
      userContextChars: 8000,
    });
    assert.equal(billing.contextSurcharge, 0);
    assert.equal(billing.total, withUpstream.total);
    assert.equal(withUpstream.total, withoutUpstream.total);
  });

  it("charges more when the visible input grows", () => {
    const outputTokens = 400;
    const shortInput = computeOpenRouterTurnCost(5000, outputTokens, modelId);
    const longInput = computeOpenRouterTurnCost(50_000, outputTokens, modelId);
    assert.ok(longInput > shortInput);
  });

  it("waiver with meaningful text charges minimum 50P", () => {
    const prose = "그는 창가에 서서 빗소리를 들었다. ".repeat(40);
    const min = resolveGemini25WaiverMinimumCharge(prose, "forced_abort");
    assert.equal(min, 50);
  });
});
