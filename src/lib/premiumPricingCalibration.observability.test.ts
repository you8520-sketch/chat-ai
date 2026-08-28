import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, it } from "node:test";
import {
  clearCheaperInferenceCatalogPricingForTest,
  resolveCheaperInferenceCatalogPricing,
  updateCheaperInferenceCatalogPricing,
  type CheaperInferenceCatalogPricing,
} from "./cheaperInferenceCatalogPricing";
import { parseCatalogPricing } from "./cheaperInferenceCatalogPricing.server";
import { GEMINI31_BASE_TIER_ONLY_CATALOG_FIXTURE } from "./fixtures/cheaperInferenceGemini31TierCatalog.fixture";
import {
  buildPremiumFxSensitivity,
  buildPremiumMarginMatrix,
  computeBenchmarkImpliedMaxMargin,
  computeCompetitiveFxCeiling,
  evaluateFxMarketStatus,
  evaluateHardComparableStatus,
  evaluatePremiumPricingGates,
  GEMINI31_MODEL_ID,
  GEMINI31_V2_PROPOSED,
  getPremiumCacheEvidenceReports,
  isPremiumCacheReadyForLiveCutover,
  OPUS5_MODEL_ID,
  OPUS5_V2_PROPOSED,
  PREMIUM_MARGIN_CANDIDATES,
  simulatePremiumPricingPolicy,
} from "./premiumPricingCalibration";
import { computeShadowPricing } from "./shadowPricing";
import {
  TOKEN_USAGE_COMPETITOR_BENCHMARKS,
  simulatePremiumCompetitive,
} from "./shadowSimulations";
import { getPublishedPricing } from "./publishedModelPricing";
import {
  _clearShadowBillingFxMemoryForTest,
  _insertShadowBillingFxDailyRowForTest,
  _setShadowBillingFxKstNowForTest,
  _setShadowBillingFxTestDb,
  peekShadowBillingFxDailySnapshot,
  previewShadowBillingFxSnapshot,
} from "./shadowBillingExchangeRate";
import {
  countAllShadowBillingFxDailySnapshots,
  ensureShadowBillingFxTables,
} from "./shadowBillingFxPersistence";

const REPO_ROOT = join(import.meta.dirname, "..", "..");

function readRepoFile(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), "utf8");
}

function setupShadowFxIsolation(): Database.Database {
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
  return db;
}

function teardownShadowFxIsolation(db: Database.Database): void {
  _setShadowBillingFxTestDb(null);
  _clearShadowBillingFxMemoryForTest();
  _setShadowBillingFxKstNowForTest(null);
  db.close();
}

function setupEmptyShadowFxDb(): Database.Database {
  const db = new Database(":memory:");
  ensureShadowBillingFxTables(db);
  _setShadowBillingFxTestDb(db);
  _clearShadowBillingFxMemoryForTest();
  _setShadowBillingFxKstNowForTest(Date.parse("2026-08-28T00:00:00.000Z"));
  return db;
}

function teardownShadowFxDb(db: Database.Database): void {
  _setShadowBillingFxTestDb(null);
  _clearShadowBillingFxMemoryForTest();
  _setShadowBillingFxKstNowForTest(null);
  db.close();
}

function withGemini31CatalogNoExplicitCache<T>(fn: () => T): T {
  clearCheaperInferenceCatalogPricingForTest();
  const parsed = parseCatalogPricing(GEMINI31_BASE_TIER_ONLY_CATALOG_FIXTURE, Date.now());
  if (parsed) updateCheaperInferenceCatalogPricing(parsed);
  try {
    return fn();
  } finally {
    clearCheaperInferenceCatalogPricingForTest();
  }
}

function verifyUnsupportedDimensionShadowSafety(): boolean {
  const geminiAbove = computeShadowPricing({
    modelId: GEMINI31_MODEL_ID,
    promptTokens: 200_001,
    outputTokens: 1_000,
  });
  const geminiCached = computeShadowPricing({
    modelId: GEMINI31_MODEL_ID,
    promptTokens: 10_000,
    cacheReadTokens: 1_000,
    outputTokens: 500,
  });
  const geminiUncached = computeShadowPricing({
    modelId: GEMINI31_MODEL_ID,
    promptTokens: 40_689,
    outputTokens: 4_307,
  });
  return (
    geminiAbove.billingReferenceCostStatus !== "complete" &&
    geminiCached.billingReferenceCostStatus !== "complete" &&
    geminiUncached.billingReferenceCostStatus === "complete" &&
    geminiAbove.worstCasePromoMargin == null &&
    geminiCached.worstCasePromoMargin == null &&
    geminiAbove.reserveStatus !== "complete"
  );
}

