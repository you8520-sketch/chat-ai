/**
 * Phase 2 Shadow Pricing ??canonical owner for unified cost & charge simulation.
 * USER BILLING UNCHANGED: deductPoints() still uses legacy `points.ts` path.
 * This module is shadow-only, used for admin diagnostics and usage JSON enrichment.
 *
 * Three costs: actualProviderCost / providerListCost / billingReferenceCost
 * One charge:  shadowStandardCharge ??promo ??finalShadowCharge
 */

import type { OpenRouterBillingInput } from "@/lib/billingRawCost";
import { resolveBillingExchangeRateSnapshot, convertUsdToKrw } from "@/lib/exchangeRate";
import { openRouterUsdCostFromRates, resolveOpenRouterModelRates } from "@/lib/openRouterModelPricing";
import { getPublishedPricing } from "@/lib/publishedModelPricing";
import { resolveCheaperInferenceCatalogPricing } from "@/lib/cheaperInferenceCatalogPricing";

export type ActualCostSource =
  | "provider_reported"
  | "live_catalog_estimated"
  | "published_fallback_estimated"
  | "unavailable";

export type ShadowCostBreakdown = {
  // raw token inputs
  promptTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  standardInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  // KRW costs
  actualProviderCostKrw: number;
  actualCostSource: ActualCostSource;
  actualCostUsd?: number;
  providerListCostKrw: number;
  billingReferenceCostKrw: number;
  inputCostKrw: number;
  outputCostKrw: number;
  reasoningCostKrw: number;
  cacheReadCostKrw: number;
  cacheWriteCostKrw: number;
  // published snapshot
  billingReferenceInputRateKrw: number;
  billingReferenceOutputRateKrw: number;
  pricingVersion: number;
  targetMargin: number;
  minimumMarginFloor: number;
};

