/**
 * Phase 2 Shadow Pricing — canonical owner for unified cost & charge simulation.
 * USER BILLING UNCHANGED: deductPoints() still uses legacy `points.ts` path.
 * Three costs: actualProviderCost / providerListCost / billingReferenceCost
 */

import {
  normalizeBillingFxSource,
  resolveShadowBillingExchangeRateSnapshot,
  type BillingFxSource,
  type ShadowBillingExchangeRateSnapshot,
} from "@/lib/shadowBillingExchangeRate";
import type { BillingFxSnapshot } from "@/lib/billingFxSnapshot";
import { convertUsdToKrw, OVERSEAS_CARD_FEE_PERCENT } from "@/lib/exchangeRate";
import { openRouterUsdCostFromRates, resolveOpenRouterModelRates } from "@/lib/openRouterModelPricing";
import { getPublishedPricing, resolvePublishedPricingExact } from "@/lib/publishedModelPricing";
import {
  resolveCheaperInferenceCatalogPricing,
  resolveCatalogRatesForPrompt,
  type ResolvedCatalogRates,
} from "@/lib/cheaperInferenceCatalogPricing";
import {
  getModelShadowPricingPolicy,
  requiresStrictCachePolicy,
} from "@/lib/modelShadowPricingPolicy";
import { selectCatalogPricingTier } from "@/lib/catalogPricingTier";
import {
  normalizeBillableUsage,
  type NormalizedBillableUsage,
  type ReasoningAccounting,
} from "@/lib/billingUsage";
import {
  computePublishedUserChargeWithSnapshot,
  type PublishedChargeBlockedReason,
  type PublishedUserChargeResult,
} from "@/lib/publishedUserCharge";

export type { NormalizedBillableUsage, ReasoningAccounting } from "@/lib/billingUsage";
export { normalizeBillableUsage } from "@/lib/billingUsage";

export type ActualCostSource =
  | "cheaper_inference_billed"
  | "provider_reported"
  | "live_catalog_estimated"
  | "live_catalog_partial"
  | "published_fallback_estimated"
  | "unavailable";

export type ProviderListCostStatus =
  | "complete"
  | "partial_missing_cache_rate"
  | "reference_rates_unavailable"
  | "tier_reference_rates_unavailable";

export type BillingReferenceCostStatus =
  | "complete"
  | "unsupported_cache_semantics"
  | "unsupported_pricing_tier"
  | "reference_rates_unavailable";

export type ActualTurnCostCoverage = "complete" | "partial";

export function resolveActualTurnCostCoverage(opts: {
  totalStageCount?: number;
  fallbackAttempted?: boolean;
  hiddenFallbackOverheadCostUsd?: number;
  lengthRecoveryPasses?: number;
  lengthContinuationPasses?: number;
}): ActualTurnCostCoverage {
  if (opts.fallbackAttempted === true) return "partial";
  if ((opts.totalStageCount ?? 1) > 1) return "partial";
  if ((opts.hiddenFallbackOverheadCostUsd ?? 0) > 0) return "partial";
  if ((opts.lengthRecoveryPasses ?? 0) > 0) return "partial";
  if ((opts.lengthContinuationPasses ?? 0) > 0) return "partial";
  return "complete";
}

export type ShadowCostBreakdown = {
  promptTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  standardInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  billableOutputTokens: number;
  reasoningAccounting: ReasoningAccounting;
  actualProviderCostKrw: number;
  actualCostSource: ActualCostSource;
  actualCostUsd?: number;
  providerListCostKrw: number;
  providerListCostStatus: ProviderListCostStatus;
  billingReferenceCostStatus: BillingReferenceCostStatus;
  reserveStatus: "unavailable" | "estimated" | "complete";
  actualTurnCostCoverage: ActualTurnCostCoverage;
  billingReferenceCostKrw: number;
  billingReferenceCostUsd: number;
  inputCostKrw: number;
  outputCostKrw: number;
  reasoningCostKrw: number;
  cacheReadCostKrw: number;
  cacheWriteCostKrw: number;
  billingReferenceInputUsdPerMillion: number;
  billingReferenceOutputUsdPerMillion: number;
  pricingVersion: number;
  targetMargin: number;
  minimumMarginFloor: number;
  fxSnapshot: {
    dateKey: string;
    source: BillingFxSource;
    baseUsdKrw: number;
    overseasFeeRate: number;
    effectiveKrwPerUsd: number;
    locked: boolean;
  };
  /** Shadow convergence — base published charge result before promo adjustment */
  _publishedChargeBase?: PublishedUserChargeResult;
};

