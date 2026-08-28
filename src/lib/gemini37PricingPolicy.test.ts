import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GEMINI37_BENCHMARK_A_ID,
  GEMINI37_BENCHMARK_B_ID,
  getMarketBenchmark,
  MODEL_MARKET_BENCHMARKS,
  requirePrimaryBenchmark,
  sumInputBreakdown,
} from "./marketUsageBenchmarks";
import {
  buildGemini37FxSensitivityMatrix,
  buildGemini37MarginMatrix,
  buildGemini37UncachedCatalogFixture,
  computeCalibrationDiscountTheoreticalMargin,
  computeDirectStandardStressMargin,
  diagnoseGemini37V1AtBaseFx,
  evaluateGemini37V2AcceptanceGates,
  FX_FIXTURE_BASE_1530,
  FX_FIXTURE_BASE_1600,
  GEMINI37_MODEL_ID,
  GEMINI37_V1_PUBLISHED,
  GEMINI37_V2_PROPOSED,
  GOOGLE_STANDARD_INTRO_VALID_THROUGH,
  simulateGemini37PolicyRow,
  simulateGemini37ViaShadowPipeline,
  buildFxSnapshotFromBase,
} from "./gemini37PricingPolicy";
import {
  calibrationReferenceEvidenceMatchesV2,
  evaluateLiveReferenceDrift,
  GEMINI37_CALIBRATION_RATE_EVIDENCE,
} from "./gemini37CalibrationEvidence";
import { getPublishedPricing } from "./publishedModelPricing";
import { clearCheaperInferenceCatalogPricingForTest, updateCheaperInferenceCatalogPricing } from "./cheaperInferenceCatalogPricing";

const EFFECTIVE_1530 = 1530 * 1.02;
const EFFECTIVE_1600 = 1600 * 1.02;

describe("marketUsageBenchmarks canonical owner", () => {
  it("MODEL_MARKET_BENCHMARKS is sole token-usage competitor owner", () => {
    assert.equal(MODEL_MARKET_BENCHMARKS["gemini-3.1-pro-preview"].length, 1);
    assert.equal(MODEL_MARKET_BENCHMARKS["claude-opus-5"].length, 1);
    assert.equal(requirePrimaryBenchmark("gemini-3.1-pro-preview").inputTokens, 40_689);
    assert.equal(requirePrimaryBenchmark("claude-opus-5").inputTokens, 63_749);
  });

  it("benchmark B input breakdown sums to total input", () => {
    const b = getMarketBenchmark(GEMINI37_MODEL_ID, GEMINI37_BENCHMARK_B_ID)!;
    assert.equal(sumInputBreakdown(b), 42_195);
    assert.equal(b.inputTokens, 42_195);
  });

  it("benchmark A keeps reasoning accounting unknown", () => {
    const a = getMarketBenchmark(GEMINI37_MODEL_ID, GEMINI37_BENCHMARK_A_ID)!;
    assert.equal(a.reasoningAccounting, "unknown");
    assert.equal(a.displayedReasoningTokens, 194);
    assert.equal(a.displayedOutputTokens, 2_367);
  });
});

describe("gemini37CalibrationEvidence", () => {
  it("immutable evidence matches published v2 fixed policy rates", () => {
    assert.equal(calibrationReferenceEvidenceMatchesV2(GEMINI37_V2_PROPOSED), true);
    assert.equal(GEMINI37_CALIBRATION_RATE_EVIDENCE.referenceInputUsdPerMillion, 0.375);
    assert.equal(GEMINI37_CALIBRATION_RATE_EVIDENCE.referenceOutputUsdPerMillion, 1.875);
    assert.equal(GEMINI37_CALIBRATION_RATE_EVIDENCE.observedCurrentInputUsdPerMillion, 0.2625);
    assert.equal(GEMINI37_CALIBRATION_RATE_EVIDENCE.observedCurrentOutputUsdPerMillion, 1.3125);
    assert.equal(GEMINI37_CALIBRATION_RATE_EVIDENCE.observedDiscountPercent, 30);
  });

  it("live reference drift is unavailable without catalog", () => {
    clearCheaperInferenceCatalogPricingForTest();
    const drift = evaluateLiveReferenceDrift(GEMINI37_V2_PROPOSED);
    assert.equal(drift.status, "UNAVAILABLE");
    assert.equal(drift.liveReferenceMatchesPublished, null);
  });

  it("live reference drift reports MATCH when catalog aligns with published v2", () => {
    updateCheaperInferenceCatalogPricing(buildGemini37UncachedCatalogFixture());
    const drift = evaluateLiveReferenceDrift(GEMINI37_V2_PROPOSED);
    assert.equal(drift.status, "MATCH");
    assert.equal(drift.liveReferenceMatchesPublished, true);
    clearCheaperInferenceCatalogPricingForTest();
  });
});

