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
import { convertUsdToKrw, OVERSEAS_CARD_FEE_PERCENT } from "@/lib/exchangeRate";
import { openRouterUsdCostFromRates, resolveOpenRouterModelRates } from "@/lib/openRouterModelPricing";
import { getPublishedPricing } from "@/lib/publishedModelPricing";
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

export type ReasoningAccounting = "included_in_output" | "separate" | "none" | "unknown";

export type NormalizedBillableUsage = {
  promptTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  standardInputTokens: number;
  visibleOutputTokens: number;
  reasoningTokens: number;
  billableOutputTokens: number;
  reasoningAccounting: ReasoningAccounting;
};

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
};

export type ShadowChargeBreakdown = ShadowCostBreakdown & {
  standardUserChargeKrw: number;
  promoPercent: number;
  promoGivebackKrw: number;
  finalShadowChargeKrw: number;
  finalShadowPoints: number;
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

/** Canonical billable usage normalizer — single owner for reasoning accounting */
export function normalizeBillableUsage(opts: {
  modelId: string;
  promptTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  outputTokens: number;
  reasoningTokens?: number;
}): NormalizedBillableUsage {
  const promptTokens = Math.max(0, opts.promptTokens);
  const cacheReadTokens = Math.max(0, opts.cacheReadTokens ?? 0);
  const cacheWriteTokens = Math.max(0, opts.cacheWriteTokens ?? 0);
  const standardInputTokens = Math.max(0, promptTokens - cacheReadTokens - cacheWriteTokens);
  const visibleOutputTokens = Math.max(0, opts.outputTokens);
  const reasoningTokens = Math.max(0, opts.reasoningTokens ?? 0);
  // Contract: reasoning_tokens from completion_tokens_details is subset of completion_tokens (included)
  let reasoningAccounting: ReasoningAccounting = "none";
  let billableOutputTokens = visibleOutputTokens;
  if (reasoningTokens <= 0) {
    reasoningAccounting = "none";
    billableOutputTokens = visibleOutputTokens;
  } else {
    reasoningAccounting = "included_in_output";
    billableOutputTokens = visibleOutputTokens;
  }
  return {
    promptTokens,
    cacheReadTokens,
    cacheWriteTokens,
    standardInputTokens,
    visibleOutputTokens,
    reasoningTokens,
    billableOutputTokens,
    reasoningAccounting,
  };
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
  pub: ReturnType<typeof getPublishedPricing>
): { costUsd: number; status: BillingReferenceCostStatus } {
  const policy = getModelShadowPricingPolicy(modelId);
  const maxPrompt =
    policy?.publishedBaseTierMaxPromptTokens ?? pub.publishedBaseTierMaxPromptTokens;
  if (
    (policy?.pricingApplicability === "base_tier_only" || pub.pricingApplicability === "base_tier_only") &&
    maxPrompt != null &&
    usage.promptTokens > maxPrompt
  ) {
    return { costUsd: 0, status: "unsupported_pricing_tier" };
  }

  const hasCacheUsage = usage.cacheReadTokens > 0 || usage.cacheWriteTokens > 0;
  if (hasCacheUsage && requiresStrictCachePolicy(modelId)) {
    return { costUsd: 0, status: "unsupported_cache_semantics" };
  }

  const pubCacheRead = pub.billingReferenceCacheReadUsdPerMillion;
  const pubCacheWrite = pub.billingReferenceCacheWriteUsdPerMillion;
  const strictCache = policy?.cachePolicyStatus === "unverified";

  if (hasCacheUsage) {
    if (strictCache) {
      return { costUsd: 0, status: "unsupported_cache_semantics" };
    }
    if (usage.cacheReadTokens > 0 && pubCacheRead == null) {
      if (requiresStrictCachePolicy(modelId)) {
        return { costUsd: 0, status: "unsupported_cache_semantics" };
      }
    }
    if (usage.cacheWriteTokens > 0 && pubCacheWrite == null) {
      if (requiresStrictCachePolicy(modelId)) {
        return { costUsd: 0, status: "unsupported_cache_semantics" };
      }
    }
  }

  const cacheReadRate =
    pubCacheRead ??
    (strictCache || requiresStrictCachePolicy(modelId) ? undefined : pub.billingReferenceInputUsdPerMillion * 0.1);
  const cacheWriteRate =
    pubCacheWrite ??
    (strictCache || requiresStrictCachePolicy(modelId) ? undefined : pub.billingReferenceInputUsdPerMillion);

  if (usage.cacheReadTokens > 0 && cacheReadRate == null) {
    return { costUsd: 0, status: "unsupported_cache_semantics" };
  }
  if (usage.cacheWriteTokens > 0 && cacheWriteRate == null) {
    return { costUsd: 0, status: "unsupported_cache_semantics" };
  }

  const costUsd =
    (usage.standardInputTokens / 1_000_000) * pub.billingReferenceInputUsdPerMillion +
    (cacheReadRate != null ? (usage.cacheReadTokens / 1_000_000) * cacheReadRate : 0) +
    (cacheWriteRate != null ? (usage.cacheWriteTokens / 1_000_000) * cacheWriteRate : 0) +
    (usage.visibleOutputTokens / 1_000_000) * pub.billingReferenceOutputUsdPerMillion +
    (usage.reasoningAccounting === "separate"
      ? (usage.reasoningTokens / 1_000_000) * pub.billingReferenceOutputUsdPerMillion
      : 0);

  return { costUsd, status: "complete" };
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
  const billingReferenceResult = computeBillingReferenceCost(usage, opts.modelId ?? "", pub);
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
      ? round1(convertUsdToKrw((usage.visibleOutputTokens / 1_000_000) * pub.billingReferenceOutputUsdPerMillion, effectiveRate))
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
  const standardUserChargeKrw =
    cost.billingReferenceCostStatus === "complete" && cost.billingReferenceCostKrw > 0
      ? round1(cost.billingReferenceCostKrw / (1 - Math.min(0.95, Math.max(0, cost.targetMargin))))
      : 0;
  const finalShadowChargeKrw = round1(standardUserChargeKrw * (1 - clampedPromo));
  const finalShadowPoints = chargePoints(finalShadowChargeKrw);
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
