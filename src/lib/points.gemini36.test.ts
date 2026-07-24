import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GEMINI_36_WAIVER_SUCCESS_MIN_COST,
  OPENROUTER_GEMINI_36_GROSS_MARGIN,
  OPENROUTER_MIN_TURN_COST,
  computeOpenRouterTurnCost,
  computeTurnBilling,
  explainOpenRouterGemini36TurnCost,
  resolveGemini36WaiverMinimumCharge,
} from "@/lib/points";
import { OPENROUTER_GEMINI_36_FLASH_MODEL } from "@/lib/chatModels";
import { resolveOpenRouterBillingRawCostKrw } from "@/lib/billingRawCost";

describe("OpenRouter Gemini 3.6 Flash billing", () => {
  const modelId = OPENROUTER_GEMINI_36_FLASH_MODEL;

  it("uses one 55% gross-margin owner", () => {
    assert.equal(OPENROUTER_GEMINI_36_GROSS_MARGIN, 0.55);
    assert.equal(GEMINI_36_WAIVER_SUCCESS_MIN_COST, 50);
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
      Math.ceil(raw / (1 - OPENROUTER_GEMINI_36_GROSS_MARGIN) - 1e-9)
    );
    const explain = explainOpenRouterGemini36TurnCost(
      inputTokens,
      outputTokens,
      modelId
    );
    assert.equal(explain.rawCostKrw, raw);
    assert.equal(explain.charFloorKrw, 0);
    assert.equal(explain.costPlusMarginKrw, expected);
    assert.equal(explain.total, expected);
    assert.equal(computeOpenRouterTurnCost(inputTokens, outputTokens, modelId), expected);
  });

  it("ignores cache, upstream cost, and hidden reasoning in user pricing", () => {
    const outputTokens = 400;
    const withProviderDetails = explainOpenRouterGemini36TurnCost(
      100,
      outputTokens,
      modelId,
      undefined,
      {
        upstreamCostUsd: 0.066,
        apiPromptTokens: 12_000,
        apiCompletionTokens: 2500,
      }
    );
    const withoutProviderDetails = explainOpenRouterGemini36TurnCost(
      100,
      outputTokens,
      modelId
    );
    const billing = computeTurnBilling({
      provider: "openrouter",
      openRouterModelId: modelId,
      inputTokens: 100,
      outputTokens,
      upstreamCostUsd: 0.066,
      apiPromptTokens: 12_000,
      apiCompletionTokens: 2500,
      userContextChars: 8000,
    });
    assert.equal(billing.contextSurcharge, 0);
    assert.equal(billing.total, withProviderDetails.total);
    assert.equal(withProviderDetails.total, withoutProviderDetails.total);
  });

  it("charges more when visible input grows", () => {
    const shortInput = computeOpenRouterTurnCost(5000, 400, modelId);
    const longInput = computeOpenRouterTurnCost(50_000, 400, modelId);
    assert.ok(longInput > shortInput);
  });

  it("charges the 50P waiver minimum for meaningful interrupted output", () => {
    const prose = "그는 창가에 서서 빗소리를 들었다. ".repeat(40);
    assert.equal(resolveGemini36WaiverMinimumCharge(prose, "forced_abort"), 50);
  });
});
