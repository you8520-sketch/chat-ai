import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GEMINI37_BENCHMARK_A_ID,
  GEMINI37_BENCHMARK_B_ID,
  getMarketBenchmark,
  sumInputBreakdown,
} from "./marketUsageBenchmarks";
import {
  buildGemini37FxSensitivityMatrix,
  buildGemini37MarginMatrix,
  computeCurrentDiscountTheoreticalMargin,
  computeDirectStandardStressMargin,
  diagnoseGemini37V1AtBaseFx,
  evaluateGemini37V2AcceptanceGates,
  FX_FIXTURE_BASE_1530,
  FX_FIXTURE_BASE_1600,
  GEMINI37_CI_CURRENT_DISCOUNTED_RATES,
  GEMINI37_CI_DISCOUNT_PERCENT,
  GEMINI37_CI_REFERENCE_RATES,
  GEMINI37_MODEL_ID,
  GEMINI37_V1_PUBLISHED,
  GEMINI37_V2_PROPOSED,
  simulateGemini37PolicyRow,
  simulateGemini37ViaShadowPipeline,
  buildGemini37CatalogFixture,
  buildFxSnapshotFromBase,
} from "./gemini37PricingPolicy";
import { getPublishedPricing } from "./publishedModelPricing";
import { clearCheaperInferenceCatalogPricingForTest, updateCheaperInferenceCatalogPricing } from "./cheaperInferenceCatalogPricing";

const EFFECTIVE_1530 = 1530 * 1.02;
const EFFECTIVE_1600 = 1600 * 1.02;

describe("marketUsageBenchmarks gemini37", () => {
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

describe("gemini37PricingPolicy v1 diagnostic", () => {
  it("v1 at base FX 1530 matches deterministic fixture", () => {
    const d = diagnoseGemini37V1AtBaseFx(FX_FIXTURE_BASE_1530);
    assert.equal(d.benchmarkA.finalPoints, 51);
    assert.equal(d.benchmarkB.finalPoints, 85);
    assert.equal(d.benchmarkA.competitorChargePoints, 55);
    assert.equal(d.benchmarkB.competitorChargePoints, 84.4);
    assert.ok(Math.abs(d.benchmarkA.billingReferenceCostKrw - 30.4) < 0.01);
    assert.ok(Math.abs(d.benchmarkB.billingReferenceCostKrw - 50.8) < 0.01);
    assert.equal(d.v1BeatsA, true);
    assert.equal(d.v1BeatsB, false);
    assert.ok(Math.abs(d.benchmarkA.competitiveDeviationPct - -7.3) < 0.1);
    assert.ok(Math.abs(d.benchmarkB.competitiveDeviationPct - 0.7) < 0.1);
  });

  it("v1 semantic drift — provider list margin ~57.7% at 40% published target", () => {
    const d = diagnoseGemini37V1AtBaseFx(FX_FIXTURE_BASE_1530);
    assert.ok(Math.abs(d.benchmarkA.providerListCostKrw - 21.5) < 0.01);
    assert.ok(Math.abs(d.benchmarkB.providerListCostKrw - 36) < 0.01);
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
    assert.equal(rowA.strictMarketPass, true);
    assert.equal(rowB.strictMarketPass, true);
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

  it("target margin semantics align with provider list at 55%", () => {
    const a = getMarketBenchmark(GEMINI37_MODEL_ID, GEMINI37_BENCHMARK_A_ID)!;
    const row = simulateGemini37PolicyRow({
      benchmark: a,
      published: GEMINI37_V2_PROPOSED,
      targetMargin: 0.55,
      baseFx: FX_FIXTURE_BASE_1530,
    });
    assert.ok(Math.abs((row.noDiscountRealizedMargin ?? 0) - 0.55) < 0.02);
  });

  it("current discount theoretical margin at 55% target is 68.5%", () => {
    assert.equal(computeCurrentDiscountTheoreticalMargin(0.55), 0.685);
  });

  it("acceptance gates all pass for v2", () => {
    const gates = evaluateGemini37V2AcceptanceGates();
    assert.equal(gates.allPass, true, JSON.stringify(gates));
  });

  it("published catalog reflects v2 after gate pass", () => {
    const gates = evaluateGemini37V2AcceptanceGates();
    assert.equal(gates.allPass, true);
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
  it("computes DIRECT_STANDARD_STRESS margin separately from providerList", () => {
    const a = getMarketBenchmark(GEMINI37_MODEL_ID, GEMINI37_BENCHMARK_A_ID)!;
    const margin = computeDirectStandardStressMargin({
      benchmark: a,
      published: GEMINI37_V2_PROPOSED,
      baseFx: FX_FIXTURE_BASE_1530,
    });
    assert.ok(margin != null && margin > 0 && margin < 1);
  });
});

describe("gemini37PricingPolicy shadow pipeline parity", () => {
  it("shadow pipeline matches policy row at v2 55% base 1530", () => {
    clearCheaperInferenceCatalogPricingForTest();
    updateCheaperInferenceCatalogPricing(buildGemini37CatalogFixture());
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
      catalog: buildGemini37CatalogFixture(),
    });
    assert.equal(shadow.finalPoints, policy.finalPoints);
    assert.ok(Math.abs(shadow.cost.billingReferenceCostKrw - policy.billingReferenceCostKrw) < 0.1);
    clearCheaperInferenceCatalogPricingForTest();
  });
});

describe("gemini37PricingPolicy CI rate ownership", () => {
  it("reference rates match CI canonical, not Google Standard", () => {
    assert.equal(GEMINI37_CI_REFERENCE_RATES.inputUsdPerMillion, 0.375);
    assert.equal(GEMINI37_CI_REFERENCE_RATES.outputUsdPerMillion, 1.875);
    assert.equal(GEMINI37_CI_CURRENT_DISCOUNTED_RATES.inputUsdPerMillion, 0.2625);
    assert.equal(GEMINI37_CI_CURRENT_DISCOUNTED_RATES.outputUsdPerMillion, 1.3125);
    assert.equal(GEMINI37_CI_DISCOUNT_PERCENT, 0.3);
    assert.notEqual(GEMINI37_V2_PROPOSED.billingReferenceInputUsdPerMillion, GEMINI37_CI_CURRENT_DISCOUNTED_RATES.inputUsdPerMillion);
  });

  it("v1 published fixture preserved for regression", () => {
    assert.equal(GEMINI37_V1_PUBLISHED.pricingVersion, 1);
    assert.equal(GEMINI37_V1_PUBLISHED.targetMargin, 0.4);
  });
});
