/**
 * Phase 2 Shadow Pricing — canonical owner for unified cost & charge simulation.
 * USER BILLING UNCHANGED: deductPoints() still uses legacy `points.ts` path.
 * Three costs: actualProviderCost / providerListCost / billingReferenceCost
 */

import {
  resolveBillingExchangeRateSnapshot,
  convertUsdToKrw,
  OVERSEAS_CARD_FEE_PERCENT,
  normalizeBillingFxSource,
  type BillingFxSource,
} from "@/lib/exchangeRate";
import { openRouterUsdCostFromRates, resolveOpenRouterModelRates } from "@/lib/openRouterModelPricing";
import { getPublishedPricing } from "@/lib/publishedModelPricing";
import { resolveCheaperInferenceCatalogPricing } from "@/lib/cheaperInferenceCatalogPricing";

export type ActualCostSource =
  | "cheaper_inference_billed"
  | "provider_reported"
  | "live_catalog_estimated"
  | "published_fallback_estimated"
  | "unavailable";

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
  reserveStatus: "unavailable" | "estimated" | "complete";
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

export type ProviderListCostStatus = "complete" | "partial_missing_cache_rate" | "reference_rates_unavailable";

function computeProviderListCostKrw(
  usage: NormalizedBillableUsage,
  modelId: string,
  effectiveRate: number
): { costKrw: number; status: ProviderListCostStatus } {
  const catalog = resolveCheaperInferenceCatalogPricing(modelId);
  if (catalog?.referenceInputUsdPerMillion != null && catalog?.referenceOutputUsdPerMillion != null) {
    const hasCacheRead = catalog.referenceCacheReadUsdPerMillion != null;
    const hasCacheWrite = catalog.referenceCacheWriteUsdPerMillion != null;
    if ((usage.cacheReadTokens > 0 && !hasCacheRead) || (usage.cacheWriteTokens > 0 && !hasCacheWrite)) {
      return { costKrw: 0, status: "partial_missing_cache_rate" };
    }
    const refInput = catalog.referenceInputUsdPerMillion;
    const refOutput = catalog.referenceOutputUsdPerMillion;
    const refCacheRead = catalog.referenceCacheReadUsdPerMillion;
    const refCacheWrite = catalog.referenceCacheWriteUsdPerMillion;
    const usd =
      (usage.standardInputTokens / 1_000_000) * refInput +
      (refCacheRead != null ? (usage.cacheReadTokens / 1_000_000) * refCacheRead : 0) +
      (refCacheWrite != null ? (usage.cacheWriteTokens / 1_000_000) * refCacheWrite : 0) +
      (usage.billableOutputTokens / 1_000_000) * refOutput;
    return { costKrw: round1(convertUsdToKrw(usd, effectiveRate)), status: "complete" };
  }
  return { costKrw: 0, status: "reference_rates_unavailable" };
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
}): ShadowCostBreakdown {
  const usage = normalizeBillableUsage(opts);
  const pub = opts.publishedPricingOverride ?? getPublishedPricing(opts.modelId ?? "");
  const snapshot = resolveBillingExchangeRateSnapshot();
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
      const { usdCost } = openRouterUsdCostFromRates({
        promptTokens: usage.promptTokens,
        outputTokens: usage.billableOutputTokens,
        cacheReadTokens: usage.cacheReadTokens,
        cacheWriteTokens: usage.cacheWriteTokens,
        modelId: opts.modelId,
      });
      actualProviderCostKrw = round1(convertUsdToKrw(usdCost, effectiveRate));
      actualCostSource = "live_catalog_estimated";
      actualCostUsd = usdCost;
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

  const providerListResult = computeProviderListCostKrw(usage, opts.modelId ?? "", effectiveRate);
  const providerListCostKrw = providerListResult.costKrw;
  const providerListCostStatus = providerListResult.status;
  const isSettledActual = actualCostSource === "cheaper_inference_billed" || actualCostSource === "provider_reported";
  const reserveStatus: ShadowCostBreakdown["reserveStatus"] =
    providerListCostStatus === "complete" && isSettledActual ? "complete" : providerListCostStatus === "reference_rates_unavailable" ? "unavailable" : "estimated";

  // Published USD → KRW via daily FX (not baked)
  const billingReferenceCostUsd =
    (usage.standardInputTokens / 1_000_000) * pub.billingReferenceInputUsdPerMillion +
    (usage.cacheReadTokens / 1_000_000) * (pub.billingReferenceCacheReadUsdPerMillion ?? pub.billingReferenceInputUsdPerMillion * 0.1) +
    (usage.cacheWriteTokens / 1_000_000) * (pub.billingReferenceCacheWriteUsdPerMillion ?? pub.billingReferenceInputUsdPerMillion) +
    (usage.visibleOutputTokens / 1_000_000) * pub.billingReferenceOutputUsdPerMillion +
    (usage.reasoningAccounting === "separate" ? (usage.reasoningTokens / 1_000_000) * pub.billingReferenceOutputUsdPerMillion : 0);
  const billingReferenceCostKrw = round1(convertUsdToKrw(billingReferenceCostUsd, effectiveRate));
  const inputCostKrw = round1(convertUsdToKrw((usage.standardInputTokens / 1_000_000) * pub.billingReferenceInputUsdPerMillion, effectiveRate));
  const cacheReadCostKrw = round1(convertUsdToKrw((usage.cacheReadTokens / 1_000_000) * (pub.billingReferenceCacheReadUsdPerMillion ?? pub.billingReferenceInputUsdPerMillion * 0.1), effectiveRate));
  const cacheWriteCostKrw = round1(convertUsdToKrw((usage.cacheWriteTokens / 1_000_000) * (pub.billingReferenceCacheWriteUsdPerMillion ?? pub.billingReferenceInputUsdPerMillion), effectiveRate));
  const outputCostKrw = round1(convertUsdToKrw((usage.visibleOutputTokens / 1_000_000) * pub.billingReferenceOutputUsdPerMillion, effectiveRate));
  const reasoningCostKrw = usage.reasoningAccounting === "separate" ? round1(convertUsdToKrw((usage.reasoningTokens / 1_000_000) * pub.billingReferenceOutputUsdPerMillion, effectiveRate)) : 0;

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
    reserveStatus,
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
    },
  };
}

