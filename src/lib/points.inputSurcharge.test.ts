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

  it("uses 10000 threshold and 1.25P per 1000 excess tokens", () => {
    assert.equal(OPENROUTER_INPUT_SURCHARGE_THRESHOLD_TOKENS, 10000);
    assert.equal(OPENROUTER_INPUT_SURCHARGE_PER_1000_TOKENS, 1.25);
  });

  it("charges 0 at or below threshold", () => {
    assert.equal(openRouterInputTokenSurchargeKrw(9999), 0);
    assert.equal(openRouterInputTokenSurchargeKrw(10000), 0);
  });

  it("charges ceil(excess/1000) times 1.25P", () => {
    assert.equal(openRouterInputTokenSurchargeKrw(10001), 2);
    assert.equal(openRouterInputTokenSurchargeKrw(10500), 2);
    assert.equal(openRouterInputTokenSurchargeKrw(11000), 2);
    assert.equal(openRouterInputTokenSurchargeKrw(11001), 3);
  });

  it("adds surcharge to output-token billing", () => {
    const outputTokens = 100;
    const base = computeOpenRouterTurnCost(5000, outputTokens, modelId);
    const withSurcharge = computeOpenRouterTurnCost(10500, outputTokens, modelId);
    assert.equal(withSurcharge - base, 2);
  });

  it("explain breakdown includes inputSurchargeKrw", () => {
    const explain = explainOpenRouterGemini25TurnCost(10500, 100, modelId);
    assert.equal(explain.inputSurchargeKrw, 2);
    assert.equal(
      explain.total,
      explain.charFloorKrw + explain.inputSurchargeKrw!
    );
  });
});
