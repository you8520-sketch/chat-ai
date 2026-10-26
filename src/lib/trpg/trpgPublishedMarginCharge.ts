import { openRouterUsdCostFromRates, resolveTrpgGmOpenRouterModelRates } from "@/lib/openRouterModelPricing";
import { resolveBillingExchangeRateSnapshot } from "@/lib/exchangeRate";
import {
  ceilPublishedChargePoints,
  convertUsdToKrwPure,
  roundKrwTenths,
} from "@/lib/publishedChargeRounding";
import { canonicalizePublishedModelId } from "@/lib/publishedModelAliases";
import { resolvePublishedPricingExact } from "@/lib/publishedModelPricing";
import type { TrpgModelUsage } from "./billing";
import { isTrpgGmBillableModel } from "./trpgGmModelIdentity";

export type TrpgPublishedMarginChargeBreakdown = {
  requestedModelId: string;
  canonicalModelId: string;
  targetMargin: number;
  minimumMarginFloor: number;
  upstreamCostUsd: number;
  upstreamSource: "provider" | "estimated";
  rawCostKrw: number;
  chargeKrw: number;
  points: number;
};

function resolveTrpgRateEstimateUsd(call: TrpgModelUsage): number {
  const rateOverride = isTrpgGmBillableModel(call.modelId)
    ? resolveTrpgGmOpenRouterModelRates(call.modelId)
    : undefined;
  return openRouterUsdCostFromRates(
    {
      promptTokens: call.inputTokens,
      outputTokens: call.outputTokens,
      cacheReadTokens: call.cacheReadTokens,
      cacheWriteTokens: call.cacheWriteTokens,
      modelId: call.modelId,
    },
    rateOverride
  ).usdCost;
}

/** Provider USD cost — actual usage.cost first, else tier-appropriate OpenRouter fallback rates. */
export function resolveTrpgCallUpstreamCostUsd(call: TrpgModelUsage): {
  upstreamCostUsd: number;
  upstreamSource: "provider" | "estimated";
} {
  if (call.upstreamCostUsd != null && call.upstreamCostUsd > 0) {
    return { upstreamCostUsd: call.upstreamCostUsd, upstreamSource: "provider" };
  }
  return { upstreamCostUsd: resolveTrpgRateEstimateUsd(call), upstreamSource: "estimated" };
}

export function explainTrpgPublishedMarginCharge(
  call: TrpgModelUsage
): TrpgPublishedMarginChargeBreakdown | null {
  if (call.inputTokens <= 0 && call.outputTokens <= 0) return null;
  const resolved = resolvePublishedPricingExact(call.modelId);
  if (!resolved) return null;
  const { upstreamCostUsd, upstreamSource } = resolveTrpgCallUpstreamCostUsd(call);
  if (!(upstreamCostUsd > 0)) return null;
  const fx = resolveBillingExchangeRateSnapshot().effectiveKrwPerUsd;
  const rawCostKrw = roundKrwTenths(convertUsdToKrwPure(upstreamCostUsd, fx));
  const chargeKrw = roundKrwTenths(rawCostKrw / (1 - resolved.pricing.targetMargin));
  const points = ceilPublishedChargePoints(chargeKrw);
  return {
    requestedModelId: call.modelId,
    canonicalModelId: resolved.canonicalModelId,
    targetMargin: resolved.pricing.targetMargin,
    minimumMarginFloor: resolved.pricing.minimumMarginFloor,
    upstreamCostUsd,
    upstreamSource,
    rawCostKrw,
    chargeKrw,
    points,
  };
}

/** User charge points — published target margin on actual/estimated provider USD cost. */
export function computeTrpgPublishedMarginChargePoints(call: TrpgModelUsage): number {
  return explainTrpgPublishedMarginCharge(call)?.points ?? 0;
}

export function trpgPublishedTargetMarginPercent(modelId: string): number {
  const canonical = canonicalizePublishedModelId(modelId);
  return Math.round((resolvePublishedPricingExact(canonical)?.pricing.targetMargin ?? 0) * 100);
}
