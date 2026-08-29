/**
 * Gemini 3.7 Flash shadow pricing policy calibration — v1 diagnostic + v2 proposal.
 * SHADOW ONLY — no live billing cutover.
 */

import { applyOverseasCardFee } from "@/lib/billingFxPolicy";
import { convertUsdToKrw } from "@/lib/exchangeRate";
import type { CheaperInferenceCatalogPricing } from "@/lib/cheaperInferenceCatalogPricing";
import {
  CACHE_POLICY_VERIFICATION,
  calibrationReferenceEvidenceMatchesV2,
  GEMINI37_CALIBRATION_RATE_EVIDENCE,
} from "@/lib/gemini37CalibrationEvidence";
import {
  FX_FIXTURE_BASE_1530,
  FX_FIXTURE_BASE_1600,
  FX_FIXTURE_CARD_FEE,
  FX_SENSITIVITY_BASES,
  GEMINI37_MARGIN_CANDIDATES,
  GEMINI37_MODEL_ID,
  GOOGLE_STANDARD_INTRO_VALID_THROUGH,
  GOOGLE_STANDARD_STRESS_RATES,
} from "@/lib/gemini37PricingPolicy.constants";
import {
  GEMINI37_BENCHMARK_A_ID,
  GEMINI37_BENCHMARK_B_ID,
  getMarketBenchmark,
  type MarketUsageBenchmark,
} from "@/lib/marketUsageBenchmarks";
import type { PublishedModelPricing } from "@/lib/publishedModelPricing";
import {
  computeShadowCharge,
  computeShadowCostsWithSnapshot,
  type ShadowCostBreakdown,
} from "@/lib/shadowPricing";
import {
  SHADOW_BILLING_FX_MODE,
  type ShadowBillingExchangeRateSnapshot,
} from "@/lib/shadowBillingExchangeRate";

export {
  FX_FIXTURE_BASE_1530,
  FX_FIXTURE_BASE_1600,
  FX_FIXTURE_CARD_FEE,
  FX_SENSITIVITY_BASES,
  GEMINI37_MARGIN_CANDIDATES,
  GEMINI37_MODEL_ID,
  GOOGLE_STANDARD_INTRO_VALID_THROUGH,
  GOOGLE_STANDARD_STRESS_RATES,
} from "@/lib/gemini37PricingPolicy.constants";

export { GEMINI37_CALIBRATION_RATE_EVIDENCE, CACHE_POLICY_VERIFICATION } from "@/lib/gemini37CalibrationEvidence";

export const GEMINI37_V1_PUBLISHED: PublishedModelPricing = {
  modelId: GEMINI37_MODEL_ID,
  billingReferenceInputUsdPerMillion: 0.53,
  billingReferenceOutputUsdPerMillion: 2.63,
  targetMargin: 0.4,
  minimumMarginFloor: 0.25,
  pricingVersion: 1,
  publishedAt: "2026-08-28T00:00:00.000Z",
};

export const GEMINI37_V2_PROPOSED: PublishedModelPricing = {
  modelId: GEMINI37_MODEL_ID,
  billingReferenceInputUsdPerMillion: 0.375,
  billingReferenceOutputUsdPerMillion: 1.875,
  targetMargin: 0.55,
  minimumMarginFloor: 0.5,
  pricingVersion: 2,
  publishedAt: "2026-08-28T14:00:00.000Z",
};

export type Gemini37CompetitiveFlagReason =
  | "competitive_and_safe"
  | "competitive_but_below_floor"
  | "margin_can_be_reduced_to_match_market"
  | "minimum_safe_price_above_market"
  | "provider_list_unavailable"
  | "market_safe_at_fixture_but_fails_fx_stress";

export type Gemini37PolicyRow = {
  benchmarkId: string;
  targetMargin: number;
  billingReferenceCostKrw: number;
  rawStandardChargeKrw: number;
  finalPoints: number;
  competitorChargePoints: number;
  competitiveDeviationPct: number;
  providerListCostKrw: number;
  noDiscountGrossProfitKrw: number | null;
  noDiscountRealizedMargin: number | null;
  currentDiscountedActualCostKrw: number | null;
  currentActualGrossProfitKrw: number | null;
  currentActualRealizedMargin: number | null;
  strictMarketPass: boolean;
  minimumFloorPass: boolean;
  flag: "GREEN" | "YELLOW" | "RED" | "FX_STRESS_FAIL";
  flagReason: Gemini37CompetitiveFlagReason;
};

