import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HTML_FLASH_MAX_OUTPUT_TOKENS } from "@/lib/htmlVisualCardRecovery";
import {
  computeFlashHtmlOnlyOutputCharge,
  computeHtmlFlashOnlyTurnBilling,
  computeTurnBilling,
  FLASH_HTML_ONLY_OUTPUT_TOKENS_PER_TIER,
  FLASH_HTML_ONLY_WON_PER_TIER,
} from "@/lib/points";

describe("computeFlashHtmlOnlyOutputCharge", () => {
  it("charges 10P per 1000 output tokens (proportional, rounded up)", () => {
    assert.equal(FLASH_HTML_ONLY_OUTPUT_TOKENS_PER_TIER, 1000);
    assert.equal(FLASH_HTML_ONLY_WON_PER_TIER, 10);
    assert.equal(HTML_FLASH_MAX_OUTPUT_TOKENS, 6000);
    assert.equal(computeFlashHtmlOnlyOutputCharge(0), 0);
    assert.equal(computeFlashHtmlOnlyOutputCharge(1000), 10);
    assert.equal(computeFlashHtmlOnlyOutputCharge(2000), 20);
    assert.equal(computeFlashHtmlOnlyOutputCharge(1200), 12);
    assert.equal(computeFlashHtmlOnlyOutputCharge(1001), 11);
  });
});

describe("computeHtmlFlashOnlyTurnBilling", () => {
  it("uses output token tier pricing only (no context surcharge)", () => {
    const flash = computeHtmlFlashOnlyTurnBilling({
      savedTextChars: 3500,
      userContextChars: 8000,
      outputTokens: 2500,
    });
    assert.equal(flash.total, 25);
    assert.equal(flash.baseCost, 25);
    assert.equal(flash.contextSurcharge, 0);
    assert.equal(flash.multiplier, 1);
  });

  it("charges less than a typical OpenRouter turn for HTML-only output", () => {
    const htmlChars = 1200;
    const flash = computeHtmlFlashOnlyTurnBilling({
      savedTextChars: htmlChars,
      userContextChars: 3000,
      outputTokens: 700,
    });
    const main = computeTurnBilling({
      provider: "openrouter",
      openRouterModelId: "anthropic/claude-opus-4.6",
      inputTokens: 30_000,
      outputTokens: 800,
      savedTextChars: htmlChars,
    });
    assert.equal(flash.total, 7);
    assert.ok(flash.total < main.total);
  });

  it("prefers actual Flash API tokens for receipt display and billing", () => {
    const flash = computeHtmlFlashOnlyTurnBilling({
      savedTextChars: 1200,
      userContextChars: 500,
      inputTokens: 8420,
      outputTokens: 2180,
    });
    assert.equal(flash.estimatedInputTokens, 8420);
    assert.equal(flash.estimatedOutputTokens, 2180);
    assert.equal(flash.tokensEstimated, false);
    assert.equal(flash.total, 22);
  });

  it("uses prompt assembly estimate when API usage missing", () => {
    const flash = computeHtmlFlashOnlyTurnBilling({
      savedTextChars: 800,
      userContextChars: 200,
      promptEstimateTokens: 6100,
    });
    assert.equal(flash.estimatedInputTokens, 6100);
    assert.equal(flash.tokensEstimated, true);
    assert.equal(flash.total, 5);
  });
});
