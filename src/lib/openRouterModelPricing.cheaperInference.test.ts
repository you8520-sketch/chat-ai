import assert from "node:assert/strict";
import test from "node:test";
import {
  openRouterUsdCostFromRates,
  resolveOpenRouterModelRates,
} from "./openRouterModelPricing";
import {
  clearCheaperInferenceCatalogPricingForTest,
  updateCheaperInferenceCatalogPricing,
} from "./cheaperInferenceCatalogPricing";

test("Claude Opus 5 uses the Cheaper Inference catalog rates", () => {
  const rates = resolveOpenRouterModelRates("claude-opus-5");
  assert.equal(rates.inputUsdPerM, 3.5);
  assert.equal(rates.cacheReadUsdPerM, 0.35);
  assert.equal(rates.cacheWriteUsdPerM, 4.375);
  assert.equal(rates.outputUsdPerM, 17.5);

  const result = openRouterUsdCostFromRates({
    modelId: "claude-opus-5",
    promptTokens: 2_000,
    cacheReadTokens: 1_000,
    cacheWriteTokens: 500,
    outputTokens: 1_000,
  });
  assert.equal(result.standardInputTokens, 500);
  assert.equal(result.usdCost, 0.0217875);
});

test("DeepSeek V4 Flash uses the Cheaper Inference catalog rates", () => {
  const rates = resolveOpenRouterModelRates("deepseek-v4-flash");
  assert.equal(rates.inputUsdPerM, 0.098);
  assert.equal(rates.cacheReadUsdPerM, 0.0196);
  assert.equal(rates.cacheWriteUsdPerM, 0.098);
  assert.equal(rates.outputUsdPerM, 0.196);
  const dated = resolveOpenRouterModelRates("deepseek-v4-flash-0731");
  assert.equal(dated.inputUsdPerM, 0.098);
  assert.equal(dated.outputUsdPerM, 0.196);
});

test("GPT-5.6 Luna uses the Cheaper Inference catalog rates", () => {
  const rates = resolveOpenRouterModelRates("gpt-5.6-luna");
  assert.equal(rates.inputUsdPerM, 1);
  assert.equal(rates.cacheReadUsdPerM, 0.1);
  assert.equal(rates.cacheWriteUsdPerM, 1);
  assert.equal(rates.outputUsdPerM, 6);
});

test("GPT-5.6 Terra uses the Cheaper Inference catalog rates", () => {
  const rates = resolveOpenRouterModelRates("gpt-5.6-terra");
  assert.equal(rates.inputUsdPerM, 2.5);
  assert.equal(rates.cacheReadUsdPerM, 0.25);
  assert.equal(rates.cacheWriteUsdPerM, 2.5);
  assert.equal(rates.outputUsdPerM, 15);
});

test("DeepSeek V4 Pro uses the Cheaper Inference catalog rates", () => {
  const rates = resolveOpenRouterModelRates("deepseek-v4-pro");
  assert.equal(rates.inputUsdPerM, 0.3045);
  assert.equal(rates.cacheReadUsdPerM, 0.231);
  assert.equal(rates.cacheWriteUsdPerM, 0.3045);
  assert.equal(rates.outputUsdPerM, 0.609);
});

test("Gemini 3.1 Pro uses fallback rates and accepts live refreshes", () => {
  clearCheaperInferenceCatalogPricingForTest();
  const fallback = resolveOpenRouterModelRates("gemini-3.1-pro-preview");
  assert.equal(fallback.inputUsdPerM, 1.4);
  assert.equal(fallback.cacheReadUsdPerM, 0.4375);
  assert.equal(fallback.cacheWriteUsdPerM, 1.4);
  assert.equal(fallback.outputUsdPerM, 8.4);

  updateCheaperInferenceCatalogPricing({
    modelId: "gemini-3.1-pro-preview",
    inputUsdPerMillion: 1.976745,
    cacheReadUsdPerMillion: 0.4375,
    cacheWriteUsdPerMillion: 1.976745,
    outputUsdPerMillion: 11.860466,
    discountPercent: 1.16,
    fetchedAt: Date.now(),
  });
  const live = resolveOpenRouterModelRates("gemini-3.1-pro-preview");
  assert.equal(live.inputUsdPerM, 1.976745);
  assert.equal(live.cacheReadUsdPerM, 0.4375);
  assert.equal(live.cacheWriteUsdPerM, 1.976745);
  assert.equal(live.outputUsdPerM, 11.860466);
  clearCheaperInferenceCatalogPricingForTest();
});

test("Gemini 3.7 Flash uses the site-stated Cheaper Inference rates", () => {
  clearCheaperInferenceCatalogPricingForTest();
  const rates = resolveOpenRouterModelRates("gemini-3.7-flash");
  assert.equal(rates.inputUsdPerM, 0.53);
  assert.equal(rates.cacheReadUsdPerM, 0.02625);
  assert.equal(rates.cacheWriteUsdPerM, 0.017708);
  assert.equal(rates.outputUsdPerM, 2.63);
  clearCheaperInferenceCatalogPricingForTest();
});

test("Luna / Opus / Flash accept live Cheaper Inference catalog overlays", () => {
  clearCheaperInferenceCatalogPricingForTest();
  for (const modelId of ["gpt-5.6-luna", "claude-opus-5", "deepseek-v4-flash"] as const) {
    updateCheaperInferenceCatalogPricing({
      modelId,
      inputUsdPerMillion: 9.99,
      cacheReadUsdPerMillion: 0.99,
      cacheWriteUsdPerMillion: 9.99,
      outputUsdPerMillion: 19.99,
      fetchedAt: Date.now(),
    });
    const live = resolveOpenRouterModelRates(modelId);
    assert.equal(live.inputUsdPerM, 9.99, modelId);
    assert.equal(live.outputUsdPerM, 19.99, modelId);
  }
  clearCheaperInferenceCatalogPricingForTest();
});