export type Gemini37FxSensitivityCell = {
  baseFx: number;
  effectiveFx: number;
  targetMargin: number;
  benchmarkId: string;
  finalPoints: number;
  competitorChargePoints: number;
  competitiveDeviationPct: number;
  strictMarketPass: boolean;
};

export type Gemini37AcceptanceGates = {
  CALIBRATION_REFERENCE_EVIDENCE_MATCHES_V2: boolean;
  BENCHMARK_A_55_MARGIN_PASS_AT_BASE_1530: boolean;
  BENCHMARK_B_55_MARGIN_PASS_AT_BASE_1530: boolean;
  BENCHMARK_A_55_MARGIN_PASS_AT_BASE_1600: boolean;
  BENCHMARK_B_55_MARGIN_PASS_AT_BASE_1600: boolean;
  UNCACHED_TARGET_MARGIN_SEMANTICS_MATCH_PROVIDER_LIST: boolean;
  PUBLISHED_RATE_INDEPENDENT_OF_OBSERVED_DISCOUNT: boolean;
  CACHE_POLICY_VERIFICATION: typeof CACHE_POLICY_VERIFICATION;
  LIVE_PROVIDER_PRICE_CHANGE_AUTO_MUTATES_PUBLISHED_V2: false;
  allPass: boolean;
};

