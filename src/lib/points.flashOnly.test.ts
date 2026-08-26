import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HTML_FLASH_MAX_OUTPUT_TOKENS,
  HTML_ONLY_MODEL_LABEL,
  HTML_OOC_FLASH_INPUT_TARGET_TOKENS,
  HTML_ONLY_TURN_MAX_INPUT_TOKENS,
  HTML_ONLY_TURN_MAX_OUTPUT_TOKENS,
} from "@/lib/htmlVisualCardRecovery";
import {
  OPENROUTER_DEEPSEEK_GROSS_MARGIN,
  computeHtmlFlashOnlyTurnBilling,
} from "@/lib/points";
import { CHEAPER_INFERENCE_GPT_56_LUNA_MODEL } from "@/lib/chatModels";
import { BACKGROUND_CREATIVE_HTML_MODEL } from "@/lib/ai";
import { clearCheaperInferenceCatalogPricingForTest } from "@/lib/cheaperInferenceCatalogPricing";
import { openRouterUsdCostFromRates } from "@/lib/openRouterModelPricing";
import { convertUsdToKrw } from "@/lib/exchangeRate";

describe("HTML token budget owner", () => {
  it("keeps dedicated HTML at 20k assembly target / 24k input hard cap / 8k output", () => {
    assert.equal(HTML_OOC_FLASH_INPUT_TARGET_TOKENS, 20_000);
    assert.equal(HTML_ONLY_TURN_MAX_INPUT_TOKENS, 24_000);
    assert.equal(HTML_ONLY_TURN_MAX_OUTPUT_TOKENS, 8_000);
    assert.ok(HTML_OOC_FLASH_INPUT_TARGET_TOKENS <= HTML_ONLY_TURN_MAX_INPUT_TOKENS);
  });

  it("keeps secondary HTML after RP at 6k output max", () => {
    assert.equal(HTML_FLASH_MAX_OUTPUT_TOKENS, 6000);
    assert.ok(HTML_ONLY_TURN_MAX_OUTPUT_TOKENS >= HTML_FLASH_MAX_OUTPUT_TOKENS);
  });
});

describe("computeHtmlFlashOnlyTurnBilling", () => {
  it("uses BACKGROUND_CREATIVE_HTML_MODEL with HTML전용모델 label and margin-based billing", () => {
    const flash = computeHtmlFlashOnlyTurnBilling({
      savedTextChars: 1200,
      userContextChars: 500,
      inputTokens: 8420,
      outputTokens: 2180,
    });
    assert.equal(flash.modelId, CHEAPER_INFERENCE_GPT_56_LUNA_MODEL);
    assert.equal(flash.modelId, BACKGROUND_CREATIVE_HTML_MODEL);
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
    const expected = Math.ceil(
      flash.rawCostKrw / (1 - OPENROUTER_DEEPSEEK_GROSS_MARGIN) - 1e-9
    );
    assert.equal(flash.baseCost, expected);
    assert.ok(flash.total >= flash.baseCost);
  });

  it("uses provider upstreamCostUsd as raw cost basis when available", () => {
    const upstreamUsd = 0.0025;
    const flash = computeHtmlFlashOnlyTurnBilling({
      savedTextChars: 500,
      inputTokens: 5000,
      outputTokens: 800,
      upstreamCostUsd: upstreamUsd,
    });
    const expectedRaw = convertUsdToKrw(upstreamUsd);
    assert.equal(flash.rawCostKrw, Math.round(expectedRaw * 10) / 10);
    assert.equal(
      flash.baseCost,
      Math.ceil(flash.rawCostKrw / (1 - OPENROUTER_DEEPSEEK_GROSS_MARGIN) - 1e-9)
    );
  });

  it("caps estimated output tokens at 8k when API usage missing", () => {
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

  it("missing provider usage bills Luna public fallback rates not legacy 1/6 snapshot", () => {
    clearCheaperInferenceCatalogPricingForTest();
    try {
      const inputTokens = 1_000_000;
      const outputTokens = 1_000_000;
      const flash = computeHtmlFlashOnlyTurnBilling({
        savedTextChars: 1000,
        inputTokens,
        outputTokens,
      });
      const publicFallbackUsd = openRouterUsdCostFromRates({
        promptTokens: inputTokens,
        outputTokens,
        modelId: CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
      }).usdCost;
      const legacySnapshotUsd = (inputTokens * 1 + outputTokens * 6) / 1_000_000;
      assert.notEqual(publicFallbackUsd, legacySnapshotUsd);
      assert.ok(publicFallbackUsd < legacySnapshotUsd);
      assert.equal(
        flash.rawCostKrw,
        Math.round(convertUsdToKrw(publicFallbackUsd) * 10) / 10
      );
    } finally {
      clearCheaperInferenceCatalogPricingForTest();
    }
  });
});