describe("gemini37PricingPolicy v1 diagnostic", () => {
  it("v1 at base FX 1530 matches deterministic fixture", () => {
    const d = diagnoseGemini37V1AtBaseFx(FX_FIXTURE_BASE_1530);
    assert.equal(d.benchmarkA.finalPoints, 51);
    assert.equal(d.benchmarkB.finalPoints, 85);
    assert.equal(d.v1BeatsA, true);
    assert.equal(d.v1BeatsB, false);
  });

  it("v1 semantic drift — provider list margin ~57.7% at 40% published target", () => {
    const d = diagnoseGemini37V1AtBaseFx(FX_FIXTURE_BASE_1530);
    assert.ok(Math.abs((d.benchmarkA.noDiscountRealizedMargin ?? 0) - 0.578) < 0.01);
    assert.ok(Math.abs((d.benchmarkB.noDiscountRealizedMargin ?? 0) - 0.576) < 0.01);
  });
});

describe("gemini37PricingPolicy v2 proposed", () => {
  it("v2 55% at base 1530 passes both benchmarks", () => {
    const a = getMarketBenchmark(GEMINI37_MODEL_ID, GEMINI37_BENCHMARK_A_ID)!;
    const b = getMarketBenchmark(GEMINI37_MODEL_ID, GEMINI37_BENCHMARK_B_ID)!;
    const rowA = simulateGemini37PolicyRow({
      benchmark: a,
      published: GEMINI37_V2_PROPOSED,
      targetMargin: 0.55,
      baseFx: FX_FIXTURE_BASE_1530,
    });
    const rowB = simulateGemini37PolicyRow({
      benchmark: b,
      published: GEMINI37_V2_PROPOSED,
      targetMargin: 0.55,
      baseFx: FX_FIXTURE_BASE_1530,
    });
    assert.equal(rowA.finalPoints, 48);
    assert.equal(rowB.finalPoints, 80);
    assert.equal(rowA.strictMarketPass, true);
    assert.equal(rowB.strictMarketPass, true);
  });

  it("v2 55% at base 1600 stress passes both benchmarks", () => {
    const a = getMarketBenchmark(GEMINI37_MODEL_ID, GEMINI37_BENCHMARK_A_ID)!;
    const b = getMarketBenchmark(GEMINI37_MODEL_ID, GEMINI37_BENCHMARK_B_ID)!;
    const rowA = simulateGemini37PolicyRow({
      benchmark: a,
      published: GEMINI37_V2_PROPOSED,
      targetMargin: 0.55,
      baseFx: FX_FIXTURE_BASE_1600,
    });
    const rowB = simulateGemini37PolicyRow({
      benchmark: b,
      published: GEMINI37_V2_PROPOSED,
      targetMargin: 0.55,
      baseFx: FX_FIXTURE_BASE_1600,
    });
    assert.equal(rowA.finalPoints, 50);
    assert.equal(rowB.finalPoints, 84);
  });

  it("57% at base 1600 benchmark B fails competitor 84.4P", () => {
    const b = getMarketBenchmark(GEMINI37_MODEL_ID, GEMINI37_BENCHMARK_B_ID)!;
    const row = simulateGemini37PolicyRow({
      benchmark: b,
      published: GEMINI37_V2_PROPOSED,
      targetMargin: 0.57,
      baseFx: FX_FIXTURE_BASE_1600,
    });
    assert.equal(row.finalPoints, 88);
    assert.equal(row.strictMarketPass, false);
  });

  it("uncached target margin semantics align with provider list at 55%", () => {
    const a = getMarketBenchmark(GEMINI37_MODEL_ID, GEMINI37_BENCHMARK_A_ID)!;
    const row = simulateGemini37PolicyRow({
      benchmark: a,
      published: GEMINI37_V2_PROPOSED,
      targetMargin: 0.55,
      baseFx: FX_FIXTURE_BASE_1530,
    });
    assert.ok(Math.abs((row.noDiscountRealizedMargin ?? 0) - 0.55) < 0.02);
  });

  it("calibration discount theoretical margin at 55% target is 68.5%", () => {
    assert.equal(computeCalibrationDiscountTheoreticalMargin(0.55), 0.685);
  });

  it("acceptance gates all pass for v2", () => {
    const gates = evaluateGemini37V2AcceptanceGates();
    assert.equal(gates.CALIBRATION_REFERENCE_EVIDENCE_MATCHES_V2, true);
    assert.equal(gates.UNCACHED_TARGET_MARGIN_SEMANTICS_MATCH_PROVIDER_LIST, true);
    assert.equal(gates.LIVE_PROVIDER_PRICE_CHANGE_AUTO_MUTATES_PUBLISHED_V2, false);
    assert.equal(gates.allPass, true, JSON.stringify(gates));
  });

  it("published catalog reflects v2 after gate pass", () => {
    const pub = getPublishedPricing(GEMINI37_MODEL_ID);
    assert.equal(pub.pricingVersion, 2);
    assert.equal(pub.billingReferenceInputUsdPerMillion, 0.375);
    assert.equal(pub.billingReferenceOutputUsdPerMillion, 1.875);
    assert.equal(pub.targetMargin, 0.55);
    assert.equal(pub.minimumMarginFloor, 0.5);
  });
});

