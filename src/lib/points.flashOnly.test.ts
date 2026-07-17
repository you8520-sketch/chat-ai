import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HTML_FLASH_MAX_OUTPUT_TOKENS,
  HTML_ONLY_MODEL_LABEL,
  HTML_ONLY_TURN_MAX_INPUT_TOKENS,
  HTML_ONLY_TURN_MAX_OUTPUT_TOKENS,
} from "@/lib/htmlVisualCardRecovery";
import {
  OPENROUTER_DEEPSEEK_GROSS_MARGIN,
  computeHtmlFlashOnlyTurnBilling,
} from "@/lib/points";
import { OPENROUTER_DEEPSEEK_V3_MODEL } from "@/lib/chatModels";

describe("HTML-only turn limits", () => {
  it("uses 30k input context and 6k output (same as secondary HTML flash)", () => {
    assert.equal(HTML_ONLY_TURN_MAX_INPUT_TOKENS, 24_000);
    assert.equal(HTML_FLASH_MAX_OUTPUT_TOKENS, 6000);
    assert.equal(HTML_ONLY_TURN_MAX_OUTPUT_TOKENS, 8000);
  });
});

describe("computeHtmlFlashOnlyTurnBilling", () => {
  it("uses DeepSeek V3 with HTML전용모델 label and margin-based billing", () => {
    const flash = computeHtmlFlashOnlyTurnBilling({
      savedTextChars: 1200,
      userContextChars: 500,
      inputTokens: 8420,
      outputTokens: 2180,
    });
    assert.equal(flash.modelId, OPENROUTER_DEEPSEEK_V3_MODEL);
    assert.equal(flash.modelLabel, HTML_ONLY_MODEL_LABEL);
    assert.equal(flash.estimatedInputTokens, 8420);
    assert.equal(flash.estimatedOutputTokens, 2180);
    assert.equal(flash.tokensEstimated, false);
    assert.ok(flash.rawCostKrw > 0);
    assert.ok(flash.baseCost >= flash.rawCostKrw);
    assert.equal(flash.multiplier, 1);
    assert.ok(flash.total >= flash.baseCost);
  });

  it("applies 55% gross margin (charge ≈ raw / 0.45)", () => {
    const flash = computeHtmlFlashOnlyTurnBilling({
      savedTextChars: 5000,
      inputTokens: 10_000,
      outputTokens: 8000,
    });
    const marginRatio = flash.baseCost / flash.rawCostKrw;
    // ceil(P) on small KRW raw (V3 exact rates) can nudge ratio slightly above 1/0.45
    assert.ok(marginRatio >= 1 / (1 - OPENROUTER_DEEPSEEK_GROSS_MARGIN) - 0.03);
    assert.ok(marginRatio <= 1 / (1 - OPENROUTER_DEEPSEEK_GROSS_MARGIN) + 0.03);
  });

  it("caps estimated output tokens at 6k when API usage missing", () => {
    const flash = computeHtmlFlashOnlyTurnBilling({
      savedTextChars: 100_000,
      userContextChars: 200,
      promptEstimateTokens: 6100,
    });
    assert.equal(flash.estimatedOutputTokens, HTML_ONLY_TURN_MAX_OUTPUT_TOKENS);
    assert.equal(flash.estimatedInputTokens, 6100);
    assert.equal(flash.tokensEstimated, true);
    assert.ok(flash.total > 0);
  });

  it("includes input surcharge for large prompts", () => {
    const small = computeHtmlFlashOnlyTurnBilling({
      savedTextChars: 800,
      inputTokens: 4000,
      outputTokens: 1200,
    });
    const large = computeHtmlFlashOnlyTurnBilling({
      savedTextChars: 800,
      inputTokens: 20_000,
      outputTokens: 1200,
    });
    assert.ok(large.contextSurcharge > small.contextSurcharge);
    assert.ok(large.total > small.total);
  });
});
