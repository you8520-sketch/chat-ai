import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  simulatePremiumCompetitive,
  TOKEN_USAGE_COMPETITOR_BENCHMARKS,
  PREMIUM_MARGIN_CANDIDATES,
} from "./shadowSimulations";
import { clearCheaperInferenceCatalogPricingForTest, updateCheaperInferenceCatalogPricing } from "./cheaperInferenceCatalogPricing";
import { _insertShadowBillingFxDailyRowForTest, _setShadowBillingFxTestDb, _clearShadowBillingFxMemoryForTest } from "./shadowBillingExchangeRate";
import { ensureShadowBillingFxTables } from "./shadowBillingFxPersistence";
import Database from "better-sqlite3";

const TEST_BASE_FX = 1530;
const TEST_EFFECTIVE_FX = 1560.6;

const GEMINI_ROW_FIXTURES = [
  { targetMargin: 0.1, finalPoints: 231, competitiveDeviationPct: -5.4, noDiscountRealizedMargin: 10.1, flag: "GREEN" as const, flagReason: "competitive_and_safe" as const },
  { targetMargin: 0.125, finalPoints: 238, competitiveDeviationPct: -2.5, noDiscountRealizedMargin: 12.7, flag: "GREEN" as const, flagReason: "competitive_and_safe" as const },
  { targetMargin: 0.14, finalPoints: 242, competitiveDeviationPct: -0.9, noDiscountRealizedMargin: 14.2, flag: "GREEN" as const, flagReason: "competitive_and_safe" as const },
  { targetMargin: 0.145, finalPoints: 243, competitiveDeviationPct: -0.5, noDiscountRealizedMargin: 14.5, flag: "GREEN" as const, flagReason: "competitive_and_safe" as const },
  { targetMargin: 0.15, finalPoints: 245, competitiveDeviationPct: 0.3, noDiscountRealizedMargin: 15.2, flag: "YELLOW" as const, flagReason: "margin_can_be_reduced_to_match_market" as const },
  { targetMargin: 0.175, finalPoints: 252, competitiveDeviationPct: 3.2, noDiscountRealizedMargin: 17.6, flag: "YELLOW" as const, flagReason: "margin_can_be_reduced_to_match_market" as const },
  { targetMargin: 0.2, finalPoints: 260, competitiveDeviationPct: 6.5, noDiscountRealizedMargin: 20.1, flag: "YELLOW" as const, flagReason: "margin_can_be_reduced_to_match_market" as const },
];

const OPUS_ROW_FIXTURES = [
  { targetMargin: 0.08, finalPoints: 695, competitiveDeviationPct: -6.3, noDiscountRealizedMargin: 8.1, flag: "YELLOW" as const, flagReason: "competitive_but_below_floor" as const },
  { targetMargin: 0.1, finalPoints: 710, competitiveDeviationPct: -4.2, noDiscountRealizedMargin: 10, flag: "YELLOW" as const, flagReason: "competitive_but_below_floor" as const },
  { targetMargin: 0.12, finalPoints: 727, competitiveDeviationPct: -2, noDiscountRealizedMargin: 12.1, flag: "YELLOW" as const, flagReason: "competitive_but_below_floor" as const },
  { targetMargin: 0.13, finalPoints: 735, competitiveDeviationPct: -0.9, noDiscountRealizedMargin: 13.1, flag: "YELLOW" as const, flagReason: "competitive_but_below_floor" as const },
  { targetMargin: 0.135, finalPoints: 739, competitiveDeviationPct: -0.3, noDiscountRealizedMargin: 13.5, flag: "YELLOW" as const, flagReason: "competitive_but_below_floor" as const },
  { targetMargin: 0.14, finalPoints: 744, competitiveDeviationPct: 0.3, noDiscountRealizedMargin: 14.1, flag: "RED" as const, flagReason: "minimum_safe_price_above_market" as const },
  { targetMargin: 0.15, finalPoints: 752, competitiveDeviationPct: 1.4, noDiscountRealizedMargin: 15, flag: "RED" as const, flagReason: "minimum_safe_price_above_market" as const },
  { targetMargin: 0.175, finalPoints: 775, competitiveDeviationPct: 4.5, noDiscountRealizedMargin: 17.5, flag: "RED" as const, flagReason: "minimum_safe_price_above_market" as const },
  { targetMargin: 0.2, finalPoints: 799, competitiveDeviationPct: 7.8, noDiscountRealizedMargin: 20, flag: "RED" as const, flagReason: "minimum_safe_price_above_market" as const },
];

function setupFxFixture() {
  const db = new Database(":memory:");
  ensureShadowBillingFxTables(db);
  _setShadowBillingFxTestDb(db);
  _clearShadowBillingFxMemoryForTest();
  _insertShadowBillingFxDailyRowForTest({
    dateKey: "2026-08-28",
    baseUsdKrw: TEST_BASE_FX,
    source: "api_daily",
  });
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

function assertRowMatchesFixture(
  row: {
    targetMargin: number;
    finalPoints: number;
    competitiveDeviationPct: number | null;
    noDiscountRealizedMargin: number | null;
    flag: string;
    flagReason: string;
  },
  fixture: (typeof GEMINI_ROW_FIXTURES)[number]
) {
  assert.equal(row.targetMargin, fixture.targetMargin);
  assert.equal(row.finalPoints, fixture.finalPoints);
  assert.equal(row.competitiveDeviationPct, fixture.competitiveDeviationPct);
  assert.equal(row.noDiscountRealizedMargin, fixture.noDiscountRealizedMargin);
  assert.equal(row.flag, fixture.flag);
  assert.equal(row.flagReason, fixture.flagReason);
}

describe("shadowSimulations benchmark isolation", () => {
  it("gemini benchmark isolated — 7 candidate rows match deterministic fixture", () => {
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
    assert.equal(r.providerListCostKrw, 207.7);
    assert.equal(r.fxSnapshot.source, "api_daily");
    assert.equal(r.fxSnapshot.baseUsdKrw, TEST_BASE_FX);
    assert.ok(Math.abs(r.fxSnapshot.effectiveKrwPerUsd - TEST_EFFECTIVE_FX) < 1e-9);
    assert.ok(r.benchmarkImpliedMaxMarginFromList != null && Math.abs(r.benchmarkImpliedMaxMarginFromList! - 0.1496) < 0.01);
    for (let i = 0; i < GEMINI_ROW_FIXTURES.length; i++) {
      assertRowMatchesFixture(r.rows[i], GEMINI_ROW_FIXTURES[i]);
    }
    clearCheaperInferenceCatalogPricingForTest();
  });

  it("opus benchmark isolated — 9 candidate rows match deterministic fixture", () => {
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
    assert.equal(r.providerListCostKrw, 639);
    assert.equal(r.fxSnapshot.source, "api_daily");
    assert.ok(r.benchmarkImpliedMaxMarginFromList != null && Math.abs(r.benchmarkImpliedMaxMarginFromList! - 0.1382) < 0.01);
    for (let i = 0; i < OPUS_ROW_FIXTURES.length; i++) {
      assertRowMatchesFixture(r.rows[i], OPUS_ROW_FIXTURES[i]);
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
