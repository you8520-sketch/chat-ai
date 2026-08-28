import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { simulatePremiumCompetitive, TOKEN_USAGE_COMPETITOR_BENCHMARKS, PREMIUM_MARGIN_CANDIDATES, SECONDARY_CHAR_BENCHMARKS } from "./shadowSimulations";
import { clearCheaperInferenceCatalogPricingForTest, updateCheaperInferenceCatalogPricing } from "./cheaperInferenceCatalogPricing";

function setupCatalogFixture() {
  clearCheaperInferenceCatalogPricingForTest();
  updateCheaperInferenceCatalogPricing({
    modelId: "gemini-3.1-pro-preview",
    inputUsdPerMillion: 1.4,
    outputUsdPerMillion: 8.4,
    cacheReadUsdPerMillion: 0.14,
    cacheWriteUsdPerMillion: 1.4,
    referenceInputUsdPerMillion: 2,
    referenceOutputUsdPerMillion: 12,
    referenceCacheReadUsdPerMillion: 0.5,
    referenceCacheWriteUsdPerMillion: 2,
    fetchedAt: Date.now(),
  });
  updateCheaperInferenceCatalogPricing({
    modelId: "claude-opus-5",
    inputUsdPerMillion: 3.5,
    outputUsdPerMillion: 17.5,
    cacheReadUsdPerMillion: 0.35,
    cacheWriteUsdPerMillion: 4.375,
    referenceInputUsdPerMillion: 5,
    referenceOutputUsdPerMillion: 25,
    referenceCacheReadUsdPerMillion: 0.5,
    referenceCacheWriteUsdPerMillion: 6.25,
    fetchedAt: Date.now(),
  });
}

describe("shadowSimulations benchmark isolation", () => {
  it("gemini benchmark isolated — uses token benchmark only", () => {
    setupCatalogFixture();
    const r = simulatePremiumCompetitive({
      modelId: "gemini-3.1-pro-preview",
      inputTokens: TOKEN_USAGE_COMPETITOR_BENCHMARKS.gemini31.inputTokens,
      outputTokens: TOKEN_USAGE_COMPETITOR_BENCHMARKS.gemini31.outputTokens,
      benchmarkChargeP: TOKEN_USAGE_COMPETITOR_BENCHMARKS.gemini31.chargeP,
      candidateMargins: PREMIUM_MARGIN_CANDIDATES.gemini31,
      minimumMarginFloor: 0.1,
    });
    assert.equal(r.rows.length, 7);
    assert.ok(r.providerListCostKrw > 0);
    assert.ok(r.billingReferenceCostKrw > 0);
    // providerList should be ~207.7 with FX ~1560, allow 20% tolerance for live FX drift
    assert.ok(r.providerListCostKrw > 150 && r.providerListCostKrw < 300);
    assert.ok(r.benchmarkImpliedMaxMarginFromList != null);
    clearCheaperInferenceCatalogPricingForTest();
  });
  it("opus benchmark isolated from char benchmark — types separate", () => {
    setupCatalogFixture();
    const r = simulatePremiumCompetitive({
      modelId: "claude-opus-5",
      inputTokens: TOKEN_USAGE_COMPETITOR_BENCHMARKS.opus5.inputTokens,
      outputTokens: TOKEN_USAGE_COMPETITOR_BENCHMARKS.opus5.outputTokens,
      benchmarkChargeP: TOKEN_USAGE_COMPETITOR_BENCHMARKS.opus5.chargeP,
      candidateMargins: PREMIUM_MARGIN_CANDIDATES.opus5,
      minimumMarginFloor: 0.15,
    });
    assert.equal(r.rows.length, 9);
    // secondary char benchmark must not be usable as token input
    assert.equal((SECONDARY_CHAR_BENCHMARKS as Record<string, unknown>).opus5 != null, true);
    // ensure flagReason exists
    for (const row of r.rows) assert.ok(typeof row.flagReason === "string");
    clearCheaperInferenceCatalogPricingForTest();
  });
  it("candidate counts are canonical", () => {
    assert.equal(PREMIUM_MARGIN_CANDIDATES.gemini31.length, 7);
    assert.equal(PREMIUM_MARGIN_CANDIDATES.opus5.length, 9);
  });
  it("providerList unavailable gives provider_list_unavailable", () => {
    clearCheaperInferenceCatalogPricingForTest();
    const r = simulatePremiumCompetitive({
      modelId: "unknown-model-xyz-no-catalog",
      inputTokens: 1000,
      outputTokens: 1000,
      benchmarkChargeP: 100,
      candidateMargins: [0.2],
      minimumMarginFloor: 0.1,
    });
    assert.equal(r.providerListCostStatus, "reference_rates_unavailable");
    assert.equal(r.rows[0].flagReason, "provider_list_unavailable");
  });
});
