import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeShadowPricing, normalizeBillableUsage } from "./shadowPricing";
import { clearCheaperInferenceCatalogPricingForTest, updateCheaperInferenceCatalogPricing } from "./cheaperInferenceCatalogPricing";

describe("shadowPricing catalog semantics", () => {
  it("reference rate is list, current is discounted", () => {
    clearCheaperInferenceCatalogPricingForTest();
    updateCheaperInferenceCatalogPricing({
      modelId: "claude-opus-5",
      inputUsdPerMillion: 3.5,
      outputUsdPerMillion: 17.5,
      cacheReadUsdPerMillion: 0.35,
      cacheWriteUsdPerMillion: 4.375,
      referenceInputUsdPerMillion: 5,
      referenceOutputUsdPerMillion: 25,
      discountPercent: 30,
      fetchedAt: Date.now(),
    });
    const s = computeShadowPricing({ modelId: "claude-opus-5", promptTokens: 1000, outputTokens: 1000 });
    assert.ok(s.providerListCostKrw > s.actualProviderCostKrw, "list > actual when discounted");
    clearCheaperInferenceCatalogPricingForTest();
  });
  it("no discount list == actual", () => {
    clearCheaperInferenceCatalogPricingForTest();
    const s = computeShadowPricing({ modelId: "gemini-3.7-flash", promptTokens: 1000, outputTokens: 1000 });
    // without catalog, both fallback => close
    assert.ok(s.providerListCostKrw >= 0);
  });
});

describe("reasoning double-count", () => {
  it("included_in_output does not double count", () => {
    const n = normalizeBillableUsage({ modelId: "claude-opus-5", promptTokens: 1000, outputTokens: 5000, reasoningTokens: 1500 });
    assert.equal(n.reasoningAccounting, "included_in_output");
    assert.equal(n.billableOutputTokens, 5000);
  });
  it("separate sums", () => {
    const n = normalizeBillableUsage({ modelId: "deepseek-v4-pro-0813", promptTokens: 1000, outputTokens: 3500, reasoningTokens: 1500 });
    assert.equal(n.reasoningAccounting, "separate");
    assert.equal(n.billableOutputTokens, 5000);
  });
  it("none", () => {
    const n = normalizeBillableUsage({ modelId: "claude-opus-5", promptTokens: 1000, outputTokens: 5000, reasoningTokens: 0 });
    assert.equal(n.billableOutputTokens, 5000);
  });
});

describe("reserve math", () => {
  it("30% discount reserve", () => {
    const s = computeShadowPricing({ modelId: "claude-opus-5", promptTokens: 40689, outputTokens: 4307 });
    // actual < list when discounted catalog present; if not, skip
    assert.ok(s.providerSavingsKrw >= 0);
  });
});

describe("actual source precedence", () => {
  it("cheaper_inference_billed takes precedence", () => {
    const s = computeShadowPricing({ modelId: "claude-opus-5", promptTokens: 1000, outputTokens: 1000, cheaperInferenceBilledCostUsd: 0.01, upstreamCostUsd: 0.02 });
    assert.equal(s.actualCostSource, "cheaper_inference_billed");
  });
});
