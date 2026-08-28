import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, it } from "node:test";
import {
  assessGemini31Above200kReachability,
  buildCurrentProductReadinessMatrix,
  buildLiveBillingCutoverAuditReport,
  classifyModelCutoverReadiness,
  computeMigrationDeltaRows,
  countPublicReceiptInternalLeakPaths,
  evaluateLiveBillingCutoverReadiness,
  GEMINI31_MODEL_ID,
  LIVE_BILLING_OWNER_AUDIT,
  OPUS5_MODEL_ID,
  verifyFxReadOnlyPreviewPath,
  verifyKstMidnightBoundary,
  verifyModelAliasResolvesToSinglePublishedPolicy,
  verifyReasoningNotDoubleCounted,
} from "./liveBillingCutoverReadiness";
import { evaluatePremiumPricingGates } from "./premiumPricingCalibration";
import {
  clearCheaperInferenceCatalogPricingForTest,
  resolveCheaperInferenceCatalogPricing,
  updateCheaperInferenceCatalogPricing,
  type CheaperInferenceCatalogPricing,
} from "./cheaperInferenceCatalogPricing";
import {
  _clearShadowBillingFxMemoryForTest,
  _setShadowBillingFxKstNowForTest,
  _setShadowBillingFxTestDb,
  peekShadowBillingFxDailySnapshot,
  previewShadowBillingFxSnapshot,
} from "./shadowBillingExchangeRate";
import {
  countAllShadowBillingFxDailySnapshots,
  ensureShadowBillingFxTables,
} from "./shadowBillingFxPersistence";
import { computeShadowPricing } from "./shadowPricing";
import { GEMINI31_BASE_TIER_PROMPT_THRESHOLD } from "./premiumModelIds";
import { parseCatalogPricing } from "./cheaperInferenceCatalogPricing.server";
import { GEMINI31_BASE_TIER_ONLY_CATALOG_FIXTURE } from "./fixtures/cheaperInferenceGemini31TierCatalog.fixture";
import {
  _insertShadowBillingFxDailyRowForTest,
} from "./shadowBillingExchangeRate";

const REPO_ROOT = join(import.meta.dirname, "..", "..");

describe("liveBillingCutoverReadiness — production boundary", () => {
  it("readiness module has no deductPoints, ForTest, or computeShadowPricing imports", () => {
    const src = readFileSync(join(REPO_ROOT, "src/lib/liveBillingCutoverReadiness.ts"), "utf8");
    const importLines = src.split("\n").filter((line) => line.trimStart().startsWith("import "));
    assert.ok(importLines.every((line) => !line.includes("deductPoints")));
    assert.ok(importLines.every((line) => !line.includes("ForTest")));
    assert.ok(importLines.every((line) => !line.includes("computeShadowPricing")));
    assert.ok(importLines.every((line) => !line.includes("resolveShadowBillingExchangeRateSnapshot")));
    const withoutOwnerAudit = src.replace(/export const LIVE_BILLING_OWNER_AUDIT[\s\S]*?} as const;/, "");
    assert.ok(!/\bdeductPoints\s*\(/.test(withoutOwnerAudit));
  });

  it("owner audit invariants", () => {
    assert.equal(LIVE_BILLING_OWNER_AUDIT.currentDeductionOwnerCount, 1);
    assert.equal(LIVE_BILLING_OWNER_AUDIT.publishedPricingLiveDeductionCalls, 0);
  });
});

describe("liveBillingCutoverReadiness — reachability", () => {
  it("Gemini31 >200k not reachable under current assembly budgets", () => {
    const a = assessGemini31Above200kReachability();
    assert.equal(a.productReachability, "not_reachable_current_product");
    assert.equal(a.effectiveCurrentProductBlocker, false);
    assert.equal(a.pricingCoverage, "unsupported");
  });

  it("Gemini31 tier boundary shadow invariants retained", () => {
    const db = new Database(":memory:");
    ensureShadowBillingFxTables(db);
    _setShadowBillingFxTestDb(db);
    _clearShadowBillingFxMemoryForTest();
    _setShadowBillingFxKstNowForTest(Date.parse("2026-08-28T00:00:00.000Z"));
    _insertShadowBillingFxDailyRowForTest({ dateKey: "2026-08-28", baseUsdKrw: 1530, source: "api_daily" });
    try {
      const at200k = computeShadowPricing({
        modelId: GEMINI31_MODEL_ID,
        promptTokens: GEMINI31_BASE_TIER_PROMPT_THRESHOLD,
        outputTokens: 100,
      });
      const above = computeShadowPricing({
        modelId: GEMINI31_MODEL_ID,
        promptTokens: GEMINI31_BASE_TIER_PROMPT_THRESHOLD + 1,
        outputTokens: 100,
      });
      assert.equal(at200k.billingReferenceCostStatus, "complete");
      assert.equal(above.billingReferenceCostStatus, "unsupported_pricing_tier");
    } finally {
      _setShadowBillingFxTestDb(null);
      _clearShadowBillingFxMemoryForTest();
      _setShadowBillingFxKstNowForTest(null);
      db.close();
    }
  });
});

