import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { simulatePremiumCompetitive, TOKEN_USAGE_COMPETITOR_BENCHMARKS, PREMIUM_MARGIN_CANDIDATES, SECONDARY_CHAR_BENCHMARKS } from "./shadowSimulations";
import { clearCheaperInferenceCatalogPricingForTest, updateCheaperInferenceCatalogPricing } from "./cheaperInferenceCatalogPricing";
import { _setExchangeRateForTest } from "./exchangeRate";

const TEST_BASE_FX = 1530;
const TEST_EFFECTIVE_FX = 1560.6;
function setupFxFixture() {
  _setExchangeRateForTest({ dateKey: "2026-08-28", usdToKrw: TEST_BASE_FX, source: "api_daily" });
}

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
    setupFxFixture();
    const r = simulatePremiumCompetitive({
      modelId: "gemini-3.1-pro-preview",
      inputTokens: TOKEN_USAGE_COMPETITOR_BENCHMARKS.gemini31.inputTokens,
      outputTokens: TOKEN_USAGE_COMPETITOR_BENCHMARKS.gemini31.outputTokens,
      benchmarkChargeP: TOKEN_USAGE_COMPETITOR_BENCHMARKS.gemini31.chargeP,
      candidateMargins: PREMIUM_MARGIN_CANDIDATES.gemini31,
      minimumMarginFloor: 0.1,
    });
    assert.equal(r.rows.length, 7);
    // deterministic: 40689*2 +4307*12 =133062 tokens USD 0.133062 *1560.6 =207.6566
    assert.ok(Math.abs(r.providerListCostKrw - 207.6566) < 1, `providerList ${r.providerListCostKrw} vs 207.65`);
    assert.ok(r.benchmarkImpliedMaxMarginFromList != null && Math.abs(r.benchmarkImpliedMaxMarginFromList! - 0.1496) < 0.01);
    // verify 7 candidates exact ordering
    for (let i = 1; i < r.rows.length; i++) assert.ok(r.rows[i].targetMargin > r.rows[i-1].targetMargin);
    clearCheaperInferenceCatalogPricingForTest();
  });
  it("opus benchmark isolated from char benchmark — types separate", () => {
    setupCatalogFixture();
    setupFxFixture();
    const r = simulatePremiumCompetitive({
      modelId: "claude-opus-5",
      inputTokens: TOKEN_USAGE_COMPETITOR_BENCHMARKS.opus5.inputTokens,
      outputTokens: TOKEN_USAGE_COMPETITOR_BENCHMARKS.opus5.outputTokens,
      benchmarkChargeP: TOKEN_USAGE_COMPETITOR_BENCHMARKS.opus5.chargeP,
      candidateMargins: PREMIUM_MARGIN_CANDIDATES.opus5,
      minimumMarginFloor: 0.15,
    });
    assert.equal(r.rows.length, 9);
    // deterministic: 63749*5 +3629*25 =409470 USD 0.40947 *1560.6 =639.0189
    assert.ok(Math.abs(r.providerListCostKrw - 639.0189) < 1, `providerList ${r.providerListCostKrw} vs 639.01`);
    assert.ok(r.benchmarkImpliedMaxMarginFromList != null && Math.abs(r.benchmarkImpliedMaxMarginFromList! - 0.1382) < 0.01);
    for (const row of r.rows) {
      assert.ok(typeof row.flagReason === "string");
      assert.ok(typeof row.finalPoints === "number");
      assert.ok(typeof row.competitiveDeviationPct === "number" || row.competitiveDeviationPct === null);
    }
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
