import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OPENROUTER_DEEPSEEK_INPUT_SURCHARGE_PER_1000_TOKENS,
  OPENROUTER_INPUT_SURCHARGE_PER_1000_TOKENS,
  OPENROUTER_INPUT_SURCHARGE_THRESHOLD_TOKENS,
  computeOpenRouterTurnCost,
  explainOpenRouterDeepSeekTurnCost,
  explainOpenRouterGemini25TurnCost,
  openRouterInputTokenSurchargeKrw,
} from "@/lib/points";
import {
  OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
  OPENROUTER_GEMINI_25_PRO_MODEL,
} from "@/lib/chatModels";

describe("OpenRouter input token surcharge", () => {
  const geminiId = OPENROUTER_GEMINI_25_PRO_MODEL;
  const deepseekId = OPENROUTER_DEEPSEEK_V4_PRO_MODEL;

  it("uses 10000 threshold; default 1P, DeepSeek 0.5P per 1000 excess", () => {
    assert.equal(OPENROUTER_INPUT_SURCHARGE_THRESHOLD_TOKENS, 10000);
    assert.equal(OPENROUTER_INPUT_SURCHARGE_PER_1000_TOKENS, 1);
    assert.equal(OPENROUTER_DEEPSEEK_INPUT_SURCHARGE_PER_1000_TOKENS, 0.5);
  });

  it("charges 0 at or below threshold", () => {
    assert.equal(openRouterInputTokenSurchargeKrw(9999, geminiId), 0);
    assert.equal(openRouterInputTokenSurchargeKrw(10000, geminiId), 0);
    assert.equal(openRouterInputTokenSurchargeKrw(10000, deepseekId), 0);
  });

  it("non-DeepSeek: ceil(excess/1000) × 1P", () => {
    assert.equal(openRouterInputTokenSurchargeKrw(10001, geminiId), 1);
    assert.equal(openRouterInputTokenSurchargeKrw(10500, geminiId), 1);
    assert.equal(openRouterInputTokenSurchargeKrw(11000, geminiId), 1);
    assert.equal(openRouterInputTokenSurchargeKrw(11001, geminiId), 2);
  });

  it("DeepSeek: proportional 0.5P/1k with no mid ceil", () => {
    assert.equal(openRouterInputTokenSurchargeKrw(10001, deepseekId), 0.0005);
    assert.equal(openRouterInputTokenSurchargeKrw(10500, deepseekId), 0.25);
    assert.equal(openRouterInputTokenSurchargeKrw(11000, deepseekId), 0.5);
    assert.equal(openRouterInputTokenSurchargeKrw(12000, deepseekId), 1);
  });

  it("adds surcharge to output-token billing (Gemini)", () => {
    const outputTokens = 100;
    const base = computeOpenRouterTurnCost(5000, outputTokens, geminiId);
    const withSurcharge = computeOpenRouterTurnCost(10500, outputTokens, geminiId);
    assert.equal(withSurcharge - base, 1);
  });

  it("DeepSeek final total ceils only once when surcharge has a decimal", () => {
    const outputTokens = 500; // floor = ceil(500*0.018) = 9
    const explain = explainOpenRouterDeepSeekTurnCost(10500, outputTokens, deepseekId);
    assert.equal(explain.inputSurchargeKrw, 0.25);
    assert.equal(explain.charFloorKrw, 9);
    // 9 + 0.25 → ceil → 10 (중간 할증 올림 없음)
    assert.equal(explain.total, 10);
    assert.equal(
      computeOpenRouterTurnCost(10500, outputTokens, deepseekId),
      10
    );
  });

  it("explain breakdown includes inputSurchargeKrw", () => {
    const explain = explainOpenRouterGemini25TurnCost(10500, 100, geminiId);
    assert.equal(explain.inputSurchargeKrw, 1);
    assert.equal(
      explain.total,
      explain.charFloorKrw + explain.inputSurchargeKrw!
    );
  });
});