describe("gemini37PricingPolicy matrices", () => {
  it("FX sensitivity uses effective = base × 1.02", () => {
    const snap1530 = buildFxSnapshotFromBase(FX_FIXTURE_BASE_1530);
    const snap1600 = buildFxSnapshotFromBase(FX_FIXTURE_BASE_1600);
    assert.ok(Math.abs(snap1530.effectiveKrwPerUsd - EFFECTIVE_1530) < 1e-9);
    assert.ok(Math.abs(snap1600.effectiveKrwPerUsd - EFFECTIVE_1600) < 1e-9);
  });

  it("margin matrix has 2 benchmarks × 9 margins", () => {
    const matrix = buildGemini37MarginMatrix({ published: GEMINI37_V2_PROPOSED });
    assert.equal(matrix.length, 18);
  });

  it("FX sensitivity matrix covers all bases × benchmarks", () => {
    const matrix = buildGemini37FxSensitivityMatrix({ published: GEMINI37_V2_PROPOSED });
    assert.equal(matrix.length, 6 * 2);
  });
});

describe("gemini37PricingPolicy direct standard stress", () => {
  it("DIRECT_STANDARD_STRESS margin ≈ 10% for benchmark A at v2 55% base 1530", () => {
    const a = getMarketBenchmark(GEMINI37_MODEL_ID, GEMINI37_BENCHMARK_A_ID)!;
    const result = computeDirectStandardStressMargin({
      benchmark: a,
      published: GEMINI37_V2_PROPOSED,
      baseFx: FX_FIXTURE_BASE_1530,
    });
    assert.equal(result.validThrough, GOOGLE_STANDARD_INTRO_VALID_THROUGH);
    assert.ok(result.margin != null && Math.abs(result.margin - 0.1) < 0.02);
  });
});

describe("gemini37PricingPolicy uncached catalog fixture", () => {
  it("does not present unverified cache rates as evidence", () => {
    const fixture = buildGemini37UncachedCatalogFixture();
    assert.equal(fixture.cacheReadUsdPerMillion, 0);
    assert.equal(fixture.cacheWriteUsdPerMillion, 0);
    assert.equal(fixture.referenceInputUsdPerMillion, GEMINI37_CALIBRATION_RATE_EVIDENCE.referenceInputUsdPerMillion);
  });
});

describe("gemini37PricingPolicy shadow pipeline parity", () => {
  it("shadow pipeline matches policy row at v2 55% base 1530", () => {
    clearCheaperInferenceCatalogPricingForTest();
    updateCheaperInferenceCatalogPricing(buildGemini37UncachedCatalogFixture());
    const a = getMarketBenchmark(GEMINI37_MODEL_ID, GEMINI37_BENCHMARK_A_ID)!;
    const policy = simulateGemini37PolicyRow({
      benchmark: a,
      published: GEMINI37_V2_PROPOSED,
      targetMargin: 0.55,
      baseFx: FX_FIXTURE_BASE_1530,
    });
    const shadow = simulateGemini37ViaShadowPipeline({
      benchmark: a,
      published: GEMINI37_V2_PROPOSED,
      baseFx: FX_FIXTURE_BASE_1530,
      catalog: buildGemini37UncachedCatalogFixture(),
    });
    assert.equal(shadow.finalPoints, policy.finalPoints);
    clearCheaperInferenceCatalogPricingForTest();
  });
});

describe("gemini37PricingPolicy ownership", () => {
  it("v1 published fixture preserved for regression", () => {
    assert.equal(GEMINI37_V1_PUBLISHED.pricingVersion, 1);
    assert.equal(GEMINI37_V1_PUBLISHED.targetMargin, 0.4);
  });

  it("published v2 is independent of calibration observed discount rates", () => {
    const evidence = GEMINI37_CALIBRATION_RATE_EVIDENCE;
    assert.notEqual(GEMINI37_V2_PROPOSED.billingReferenceInputUsdPerMillion, evidence.observedCurrentInputUsdPerMillion);
    assert.notEqual(GEMINI37_V2_PROPOSED.billingReferenceOutputUsdPerMillion, evidence.observedCurrentOutputUsdPerMillion);
  });
});