export type DirectStandardStressResult = {
  margin: number | null;
  validThrough: typeof GOOGLE_STANDARD_INTRO_VALID_THROUGH;
  rates: typeof GOOGLE_STANDARD_STRESS_RATES;
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function chargePoints(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.ceil(n - 1e-9);
}

export function buildFxSnapshotFromBase(baseUsdKrw: number): ShadowBillingExchangeRateSnapshot {
  return {
    mode: SHADOW_BILLING_FX_MODE,
    dateKey: "2026-08-28",
    usdToKrw: baseUsdKrw,
    effectiveKrwPerUsd: applyOverseasCardFee(baseUsdKrw),
    source: "api_daily",
    locked: true,
    overseasFeeRate: FX_FIXTURE_CARD_FEE,
  };
}

/**
 * Uncached benchmark catalog fixture — cache token fields are type placeholders only.
 * All calibration workloads use cacheReadTokens=0 and cacheWriteTokens=0.
 */
export function buildGemini37UncachedCatalogFixture(
  overrides?: Partial<CheaperInferenceCatalogPricing>
): CheaperInferenceCatalogPricing {
  const evidence = GEMINI37_CALIBRATION_RATE_EVIDENCE;
  return {
    modelId: GEMINI37_MODEL_ID,
    inputUsdPerMillion: evidence.observedCurrentInputUsdPerMillion,
    outputUsdPerMillion: evidence.observedCurrentOutputUsdPerMillion,
    cacheReadUsdPerMillion: 0,
    cacheWriteUsdPerMillion: 0,
    referenceInputUsdPerMillion: evidence.referenceInputUsdPerMillion,
    referenceOutputUsdPerMillion: evidence.referenceOutputUsdPerMillion,
    discountPercent: evidence.observedDiscountPercent,
    fetchedAt: Date.parse(evidence.observedAt),
    ...overrides,
  };
}

/** @deprecated Use buildGemini37UncachedCatalogFixture */
export const buildGemini37CatalogFixture = buildGemini37UncachedCatalogFixture;

function computeProviderListCostKrw(
  benchmark: MarketUsageBenchmark,
  fxSnapshot: ShadowBillingExchangeRateSnapshot,
  catalog: CheaperInferenceCatalogPricing
): number {
  const usd =
    (benchmark.inputTokens / 1_000_000) * (catalog.referenceInputUsdPerMillion ?? 0) +
    (benchmark.displayedOutputTokens / 1_000_000) * (catalog.referenceOutputUsdPerMillion ?? 0);
  return round1(convertUsdToKrw(usd, fxSnapshot.effectiveKrwPerUsd));
}

function computeCurrentDiscountedActualCostKrw(
  benchmark: MarketUsageBenchmark,
  fxSnapshot: ShadowBillingExchangeRateSnapshot,
  catalog: CheaperInferenceCatalogPricing
): number {
  const usd =
    (benchmark.inputTokens / 1_000_000) * catalog.inputUsdPerMillion +
    (benchmark.displayedOutputTokens / 1_000_000) * catalog.outputUsdPerMillion;
  return round1(convertUsdToKrw(usd, fxSnapshot.effectiveKrwPerUsd));
}

function computeBillingReferenceCostKrw(
  benchmark: MarketUsageBenchmark,
  published: PublishedModelPricing,
  fxSnapshot: ShadowBillingExchangeRateSnapshot
): number {
  const usd =
    (benchmark.inputTokens / 1_000_000) * published.billingReferenceInputUsdPerMillion +
    (benchmark.displayedOutputTokens / 1_000_000) * published.billingReferenceOutputUsdPerMillion;
  return round1(convertUsdToKrw(usd, fxSnapshot.effectiveKrwPerUsd));
}

function resolveFlag(params: {
  finalPoints: number;
  competitorChargePoints: number;
  noDiscountRealizedMargin: number | null;
  minimumMarginFloor: number;
  providerListAvailable: boolean;
  minimumSafePrice: number | null;
}): { flag: Gemini37PolicyRow["flag"]; flagReason: Gemini37CompetitiveFlagReason } {
  if (!params.providerListAvailable) {
    return { flag: "YELLOW", flagReason: "provider_list_unavailable" };
  }
  if (params.finalPoints <= params.competitorChargePoints && (params.noDiscountRealizedMargin ?? 0) >= params.minimumMarginFloor) {
    return { flag: "GREEN", flagReason: "competitive_and_safe" };
  }
  if (params.finalPoints <= params.competitorChargePoints && (params.noDiscountRealizedMargin ?? 0) < params.minimumMarginFloor) {
    return { flag: "YELLOW", flagReason: "competitive_but_below_floor" };
  }
  if (params.minimumSafePrice != null && params.minimumSafePrice <= params.competitorChargePoints) {
    return { flag: "YELLOW", flagReason: "margin_can_be_reduced_to_match_market" };
  }
  return { flag: "RED", flagReason: "minimum_safe_price_above_market" };
}

export function simulateGemini37PolicyRow(params: {
  benchmark: MarketUsageBenchmark;
  published: PublishedModelPricing;
  targetMargin: number;
  baseFx: number;
  catalog?: CheaperInferenceCatalogPricing;
}): Gemini37PolicyRow {
  const fxSnapshot = buildFxSnapshotFromBase(params.baseFx);
  const catalog = params.catalog ?? buildGemini37UncachedCatalogFixture();
  const billingReferenceCostKrw = computeBillingReferenceCostKrw(params.benchmark, params.published, fxSnapshot);
  const rawStandardChargeKrw = round1(billingReferenceCostKrw / (1 - params.targetMargin));
  const finalPoints = chargePoints(rawStandardChargeKrw);
  const providerListCostKrw = computeProviderListCostKrw(params.benchmark, fxSnapshot, catalog);
  const providerListAvailable =
    catalog.referenceInputUsdPerMillion != null && catalog.referenceOutputUsdPerMillion != null;
  const noDiscountGrossProfitKrw = providerListAvailable ? round1(finalPoints - providerListCostKrw) : null;
  const noDiscountRealizedMargin =
    noDiscountGrossProfitKrw != null && finalPoints > 0
      ? Math.round((noDiscountGrossProfitKrw / finalPoints) * 1000) / 1000
      : null;
  const currentDiscountedActualCostKrw = computeCurrentDiscountedActualCostKrw(params.benchmark, fxSnapshot, catalog);
  const currentActualGrossProfitKrw = round1(finalPoints - currentDiscountedActualCostKrw);
  const currentActualRealizedMargin =
    finalPoints > 0 ? Math.round((currentActualGrossProfitKrw / finalPoints) * 1000) / 1000 : null;
  const competitiveDeviationPct =
    params.benchmark.competitorChargePoints > 0
      ? round1(((finalPoints - params.benchmark.competitorChargePoints) / params.benchmark.competitorChargePoints) * 100)
      : 0;
  const strictMarketPass = finalPoints <= params.benchmark.competitorChargePoints;
  const minimumFloorPass = (noDiscountRealizedMargin ?? 0) >= params.published.minimumMarginFloor;
  const minimumSafePrice = providerListAvailable ? providerListCostKrw / (1 - params.published.minimumMarginFloor) : null;
  const { flag, flagReason } = resolveFlag({
    finalPoints,
    competitorChargePoints: params.benchmark.competitorChargePoints,
    noDiscountRealizedMargin,
    minimumMarginFloor: params.published.minimumMarginFloor,
    providerListAvailable,
    minimumSafePrice,
  });

  return {
    benchmarkId: params.benchmark.id,
    targetMargin: params.targetMargin,
    billingReferenceCostKrw,
    rawStandardChargeKrw,
    finalPoints,
    competitorChargePoints: params.benchmark.competitorChargePoints,
    competitiveDeviationPct,
    providerListCostKrw,
    noDiscountGrossProfitKrw,
    noDiscountRealizedMargin,
    currentDiscountedActualCostKrw,
    currentActualGrossProfitKrw,
    currentActualRealizedMargin,
    strictMarketPass,
    minimumFloorPass,
    flag,
    flagReason,
  };
}

export function buildGemini37MarginMatrix(params: {
  published: PublishedModelPricing;
  baseFx?: number;
}): Gemini37PolicyRow[] {
  const baseFx = params.baseFx ?? FX_FIXTURE_BASE_1530;
  const benchmarks = [GEMINI37_BENCHMARK_A_ID, GEMINI37_BENCHMARK_B_ID].map((id) =>
    getMarketBenchmark(GEMINI37_MODEL_ID, id)
  ).filter((b): b is MarketUsageBenchmark => b != null);

  const rows: Gemini37PolicyRow[] = [];
  for (const benchmark of benchmarks) {
    for (const targetMargin of GEMINI37_MARGIN_CANDIDATES) {
      rows.push(
        simulateGemini37PolicyRow({
          benchmark,
          published: params.published,
          targetMargin,
          baseFx,
        })
      );
    }
  }
  return rows;
}

export function buildGemini37FxSensitivityMatrix(params: {
  published: PublishedModelPricing;
  targetMargin?: number;
}): Gemini37FxSensitivityCell[] {
  const targetMargin = params.targetMargin ?? GEMINI37_V2_PROPOSED.targetMargin;
  const benchmarks = [GEMINI37_BENCHMARK_A_ID, GEMINI37_BENCHMARK_B_ID].map((id) =>
    getMarketBenchmark(GEMINI37_MODEL_ID, id)
  ).filter((b): b is MarketUsageBenchmark => b != null);

  const cells: Gemini37FxSensitivityCell[] = [];
  for (const baseFx of FX_SENSITIVITY_BASES) {
    const fxSnapshot = buildFxSnapshotFromBase(baseFx);
    for (const benchmark of benchmarks) {
      const row = simulateGemini37PolicyRow({
        benchmark,
        published: params.published,
        targetMargin,
        baseFx,
      });
      cells.push({
        baseFx,
        effectiveFx: round1(fxSnapshot.effectiveKrwPerUsd),
        targetMargin,
        benchmarkId: benchmark.id,
        finalPoints: row.finalPoints,
        competitorChargePoints: benchmark.competitorChargePoints,
        competitiveDeviationPct: row.competitiveDeviationPct,
        strictMarketPass: row.strictMarketPass,
      });
    }
  }
  return cells;
}

export function computeDirectStandardStressMargin(params: {
  benchmark: MarketUsageBenchmark;
  published: PublishedModelPricing;
  baseFx?: number;
}): DirectStandardStressResult {
  const baseFx = params.baseFx ?? FX_FIXTURE_BASE_1530;
  const fxSnapshot = buildFxSnapshotFromBase(baseFx);
  const billingReferenceCostKrw = computeBillingReferenceCostKrw(params.benchmark, params.published, fxSnapshot);
  const userPriceKrw = round1(billingReferenceCostKrw / (1 - params.published.targetMargin));
  const directStandardUsd =
    (params.benchmark.inputTokens / 1_000_000) * GOOGLE_STANDARD_STRESS_RATES.inputUsdPerMillion +
    (params.benchmark.displayedOutputTokens / 1_000_000) * GOOGLE_STANDARD_STRESS_RATES.outputUsdPerMillion;
  const directStandardCostKrw = round1(convertUsdToKrw(directStandardUsd, fxSnapshot.effectiveKrwPerUsd));
  const margin = userPriceKrw > 0 ? round1((userPriceKrw - directStandardCostKrw) / userPriceKrw) : null;
  return {
    margin,
    validThrough: GOOGLE_STANDARD_INTRO_VALID_THROUGH,
    rates: GOOGLE_STANDARD_STRESS_RATES,
  };
}

export function computeCalibrationDiscountTheoreticalMargin(targetMargin: number): number {
  const discountMultiplier = 1 - GEMINI37_CALIBRATION_RATE_EVIDENCE.observedDiscountPercent / 100;
  return Math.round((1 - discountMultiplier * (1 - targetMargin)) * 1000) / 1000;
}

/** @deprecated Use computeCalibrationDiscountTheoreticalMargin */
export const computeCurrentDiscountTheoreticalMargin = computeCalibrationDiscountTheoreticalMargin;

export function diagnoseGemini37V1AtBaseFx(baseFx: number = FX_FIXTURE_BASE_1530): {
  benchmarkA: Gemini37PolicyRow;
  benchmarkB: Gemini37PolicyRow;
  v1BeatsA: boolean;
  v1BeatsB: boolean;
} {
  const benchmarkA = getMarketBenchmark(GEMINI37_MODEL_ID, GEMINI37_BENCHMARK_A_ID)!;
  const benchmarkB = getMarketBenchmark(GEMINI37_MODEL_ID, GEMINI37_BENCHMARK_B_ID)!;
  const rowA = simulateGemini37PolicyRow({
    benchmark: benchmarkA,
    published: GEMINI37_V1_PUBLISHED,
    targetMargin: GEMINI37_V1_PUBLISHED.targetMargin,
    baseFx,
  });
  const rowB = simulateGemini37PolicyRow({
    benchmark: benchmarkB,
    published: GEMINI37_V1_PUBLISHED,
    targetMargin: GEMINI37_V1_PUBLISHED.targetMargin,
    baseFx,
  });
  return {
    benchmarkA: rowA,
    benchmarkB: rowB,
    v1BeatsA: rowA.strictMarketPass,
    v1BeatsB: rowB.strictMarketPass,
  };
}

export function evaluateGemini37V2AcceptanceGates(): Gemini37AcceptanceGates {
  const benchmarkA = getMarketBenchmark(GEMINI37_MODEL_ID, GEMINI37_BENCHMARK_A_ID)!;
  const benchmarkB = getMarketBenchmark(GEMINI37_MODEL_ID, GEMINI37_BENCHMARK_B_ID)!;
  const targetMargin = GEMINI37_V2_PROPOSED.targetMargin;

  const a1530 = simulateGemini37PolicyRow({
    benchmark: benchmarkA,
    published: GEMINI37_V2_PROPOSED,
    targetMargin,
    baseFx: FX_FIXTURE_BASE_1530,
  });
  const b1530 = simulateGemini37PolicyRow({
    benchmark: benchmarkB,
    published: GEMINI37_V2_PROPOSED,
    targetMargin,
    baseFx: FX_FIXTURE_BASE_1530,
  });
  const a1600 = simulateGemini37PolicyRow({
    benchmark: benchmarkA,
    published: GEMINI37_V2_PROPOSED,
    targetMargin,
    baseFx: FX_FIXTURE_BASE_1600,
  });
  const b1600 = simulateGemini37PolicyRow({
    benchmark: benchmarkB,
    published: GEMINI37_V2_PROPOSED,
    targetMargin,
    baseFx: FX_FIXTURE_BASE_1600,
  });

  const semanticsRow = simulateGemini37PolicyRow({
    benchmark: benchmarkA,
    published: GEMINI37_V2_PROPOSED,
    targetMargin,
    baseFx: FX_FIXTURE_BASE_1530,
  });
  const uncachedTargetMarginSemanticsMatch =
    semanticsRow.noDiscountRealizedMargin != null &&
    calibrationReferenceEvidenceMatchesV2(GEMINI37_V2_PROPOSED) &&
    Math.abs(semanticsRow.noDiscountRealizedMargin - targetMargin) < 0.02;

  const evidence = GEMINI37_CALIBRATION_RATE_EVIDENCE;
  const publishedIndependentOfObservedDiscount =
    GEMINI37_V2_PROPOSED.billingReferenceInputUsdPerMillion !== evidence.observedCurrentInputUsdPerMillion &&
    GEMINI37_V2_PROPOSED.billingReferenceOutputUsdPerMillion !== evidence.observedCurrentOutputUsdPerMillion;

  const gates: Gemini37AcceptanceGates = {
    CALIBRATION_REFERENCE_EVIDENCE_MATCHES_V2: calibrationReferenceEvidenceMatchesV2(GEMINI37_V2_PROPOSED),
    BENCHMARK_A_55_MARGIN_PASS_AT_BASE_1530: a1530.strictMarketPass,
    BENCHMARK_B_55_MARGIN_PASS_AT_BASE_1530: b1530.strictMarketPass,
    BENCHMARK_A_55_MARGIN_PASS_AT_BASE_1600: a1600.strictMarketPass,
    BENCHMARK_B_55_MARGIN_PASS_AT_BASE_1600: b1600.strictMarketPass,
    UNCACHED_TARGET_MARGIN_SEMANTICS_MATCH_PROVIDER_LIST: uncachedTargetMarginSemanticsMatch,
    PUBLISHED_RATE_INDEPENDENT_OF_OBSERVED_DISCOUNT: publishedIndependentOfObservedDiscount,
    CACHE_POLICY_VERIFICATION,
    LIVE_PROVIDER_PRICE_CHANGE_AUTO_MUTATES_PUBLISHED_V2: false,
    allPass: false,
  };
  gates.allPass =
    gates.CALIBRATION_REFERENCE_EVIDENCE_MATCHES_V2 &&
    gates.BENCHMARK_A_55_MARGIN_PASS_AT_BASE_1530 &&
    gates.BENCHMARK_B_55_MARGIN_PASS_AT_BASE_1530 &&
    gates.BENCHMARK_A_55_MARGIN_PASS_AT_BASE_1600 &&
    gates.BENCHMARK_B_55_MARGIN_PASS_AT_BASE_1600 &&
    gates.UNCACHED_TARGET_MARGIN_SEMANTICS_MATCH_PROVIDER_LIST &&
    gates.PUBLISHED_RATE_INDEPENDENT_OF_OBSERVED_DISCOUNT;
  return gates;
}

export function simulateGemini37ViaShadowPipeline(params: {
  benchmark: MarketUsageBenchmark;
  published: PublishedModelPricing;
  baseFx: number;
  catalog: CheaperInferenceCatalogPricing;
}): {
  cost: ShadowCostBreakdown;
  finalPoints: number;
} {
  const fxSnapshot = buildFxSnapshotFromBase(params.baseFx);
  const cost = computeShadowCostsWithSnapshot(
    {
      modelId: GEMINI37_MODEL_ID,
      promptTokens: params.benchmark.inputTokens,
      outputTokens: params.benchmark.displayedOutputTokens,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      publishedPricingOverride: params.published,
    },
    fxSnapshot
  );
  const charge = computeShadowCharge({
    ...cost,
    targetMargin: params.published.targetMargin,
    minimumMarginFloor: params.published.minimumMarginFloor,
  });
  return { cost, finalPoints: charge.finalShadowPoints };
}

export function markFxStressFailures(
  baseFixtureRows: Gemini37PolicyRow[],
  stressFxRows: Gemini37PolicyRow[]
): Array<Gemini37PolicyRow & { fxStressPass: boolean }> {
  const stressByKey = new Map(stressFxRows.map((r) => [`${r.benchmarkId}:${r.targetMargin}`, r]));
  return baseFixtureRows.map((row) => {
    const stress = stressByKey.get(`${row.benchmarkId}:${row.targetMargin}`);
    const fxStressPass = stress?.strictMarketPass ?? false;
    if (row.strictMarketPass && !fxStressPass) {
      return {
        ...row,
        fxStressPass,
        flag: "FX_STRESS_FAIL" as const,
        flagReason: "market_safe_at_fixture_but_fails_fx_stress" as const,
      };
    }
    return { ...row, fxStressPass };
  });
}
