import { resolveRpOpenRouterModelId } from "@/lib/openRouterConfig";
import { openRouterUsdCostFromRates, resolveTrpgOpenRouterFlexFallbackRates } from "@/lib/openRouterModelPricing";
import { resolveBillingExchangeRateSnapshot } from "@/lib/exchangeRate";
import {
  ceilPublishedChargePoints,
  convertUsdToKrwPure,
  roundKrwTenths,
} from "@/lib/publishedChargeRounding";
import { canonicalizePublishedModelId } from "@/lib/publishedModelAliases";
import { resolvePublishedPricingExact } from "@/lib/publishedModelPricing";
import type { TrpgModelUsage } from "./billing";

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

function resolveTrpgRateEstimateUsd(call: TrpgModelUsage, now: Date): number {
  const wireModelId = resolveRpOpenRouterModelId(call.modelId);
  return openRouterUsdCostFromRates(
    {
      promptTokens: call.inputTokens,
      outputTokens: call.outputTokens,
      cacheReadTokens: call.cacheReadTokens,
      cacheWriteTokens: call.cacheWriteTokens,
      modelId: wireModelId,
    },
    resolveTrpgOpenRouterFlexFallbackRates(wireModelId, now)
  ).usdCost;
}

/** Provider USD cost — actual usage.cost first, else tier-appropriate OpenRouter fallback rates. */
export function resolveTrpgCallUpstreamCostUsd(
  call: TrpgModelUsage,
  now: Date = new Date()
): {
  upstreamCostUsd: number;
  upstreamSource: "provider" | "estimated";
} {
  if (call.upstreamCostUsd != null && call.upstreamCostUsd > 0) {
    return { upstreamCostUsd: call.upstreamCostUsd, upstreamSource: "provider" };
  }
  return { upstreamCostUsd: resolveTrpgRateEstimateUsd(call, now), upstreamSource: "estimated" };
}

export function explainTrpgPublishedMarginCharge(
  call: TrpgModelUsage,
  now: Date = new Date()
): TrpgPublishedMarginChargeBreakdown | null {
  if (call.inputTokens <= 0 && call.outputTokens <= 0) return null;
  const resolved = resolvePublishedPricingExact(call.modelId);
  if (!resolved) return null;
  const { upstreamCostUsd, upstreamSource } = resolveTrpgCallUpstreamCostUsd(call, now);
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
export function computeTrpgPublishedMarginChargePoints(
  call: TrpgModelUsage,
  now: Date = new Date()
): number {
  return explainTrpgPublishedMarginCharge(call, now)?.points ?? 0;
}

export function trpgPublishedTargetMarginPercent(modelId: string): number {
  const canonical = canonicalizePublishedModelId(modelId);
  return Math.round((resolvePublishedPricingExact(canonical)?.pricing.targetMargin ?? 0) * 100);
}