function verifyUnverifiedCacheBlocksLiveCatalogActualEstimate(): boolean {
  return withGemini31CatalogNoExplicitCache(() => {
    const s = computeShadowPricing({
      modelId: GEMINI31_MODEL_ID,
      promptTokens: 10_000,
      cacheReadTokens: 5_000,
      outputTokens: 500,
    });
    return (
      s.billingReferenceCostStatus === "unsupported_cache_semantics" &&
      s.actualCostSource === "unavailable" &&
      s.actualProviderCostKrw === 0 &&
      s.actualCostUsd === undefined &&
      s.finalShadowPoints === 0 &&
      s.reserveStatus !== "complete" &&
      s.worstCasePromoMargin == null
    );
  });
}

function verifyExactSettledCostSurvivesUnsupportedBillingReference(): boolean {
  return withGemini31CatalogNoExplicitCache(() => {
    const s = computeShadowPricing({
      modelId: GEMINI31_MODEL_ID,
      promptTokens: 10_000,
      cacheReadTokens: 5_000,
      outputTokens: 500,
      cheaperInferenceBilledCostUsd: 0.012345,
    });
    return (
      s.actualCostSource === "cheaper_inference_billed" &&
      s.actualCostUsd === 0.012345 &&
      s.billingReferenceCostStatus === "unsupported_cache_semantics" &&
      s.finalShadowPoints === 0 &&
      s.reserveStatus !== "complete"
    );
  });
}

function snapshotCatalog(modelIds: readonly string[]): Record<string, CheaperInferenceCatalogPricing | null> {
  return Object.fromEntries(modelIds.map((id) => [id, resolveCheaperInferenceCatalogPricing(id)]));
}

function catalogSnapshotsEqual(
  before: Record<string, CheaperInferenceCatalogPricing | null>,
  after: Record<string, CheaperInferenceCatalogPricing | null>
): boolean {
  return JSON.stringify(before) === JSON.stringify(after);
}

/** Mirrors read-only premium diagnostics invoked by /admin/pricing. */
function invokeAdminPremiumDiagnosticsReadOnly(): void {
  peekShadowBillingFxDailySnapshot();
  previewShadowBillingFxSnapshot();

  evaluatePremiumPricingGates();
  getPremiumCacheEvidenceReports();
  isPremiumCacheReadyForLiveCutover();

  for (const modelId of [GEMINI31_MODEL_ID, OPUS5_MODEL_ID] as const) {
    const published = modelId === GEMINI31_MODEL_ID ? GEMINI31_V2_PROPOSED : OPUS5_V2_PROPOSED;
    simulatePremiumPricingPolicy({
      modelId,
      published,
      targetMargin: published.targetMargin,
      baseFx: 1530,
    });
    buildPremiumMarginMatrix({ modelId, published });
    buildPremiumFxSensitivity({ modelId, published });
    computeCompetitiveFxCeiling({
      modelId,
      published,
      targetMargin: published.targetMargin,
    });
    evaluateHardComparableStatus({ modelId, published, baseFx: 1530 });
    computeBenchmarkImpliedMaxMargin({ modelId, baseFx: 1530 });
    resolveCheaperInferenceCatalogPricing(modelId);
  }

  const currentFx = peekShadowBillingFxDailySnapshot()?.usdToKrw ?? previewShadowBillingFxSnapshot().usdToKrw;
  evaluateFxMarketStatus({
    currentBaseFx: currentFx,
    competitiveFxCeiling: computeCompetitiveFxCeiling({
      modelId: GEMINI31_MODEL_ID,
      published: GEMINI31_V2_PROPOSED,
      targetMargin: GEMINI31_V2_PROPOSED.targetMargin,
    }),
  });

  simulatePremiumCompetitive({
    modelId: GEMINI31_MODEL_ID,
    inputTokens: TOKEN_USAGE_COMPETITOR_BENCHMARKS.gemini31.inputTokens,
    outputTokens: TOKEN_USAGE_COMPETITOR_BENCHMARKS.gemini31.outputTokens,
    benchmarkChargeP: TOKEN_USAGE_COMPETITOR_BENCHMARKS.gemini31.chargeP,
    candidateMargins: PREMIUM_MARGIN_CANDIDATES.gemini31,
    minimumMarginFloor: getPublishedPricing(GEMINI31_MODEL_ID).minimumMarginFloor,
  });
  simulatePremiumCompetitive({
    modelId: OPUS5_MODEL_ID,
    inputTokens: TOKEN_USAGE_COMPETITOR_BENCHMARKS.opus5.inputTokens,
    outputTokens: TOKEN_USAGE_COMPETITOR_BENCHMARKS.opus5.outputTokens,
    benchmarkChargeP: TOKEN_USAGE_COMPETITOR_BENCHMARKS.opus5.chargeP,
    candidateMargins: PREMIUM_MARGIN_CANDIDATES.opus5,
    minimumMarginFloor: getPublishedPricing(OPUS5_MODEL_ID).minimumMarginFloor,
  });
}

