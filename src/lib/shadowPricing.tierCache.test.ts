import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCatalogPricing } from "./cheaperInferenceCatalogPricing.server";
import { updateCheaperInferenceCatalogPricing, clearCheaperInferenceCatalogPricingForTest } from "./cheaperInferenceCatalogPricing";
import { computeShadowPricing } from "./shadowPricing";
import { GEMINI31_TIERED_CATALOG_FIXTURE, GEMINI31_BASE_TIER_ONLY_CATALOG_FIXTURE } from "./fixtures/cheaperInferenceGemini31TierCatalog.fixture";
import {
  _clearShadowBillingFxMemoryForTest,
  _insertShadowBillingFxDailyRowForTest,
  _setShadowBillingFxKstNowForTest,
  _setShadowBillingFxTestDb,
} from "./shadowBillingExchangeRate";
import { ensureShadowBillingFxTables } from "./shadowBillingFxPersistence";
import Database from "better-sqlite3";

function setupFxFixture() {
  const db = new Database(":memory:");
  ensureShadowBillingFxTables(db);
  _setShadowBillingFxTestDb(db);
  _clearShadowBillingFxMemoryForTest();
  _setShadowBillingFxKstNowForTest(Date.parse("2026-08-28T00:00:00.000Z"));
  _insertShadowBillingFxDailyRowForTest({
    dateKey: "2026-08-28",
    baseUsdKrw: 1530,
    source: "api_daily",
  });
}

function teardownFxFixture() {
  _setShadowBillingFxTestDb(null);
  _clearShadowBillingFxMemoryForTest();
  _setShadowBillingFxKstNowForTest(null);
}

describe("shadowPricing tier and cache strictness", () => {
  it("Gemini31 uncached <=200k → billingReferenceCostStatus complete", () => {
    setupFxFixture();
    const s = computeShadowPricing({
      modelId: "gemini-3.1-pro-preview",
      promptTokens: 40_689,
      outputTokens: 4_307,
    });
    assert.equal(s.billingReferenceCostStatus, "complete");
    assert.ok(s.billingReferenceCostKrw > 0);
    teardownFxFixture();
  });

  it("Gemini31 prompt >200k → unsupported_pricing_tier (published base-tier only)", () => {
    setupFxFixture();
    const s = computeShadowPricing({
      modelId: "gemini-3.1-pro-preview",
      promptTokens: 200_001,
      outputTokens: 1_000,
    });
    assert.equal(s.billingReferenceCostStatus, "unsupported_pricing_tier");
    assert.equal(s.finalShadowPoints, 0);
    assert.equal(s.worstCasePromoMargin, null);
    teardownFxFixture();
  });

  it("Gemini31 cached turn → unsupported_cache_semantics", () => {
    clearCheaperInferenceCatalogPricingForTest();
    const parsed = parseCatalogPricing(GEMINI31_BASE_TIER_ONLY_CATALOG_FIXTURE, Date.now())!;
    updateCheaperInferenceCatalogPricing(parsed);
    setupFxFixture();
    const s = computeShadowPricing({
      modelId: "gemini-3.1-pro-preview",
      promptTokens: 10_000,
      cacheReadTokens: 5_000,
      outputTokens: 500,
    });
    assert.equal(s.billingReferenceCostStatus, "unsupported_cache_semantics");
    assert.equal(s.finalShadowPoints, 0);
    assert.equal(s.actualCostSource, "unavailable");
    assert.equal(s.actualProviderCostKrw, 0);
    assert.equal(s.actualCostUsd, undefined);
    assert.notEqual(s.reserveStatus, "complete");
    assert.equal(s.worstCasePromoMargin, null);
    clearCheaperInferenceCatalogPricingForTest();
    teardownFxFixture();
  });

  it("Gemini31 cached + exact billed cost retains settled actual but billing reference unsupported", () => {
    clearCheaperInferenceCatalogPricingForTest();
    const parsed = parseCatalogPricing(GEMINI31_BASE_TIER_ONLY_CATALOG_FIXTURE, Date.now())!;
    updateCheaperInferenceCatalogPricing(parsed);
    setupFxFixture();
    const s = computeShadowPricing({
      modelId: "gemini-3.1-pro-preview",
      promptTokens: 10_000,
      cacheReadTokens: 5_000,
      outputTokens: 500,
      cheaperInferenceBilledCostUsd: 0.012345,
    });
    assert.equal(s.actualCostSource, "cheaper_inference_billed");
    assert.equal(s.actualCostUsd, 0.012345);
    assert.equal(s.billingReferenceCostStatus, "unsupported_cache_semantics");
    assert.equal(s.finalShadowPoints, 0);
    assert.notEqual(s.reserveStatus, "complete");
    clearCheaperInferenceCatalogPricingForTest();
    teardownFxFixture();
  });

  it("ABOVE_THRESHOLD_REQUEST_USES_BASE_PROVIDER_LIST_RATE: false", () => {
    clearCheaperInferenceCatalogPricingForTest();
    const parsed = parseCatalogPricing(GEMINI31_BASE_TIER_ONLY_CATALOG_FIXTURE, Date.now())!;
    updateCheaperInferenceCatalogPricing(parsed);
    setupFxFixture();
    const s = computeShadowPricing({
      modelId: "gemini-3.1-pro-preview",
      promptTokens: 200_001,
      outputTokens: 1_000,
    });
    assert.equal(s.providerListCostStatus, "tier_reference_rates_unavailable");
    assert.notEqual(s.providerListCostStatus, "complete");
    clearCheaperInferenceCatalogPricingForTest();
    teardownFxFixture();
  });

  it("above-threshold with full CI tier uses above reference rates for provider list", () => {
    clearCheaperInferenceCatalogPricingForTest();
    const parsed = parseCatalogPricing(GEMINI31_TIERED_CATALOG_FIXTURE, Date.now())!;
    updateCheaperInferenceCatalogPricing(parsed);
    setupFxFixture();
    const base = computeShadowPricing({
      modelId: "gemini-3.1-pro-preview",
      promptTokens: 100_000,
      outputTokens: 1_000,
    });
    const above = computeShadowPricing({
      modelId: "gemini-3.1-pro-preview",
      promptTokens: 250_000,
      outputTokens: 1_000,
    });
    assert.equal(base.providerListCostStatus, "complete");
    assert.equal(above.providerListCostStatus, "complete");
    assert.ok(above.providerListCostKrw > base.providerListCostKrw);
    assert.equal(above.billingReferenceCostStatus, "unsupported_pricing_tier");
    clearCheaperInferenceCatalogPricingForTest();
    teardownFxFixture();
  });

  it("Opus5 uncached → billingReferenceCostStatus complete", () => {
    setupFxFixture();
    const s = computeShadowPricing({
      modelId: "claude-opus-5",
      promptTokens: 63_749,
      outputTokens: 3_629,
    });
    assert.equal(s.billingReferenceCostStatus, "complete");
    teardownFxFixture();
  });

  it("Opus5 cached with verified 5m published rates → billingReferenceCostStatus complete", () => {
    setupFxFixture();
    const s = computeShadowPricing({
      modelId: "claude-opus-5",
      promptTokens: 10_000,
      cacheReadTokens: 2_000,
      cacheWriteTokens: 1_000,
      outputTokens: 500,
    });
    assert.equal(s.billingReferenceCostStatus, "complete");
    teardownFxFixture();
  });
});
