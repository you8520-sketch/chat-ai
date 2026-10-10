/**
 * Billing / provider pricing semantics audit — read-only matrices and case builders.
 * NOT a live billing owner. No pricing row mutations.
 */

import { normalizeBillableUsage, type NormalizedBillableUsage } from "@/lib/billingUsage";
import { GEMINI37_CALIBRATION_RATE_EVIDENCE } from "@/lib/gemini37CalibrationEvidence";
import {
  GOOGLE_STANDARD_INTRO_VALID_THROUGH,
  GOOGLE_STANDARD_STRESS_RATES,
} from "@/lib/gemini37PricingPolicy.constants";
import {
  GEMINI37_BENCHMARK_A_ID,
  GEMINI37_BENCHMARK_B_ID,
  getMarketBenchmark,
} from "@/lib/marketUsageBenchmarks";
import { getPublishedPricing } from "@/lib/publishedModelPricing";
import {
  computeSiteDiscountPercent,
  SITE_PROMOTION_PASS_THROUGH_RATIO,
} from "@/lib/sitePromotionPolicy";
import { applySitePromotionToCharge } from "@/lib/sitePromotionPolicy";
import { CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL } from "@/lib/chatModels";

export const SEMANTICS_AUDIT_FX = {
  usdToKrw: 1530,
  effectiveKrwPerUsd: 1560.6,
  overseasFeeRate: 0.02,
} as const;

export const G37_TARGET_MARGIN = 0.55;

export type ProviderPricingMode =
  | "GOOGLE_STANDARD_PAYGO_INTRO"
  | "GOOGLE_STANDARD_PAYGO_POST_INTRO"
  | "GOOGLE_FLEX_BATCH_INTRO"
  | "GOOGLE_FLEX_BATCH_POST_INTRO"
  | "GOOGLE_CONTEXT_CACHE_READ"
  | "GOOGLE_PROVISIONED_THROUGHPUT_CREDIT"
  | "DEEPSEEK_V4_PRO_PEAK"
  | "DEEPSEEK_V4_PRO_OFF_PEAK"
  | "DEEPSEEK_V4_1_FLASH_PEAK"
  | "DEEPSEEK_V4_1_FLASH_OFF_PEAK"
  | "CI_MARKETPLACE_DISCOUNT";

export type G37PricingBasisId = "A_STANDARD_INTRO" | "B_STANDARD_POST_INTRO" | "C_FLEX_BATCH_INTRO";

export type G37BasisRates = {
  id: G37PricingBasisId;
  label: string;
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  googleMode: ProviderPricingMode;
  validThrough?: string;
};

export const G37_PRICING_BASES: readonly G37BasisRates[] = [
  {
    id: "A_STANDARD_INTRO",
    label: "Google current Standard PayGo (introductory)",
    inputUsdPerMillion: 0.75,
    outputUsdPerMillion: 3.75,
    googleMode: "GOOGLE_STANDARD_PAYGO_INTRO",
    validThrough: GOOGLE_STANDARD_INTRO_VALID_THROUGH,
  },
  {
    id: "B_STANDARD_POST_INTRO",
    label: "Google future Standard PayGo (post-intro)",
    inputUsdPerMillion: 1.5,
    outputUsdPerMillion: 7.5,
    googleMode: "GOOGLE_STANDARD_PAYGO_POST_INTRO",
    validThrough: "2027-01-01 onward",
  },
  {
    id: "C_FLEX_BATCH_INTRO",
    label: "Google Flex/Batch (introductory half-rate)",
    inputUsdPerMillion: 0.375,
    outputUsdPerMillion: 1.875,
    googleMode: "GOOGLE_FLEX_BATCH_INTRO",
    validThrough: GOOGLE_STANDARD_INTRO_VALID_THROUGH,
  },
] as const;

export const CI_G37_EVIDENCE = {
  listInputUsdPerMillion: 0.75,
  listOutputUsdPerMillion: 3.75,
  currentInputUsdPerMillion: 0.525,
  currentOutputUsdPerMillion: 2.625,
  discountPercent: 30,
  observedAt: "2026-09-20 audit fixture (repo + user-provided CI evidence)",
} as const;

export const DEEPSEEK_V4_PRO_OFFICIAL = {
  peak: { inputUsdPerMillion: 1.32, outputUsdPerMillion: 3.96, cacheHitInputUsdPerMillion: 0.044 },
  offPeak: { inputUsdPerMillion: 0.66, outputUsdPerMillion: 1.98, cacheHitInputUsdPerMillion: 0.022 },
  peakHoursUtc: "01:00–04:00 and 06:00–10:00 Mon–Fri",
} as const;

