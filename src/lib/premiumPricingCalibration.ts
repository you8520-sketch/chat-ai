/**
 * Premium pricing calibration — single formula owner for Gemini 3.1 Pro + Opus 5.
 * SHADOW ONLY — hard comparable benchmarks only for margin selection.
 */

import { applyOverseasCardFee } from "@/lib/billingFxPolicy";
import { convertUsdToKrw } from "@/lib/exchangeRate";
import type { CheaperInferenceCatalogPricing } from "@/lib/cheaperInferenceCatalogPricing";
import {
  GEMINI31_MODEL_ID,
  OPUS5_MODEL_ID,
} from "@/lib/premiumModelIds";
import {
  PREMIUM_PRICING_CALIBRATION_EVIDENCE,
  type CacheEvidenceAudit,
  auditPremiumCacheEvidence,
  evaluateAboveThresholdReferenceVerified,
  referenceEvidenceMatchesPublishedBaseTier,
} from "@/lib/premiumPricingCalibrationEvidence";
import { requirePrimaryBenchmark, type MarketUsageBenchmark } from "@/lib/marketUsageBenchmarks";
import type { PublishedModelPricing } from "@/lib/publishedModelPricing";
import {
  SHADOW_BILLING_FX_MODE,
  type ShadowBillingExchangeRateSnapshot,
} from "@/lib/shadowBillingExchangeRate";

export const PREMIUM_FX_CARD_FEE = 0.02;

export const PREMIUM_FX_SENSITIVITY_BASES = [
  1400, 1450, 1500, 1530, 1550, 1600, 1625, 1650,
] as const;

export const PREMIUM_HARD_GATE_FX_BASES = [1530, 1600, 1625] as const;

export const PREMIUM_MARGIN_CANDIDATES = {
  gemini31: [0.05, 0.075, 0.08, 0.09, 0.1, 0.11, 0.125, 0.14, 0.15, 0.175, 0.2] as const,
  opus5: [0.03, 0.05, 0.06, 0.07, 0.08, 0.09, 0.1, 0.12, 0.13, 0.135, 0.14, 0.15, 0.2, 0.25] as const,
};

export const FX_MARKET_STATUS_BUFFER_KRW = 15;

export const GEMINI31_V1_PUBLISHED: PublishedModelPricing = {
  modelId: GEMINI31_MODEL_ID,
  billingReferenceInputUsdPerMillion: 2,
  billingReferenceOutputUsdPerMillion: 12,
  targetMargin: 0.2,
  minimumMarginFloor: 0.1,
  pricingVersion: 1,
  publishedAt: "2026-08-28T00:00:00.000Z",
  pricingApplicability: "base_tier_only",
  publishedBaseTierMaxPromptTokens: 200_000,
};

export const OPUS5_V1_PUBLISHED: PublishedModelPricing = {
  modelId: OPUS5_MODEL_ID,
  billingReferenceInputUsdPerMillion: 5,
  billingReferenceOutputUsdPerMillion: 25,
  billingReferenceCacheReadUsdPerMillion: 0.5,
  billingReferenceCacheWriteUsdPerMillion: 6.25,
  targetMargin: 0.25,
  minimumMarginFloor: 0.15,
  pricingVersion: 1,
  publishedAt: "2026-08-28T00:00:00.000Z",
};

export const GEMINI31_V2_PROPOSED: PublishedModelPricing = {
  modelId: GEMINI31_MODEL_ID,
  billingReferenceInputUsdPerMillion: 2,
  billingReferenceOutputUsdPerMillion: 12,
  targetMargin: 0.09,
  minimumMarginFloor: 0.05,
  pricingVersion: 2,
  publishedAt: "2026-08-28T15:00:00.000Z",
  pricingApplicability: "base_tier_only",
  publishedBaseTierMaxPromptTokens: 200_000,
};

export const OPUS5_V2_PROPOSED: PublishedModelPricing = {
  modelId: OPUS5_MODEL_ID,
  billingReferenceInputUsdPerMillion: 5,
  billingReferenceOutputUsdPerMillion: 25,
  billingReferenceCacheReadUsdPerMillion: 0.5,
  billingReferenceCacheWriteUsdPerMillion: 6.25,
  targetMargin: 0.08,
  minimumMarginFloor: 0.05,
  pricingVersion: 2,
  publishedAt: "2026-08-28T15:00:00.000Z",
};

