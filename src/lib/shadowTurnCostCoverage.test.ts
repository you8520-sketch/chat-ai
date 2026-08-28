import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import {
  computeShadowPricing,
  resolveActualTurnCostCoverage,
} from "./shadowPricing";
import {
  clearCheaperInferenceCatalogPricingForTest,
  updateCheaperInferenceCatalogPricing,
} from "./cheaperInferenceCatalogPricing";
import {
  _clearShadowBillingFxMemoryForTest,
  _insertShadowBillingFxDailyRowForTest,
  _setShadowBillingFxTestDb,
} from "./shadowBillingExchangeRate";
import { ensureShadowBillingFxTables } from "./shadowBillingFxPersistence";
import Database from "better-sqlite3";

function setupFxFixture() {
  const db = new Database(":memory:");
  ensureShadowBillingFxTables(db);
  _setShadowBillingFxTestDb(db);
  _clearShadowBillingFxMemoryForTest();
  _insertShadowBillingFxDailyRowForTest({
    dateKey: "2026-08-28",
    baseUsdKrw: 1530,
    source: "api_daily",
  });
}

function setupCatalogFixture() {
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

describe("actual turn cost coverage gate", () => {
  beforeEach(() => {
    setupFxFixture();
    setupCatalogFixture();
  });

  afterEach(() => {
    clearCheaperInferenceCatalogPricingForTest();
    _setShadowBillingFxTestDb(null);
    _clearShadowBillingFxMemoryForTest();
  });

  it("single-call settled envelope can report complete reserve", () => {
    assert.equal(
      resolveActualTurnCostCoverage({
        totalStageCount: 1,
        hiddenFallbackOverheadCostUsd: 0,
        lengthRecoveryPasses: 0,
        lengthContinuationPasses: 0,
      }),
      "complete"
    );
    const s = computeShadowPricing({
      modelId: "claude-opus-5",
      promptTokens: 1000,
      outputTokens: 1000,
      cheaperInferenceBilledCostUsd: 0.008,
      actualTurnCostCoverage: "complete",
    });
    assert.equal(s.actualCostSource, "cheaper_inference_billed");
    assert.equal(s.actualTurnCostCoverage, "complete");
    assert.equal(s.reserveStatus, "complete");
    assert.ok(s.providerSavingsKrw != null);
    assert.ok(s.actualRealizedMargin != null);
  });

  it("multi-call partial cost cannot report complete reserve", () => {
    assert.equal(
      resolveActualTurnCostCoverage({
        totalStageCount: 2,
        hiddenFallbackOverheadCostUsd: 0,
        lengthRecoveryPasses: 0,
        lengthContinuationPasses: 0,
      }),
      "partial"
    );
    const s = computeShadowPricing({
      modelId: "claude-opus-5",
      promptTokens: 1000,
      outputTokens: 1000,
      cheaperInferenceBilledCostUsd: 0.008,
      actualTurnCostCoverage: "partial",
    });
    assert.equal(s.actualTurnCostCoverage, "partial");
    assert.notEqual(s.reserveStatus, "complete");
    assert.equal(s.providerSavingsKrw, null);
    assert.equal(s.providerOverrunKrw, null);
    assert.equal(s.netPricingBufferDeltaKrw, null);
    assert.equal(s.actualRealizedMargin, null);
  });

  it("hidden fallback overhead marks coverage partial", () => {
    assert.equal(
      resolveActualTurnCostCoverage({
        totalStageCount: 1,
        hiddenFallbackOverheadCostUsd: 0.002,
      }),
      "partial"
    );
  });

  it("length recovery marks coverage partial", () => {
    assert.equal(
      resolveActualTurnCostCoverage({
        totalStageCount: 1,
        lengthRecoveryPasses: 1,
      }),
      "partial"
    );
  });

  it("length continuation marks coverage partial", () => {
    assert.equal(
      resolveActualTurnCostCoverage({
        totalStageCount: 1,
        lengthContinuationPasses: 1,
      }),
      "partial"
    );
  });
});