export const DEEPSEEK_V4_1_FLASH_OFFICIAL = {
  peak: { inputUsdPerMillion: 0.3, outputUsdPerMillion: 1.2, cacheHitInputUsdPerMillion: 0.006 },
  offPeak: { inputUsdPerMillion: 0.15, outputUsdPerMillion: 0.6, cacheHitInputUsdPerMillion: 0.003 },
} as const;

export type G37MatrixRow = {
  basisId: G37PricingBasisId;
  benchmarkId: string;
  inputTokens: number;
  outputTokens: number;
  referenceRawKrw: number;
  ourBaseP: number;
  competitorP: number;
  deltaP: number;
  deltaPercent: number;
  targetMargin: number;
  ciProcurementKrw: number;
  ciProcurementRealizedMargin: number;
};

export type DeepSeekMatrixRow = {
  modelFamily: "V4_PRO" | "V4_1_FLASH";
  tier: "PEAK" | "OFF_PEAK" | "CI_CURRENT" | "PUBLISHED_REFERENCE";
  shape: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  referenceRawKrw: number;
  ourPublishedBaseP: number | null;
  competitorP: null;
  ciProcurementKrw: number | null;
  realizedMargin: number | null;
};

export type PromotionDoubleApplicationCase = {
  caseId: "A" | "B" | "C";
  label: string;
  baseUsesPromotionalPrice: boolean;
  sitePromoActive: boolean;
  procurementTierChanged: boolean;
  baseUserChargePoints: number;
  finalUserChargePoints: number;
  doubleDiscountRisk: boolean;
  notes: string;
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function chargePoints(rawKrw: number, margin: number): number {
  if (!Number.isFinite(rawKrw) || rawKrw <= 0) return 0;
  return Math.ceil(rawKrw / (1 - margin) - 1e-9);
}

function usageCostKrw(
  usage: Pick<NormalizedBillableUsage, "standardInputTokens" | "billableOutputTokens" | "cacheReadTokens">,
  inputUsdPerMillion: number,
  outputUsdPerMillion: number,
  cacheReadUsdPerMillion = 0
): number {
  const usd =
    (usage.standardInputTokens / 1_000_000) * inputUsdPerMillion +
    (usage.cacheReadTokens / 1_000_000) * cacheReadUsdPerMillion +
    (usage.billableOutputTokens / 1_000_000) * outputUsdPerMillion;
  return round1(usd * SEMANTICS_AUDIT_FX.effectiveKrwPerUsd);
}

function g37BenchmarkUsage(benchmarkId: string): NormalizedBillableUsage {
  const benchmark =
    benchmarkId === GEMINI37_BENCHMARK_A_ID
      ? getMarketBenchmark(CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL, GEMINI37_BENCHMARK_A_ID)!
      : getMarketBenchmark(CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL, GEMINI37_BENCHMARK_B_ID)!;
  return normalizeBillableUsage({
    modelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
    promptTokens: benchmark.inputTokens,
    outputTokens: benchmark.displayedOutputTokens,
  });
}

export function buildG37ThreeBasisMatrix(): G37MatrixRow[] {
  const ciCurrent = GEMINI37_CALIBRATION_RATE_EVIDENCE;
  const rows: G37MatrixRow[] = [];

  for (const basis of G37_PRICING_BASES) {
    for (const benchmarkId of [GEMINI37_BENCHMARK_A_ID, GEMINI37_BENCHMARK_B_ID] as const) {
      const benchmark = getMarketBenchmark(CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL, benchmarkId)!;
      const usage = g37BenchmarkUsage(benchmarkId);
      const referenceRawKrw = usageCostKrw(usage, basis.inputUsdPerMillion, basis.outputUsdPerMillion);
      const ourBaseP = chargePoints(referenceRawKrw, G37_TARGET_MARGIN);
      const competitorP = benchmark.competitorChargePoints;
      const procKrw = usageCostKrw(
        usage,
        ciCurrent.observedCurrentInputUsdPerMillion,
        ciCurrent.observedCurrentOutputUsdPerMillion
      );
      rows.push({
        basisId: basis.id,
        benchmarkId,
        inputTokens: benchmark.inputTokens,
        outputTokens: benchmark.displayedOutputTokens,
        referenceRawKrw,
        ourBaseP,
        competitorP,
        deltaP: round1(ourBaseP - competitorP),
        deltaPercent: round1(((ourBaseP - competitorP) / competitorP) * 100),
        targetMargin: G37_TARGET_MARGIN,
        ciProcurementKrw: procKrw,
        ciProcurementRealizedMargin:
          ourBaseP > 0 ? round1((ourBaseP - procKrw) / ourBaseP) : 0,
      });
    }
  }
  return rows;
}

const DEEPSEEK_SHAPES = {
  NORMAL: { promptTokens: 33_247, outputTokens: 3_461, cacheReadTokens: 0 },
  MEMORY_HEAVY: { promptTokens: 12_871, outputTokens: 1_273, cacheReadTokens: 12_800 },
  BOUNDED_VALID_STRESS: { promptTokens: 80_000, outputTokens: 5_000, cacheReadTokens: 0 },
} as const;

function deepSeekPublishedBaseP(
  usage: NormalizedBillableUsage,
  inputUsdPerMillion: number,
  outputUsdPerMillion: number,
  cacheReadUsdPerMillion: number,
  targetMargin: number
): number {
  const rawKrw = usageCostKrw(usage, inputUsdPerMillion, outputUsdPerMillion, cacheReadUsdPerMillion);
  return chargePoints(rawKrw, targetMargin);
}

export function buildDeepSeekMatrix(): DeepSeekMatrixRow[] {
  const published = getPublishedPricing("deepseek-v4-pro-0813");
  const ciCurrent = { in: 0.3045, out: 0.609, cache: 0.231 };
  const rows: DeepSeekMatrixRow[] = [];

  for (const [shape, tokens] of Object.entries(DEEPSEEK_SHAPES)) {
    const usage = normalizeBillableUsage({
      modelId: "deepseek-v4-pro-0813",
      ...tokens,
    });

    const tiers: Array<{
      modelFamily: "V4_PRO" | "V4_1_FLASH";
      tier: DeepSeekMatrixRow["tier"];
      in: number;
      out: number;
      cache: number;
      targetMargin?: number;
    }> = [
      {
        modelFamily: "V4_PRO",
        tier: "OFF_PEAK",
        in: DEEPSEEK_V4_PRO_OFFICIAL.offPeak.inputUsdPerMillion,
        out: DEEPSEEK_V4_PRO_OFFICIAL.offPeak.outputUsdPerMillion,
        cache: DEEPSEEK_V4_PRO_OFFICIAL.offPeak.cacheHitInputUsdPerMillion,
      },
      {
        modelFamily: "V4_PRO",
        tier: "PEAK",
        in: DEEPSEEK_V4_PRO_OFFICIAL.peak.inputUsdPerMillion,
        out: DEEPSEEK_V4_PRO_OFFICIAL.peak.outputUsdPerMillion,
        cache: DEEPSEEK_V4_PRO_OFFICIAL.peak.cacheHitInputUsdPerMillion,
      },
      {
        modelFamily: "V4_PRO",
        tier: "PUBLISHED_REFERENCE",
        in: published.billingReferenceInputUsdPerMillion,
        out: published.billingReferenceOutputUsdPerMillion,
        cache: published.billingReferenceCacheReadUsdPerMillion ?? 0,
        targetMargin: published.targetMargin,
      },
      {
        modelFamily: "V4_PRO",
        tier: "CI_CURRENT",
        in: ciCurrent.in,
        out: ciCurrent.out,
        cache: ciCurrent.cache,
        targetMargin: published.targetMargin,
      },
      {
        modelFamily: "V4_1_FLASH",
        tier: "OFF_PEAK",
        in: DEEPSEEK_V4_1_FLASH_OFFICIAL.offPeak.inputUsdPerMillion,
        out: DEEPSEEK_V4_1_FLASH_OFFICIAL.offPeak.outputUsdPerMillion,
        cache: DEEPSEEK_V4_1_FLASH_OFFICIAL.offPeak.cacheHitInputUsdPerMillion,
      },
      {
        modelFamily: "V4_1_FLASH",
        tier: "PEAK",
        in: DEEPSEEK_V4_1_FLASH_OFFICIAL.peak.inputUsdPerMillion,
        out: DEEPSEEK_V4_1_FLASH_OFFICIAL.peak.outputUsdPerMillion,
        cache: DEEPSEEK_V4_1_FLASH_OFFICIAL.peak.cacheHitInputUsdPerMillion,
      },
    ];

    for (const t of tiers) {
      const rawKrw = usageCostKrw(usage, t.in, t.out, t.cache);
      const publishedP =
        t.tier === "PUBLISHED_REFERENCE" || t.tier === "CI_CURRENT"
          ? deepSeekPublishedBaseP(
              usage,
              t.tier === "PUBLISHED_REFERENCE" ? t.in : published.billingReferenceInputUsdPerMillion,
              t.tier === "PUBLISHED_REFERENCE" ? t.out : published.billingReferenceOutputUsdPerMillion,
              t.tier === "PUBLISHED_REFERENCE" ? t.cache : published.billingReferenceCacheReadUsdPerMillion ?? 0,
              published.targetMargin
            )
          : null;
      const procKrw = t.tier === "CI_CURRENT" ? rawKrw : null;
      const basePForMargin = publishedP ?? 0;
      rows.push({
        modelFamily: t.modelFamily,
        tier: t.tier,
        shape,
        inputTokens: tokens.promptTokens,
        outputTokens: tokens.outputTokens,
        cacheReadTokens: tokens.cacheReadTokens,
        referenceRawKrw: rawKrw,
        ourPublishedBaseP: publishedP,
        competitorP: null,
        ciProcurementKrw: procKrw,
        realizedMargin:
          publishedP != null && procKrw != null && basePForMargin > 0
            ? round1((basePForMargin - procKrw) / basePForMargin)
            : null,
      });
    }
  }
  return rows;
}

/** Deterministic promotion layering cases for GPT review — no DB required. */
export function buildPromotionDoubleApplicationCases(): PromotionDoubleApplicationCase[] {
  const baseNormalCharge = 100;
  const officialIntroDiscountPct = 50;
  const siteDiscountPct = computeSiteDiscountPercent(officialIntroDiscountPct);

  const caseA: PromotionDoubleApplicationCase = {
    caseId: "A",
    label: "BASE already uses official promotional Standard intro price + site promo active",
    baseUsesPromotionalPrice: true,
    sitePromoActive: true,
    procurementTierChanged: false,
    baseUserChargePoints: baseNormalCharge,
    finalUserChargePoints: applySitePromotionToCharge(baseNormalCharge, siteDiscountPct).finalChargePoints,
    doubleDiscountRisk: true,
    notes:
      "If BASE_USER_CHARGE is calibrated to Google intro $0.75/$3.75 AND an official_provider_promotions row passes 50% through site promotion, user sees stacked discount. Existing code applies site promo on BASE only — risk is semantic (BASE already embeds intro), not duplicate applySitePromotion calls.",
  };

  const caseBFinal = applySitePromotionToCharge(baseNormalCharge, siteDiscountPct).finalChargePoints;
  const caseB: PromotionDoubleApplicationCase = {
    caseId: "B",
    label: "BASE uses normal non-promotional baseline + site promo active",
    baseUsesPromotionalPrice: false,
    sitePromoActive: true,
    procurementTierChanged: false,
    baseUserChargePoints: baseNormalCharge,
    finalUserChargePoints: caseBFinal,
    doubleDiscountRisk: false,
    notes: `Expected layered behavior: BASE=${baseNormalCharge} → FINAL=${caseBFinal} at site ${siteDiscountPct}% (official ${officialIntroDiscountPct}% × pass-through ${SITE_PROMOTION_PASS_THROUGH_RATIO}).`,
  };

  const caseC: PromotionDoubleApplicationCase = {
    caseId: "C",
    label: "Flex/off-peak/CI marketplace tier changes procurement only",
    baseUsesPromotionalPrice: false,
    sitePromoActive: false,
    procurementTierChanged: true,
    baseUserChargePoints: baseNormalCharge,
    finalUserChargePoints: baseNormalCharge,
    doubleDiscountRisk: false,
    notes:
      "BASE and site promo unchanged; CI current or DeepSeek off-peak procurement moves ACTUAL_REALIZED_MARGIN only. Live bug: when BASE follows CI current (pointsReasoningMargins), procurement swing also moves BASE — violates intended separation.",
  };

  return [caseA, caseB, caseC];
}

export const PRICING_DIMENSION_OWNER_MAP = {
  PROVIDER_NORMAL_BASELINE: {
    intendedOwner: "publishedModelPricing.billingReference* (cutover) / competitor benchmark calibration",
    currentLiveOwner: "pointsReasoningMargins.ts fallback + CI catalog overlay (bug: follows current)",
    notes: "Google Standard intro; DeepSeek peak cache-miss per product policy",
  },
  OFFICIAL_TEMP_PROMO: {
    intendedOwner: "officialProviderPromotion.ts (verified admin rows)",
    currentLiveOwner: "officialProviderPromotion.ts",
    notes: "Explicit provider credits / time-boxed official discounts — NOT Flex/Batch/off-peak",
  },
  PROCUREMENT_TIER: {
    intendedOwner: "procurementCost.ts + upstreamCostUsd",
    currentLiveOwner: "procurementCost.ts; also incorrectly drives BASE via upstreamCostUsd path",
    notes: "DeepSeek off-peak, Google Flex if actually procured, CI current",
  },
  CI_REFERENCE_QUOTE: {
    intendedOwner: "cheaperInferenceCatalogPricing reference_* fields (informational list)",
    currentLiveOwner: "gemini37CalibrationEvidence / billingPreflightModelPricingEvidence",
    notes: "NOT proven equal to provider undiscounted list (G37: CI list=Standard, published ref=Flex)",
  },
  CI_CURRENT_PROCUREMENT: {
    intendedOwner: "cheaperInferenceCatalogPricing input/output current rates",
    currentLiveOwner: "withLiveCheaperInferenceCatalogPricing in pointsReasoningMargins",
    notes: "30% marketplace discount — never site promotion",
  },
  ACTUAL_UPSTREAM_COST: {
    intendedOwner: "providerCostLedger + upstreamCostUsd envelope",
    currentLiveOwner: "providerCostLedger.ts, chat usage upstreamCostUsd",
    notes: "Settlement truth for realized margin",
  },
  BASE_USER_CHARGE: {
    intendedOwner: "publishedUserCharge.ts (stable reference + target margin)",
    currentLiveOwner: "pointsReasoningMargins.ts computeReasoningPointCost / upstream override",
    notes: "Cutover STOP on PR #991",
  },
  SITE_PROMOTION: {
    intendedOwner: "sitePromotion.ts on BASE only",
    currentLiveOwner: "sitePromotion.ts applySitePromotionToTurnBilling",
    notes: "60% pass-through, 7-day cap; CI discountPercent excluded",
  },
  FINAL_USER_CHARGE: {
    intendedOwner: "BASE minus site promotion (+ surcharges)",
    currentLiveOwner: "pointsReasoningMargins.ts",
    notes: "Unchanged by procurement tier when separation correct",
  },
  ACTUAL_REALIZED_MARGIN: {
    intendedOwner: "admin finance / shadow diagnostics",
    currentLiveOwner: "upstreamCostUsd vs charged points",
    notes: "Procurement tier affects this, not BASE_USER_CHARGE",
  },
} as const;

export function publishedG37MatchesFlexBatch(): boolean {
  const published = getPublishedPricing(CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL);
  const flex = G37_PRICING_BASES.find((b) => b.id === "C_FLEX_BATCH_INTRO")!;
  return (
    published.billingReferenceInputUsdPerMillion === flex.inputUsdPerMillion &&
    published.billingReferenceOutputUsdPerMillion === flex.outputUsdPerMillion
  );
}

export function ciListMatchesGoogleStandard(): boolean {
  return (
    CI_G37_EVIDENCE.listInputUsdPerMillion === GOOGLE_STANDARD_STRESS_RATES.inputUsdPerMillion &&
    CI_G37_EVIDENCE.listOutputUsdPerMillion === GOOGLE_STANDARD_STRESS_RATES.outputUsdPerMillion
  );
}

export function directStandardStressMarginAtPublishedV2(benchmarkId: string): number | null {
  const published = getPublishedPricing(CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL);
  const usage = g37BenchmarkUsage(benchmarkId);
  const userPriceKrw = round1(
    usageCostKrw(
      usage,
      published.billingReferenceInputUsdPerMillion,
      published.billingReferenceOutputUsdPerMillion
    ) /
      (1 - published.targetMargin)
  );
  const directStandardKrw = usageCostKrw(
    usage,
    GOOGLE_STANDARD_STRESS_RATES.inputUsdPerMillion,
    GOOGLE_STANDARD_STRESS_RATES.outputUsdPerMillion
  );
  return userPriceKrw > 0 ? round1((userPriceKrw - directStandardKrw) / userPriceKrw) : null;
}
