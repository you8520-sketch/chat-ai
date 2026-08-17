import { CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL } from "@/lib/chatModels";
import { openRouterUsdCostDetailed } from "@/lib/billingRawCost";
import { convertUsdToKrw, resolveBillingExchangeRateSnapshot } from "@/lib/exchangeRate";
import { openRouterUsdCostFromRates } from "@/lib/openRouterModelPricing";
import { DEFAULT_TRPG_BILLING_MODE, type TrpgBillingMode } from "./types";
import type { TrpgModelUsage } from "./billing";

export type TrpgProviderCostSource = "actual" | "estimated";

export type TrpgRoundEconomicsObservation = {
  billingMode: TrpgBillingMode;
  modelSubtotalPoints: number;
  partyPremiumPoints: number;
  serviceSubtotalPoints: number;
  quotedCreatorFundingPoints: number;
  roundTotalPoints: number;
  paidPointsSpent: number;
  freePointsSpent: number;
  actualCreatorCpCredited: number;
  providerCostUsd: number;
  providerCostKrw: number;
  costSource: TrpgProviderCostSource;
  humanCount: number;
  botCount: number;
  netContributionPoints: number;
  pointContributionMargin: number;
  paidCoverageRate: number;
  /** Ops approximation only — not accounting net profit after discounts/subscriptions. */
  paidContribution: number;
};

export function parseProviderUsageCostUsd(usage: unknown): number | undefined {
  if (!usage || typeof usage !== "object") return undefined;
  const row = usage as Record<string, unknown>;
  const details = row.cost_details && typeof row.cost_details === "object"
    ? (row.cost_details as Record<string, unknown>)
    : null;
  const candidates = [
    row.cost,
    row.total_cost,
    row.cost_usd,
    row.total_cost_usd,
    details?.upstream_inference_cost,
    details?.upstream_cost,
    details?.cost,
  ];
  for (const raw of candidates) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return undefined;
}

function estimateCallUsd(call: TrpgModelUsage): number {
  const fromRates = openRouterUsdCostDetailed({
    promptTokens: call.inputTokens,
    outputTokens: call.outputTokens,
    cacheReadTokens: call.cacheReadTokens,
    cacheWriteTokens: call.cacheWriteTokens,
    modelId: call.modelId,
  });
  if (fromRates > 0) return fromRates;
  const fallback = openRouterUsdCostFromRates({
    promptTokens: Math.max(1, call.inputTokens),
    outputTokens: Math.max(1, call.outputTokens),
    modelId: call.modelId || CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  }).usdCost;
  if (fallback > 0) return fallback;
  return openRouterUsdCostFromRates({
    promptTokens: Math.max(1, call.inputTokens),
    outputTokens: Math.max(1, call.outputTokens),
    modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  }).usdCost;
}

export function resolveTrpgProviderCost(calls: TrpgModelUsage[]): {
  providerCostUsd: number;
  providerCostKrw: number;
  costSource: TrpgProviderCostSource;
} {
  let usd = 0;
  let anyEstimated = calls.length === 0;
  for (const call of calls) {
    const actual = call.upstreamCostUsd != null && call.upstreamCostUsd > 0 ? call.upstreamCostUsd : undefined;
    if (actual != null) {
      usd += actual;
      continue;
    }
    anyEstimated = true;
    usd += estimateCallUsd(call);
  }
  if (usd <= 0 && calls.length > 0) {
    anyEstimated = true;
    usd = estimateCallUsd({
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      inputTokens: 1,
      outputTokens: 1,
    });
  }
  const rate = resolveBillingExchangeRateSnapshot().effectiveKrwPerUsd;
  return {
    providerCostUsd: Math.round(usd * 1e6) / 1e6,
    providerCostKrw: convertUsdToKrw(usd, rate),
    costSource: anyEstimated ? "estimated" : "actual",
  };
}

export function observeTrpgRoundEconomics(opts: {
  breakdown: {
    modelSubtotal: number;
    partyPremiumPoints: number;
    serviceSubtotal: number;
    creatorFundingPoints: number;
    roundTotal: number;
    humanCount: number;
    botCount: number;
    billingMode?: TrpgBillingMode;
  };
  billingMode?: TrpgBillingMode;
  paidPointsSpent: number;
  freePointsSpent: number;
  actualCreatorCpCredited: number;
  calls: TrpgModelUsage[];
}): TrpgRoundEconomicsObservation {
  const cost = resolveTrpgProviderCost(opts.calls);
  const roundTotalPoints = opts.breakdown.roundTotal;
  const netContributionPoints =
    roundTotalPoints - opts.actualCreatorCpCredited - cost.providerCostKrw;
  const paidCoverageRate = roundTotalPoints > 0 ? opts.paidPointsSpent / roundTotalPoints : 0;
  return {
    billingMode: opts.billingMode ?? opts.breakdown.billingMode ?? DEFAULT_TRPG_BILLING_MODE,
    modelSubtotalPoints: opts.breakdown.modelSubtotal,
    partyPremiumPoints: opts.breakdown.partyPremiumPoints,
    serviceSubtotalPoints: opts.breakdown.serviceSubtotal,
    quotedCreatorFundingPoints: opts.breakdown.creatorFundingPoints,
    roundTotalPoints,
    paidPointsSpent: opts.paidPointsSpent,
    freePointsSpent: opts.freePointsSpent,
    actualCreatorCpCredited: opts.actualCreatorCpCredited,
    providerCostUsd: cost.providerCostUsd,
    providerCostKrw: cost.providerCostKrw,
    costSource: cost.costSource,
    humanCount: opts.breakdown.humanCount,
    botCount: opts.breakdown.botCount,
    netContributionPoints,
    pointContributionMargin: roundTotalPoints > 0 ? netContributionPoints / roundTotalPoints : 0,
    paidCoverageRate,
    paidContribution: opts.paidPointsSpent - opts.actualCreatorCpCredited - cost.providerCostKrw,
  };
}

export function logTrpgRoundEconomics(observation: TrpgRoundEconomicsObservation): void {
  console.info("[TRPG][economics]", {
    billingMode: observation.billingMode,
    modelSubtotalPoints: observation.modelSubtotalPoints,
    partyPremiumPoints: observation.partyPremiumPoints,
    serviceSubtotalPoints: observation.serviceSubtotalPoints,
    quotedCreatorFundingPoints: observation.quotedCreatorFundingPoints,
    roundTotalPoints: observation.roundTotalPoints,
    paidPointsSpent: observation.paidPointsSpent,
    freePointsSpent: observation.freePointsSpent,
    actualCreatorCpCredited: observation.actualCreatorCpCredited,
    providerCostUsd: observation.providerCostUsd,
    providerCostKrw: observation.providerCostKrw,
    costSource: observation.costSource,
    humanCount: observation.humanCount,
    botCount: observation.botCount,
    netContributionPoints: observation.netContributionPoints,
    pointContributionMargin: observation.pointContributionMargin,
    paidCoverageRate: observation.paidCoverageRate,
    paidContribution: observation.paidContribution,
    paidContributionNote: "ops approximation; not accounting net profit",
  });
}