describe("liveBillingCutoverReadiness — migration delta @1530", () => {
  it("golden planned Published fixtures", () => {
    const rows = computeMigrationDeltaRows();
    const g37a = rows.find((r) => r.benchmarkId === "gemini37_competitor_a")!;
    const g37b = rows.find((r) => r.benchmarkId === "gemini37_competitor_b")!;
    const g31 = rows.find((r) => r.benchmarkId === "gemini31_competitor_a")!;
    const opus = rows.find((r) => r.benchmarkId === "opus5_competitor_a")!;

    assert.equal(g37a.plannedPublishedFinalPoints, 48);
    assert.equal(g37b.plannedPublishedFinalPoints, 80);
    assert.equal(g31.plannedPublishedFinalPoints, 229);
    assert.equal(opus.plannedPublishedFinalPoints, 695);
    assert.ok(g37a.legacyFinalPoints !== g37a.plannedPublishedFinalPoints);
    assert.ok(g31.legacyFinalPoints !== g31.plannedPublishedFinalPoints);
  });
});

describe("liveBillingCutoverReadiness — usage / receipt / FX", () => {
  it("reasoning is not double-counted in billable output", () => {
    assert.equal(verifyReasoningNotDoubleCounted(), true);
  });

  it("model alias resolves to single Published policy", () => {
    assert.equal(verifyModelAliasResolvesToSinglePublishedPolicy(), true);
  });

  it("public receipt sanitize removes internal economics", () => {
    assert.equal(countPublicReceiptInternalLeakPaths(), 0);
  });

  it("KST midnight boundary", () => {
    assert.equal(verifyKstMidnightBoundary(), true);
  });

  it("readiness diagnostics use read-only FX preview only", () => {
    const db = new Database(":memory:");
    ensureShadowBillingFxTables(db);
    _setShadowBillingFxTestDb(db);
    _clearShadowBillingFxMemoryForTest();
    _setShadowBillingFxKstNowForTest(Date.parse("2026-08-28T00:00:00.000Z"));
    try {
      assert.equal(countAllShadowBillingFxDailySnapshots(db), 0);
      verifyFxReadOnlyPreviewPath();
      evaluateLiveBillingCutoverReadiness("test-sha");
      evaluatePremiumPricingGates();
      peekShadowBillingFxDailySnapshot();
      previewShadowBillingFxSnapshot();
      assert.equal(countAllShadowBillingFxDailySnapshots(db), 0);
    } finally {
      _setShadowBillingFxTestDb(null);
      _clearShadowBillingFxMemoryForTest();
      _setShadowBillingFxKstNowForTest(null);
      db.close();
    }
  });

  it("readiness diagnostics do not mutate CI catalog cache", () => {
    clearCheaperInferenceCatalogPricingForTest();
    const sentinel: CheaperInferenceCatalogPricing = {
      modelId: "sentinel-readiness-catalog",
      inputUsdPerMillion: 3.141592,
      outputUsdPerMillion: 2.718281,
      cacheReadUsdPerMillion: 0.314159,
      cacheWriteUsdPerMillion: 3.141592,
      fetchedAt: 1_700_000_000_000,
    };
    const parsed = parseCatalogPricing(GEMINI31_BASE_TIER_ONLY_CATALOG_FIXTURE, Date.now());
    if (parsed) updateCheaperInferenceCatalogPricing(parsed);
    updateCheaperInferenceCatalogPricing(sentinel);
    const before = JSON.stringify([
      resolveCheaperInferenceCatalogPricing(GEMINI31_MODEL_ID),
      resolveCheaperInferenceCatalogPricing(sentinel.modelId),
    ]);
    evaluateLiveBillingCutoverReadiness("test-sha");
    const after = JSON.stringify([
      resolveCheaperInferenceCatalogPricing(GEMINI31_MODEL_ID),
      resolveCheaperInferenceCatalogPricing(sentinel.modelId),
    ]);
    assert.equal(before, after);
    clearCheaperInferenceCatalogPricingForTest();
  });
});

describe("liveBillingCutoverReadiness — matrix and classification", () => {
  it("readiness matrix is complete for three audit models", () => {
    const matrix = buildCurrentProductReadinessMatrix();
    const requiredRows = [
      "Base uncached usage",
      "Cache read",
      "Cache write",
      "Above pricing threshold",
      "Reasoning accounting",
      "Multi-stage turn",
      "Fallback",
      "Continuation/recovery",
      "Missing usage",
      "Quality waiver",
      "Receipt",
      "Idempotency",
      "FX snapshot",
    ] as const;
    for (const modelId of ["gemini-3.7-flash", GEMINI31_MODEL_ID, OPUS5_MODEL_ID]) {
      assert.ok(matrix[modelId], `missing matrix for ${modelId}`);
      for (const row of requiredRows) {
        assert.ok(matrix[modelId][row], `${modelId} missing ${row}`);
      }
    }
  });

  it("no model is CURRENT PRODUCT CUTOVER READY (A) without policy work", () => {
    assert.notEqual(classifyModelCutoverReadiness("gemini-3.7-flash"), "A");
    assert.notEqual(classifyModelCutoverReadiness(GEMINI31_MODEL_ID), "A");
    assert.notEqual(classifyModelCutoverReadiness(OPUS5_MODEL_ID), "A");
  });

  it("audit report enumerates cutover blockers", () => {
    const report = buildLiveBillingCutoverAuditReport("test-sha");
    assert.ok(report.cutoverBlockers.length >= 3);
    assert.equal(report.receipt.publicReceiptInternalLeakPaths, 0);
    assert.equal(report.idempotency.duplicateRequestDoubleChargePossible, false);
    assert.equal(report.fx.adminReadCanLockFx, false);
    assert.equal(report.pureLiveChargeEngineExtractionRequired, true);
    assert.equal(report.numericCostOwnerOnlyCutoverPossible, true);
  });
});