export type ShadowChargeBreakdown = ShadowCostBreakdown & {
  standardUserChargeKrw: number;
  promoPercent: number;
  promoGivebackKrw: number;
  finalShadowChargeKrw: number;
  finalShadowPoints: number;
  publishedChargeStatus: "complete" | "blocked";
  publishedChargeBlockedReason?: PublishedChargeBlockedReason;
  actualRealizedMargin: number | null;
  providerSavingsKrw: number | null;
  providerOverrunKrw: number | null;
  promoGivebackForReserveKrw: number;
  netPricingBufferDeltaKrw: number | null;
  actualGrossProfitKrw: number;
  worstCasePromoMargin: number | null;
  marginFloorViolated: boolean | null;
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function chargePoints(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.ceil(n - 1e-9);
}

function toBillingFxSnapshot(snapshot: ShadowBillingExchangeRateSnapshot): BillingFxSnapshot {
  return {
    mode: snapshot.mode,
    dateKey: snapshot.dateKey,
    usdToKrw: snapshot.usdToKrw,
    effectiveKrwPerUsd: snapshot.effectiveKrwPerUsd,
    source: normalizeBillingFxSource(snapshot.source),
    overseasFeeRate: snapshot.overseasFeeRate,
    locked: snapshot.locked,
  };
}

function mapPublishedBlockToBillingStatus(
  reason: PublishedChargeBlockedReason
): BillingReferenceCostStatus {
  switch (reason) {
    case "unsupported_cache_semantics":
      return "unsupported_cache_semantics";
    case "unsupported_pricing_tier":
      return "unsupported_pricing_tier";
    case "unsupported_model":
    case "incomplete_usage_coverage":
    case "unknown_usage_coverage":
    case "invalid_usage":
    case "invalid_fx_snapshot":
    case "invalid_published_pricing":
      return "reference_rates_unavailable";
    default: {
      const _exhaustive: never = reason;
      return _exhaustive;
    }
  }
}

function usageUsdFromReferenceRates(
  usage: NormalizedBillableUsage,
  rates: Pick<
    ResolvedCatalogRates,
    | "referenceInputUsdPerMillion"
    | "referenceOutputUsdPerMillion"
    | "referenceCacheReadUsdPerMillion"
    | "referenceCacheWriteUsdPerMillion"
  >
): number | null {
  if (rates.referenceInputUsdPerMillion == null || rates.referenceOutputUsdPerMillion == null) {
    return null;
  }
  if (usage.cacheReadTokens > 0 && rates.referenceCacheReadUsdPerMillion == null) return null;
  if (usage.cacheWriteTokens > 0 && rates.referenceCacheWriteUsdPerMillion == null) return null;
  return (
    (usage.standardInputTokens / 1_000_000) * rates.referenceInputUsdPerMillion +
    (rates.referenceCacheReadUsdPerMillion != null
      ? (usage.cacheReadTokens / 1_000_000) * rates.referenceCacheReadUsdPerMillion
      : 0) +
    (rates.referenceCacheWriteUsdPerMillion != null
      ? (usage.cacheWriteTokens / 1_000_000) * rates.referenceCacheWriteUsdPerMillion
      : 0) +
    (usage.billableOutputTokens / 1_000_000) * rates.referenceOutputUsdPerMillion
  );
}

function usageUsdFromCurrentRates(
  usage: NormalizedBillableUsage,
  rates: Pick<
    ResolvedCatalogRates,
    "inputUsdPerMillion" | "outputUsdPerMillion" | "cacheReadUsdPerMillion" | "cacheWriteUsdPerMillion"
  >
): number | null {
  if (usage.cacheReadTokens > 0 && rates.cacheReadUsdPerMillion == null) return null;
  if (usage.cacheWriteTokens > 0 && rates.cacheWriteUsdPerMillion == null) return null;
  return (
    (usage.standardInputTokens / 1_000_000) * rates.inputUsdPerMillion +
    (rates.cacheReadUsdPerMillion != null
      ? (usage.cacheReadTokens / 1_000_000) * rates.cacheReadUsdPerMillion
      : 0) +
    (rates.cacheWriteUsdPerMillion != null
      ? (usage.cacheWriteTokens / 1_000_000) * rates.cacheWriteUsdPerMillion
      : 0) +
    (usage.billableOutputTokens / 1_000_000) * rates.outputUsdPerMillion
  );
}

function computeProviderListCostKrw(
  usage: NormalizedBillableUsage,
  modelId: string,
  effectiveRate: number
): { costKrw: number; status: ProviderListCostStatus } {
  const catalog = resolveCheaperInferenceCatalogPricing(modelId);
  if (!catalog) {
    return { costKrw: 0, status: "reference_rates_unavailable" };
  }

  const tier = selectCatalogPricingTier({
    promptTokens: usage.promptTokens,
    inputTokenPriceThreshold: catalog.inputTokenPriceThreshold,
  });
  if (tier === "above_threshold" && !catalog.aboveThreshold) {
    return { costKrw: 0, status: "tier_reference_rates_unavailable" };
  }

  const resolved = resolveCatalogRatesForPrompt(catalog, usage.promptTokens);
  const usd = usageUsdFromReferenceRates(usage, resolved);
  if (usd == null) {
    if (tier === "above_threshold") {
      return { costKrw: 0, status: "tier_reference_rates_unavailable" };
    }
    if (resolved.referenceInputUsdPerMillion == null || resolved.referenceOutputUsdPerMillion == null) {
      return { costKrw: 0, status: "reference_rates_unavailable" };
    }
    return { costKrw: 0, status: "partial_missing_cache_rate" };
  }
  return { costKrw: round1(convertUsdToKrw(usd, effectiveRate)), status: "complete" };
}

function computeBillingReferenceCost(
  usage: NormalizedBillableUsage,
  modelId: string,
  fxSnapshot: BillingFxSnapshot,
  pub: ReturnType<typeof getPublishedPricing>
): { costUsd: number; status: BillingReferenceCostStatus; publishedResult: PublishedUserChargeResult } {
  const resolvedOverride = resolvePublishedPricingExact(modelId);
  const publishedResult = computePublishedUserChargeWithSnapshot({
    modelId,
    usage,
    usageCoverage: "complete",
    fxSnapshot,
    adjustment: { kind: "none" },
    resolvedPricing: resolvedOverride ?? {
      requestedModelId: modelId,
      canonicalModelId: pub.modelId,
      pricing: pub,
    },
  });
  if (publishedResult.status === "complete") {
    return {
      costUsd: publishedResult.snapshot.billingReferenceCostUsd,
      status: "complete",
      publishedResult,
    };
  }
  return {
    costUsd: 0,
    status: mapPublishedBlockToBillingStatus(publishedResult.reason),
    publishedResult,
  };
}

function estimateActualCostFromCatalog(
  usage: NormalizedBillableUsage,
  modelId: string
): { usdCost: number; source: ActualCostSource } {
  const hasCacheUsage = usage.cacheReadTokens > 0 || usage.cacheWriteTokens > 0;
  if (hasCacheUsage && requiresStrictCachePolicy(modelId)) {
    return { usdCost: 0, source: "unavailable" };
  }

  const catalog = resolveCheaperInferenceCatalogPricing(modelId);
  if (!catalog) {
    return { usdCost: 0, source: "unavailable" };
  }

  const tier = selectCatalogPricingTier({
    promptTokens: usage.promptTokens,
    inputTokenPriceThreshold: catalog.inputTokenPriceThreshold,
  });
  if (tier === "above_threshold" && !catalog.aboveThreshold) {
    return { usdCost: 0, source: "unavailable" };
  }

  const resolved = resolveCatalogRatesForPrompt(catalog, usage.promptTokens);
  const usd = usageUsdFromCurrentRates(usage, resolved);
  if (usd == null) {
    return { usdCost: 0, source: tier === "above_threshold" ? "live_catalog_partial" : "unavailable" };
  }
  return { usdCost: usd, source: "live_catalog_estimated" };
}

export function computeShadowCostsWithSnapshot(
  opts: {
    modelId: string;
    promptTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    outputTokens: number;
    reasoningTokens?: number;
    cheaperInferenceBilledCostUsd?: number;
    upstreamCostUsd?: number;
    publishedPricingOverride?: ReturnType<typeof getPublishedPricing>;
    actualTurnCostCoverage?: ActualTurnCostCoverage;
  },
  snapshot: ShadowBillingExchangeRateSnapshot
): ShadowCostBreakdown {
  const usage = normalizeBillableUsage(opts);
  const pub = opts.publishedPricingOverride ?? getPublishedPricing(opts.modelId ?? "");
  const effectiveRate = snapshot.effectiveKrwPerUsd;

  let actualProviderCostKrw = 0;
  let actualCostSource: ActualCostSource = "unavailable";
  let actualCostUsd: number | undefined;
  if (opts.cheaperInferenceBilledCostUsd != null && opts.cheaperInferenceBilledCostUsd > 0) {
    actualCostUsd = opts.cheaperInferenceBilledCostUsd;
    actualProviderCostKrw = round1(convertUsdToKrw(actualCostUsd, effectiveRate));
    actualCostSource = "cheaper_inference_billed";
  } else if (opts.upstreamCostUsd != null && opts.upstreamCostUsd > 0) {
    actualCostUsd = opts.upstreamCostUsd;
    actualProviderCostKrw = round1(convertUsdToKrw(actualCostUsd, effectiveRate));
    actualCostSource = "provider_reported";
  } else {
    const livePricing = resolveCheaperInferenceCatalogPricing(opts.modelId ?? "");
    if (livePricing) {
      const estimate = estimateActualCostFromCatalog(usage, opts.modelId ?? "");
      actualCostSource = estimate.source;
      actualCostUsd = estimate.usdCost > 0 ? estimate.usdCost : undefined;
      actualProviderCostKrw =
        estimate.usdCost > 0 ? round1(convertUsdToKrw(estimate.usdCost, effectiveRate)) : 0;
    } else {
      const policy = getModelShadowPricingPolicy(opts.modelId ?? "");
      const abovePublishedTier =
        policy?.pricingApplicability === "base_tier_only" &&
        policy.publishedBaseTierMaxPromptTokens != null &&
        usage.promptTokens > policy.publishedBaseTierMaxPromptTokens;
      const cachedStrict =
        (usage.cacheReadTokens > 0 || usage.cacheWriteTokens > 0) &&
        requiresStrictCachePolicy(opts.modelId ?? "");
      if (abovePublishedTier || cachedStrict) {
        actualCostSource = "unavailable";
      } else {
        const fallbackUsd = openRouterUsdCostFromRates({
          promptTokens: usage.promptTokens,
          outputTokens: usage.billableOutputTokens,
          cacheReadTokens: usage.cacheReadTokens,
          cacheWriteTokens: usage.cacheWriteTokens,
          modelId: opts.modelId,
        }).usdCost;
        actualProviderCostKrw = round1(convertUsdToKrw(fallbackUsd, effectiveRate));
        actualCostSource = fallbackUsd > 0 ? "published_fallback_estimated" : "unavailable";
        if (fallbackUsd > 0) actualCostUsd = fallbackUsd;
      }
    }
  }

  const providerListResult = computeProviderListCostKrw(usage, opts.modelId ?? "", effectiveRate);
  const providerListCostKrw = providerListResult.costKrw;
  const providerListCostStatus = providerListResult.status;
  const billingFxSnapshot = toBillingFxSnapshot(snapshot);
  const billingReferenceResult = computeBillingReferenceCost(
    usage,
    opts.modelId ?? "",
    billingFxSnapshot,
    pub
  );
  const billingReferenceCostUsd = billingReferenceResult.costUsd;
  const billingReferenceCostStatus = billingReferenceResult.status;
  const billingReferenceCostKrw =
    billingReferenceCostStatus === "complete"
      ? round1(convertUsdToKrw(billingReferenceCostUsd, effectiveRate))
      : 0;
  const actualTurnCostCoverage = opts.actualTurnCostCoverage ?? "complete";
  const isSettledActual = actualCostSource === "cheaper_inference_billed" || actualCostSource === "provider_reported";
  const isPricingValidated =
    billingReferenceCostStatus === "complete" &&
    providerListCostStatus === "complete" &&
    actualCostSource !== "live_catalog_partial" &&
    actualCostSource !== "unavailable";
  const reserveStatus: ShadowCostBreakdown["reserveStatus"] =
    isPricingValidated && isSettledActual && actualTurnCostCoverage === "complete"
      ? "complete"
      : providerListCostStatus === "reference_rates_unavailable" ||
          billingReferenceCostStatus === "reference_rates_unavailable"
        ? "unavailable"
        : "estimated";

  const inputCostKrw =
    billingReferenceCostStatus === "complete"
      ? round1(convertUsdToKrw((usage.standardInputTokens / 1_000_000) * pub.billingReferenceInputUsdPerMillion, effectiveRate))
      : 0;
  const cacheReadCostKrw =
    billingReferenceCostStatus === "complete" && pub.billingReferenceCacheReadUsdPerMillion != null
      ? round1(
          convertUsdToKrw(
            (usage.cacheReadTokens / 1_000_000) * pub.billingReferenceCacheReadUsdPerMillion,
            effectiveRate
          )
        )
      : 0;
  const cacheWriteCostKrw =
    billingReferenceCostStatus === "complete" && pub.billingReferenceCacheWriteUsdPerMillion != null
      ? round1(
          convertUsdToKrw(
            (usage.cacheWriteTokens / 1_000_000) * pub.billingReferenceCacheWriteUsdPerMillion,
            effectiveRate
          )
        )
      : 0;
  const outputCostKrw =
    billingReferenceCostStatus === "complete"
      ? round1(convertUsdToKrw((usage.billableOutputTokens / 1_000_000) * pub.billingReferenceOutputUsdPerMillion, effectiveRate))
      : 0;
  const reasoningCostKrw =
    billingReferenceCostStatus === "complete" && usage.reasoningAccounting === "separate"
      ? round1(convertUsdToKrw((usage.reasoningTokens / 1_000_000) * pub.billingReferenceOutputUsdPerMillion, effectiveRate))
      : 0;

  return {
    promptTokens: usage.promptTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    standardInputTokens: usage.standardInputTokens,
    outputTokens: usage.visibleOutputTokens,
    reasoningTokens: usage.reasoningTokens,
    billableOutputTokens: usage.billableOutputTokens,
    reasoningAccounting: usage.reasoningAccounting,
    actualProviderCostKrw,
    actualCostSource,
    actualCostUsd,
    providerListCostKrw,
    providerListCostStatus,
    billingReferenceCostStatus,
    reserveStatus,
    actualTurnCostCoverage,
    billingReferenceCostKrw,
    billingReferenceCostUsd,
    inputCostKrw,
    outputCostKrw,
    reasoningCostKrw,
    cacheReadCostKrw,
    cacheWriteCostKrw,
    billingReferenceInputUsdPerMillion: pub.billingReferenceInputUsdPerMillion,
    billingReferenceOutputUsdPerMillion: pub.billingReferenceOutputUsdPerMillion,
    pricingVersion: pub.pricingVersion,
    targetMargin: pub.targetMargin,
    minimumMarginFloor: pub.minimumMarginFloor,
    fxSnapshot: {
      dateKey: snapshot.dateKey,
      source: normalizeBillingFxSource(snapshot.source),
      baseUsdKrw: snapshot.usdToKrw,
      overseasFeeRate: OVERSEAS_CARD_FEE_PERCENT,
      effectiveKrwPerUsd: snapshot.effectiveKrwPerUsd,
      locked: snapshot.locked,
    },
    _publishedChargeBase: billingReferenceResult.publishedResult,
  };
}

export function computeShadowCosts(opts: {
  modelId: string;
  promptTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  outputTokens: number;
  reasoningTokens?: number;
  cheaperInferenceBilledCostUsd?: number;
  upstreamCostUsd?: number;
  publishedPricingOverride?: ReturnType<typeof getPublishedPricing>;
  actualTurnCostCoverage?: ActualTurnCostCoverage;
}): ShadowCostBreakdown {
  const snapshot = resolveShadowBillingExchangeRateSnapshot();
  return computeShadowCostsWithSnapshot(opts, snapshot);
}

export function computeShadowCharge(cost: ShadowCostBreakdown, opts?: { promoPercent?: number; now?: Date }): ShadowChargeBreakdown {
  const promoPercent = opts?.promoPercent ?? 0;
  const clampedPromo = Math.min(0.9, Math.max(0, promoPercent));

  let standardUserChargeKrw = 0;
  let finalShadowChargeKrw = 0;
  let finalShadowPoints = 0;
  let publishedChargeStatus: "complete" | "blocked" = "blocked";
  let publishedChargeBlockedReason: PublishedChargeBlockedReason | undefined;

  const base = cost._publishedChargeBase;
  if (base?.status === "complete") {
    publishedChargeStatus = "complete";
    standardUserChargeKrw = base.snapshot.standardUserChargeKrw;

    if (clampedPromo > 0) {
      const usage: NormalizedBillableUsage = {
        promptTokens: base.snapshot.promptTokens,
        cacheReadTokens: base.snapshot.cacheReadTokens,
        cacheWriteTokens: base.snapshot.cacheWriteTokens,
        standardInputTokens: base.snapshot.standardInputTokens,
        visibleOutputTokens: base.snapshot.visibleOutputTokens,
        reasoningTokens: base.snapshot.reasoningTokens,
        billableOutputTokens: base.snapshot.billableOutputTokens,
        reasoningAccounting: base.snapshot.reasoningAccounting,
      };
      const fxSnapshot: BillingFxSnapshot = {
        mode: base.snapshot.fxMode,
        dateKey: base.snapshot.fxDateKey,
        usdToKrw: base.snapshot.usdToKrw,
        effectiveKrwPerUsd: base.snapshot.effectiveKrwPerUsd,
        source: base.snapshot.fxSource,
        overseasFeeRate: base.snapshot.overseasFeeRate,
        locked: base.snapshot.fxLocked,
      };
      const promoResult = computePublishedUserChargeWithSnapshot({
        modelId: base.snapshot.canonicalModelId,
        usage,
        usageCoverage: "complete",
        fxSnapshot,
        adjustment: { kind: "self_funded_promo", promoId: "shadow_promo", percent: clampedPromo },
        resolvedPricing: {
          requestedModelId: base.snapshot.requestedModelId,
          canonicalModelId: base.snapshot.canonicalModelId,
          pricing: {
            modelId: base.snapshot.canonicalModelId,
            billingReferenceInputUsdPerMillion: base.snapshot.billingReferenceInputUsdPerMillion,
            billingReferenceOutputUsdPerMillion: base.snapshot.billingReferenceOutputUsdPerMillion,
            billingReferenceCacheReadUsdPerMillion: base.snapshot.billingReferenceCacheReadUsdPerMillion ?? undefined,
            billingReferenceCacheWriteUsdPerMillion: base.snapshot.billingReferenceCacheWriteUsdPerMillion ?? undefined,
            targetMargin: base.snapshot.targetMargin,
            minimumMarginFloor: base.snapshot.minimumMarginFloor,
            pricingVersion: base.snapshot.pricingVersion,
            publishedAt: base.snapshot.publishedAt,
          },
        },
      });
      if (promoResult.status === "complete") {
        finalShadowChargeKrw = promoResult.snapshot.finalUserChargeKrw;
        finalShadowPoints = promoResult.snapshot.finalPoints;
      } else {
        finalShadowChargeKrw = standardUserChargeKrw;
        finalShadowPoints = chargePoints(finalShadowChargeKrw);
      }
    } else {
      finalShadowChargeKrw = base.snapshot.finalUserChargeKrw;
      finalShadowPoints = base.snapshot.finalPoints;
    }
  } else if (base?.status === "blocked") {
    publishedChargeBlockedReason = base.reason;
    publishedChargeStatus = "blocked";
  } else if (cost.billingReferenceCostStatus !== "complete") {
    publishedChargeBlockedReason =
      cost.billingReferenceCostStatus === "unsupported_cache_semantics"
        ? "unsupported_cache_semantics"
        : cost.billingReferenceCostStatus === "unsupported_pricing_tier"
          ? "unsupported_pricing_tier"
          : "unsupported_model";
    publishedChargeStatus = "blocked";
  }

  const promoGivebackKrw = round1(Math.max(0, standardUserChargeKrw - finalShadowChargeKrw));
  const isReserveComplete = cost.reserveStatus === "complete";
  const providerSavingsKrw = isReserveComplete ? Math.max(0, round1(cost.providerListCostKrw - cost.actualProviderCostKrw)) : null;
  const providerOverrunKrw = isReserveComplete ? Math.max(0, round1(cost.actualProviderCostKrw - cost.providerListCostKrw)) : null;
  const promoGivebackForReserveKrw = promoGivebackKrw;
  const netPricingBufferDeltaKrw = isReserveComplete && providerSavingsKrw != null && providerOverrunKrw != null ? round1(providerSavingsKrw - providerOverrunKrw - promoGivebackForReserveKrw) : null;
  const actualGrossProfitKrw = round1(finalShadowChargeKrw - cost.actualProviderCostKrw);
  const actualRealizedMargin =
    cost.actualTurnCostCoverage === "partial"
      ? null
      : finalShadowChargeKrw > 0
        ? round1(actualGrossProfitKrw / finalShadowChargeKrw)
        : null;
  const isPricingComplete =
    cost.billingReferenceCostStatus === "complete" && cost.providerListCostStatus === "complete";
  const worstCasePromoMargin =
    isPricingComplete && finalShadowChargeKrw > 0
      ? round1((finalShadowChargeKrw - cost.providerListCostKrw) / finalShadowChargeKrw)
      : null;
  const marginFloorViolated: boolean | null = worstCasePromoMargin == null ? null : worstCasePromoMargin < cost.minimumMarginFloor;
  return {
    ...cost,
    standardUserChargeKrw,
    promoPercent: clampedPromo,
    promoGivebackKrw,
    finalShadowChargeKrw,
    finalShadowPoints,
    publishedChargeStatus,
    publishedChargeBlockedReason,
    actualRealizedMargin,
    providerSavingsKrw,
    providerOverrunKrw,
    promoGivebackForReserveKrw,
    netPricingBufferDeltaKrw,
    actualGrossProfitKrw,
    worstCasePromoMargin,
    marginFloorViolated,
  };
}

export function computeShadowPricing(opts: {
  modelId: string;
  promptTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  outputTokens: number;
  reasoningTokens?: number;
  cheaperInferenceBilledCostUsd?: number;
  upstreamCostUsd?: number;
  promoPercent?: number;
  actualTurnCostCoverage?: ActualTurnCostCoverage;
}): ShadowChargeBreakdown {
  const cost = computeShadowCosts(opts);
  return computeShadowCharge(cost, { promoPercent: opts.promoPercent });
}