export function computeShadowCharge(cost: ShadowCostBreakdown, opts?: { promoPercent?: number; now?: Date }): ShadowChargeBreakdown {
  const promoPercent = opts?.promoPercent ?? 0;
  const clampedPromo = Math.min(0.9, Math.max(0, promoPercent));
  const standardUserChargeKrw = cost.billingReferenceCostKrw > 0 ? round1(cost.billingReferenceCostKrw / (1 - Math.min(0.95, Math.max(0, cost.targetMargin)))) : 0;
  const finalShadowChargeKrw = round1(standardUserChargeKrw * (1 - clampedPromo));
  const finalShadowPoints = chargePoints(finalShadowChargeKrw);
  const promoGivebackKrw = round1(Math.max(0, standardUserChargeKrw - finalShadowChargeKrw));
  const isReserveComplete = cost.reserveStatus === "complete";
  const providerSavingsKrw = isReserveComplete ? Math.max(0, round1(cost.providerListCostKrw - cost.actualProviderCostKrw)) : null;
  const providerOverrunKrw = isReserveComplete ? Math.max(0, round1(cost.actualProviderCostKrw - cost.providerListCostKrw)) : null;
  const promoGivebackForReserveKrw = promoGivebackKrw;
  const netPricingBufferDeltaKrw = isReserveComplete && providerSavingsKrw != null && providerOverrunKrw != null ? round1(providerSavingsKrw - providerOverrunKrw - promoGivebackForReserveKrw) : null;
  const actualGrossProfitKrw = round1(finalShadowChargeKrw - cost.actualProviderCostKrw);
  const actualRealizedMargin = finalShadowChargeKrw > 0 ? round1(actualGrossProfitKrw / finalShadowChargeKrw) : null;
  const worstCasePromoMargin = cost.providerListCostStatus === "complete" && finalShadowChargeKrw > 0 ? round1((finalShadowChargeKrw - cost.providerListCostKrw) / finalShadowChargeKrw) : null;
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
}): ShadowChargeBreakdown {
  const cost = computeShadowCosts(opts);
  return computeShadowCharge(cost, { promoPercent: opts.promoPercent });
}