export type PremiumPolicyRow = {
  modelId: string;
  targetMargin: number;
  baseFx: number;
  billingReferenceCostKrw: number;
  rawStandardChargeKrw: number;
  finalPoints: number;
  competitorChargePoints: number;
  competitiveDeviationPct: number;
  providerListCostKrw: number;
  noDiscountGrossProfitKrw: number | null;
  noDiscountRealizedMargin: number | null;
  strictMarketPass: boolean;
  minimumFloorPass: boolean;
};

export type PremiumFxSensitivityCell = {
  modelId: string;
  baseFx: number;
  effectiveFx: number;
  targetMargin: number;
  finalPoints: number;
  competitorChargePoints: number;
  competitiveDeviationPct: number;
  strictMarketPass: boolean;
};

export type FxMarketStatus = "SAFE" | "NEAR_LIMIT" | "REVIEW_REQUIRED";

export type PremiumAcceptanceGates = {
  GEMINI31_BASE_TIER_REFERENCE_VERIFIED: boolean;
  GEMINI31_ABOVE_THRESHOLD_REFERENCE_VERIFIED: boolean;
  GEMINI31_CACHE_SEMANTICS_VERIFIED: boolean;
  OPUS5_BASE_REFERENCE_VERIFIED: boolean;
  OPUS5_CACHE_READ_VERIFIED: boolean;
  OPUS5_CACHE_WRITE_TTL_VERIFIED: boolean;
  GEMINI31_BASE1530_PASS: boolean;
  GEMINI31_BASE1600_PASS: boolean;
  GEMINI31_BASE1625_PASS: boolean;
  OPUS5_BASE1530_PASS: boolean;
  OPUS5_BASE1600_PASS: boolean;
  OPUS5_BASE1625_PASS: boolean;
  GEMINI31_UNCACHED_TARGET_SEMANTICS_MATCH: boolean;
  OPUS5_UNCACHED_TARGET_SEMANTICS_MATCH: boolean;
  GEMINI31_FX_CEILING_GTE_1625: boolean;
  OPUS5_FX_CEILING_GTE_1625: boolean;
  allPass: boolean;
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function chargePoints(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.ceil(n - 1e-9);
}

export function buildPremiumFxSnapshot(baseUsdKrw: number): ShadowBillingExchangeRateSnapshot {
  return {
    mode: SHADOW_BILLING_FX_MODE,
    dateKey: "2026-08-28",
    usdToKrw: baseUsdKrw,
    effectiveKrwPerUsd: applyOverseasCardFee(baseUsdKrw),
    source: "api_daily",
    locked: true,
    overseasFeeRate: PREMIUM_FX_CARD_FEE,
  };
}

export function buildPremiumUncachedCatalogFixture(modelId: string): CheaperInferenceCatalogPricing {
  const evidence =
    modelId === GEMINI31_MODEL_ID
      ? PREMIUM_PRICING_CALIBRATION_EVIDENCE[GEMINI31_MODEL_ID]
      : modelId === OPUS5_MODEL_ID
        ? PREMIUM_PRICING_CALIBRATION_EVIDENCE[OPUS5_MODEL_ID]
        : null;
  if (!evidence) throw new Error(`Missing premium calibration evidence: ${modelId}`);
  return {
    modelId,
    inputUsdPerMillion: evidence.observedCurrentInputUsdPerMillion,
    outputUsdPerMillion: evidence.observedCurrentOutputUsdPerMillion,
    cacheReadUsdPerMillion: 0,
    cacheWriteUsdPerMillion: 0,
    referenceInputUsdPerMillion: evidence.referenceInputUsdPerMillion,
    referenceOutputUsdPerMillion: evidence.referenceOutputUsdPerMillion,
    referenceCacheReadUsdPerMillion: evidence.referenceCacheReadUsdPerMillion ?? undefined,
    referenceCacheWriteUsdPerMillion: evidence.referenceCacheWriteUsdPerMillion ?? undefined,
    discountPercent: evidence.observedDiscountPercent ?? undefined,
    fetchedAt: Date.parse(evidence.observedAt),
  };
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

export function simulatePremiumPricingPolicy(params: {
  modelId: string;
  published: PublishedModelPricing;
  targetMargin: number;
  baseFx: number;
  catalog?: CheaperInferenceCatalogPricing;
}): PremiumPolicyRow {
  const benchmark = requirePrimaryBenchmark(params.modelId);
  const fxSnapshot = buildPremiumFxSnapshot(params.baseFx);
  const catalog = params.catalog ?? buildPremiumUncachedCatalogFixture(params.modelId);
  const billingReferenceCostKrw = computeBillingReferenceCostKrw(benchmark, params.published, fxSnapshot);
  const rawStandardChargeKrw = round1(billingReferenceCostKrw / (1 - params.targetMargin));
  const finalPoints = chargePoints(rawStandardChargeKrw);
  const providerListCostKrw = computeProviderListCostKrw(benchmark, fxSnapshot, catalog);
  const noDiscountGrossProfitKrw = round1(finalPoints - providerListCostKrw);
  const noDiscountRealizedMargin =
    finalPoints > 0 ? Math.round((noDiscountGrossProfitKrw / finalPoints) * 1000) / 1000 : null;
  const competitiveDeviationPct =
    benchmark.competitorChargePoints > 0
      ? round1(((finalPoints - benchmark.competitorChargePoints) / benchmark.competitorChargePoints) * 100)
      : 0;

  return {
    modelId: params.modelId,
    targetMargin: params.targetMargin,
    baseFx: params.baseFx,
    billingReferenceCostKrw,
    rawStandardChargeKrw,
    finalPoints,
    competitorChargePoints: benchmark.competitorChargePoints,
    competitiveDeviationPct,
    providerListCostKrw,
    noDiscountGrossProfitKrw,
    noDiscountRealizedMargin,
    strictMarketPass: finalPoints <= benchmark.competitorChargePoints,
    minimumFloorPass: (noDiscountRealizedMargin ?? 0) >= params.published.minimumMarginFloor,
  };
}

export function buildPremiumMarginMatrix(params: {
  modelId: string;
  published: PublishedModelPricing;
  baseFx?: number;
}): PremiumPolicyRow[] {
  const baseFx = params.baseFx ?? 1530;
  const candidates =
    params.modelId === GEMINI31_MODEL_ID
      ? PREMIUM_MARGIN_CANDIDATES.gemini31
      : params.modelId === OPUS5_MODEL_ID
        ? PREMIUM_MARGIN_CANDIDATES.opus5
        : [];
  return candidates.map((targetMargin) =>
    simulatePremiumPricingPolicy({
      modelId: params.modelId,
      published: params.published,
      targetMargin,
      baseFx,
    })
  );
}

export function buildPremiumFxSensitivity(params: {
  modelId: string;
  published: PublishedModelPricing;
  targetMargin?: number;
}): PremiumFxSensitivityCell[] {
  const targetMargin =
    params.targetMargin ??
    (params.modelId === GEMINI31_MODEL_ID
      ? GEMINI31_V2_PROPOSED.targetMargin
      : OPUS5_V2_PROPOSED.targetMargin);
  const benchmark = requirePrimaryBenchmark(params.modelId);
  const cells: PremiumFxSensitivityCell[] = [];
  for (const baseFx of PREMIUM_FX_SENSITIVITY_BASES) {
    const row = simulatePremiumPricingPolicy({
      modelId: params.modelId,
      published: params.published,
      targetMargin,
      baseFx,
    });
    cells.push({
      modelId: params.modelId,
      baseFx,
      effectiveFx: round1(buildPremiumFxSnapshot(baseFx).effectiveKrwPerUsd),
      targetMargin,
      finalPoints: row.finalPoints,
      competitorChargePoints: benchmark.competitorChargePoints,
      competitiveDeviationPct: row.competitiveDeviationPct,
      strictMarketPass: row.strictMarketPass,
    });
  }
  return cells;
}

export function computeCompetitiveFxCeiling(params: {
  modelId: string;
  published: PublishedModelPricing;
  targetMargin: number;
  maxBaseFx?: number;
}): number {
  const benchmark = requirePrimaryBenchmark(params.modelId);
  const maxBase = params.maxBaseFx ?? 2000;
  let lo = 1000;
  let hi = maxBase;
  let best = lo;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const row = simulatePremiumPricingPolicy({
      modelId: params.modelId,
      published: params.published,
      targetMargin: params.targetMargin,
      baseFx: mid,
    });
    if (row.finalPoints <= benchmark.competitorChargePoints) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

export function evaluateFxMarketStatus(params: {
  currentBaseFx: number;
  competitiveFxCeiling: number;
}): FxMarketStatus {
  if (params.currentBaseFx <= params.competitiveFxCeiling - FX_MARKET_STATUS_BUFFER_KRW) {
    return "SAFE";
  }
  if (params.currentBaseFx <= params.competitiveFxCeiling) {
    return "NEAR_LIMIT";
  }
  return "REVIEW_REQUIRED";
}

/**
 * Hard-comparable margin selection — reads MODEL_MARKET_BENCHMARKS only.
 * OPAQUE_MARKET_REFERENCES are intentionally excluded.
 */
export function selectPremiumTargetMargin(params: {
  modelId: string;
  published: PublishedModelPricing;
  candidateMargins: readonly number[];
  minimumMarginFloor: number;
  stressFxBases?: readonly number[];
}): number | null {
  const stressBases = params.stressFxBases ?? PREMIUM_HARD_GATE_FX_BASES;
  const sorted = [...params.candidateMargins].sort((a, b) => b - a);
  for (const targetMargin of sorted) {
    if (targetMargin < params.minimumMarginFloor) continue;
    const passesAll = stressBases.every((baseFx) => {
      const row = simulatePremiumPricingPolicy({
        modelId: params.modelId,
        published: params.published,
        targetMargin,
        baseFx,
      });
      return row.strictMarketPass && row.minimumFloorPass;
    });
    if (passesAll) return targetMargin;
  }
  return null;
}

export function evaluatePremiumPricingGates(): PremiumAcceptanceGates {
  const g31 = simulatePremiumPricingPolicy({
    modelId: GEMINI31_MODEL_ID,
    published: GEMINI31_V2_PROPOSED,
    targetMargin: GEMINI31_V2_PROPOSED.targetMargin,
    baseFx: 1530,
  });
  const g31_1600 = simulatePremiumPricingPolicy({
    modelId: GEMINI31_MODEL_ID,
    published: GEMINI31_V2_PROPOSED,
    targetMargin: GEMINI31_V2_PROPOSED.targetMargin,
    baseFx: 1600,
  });
  const g31_1625 = simulatePremiumPricingPolicy({
    modelId: GEMINI31_MODEL_ID,
    published: GEMINI31_V2_PROPOSED,
    targetMargin: GEMINI31_V2_PROPOSED.targetMargin,
    baseFx: 1625,
  });
  const o5 = simulatePremiumPricingPolicy({
    modelId: OPUS5_MODEL_ID,
    published: OPUS5_V2_PROPOSED,
    targetMargin: OPUS5_V2_PROPOSED.targetMargin,
    baseFx: 1530,
  });
  const o5_1600 = simulatePremiumPricingPolicy({
    modelId: OPUS5_MODEL_ID,
    published: OPUS5_V2_PROPOSED,
    targetMargin: OPUS5_V2_PROPOSED.targetMargin,
    baseFx: 1600,
  });
  const o5_1625 = simulatePremiumPricingPolicy({
    modelId: OPUS5_MODEL_ID,
    published: OPUS5_V2_PROPOSED,
    targetMargin: OPUS5_V2_PROPOSED.targetMargin,
    baseFx: 1625,
  });

  const g31Semantics = g31.noDiscountRealizedMargin != null &&
    Math.abs(g31.noDiscountRealizedMargin - GEMINI31_V2_PROPOSED.targetMargin) < 0.02;
  const o5Semantics = o5.noDiscountRealizedMargin != null &&
    Math.abs(o5.noDiscountRealizedMargin - OPUS5_V2_PROPOSED.targetMargin) < 0.02;

  const g31Ceiling = computeCompetitiveFxCeiling({
    modelId: GEMINI31_MODEL_ID,
    published: GEMINI31_V2_PROPOSED,
    targetMargin: GEMINI31_V2_PROPOSED.targetMargin,
  });
  const o5Ceiling = computeCompetitiveFxCeiling({
    modelId: OPUS5_MODEL_ID,
    published: OPUS5_V2_PROPOSED,
    targetMargin: OPUS5_V2_PROPOSED.targetMargin,
  });

  const g31Cache = auditPremiumCacheEvidence(GEMINI31_MODEL_ID, GEMINI31_V2_PROPOSED);
  const o5Cache = auditPremiumCacheEvidence(OPUS5_MODEL_ID, OPUS5_V2_PROPOSED);

  const gates: PremiumAcceptanceGates = {
    GEMINI31_BASE_TIER_REFERENCE_VERIFIED: referenceEvidenceMatchesPublishedBaseTier(
      GEMINI31_MODEL_ID,
      GEMINI31_V2_PROPOSED
    ),
    GEMINI31_ABOVE_THRESHOLD_REFERENCE_VERIFIED: evaluateAboveThresholdReferenceVerified(GEMINI31_MODEL_ID),
    GEMINI31_CACHE_SEMANTICS_VERIFIED: g31Cache.status === "VERIFIED",
    OPUS5_BASE_REFERENCE_VERIFIED: referenceEvidenceMatchesPublishedBaseTier(OPUS5_MODEL_ID, OPUS5_V2_PROPOSED),
    OPUS5_CACHE_READ_VERIFIED: o5Cache.status === "VERIFIED_5M" || o5Cache.status === "VERIFIED",
    OPUS5_CACHE_WRITE_TTL_VERIFIED: o5Cache.status === "VERIFIED_5M",
    GEMINI31_BASE1530_PASS: g31.strictMarketPass,
    GEMINI31_BASE1600_PASS: g31_1600.strictMarketPass,
    GEMINI31_BASE1625_PASS: g31_1625.strictMarketPass,
    OPUS5_BASE1530_PASS: o5.strictMarketPass,
    OPUS5_BASE1600_PASS: o5_1600.strictMarketPass,
    OPUS5_BASE1625_PASS: o5_1625.strictMarketPass,
    GEMINI31_UNCACHED_TARGET_SEMANTICS_MATCH: g31Semantics,
    OPUS5_UNCACHED_TARGET_SEMANTICS_MATCH: o5Semantics,
    GEMINI31_FX_CEILING_GTE_1625: g31Ceiling >= 1625,
    OPUS5_FX_CEILING_GTE_1625: o5Ceiling >= 1625,
    allPass: false,
  };
  gates.allPass =
    gates.GEMINI31_BASE_TIER_REFERENCE_VERIFIED &&
    gates.OPUS5_BASE_REFERENCE_VERIFIED &&
    gates.GEMINI31_BASE1530_PASS &&
    gates.GEMINI31_BASE1600_PASS &&
    gates.GEMINI31_BASE1625_PASS &&
    gates.OPUS5_BASE1530_PASS &&
    gates.OPUS5_BASE1600_PASS &&
    gates.OPUS5_BASE1625_PASS &&
    gates.GEMINI31_UNCACHED_TARGET_SEMANTICS_MATCH &&
    gates.OPUS5_UNCACHED_TARGET_SEMANTICS_MATCH &&
    gates.GEMINI31_FX_CEILING_GTE_1625 &&
    gates.OPUS5_FX_CEILING_GTE_1625;
  return gates;
}

export function getPremiumCacheEvidenceReports(): Record<string, CacheEvidenceAudit> {
  return {
    [GEMINI31_MODEL_ID]: auditPremiumCacheEvidence(GEMINI31_MODEL_ID, GEMINI31_V2_PROPOSED),
    [OPUS5_MODEL_ID]: auditPremiumCacheEvidence(OPUS5_MODEL_ID, OPUS5_V2_PROPOSED),
  };
}

export function isPremiumCacheReadyForLiveCutover(): boolean {
  const reports = getPremiumCacheEvidenceReports();
  return Object.entries(reports).every(([, r]) => r.status === "VERIFIED" || r.status === "VERIFIED_5M");
}

export type HardComparableStatus = "PASS" | "FAIL";

export function evaluateHardComparableStatus(params: {
  modelId: string;
  published: PublishedModelPricing;
  baseFx?: number;
}): HardComparableStatus {
  const row = simulatePremiumPricingPolicy({
    modelId: params.modelId,
    published: params.published,
    targetMargin: params.published.targetMargin,
    baseFx: params.baseFx ?? 1530,
  });
  return row.strictMarketPass ? "PASS" : "FAIL";
}

export function computeBenchmarkImpliedMaxMargin(params: {
  modelId: string;
  baseFx?: number;
}): number | null {
  const benchmark = requirePrimaryBenchmark(params.modelId);
  const fxSnapshot = buildPremiumFxSnapshot(params.baseFx ?? 1530);
  const catalog = buildPremiumUncachedCatalogFixture(params.modelId);
  const providerListCostKrw = computeProviderListCostKrw(benchmark, fxSnapshot, catalog);
  if (benchmark.competitorChargePoints <= 0 || providerListCostKrw <= 0) return null;
  return Math.round((1 - providerListCostKrw / benchmark.competitorChargePoints) * 10000) / 10000;
}

export { GEMINI31_MODEL_ID, OPUS5_MODEL_ID };
