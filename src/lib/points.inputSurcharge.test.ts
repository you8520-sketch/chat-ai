import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OPENROUTER_INPUT_SURCHARGE_PER_1000_TOKENS,
  OPENROUTER_INPUT_SURCHARGE_THRESHOLD_TOKENS,
  computeOpenRouterTurnCost,
  explainOpenRouterGemini25TurnCost,
  openRouterInputTokenSurchargeKrw,
} from "@/lib/points";
import { OPENROUTER_GEMINI_25_PRO_MODEL } from "@/lib/chatModels";

describe("OpenRouter input token surcharge", () => {
  const modelId = OPENROUTER_GEMINI_25_PRO_MODEL;

  it("uses 8000 threshold and 1.5P per 1000 excess tokens", () => {
    assert.equal(OPENROUTER_INPUT_SURCHARGE_THRESHOLD_TOKENS, 8000);
    assert.equal(OPENROUTER_INPUT_SURCHARGE_PER_1000_TOKENS, 1.5);
  });

  it("charges 0 below threshold", () => {
    assert.equal(openRouterInputTokenSurchargeKrw(7999), 0);
    assert.equal(openRouterInputTokenSurchargeKrw(8000), 0);
  });

  it("charges ceil(excess/1000) × 1.5P", () => {
    assert.equal(openRouterInputTokenSurchargeKrw(9000), 2);
    assert.equal(openRouterInputTokenSurchargeKrw(9500), 3);
    assert.equal(openRouterInputTokenSurchargeKrw(10000), 3);
    assert.equal(openRouterInputTokenSurchargeKrw(10001), 4);
  });

  it("adds surcharge to output-token billing", () => {
    const outputTokens = 100;
    const base = computeOpenRouterTurnCost(5000, outputTokens, modelId);
    const withSurcharge = computeOpenRouterTurnCost(9500, outputTokens, modelId);
    assert.equal(withSurcharge - base, 3);
  });

  it("explain breakdown includes inputSurchargeKrw", () => {
    const explain = explainOpenRouterGemini25TurnCost(9500, 100, modelId);
    assert.equal(explain.inputSurchargeKrw, 3);
    assert.equal(
      explain.total,
      explain.charFloorKrw + explain.inputSurchargeKrw!
    );
  });
});