describe("premiumPricingCalibration observability purity", () => {
  it("production calibration module has no test fixture or mutating shadow imports", () => {
    const src = readRepoFile("src/lib/premiumPricingCalibration.ts");
    assert.ok(!src.includes("ForTest"));
    assert.ok(!src.includes("fixtures/"));
    assert.ok(!src.includes("computeShadowPricing"));
    assert.ok(!src.includes("parseCatalogPricing"));
    assert.ok(!src.includes("updateCheaperInferenceCatalogPricing"));
    assert.ok(!src.includes("clearCheaperInferenceCatalogPricingForTest"));
  });

  it("admin pricing page has no mutating shadow resolver imports", () => {
    const src = readRepoFile("src/app/admin/pricing/page.tsx");
    assert.ok(!src.includes("computeShadowPricing"));
    assert.ok(!src.includes("resolveShadowBillingExchangeRateSnapshot"));
    assert.ok(!src.includes("ForTest"));
    assert.ok(!src.includes("fixtures/"));
  });

  it("admin premium diagnostics with empty FX DB create zero daily rows", () => {
    const db = setupEmptyShadowFxDb();
    try {
      const before = countAllShadowBillingFxDailySnapshots(db);
      assert.equal(before, 0);
      invokeAdminPremiumDiagnosticsReadOnly();
      const after = countAllShadowBillingFxDailySnapshots(db);
      assert.equal(after, 0);
    } finally {
      teardownShadowFxDb(db);
    }
  });

  it("admin premium diagnostics do not mutate seeded CI catalog cache", () => {
    clearCheaperInferenceCatalogPricingForTest();
    const sentinel: CheaperInferenceCatalogPricing = {
      modelId: "sentinel-premium-catalog-model",
      inputUsdPerMillion: 9.876543,
      outputUsdPerMillion: 8.765432,
      cacheReadUsdPerMillion: 0.987654,
      cacheWriteUsdPerMillion: 9.876543,
      referenceInputUsdPerMillion: 11.111111,
      referenceOutputUsdPerMillion: 22.222222,
      fetchedAt: 1_700_000_000_000,
    };
    const geminiParsed = parseCatalogPricing(GEMINI31_BASE_TIER_ONLY_CATALOG_FIXTURE, Date.now());
    if (geminiParsed) updateCheaperInferenceCatalogPricing(geminiParsed);
    updateCheaperInferenceCatalogPricing(sentinel);

    const watchedIds = [GEMINI31_MODEL_ID, sentinel.modelId] as const;
    const before = snapshotCatalog(watchedIds);
    invokeAdminPremiumDiagnosticsReadOnly();
    const after = snapshotCatalog(watchedIds);

    assert.equal(catalogSnapshotsEqual(before, after), true);
    clearCheaperInferenceCatalogPricingForTest();
  });

  it("runtime acceptance gates are read-only — no shadow safety fields", () => {
    const gates = evaluatePremiumPricingGates();
    assert.equal("UNSUPPORTED_DIMENSION_IS_BLOCKED" in gates, false);
    assert.equal("UNVERIFIED_CACHE_LIVE_CATALOG_ACTUAL_ESTIMATE_BLOCKED" in gates, false);
    assert.equal("EXACT_SETTLED_COST_SURVIVES_UNSUPPORTED_BILLING_REFERENCE" in gates, false);
    assert.equal(gates.allPass, true);
  });
});

describe("premiumPricingCalibration adversarial safety invariants (test-only)", () => {
  it("TESTED_INVARIANT_UNSUPPORTED_DIMENSION_IS_BLOCKED", () => {
    const db = setupShadowFxIsolation();
    try {
      assert.equal(verifyUnsupportedDimensionShadowSafety(), true);
    } finally {
      teardownShadowFxIsolation(db);
    }
  });

  it("TESTED_INVARIANT_UNVERIFIED_CACHE_ACTUAL_ESTIMATE_BLOCKED", () => {
    const db = setupShadowFxIsolation();
    try {
      assert.equal(verifyUnverifiedCacheBlocksLiveCatalogActualEstimate(), true);
    } finally {
      teardownShadowFxIsolation(db);
    }
  });

  it("TESTED_INVARIANT_EXACT_SETTLED_COST_SURVIVES", () => {
    const db = setupShadowFxIsolation();
    try {
      assert.equal(verifyExactSettledCostSurvivesUnsupportedBillingReference(), true);
    } finally {
      teardownShadowFxIsolation(db);
    }
  });
});
