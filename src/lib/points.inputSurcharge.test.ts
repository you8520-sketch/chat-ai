import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OPENROUTER_DEEPSEEK_INPUT_SURCHARGE_PER_1000_TOKENS,
  OPENROUTER_INPUT_SURCHARGE_PER_1000_TOKENS,
  OPENROUTER_INPUT_SURCHARGE_THRESHOLD_TOKENS,
  computeOpenRouterTurnCost,
  explainOpenRouterDeepSeekTurnCost,
  explainOpenRouterGemini36TurnCost,
  openRouterInputTokenSurchargeKrw,
} from "@/lib/points";
import {
  OPENROUTER_DEEPSEEK_V3_MODEL,
  OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
  OPENROUTER_GEMINI_36_FLASH_MODEL,
  OPENROUTER_MUSE_SPARK_11_MODEL,
  OPENROUTER_TENCENT_HY3_MODEL,
} from "@/lib/chatModels";

describe("OpenRouter input token surcharge", () => {
  const geminiId = OPENROUTER_GEMINI_36_FLASH_MODEL;
  const deepseekId = OPENROUTER_DEEPSEEK_V4_PRO_MODEL;

  it("keeps the legacy threshold constants for non-proportional models", () => {
    assert.equal(OPENROUTER_INPUT_SURCHARGE_THRESHOLD_TOKENS, 10000);
    assert.equal(OPENROUTER_INPUT_SURCHARGE_PER_1000_TOKENS, 1);
    assert.equal(OPENROUTER_DEEPSEEK_INPUT_SURCHARGE_PER_1000_TOKENS, 0.5);
  });

  it("charges 0 at or below threshold", () => {
    assert.equal(openRouterInputTokenSurchargeKrw(9999, geminiId), 0);
    assert.equal(openRouterInputTokenSurchargeKrw(10000, geminiId), 0);
    assert.equal(openRouterInputTokenSurchargeKrw(10000, deepseekId), 0);
  });

  it("other legacy models: ceil(excess/1000) × 1P", () => {
    assert.equal(openRouterInputTokenSurchargeKrw(10001, "qwen/qwen3.7-max"), 1);
    assert.equal(openRouterInputTokenSurchargeKrw(10500, "qwen/qwen3.7-max"), 1);
    assert.equal(openRouterInputTokenSurchargeKrw(11000, "qwen/qwen3.7-max"), 1);
    assert.equal(openRouterInputTokenSurchargeKrw(11001, "qwen/qwen3.7-max"), 2);
  });

  it("V4 Pro and Hy3 do not double-charge a 10k input surcharge", () => {
    assert.equal(openRouterInputTokenSurchargeKrw(10001, deepseekId), 0);
    assert.equal(openRouterInputTokenSurchargeKrw(12000, deepseekId), 0);
    assert.equal(
      openRouterInputTokenSurchargeKrw(12000, OPENROUTER_TENCENT_HY3_MODEL),
      0
    );
  });

  it("Muse and Gemini 3.6 bill all input directly without a legacy surcharge", () => {
    assert.equal(openRouterInputTokenSurchargeKrw(50_000, geminiId), 0);
    assert.equal(
      openRouterInputTokenSurchargeKrw(50_000, OPENROUTER_MUSE_SPARK_11_MODEL),
      0
    );
  });

  it("keeps the 0.5P/1k rule for legacy DeepSeek V3 paths", () => {
    assert.equal(
      openRouterInputTokenSurchargeKrw(10500, OPENROUTER_DEEPSEEK_V3_MODEL),
      0.25
    );
    assert.equal(
      openRouterInputTokenSurchargeKrw(12000, OPENROUTER_DEEPSEEK_V3_MODEL),
      1
    );
  });

  it("Gemini direct input billing grows without a legacy surcharge", () => {
    const outputTokens = 100;
    const base = computeOpenRouterTurnCost(5000, outputTokens, geminiId);
    const longContext = computeOpenRouterTurnCost(50_000, outputTokens, geminiId);
    assert.ok(longContext > base);
  });

  it("DeepSeek V4 Pro bills all input through the cache-neutral margin formula", () => {
    const outputTokens = 500;
    const explain = explainOpenRouterDeepSeekTurnCost(10500, outputTokens, deepseekId);
    assert.equal(openRouterInputTokenSurchargeKrw(10500, deepseekId), 0);
    assert.equal(explain.inputSurchargeKrw, undefined);
    assert.equal(explain.charFloorKrw, 0);
    assert.equal(explain.applied, "cost_plus_margin");
    assert.equal(computeOpenRouterTurnCost(10500, outputTokens, deepseekId), explain.total);
  });

  it("Gemini explain breakdown uses one margin owner without a surcharge field", () => {
    const explain = explainOpenRouterGemini36TurnCost(10500, 100, geminiId);
    assert.equal(explain.inputSurchargeKrw, undefined);
    assert.equal(explain.charFloorKrw, 0);
    assert.equal(explain.applied, "cost_plus_margin");
  });
});