export type ShadowChargeBreakdown = ShadowCostBreakdown & {
  standardUserChargeKrw: number; // billingReferenceCost / (1 - targetMargin)
  promoPercent: number;
  promoGivebackKrw: number;
  finalShadowChargeKrw: number;
  finalShadowPoints: number; // ceil
  // margin & reserve components (KRW, 1P=1??normalization via canonical owner)
  actualRealizedMargin: number | null;
  providerSavingsKrw: number;
  providerOverrunKrw: number;
  promoGivebackForReserveKrw: number;
  netPricingBufferDeltaKrw: number;
  actualGrossProfitKrw: number;
  // safety
  worstCasePromoMargin: number | null; // (promoCharge - providerListCost)/promoCharge
  marginFloorViolated: boolean;
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function chargePoints(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.ceil(n - 1e-9);
}

function resolvePriceKindRates(modelId: string, kind: "live" | "list") {
  if (kind === "live") return resolveOpenRouterModelRates(modelId);
  // list: bypass live catalog, use fallback snapshot directly
  // temporarily clear live map effect by constructing from fallback via priceKind is not exposed,
  // so we compute via fallback constants directly: use published reference as list proxy
  // To avoid live contamination, we read raw fallback by calling with modelId that is not in live map?
  // Simpler: compute USD from published snapshot would be equivalent.
  // Here we still need list USD for providerListCost ??use fallback snapshot rates.
  // We achieve by temporarily reading published rates and converting back to USD for openRouterUsdCostFromRates?
  // Easiest: use resolveOpenRouterModelRates but if live exists we want list, so we reconstruct list USD cost manually
  // Fallback: use publishedModelPricing reference rates ??USD
  return resolveOpenRouterModelRates(modelId); // TODO: priceKind separation pending catalog semantics verification
}

export function computeShadowCosts(opts: {
  modelId: string;
  promptTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  outputTokens: number;
  reasoningTokens?: number;
  upstreamCostUsd?: number;
  publishedPricingOverride?: ReturnType<typeof getPublishedPricing>;
}): ShadowCostBreakdown {
  const modelId = opts.modelId ?? "";
  const promptTokens = Math.max(0, opts.promptTokens);
  const cacheReadTokens = Math.max(0, opts.cacheReadTokens ?? 0);
  const cacheWriteTokens = Math.max(0, opts.cacheWriteTokens ?? 0);
  const standardInputTokens = Math.max(0, promptTokens - cacheReadTokens - cacheWriteTokens);
  const outputTokens = Math.max(0, opts.outputTokens);
  const reasoningTokens = Math.max(0, opts.reasoningTokens ?? 0);

  const pub = opts.publishedPricingOverride ?? getPublishedPricing(modelId);
  const snapshot = resolveBillingExchangeRateSnapshot();
  const effectiveRate = snapshot.effectiveKrwPerUsd;

  // actualProviderCost: upstream ?°ì„ , ?†ìœ¼ë©?live catalogÃ—usage, ?†ìœ¼ë©?published fallback
  let actualProviderCostKrw = 0;
  let actualCostSource: ActualCostSource = "unavailable";
  let actualCostUsd: number | undefined;
  if (opts.upstreamCostUsd != null && opts.upstreamCostUsd > 0) {
    actualCostUsd = opts.upstreamCostUsd;
    actualProviderCostKrw = round1(convertUsdToKrw(actualCostUsd, effectiveRate));
    actualCostSource = "provider_reported";
  } else {
    const livePricing = resolveCheaperInferenceCatalogPricing(modelId);
    if (livePricing) {
      const liveRates = resolveOpenRouterModelRates(modelId);
      const { usdCost } = openRouterUsdCostFromRates({
        promptTokens,
        outputTokens: outputTokens + reasoningTokens,
        cacheReadTokens,
        cacheWriteTokens,
        modelId,
      });
      actualProviderCostKrw = round1(convertUsdToKrw(usdCost, effectiveRate));
      actualCostSource = "live_catalog_estimated";
      actualCostUsd = usdCost;
    } else {
      // fallback to published reference (stable)
      const fallbackUsd = openRouterUsdCostFromRates({
        promptTokens,
        outputTokens: outputTokens + reasoningTokens,
        cacheReadTokens,
        cacheWriteTokens,
        modelId,
      }).usdCost;
      actualProviderCostKrw = round1(convertUsdToKrw(fallbackUsd, effectiveRate));
      actualCostSource = fallbackUsd > 0 ? "published_fallback_estimated" : "unavailable";
      if (fallbackUsd > 0) actualCostUsd = fallbackUsd;
    }
  }

  // providerListCost: undiscounted list (fallback snapshot, no live discount)
  // For now list = actual with live stripped: use fallback USD cost
  // If live pricing meaning is confirmed as discounted, list would be discounted/(1-discount)
  // Until verified, list = fallback snapshot cost (same as published reference for now)
  const listUsdCost = openRouterUsdCostFromRates({
    promptTokens,
    outputTokens: outputTokens + reasoningTokens,
    cacheReadTokens,
    cacheWriteTokens,
    modelId,
  }).usdCost;
  // If live discount is applied, listUsdCost above already uses live (overridden). To get true list we would need un-discounted.
  // For Phase 2 shadow, we compute list via published reference rates as proxy for undiscounted.
  const listViaPublishedKrw = (() => {
    const r = pub;
    const inCost = standardInputTokens * r.billingReferenceInputRateKrw;
    const crCost = cacheReadTokens * (r.billingReferenceCacheReadRateKrw ?? r.billingReferenceInputRateKrw * 0.1);
    const cwCost = cacheWriteTokens * (r.billingReferenceCacheWriteRateKrw ?? r.billingReferenceInputRateKrw);
    const outCost = (outputTokens + reasoningTokens) * r.billingReferenceOutputRateKrw;
    return round1(inCost + crCost + cwCost + outCost);
  })();
  const providerListCostKrw = listViaPublishedKrw > 0 ? listViaPublishedKrw : round1(convertUsdToKrw(listUsdCost, effectiveRate));

  // billingReferenceCost: published reference rates Ã— usage (stable)
  const inputCostKrw = round1(standardInputTokens * pub.billingReferenceInputRateKrw);
  const cacheReadCostKrw = round1(cacheReadTokens * (pub.billingReferenceCacheReadRateKrw ?? pub.billingReferenceInputRateKrw * 0.1));
  const cacheWriteCostKrw = round1(cacheWriteTokens * (pub.billingReferenceCacheWriteRateKrw ?? pub.billingReferenceInputRateKrw));
  const outputCostKrw = round1(outputTokens * pub.billingReferenceOutputRateKrw);
  const reasoningCostKrw = round1(reasoningTokens * pub.billingReferenceOutputRateKrw);
  const billingReferenceCostKrw = round1(inputCostKrw + cacheReadCostKrw + cacheWriteCostKrw + outputCostKrw + reasoningCostKrw);

  return {
    promptTokens,
    cacheReadTokens,
    cacheWriteTokens,
    standardInputTokens,
    outputTokens,
    reasoningTokens,
    actualProviderCostKrw,
    actualCostSource,
    actualCostUsd,
    providerListCostKrw,
    billingReferenceCostKrw,
    inputCostKrw,
    outputCostKrw,
    reasoningCostKrw,
    cacheReadCostKrw,
    cacheWriteCostKrw,
    billingReferenceInputRateKrw: pub.billingReferenceInputRateKrw,
    billingReferenceOutputRateKrw: pub.billingReferenceOutputRateKrw,
    pricingVersion: pub.pricingVersion,
    targetMargin: pub.targetMargin,
    minimumMarginFloor: pub.minimumMarginFloor,
  };
}

export function computeShadowCharge(
  cost: ShadowCostBreakdown,
  opts?: { promoPercent?: number; now?: Date }
): ShadowChargeBreakdown {
  const promoPercent = opts?.promoPercent ?? 0;
  const clampedPromo = Math.min(0.9, Math.max(0, promoPercent));
  const standardUserChargeKrw = cost.billingReferenceCostKrw > 0
    ? round1(cost.billingReferenceCostKrw / (1 - Math.min(0.95, Math.max(0, cost.targetMargin))))
    : 0;
  const finalShadowChargeKrw = round1(standardUserChargeKrw * (1 - clampedPromo));
  const finalShadowPoints = chargePoints(finalShadowChargeKrw);
  const promoGivebackKrw = round1(Math.max(0, standardUserChargeKrw - finalShadowChargeKrw));
  // Reserve components (KRW, 1P=1??
  const providerSavingsKrw = Math.max(0, round1(cost.providerListCostKrw - cost.actualProviderCostKrw));
  const providerOverrunKrw = Math.max(0, round1(cost.actualProviderCostKrw - cost.providerListCostKrw));
  const promoGivebackForReserveKrw = promoGivebackKrw;
  const netPricingBufferDeltaKrw = round1(providerSavingsKrw - providerOverrunKrw - promoGivebackForReserveKrw);
  const actualGrossProfitKrw = round1(finalShadowChargeKrw - cost.actualProviderCostKrw);
  const actualRealizedMargin =
    finalShadowChargeKrw > 0 ? round1(actualGrossProfitKrw / finalShadowChargeKrw) : null;
  const worstCasePromoMargin =
    finalShadowChargeKrw > 0 ? round1((finalShadowChargeKrw - cost.providerListCostKrw) / finalShadowChargeKrw) : null;
  const marginFloorViolated =
    worstCasePromoMargin != null ? worstCasePromoMargin < cost.minimumMarginFloor : false;

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

/** Convenience: one-call */
export function computeShadowPricing(opts: {
  modelId: string;
  promptTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  outputTokens: number;
  reasoningTokens?: number;
  upstreamCostUsd?: number;
  promoPercent?: number;
}): ShadowChargeBreakdown {
  const cost = computeShadowCosts(opts);
  return computeShadowCharge(cost, { promoPercent: opts.promoPercent });
}
