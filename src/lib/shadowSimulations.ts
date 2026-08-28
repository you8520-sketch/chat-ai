import {
  peekShadowBillingFxDailySnapshot,
  previewShadowBillingFxSnapshot,
} from "@/lib/shadowBillingExchangeRate";
import { requirePrimaryBenchmark } from "@/lib/marketUsageBenchmarks";
import { getPublishedPricing } from "@/lib/publishedModelPricing";
import {
  computeShadowCharge,
  computeShadowCostsWithSnapshot,
  type ActualCostSource,
  type ProviderListCostStatus,
  type ShadowCostBreakdown,
} from "@/lib/shadowPricing";

export type CompetitiveFlagReason =
  | "competitive_and_safe"
  | "competitive_but_below_floor"
  | "margin_can_be_reduced_to_match_market"
  | "minimum_safe_price_above_market"
  | "provider_list_unavailable";

export type SimulationRow = {
  targetMargin: number;
  standardUserChargeKrw: number;
  finalPoints: number;
  benchmarkChargeP: number;
  competitiveDeviationPct: number | null;
  noDiscountGrossProfitKrw: number | null;
  noDiscountRealizedMargin: number | null;
  currentActualGrossProfitKrw: number | null;
  currentActualRealizedMargin: number | null;
  providerSavingsKrw: number | null;
  flag: "GREEN" | "YELLOW" | "RED";
  flagReason: CompetitiveFlagReason;
};

export type PremiumSimulationResult = {
  providerListCostKrw: number;
  providerListCostStatus: ProviderListCostStatus;
  billingReferenceCostKrw: number;
  actualProviderCostKrw: number;
  actualCostSource: ActualCostSource;
  benchmarkChargeP: number;
  benchmarkImpliedMaxMarginFromList: number | null;
  minimumSafePrice: number | null;
  reserveStatus: ShadowCostBreakdown["reserveStatus"];
  fxSnapshot: ShadowCostBreakdown["fxSnapshot"];
  rows: SimulationRow[];
};

function benchmarkImpliedMaxMargin(providerListCostKrw: number, benchmarkChargeP: number): number | null {
  if (benchmarkChargeP <= 0 || providerListCostKrw <= 0) return null;
  return 1 - providerListCostKrw / benchmarkChargeP;
}

function resolveFxForAdminSimulation() {
  return peekShadowBillingFxDailySnapshot() ?? previewShadowBillingFxSnapshot();
}

export { PREMIUM_MARGIN_CANDIDATES } from "@/lib/premiumPricingCalibration";

const gemini31Primary = requirePrimaryBenchmark("gemini-3.1-pro-preview");
const opus5Primary = requirePrimaryBenchmark("claude-opus-5");

/** Legacy single-benchmark view — canonical owner is MODEL_MARKET_BENCHMARKS. */
export const TOKEN_USAGE_COMPETITOR_BENCHMARKS = {
  gemini31: {
    inputTokens: gemini31Primary.inputTokens,
    outputTokens: gemini31Primary.displayedOutputTokens,
    chargeP: gemini31Primary.competitorChargePoints,
    label: "Gemini 3.1 Pro Preview",
  },
  opus5: {
    inputTokens: opus5Primary.inputTokens,
    outputTokens: opus5Primary.displayedOutputTokens,
    chargeP: opus5Primary.competitorChargePoints,
    label: "Claude Opus 5",
  },
} as const;

export function simulatePremiumCompetitive(params: {
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  benchmarkChargeP: number;
  candidateMargins: readonly number[];
  minimumMarginFloor: number;
}): PremiumSimulationResult {
  const fxSnapshot = resolveFxForAdminSimulation();
  const cost = computeShadowCostsWithSnapshot(
    {
      modelId: params.modelId,
      promptTokens: params.inputTokens,
      outputTokens: params.outputTokens,
    },
    fxSnapshot
  );
  const base = computeShadowCharge(cost);
  const providerListCostKrw = base.providerListCostKrw;
  const billingReferenceCostKrw = base.billingReferenceCostKrw;
  const actualProviderCostKrw = base.actualProviderCostKrw;
  const benchmarkImpliedMaxMarginFromList = benchmarkImpliedMaxMargin(providerListCostKrw, params.benchmarkChargeP);
  const minimumSafePrice = base.providerListCostStatus === "complete" ? providerListCostKrw / (1 - params.minimumMarginFloor) : null;

  const rows: SimulationRow[] = params.candidateMargins.map((m) => {
    const standard = billingReferenceCostKrw / (1 - m);
    const finalPoints = Math.ceil(standard - 1e-9);
    const competitiveDeviationPct = params.benchmarkChargeP > 0 ? ((finalPoints - params.benchmarkChargeP) / params.benchmarkChargeP) * 100 : null;
    const noDiscountGross = providerListCostKrw > 0 ? finalPoints - providerListCostKrw : null;
    const noDiscountMargin = noDiscountGross != null && finalPoints > 0 ? noDiscountGross / finalPoints : null;
    const currentGross = actualProviderCostKrw > 0 ? finalPoints - actualProviderCostKrw : null;
    const currentMargin = currentGross != null && finalPoints > 0 ? currentGross / finalPoints : null;
    const providerSavings = base.providerSavingsKrw;
    let flag: SimulationRow["flag"] = "GREEN";
    let flagReason: CompetitiveFlagReason = "competitive_and_safe";
    if (base.providerListCostStatus !== "complete") {
      flag = "YELLOW";
      flagReason = "provider_list_unavailable";
    } else if (finalPoints <= params.benchmarkChargeP && (noDiscountMargin ?? 0) >= params.minimumMarginFloor) {
      flag = "GREEN";
      flagReason = "competitive_and_safe";
    } else if (finalPoints <= params.benchmarkChargeP && (noDiscountMargin ?? 0) < params.minimumMarginFloor) {
      flag = "YELLOW";
      flagReason = "competitive_but_below_floor";
    } else if (minimumSafePrice != null && minimumSafePrice <= params.benchmarkChargeP) {
      flag = "YELLOW";
      flagReason = "margin_can_be_reduced_to_match_market";
    } else {
      flag = "RED";
      flagReason = "minimum_safe_price_above_market";
    }
    return {
      targetMargin: m,
      standardUserChargeKrw: Math.round(standard * 10) / 10,
      finalPoints,
      benchmarkChargeP: params.benchmarkChargeP,
      competitiveDeviationPct: competitiveDeviationPct != null ? Math.round(competitiveDeviationPct * 10) / 10 : null,
      noDiscountGrossProfitKrw: noDiscountGross != null ? Math.round(noDiscountGross * 10) / 10 : null,
      noDiscountRealizedMargin: noDiscountMargin != null ? Math.round(noDiscountMargin * 1000) / 10 : null,
      currentActualGrossProfitKrw: currentGross != null ? Math.round(currentGross * 10) / 10 : null,
      currentActualRealizedMargin: currentMargin != null ? Math.round(currentMargin * 1000) / 10 : null,
      providerSavingsKrw: providerSavings,
      flag,
      flagReason,
    };
  });

  return {
    providerListCostKrw,
    providerListCostStatus: base.providerListCostStatus,
    billingReferenceCostKrw,
    actualProviderCostKrw,
    actualCostSource: base.actualCostSource,
    benchmarkChargeP: params.benchmarkChargeP,
    benchmarkImpliedMaxMarginFromList,
    minimumSafePrice: minimumSafePrice != null ? Math.round(minimumSafePrice * 10) / 10 : null,
    reserveStatus: base.reserveStatus,
    fxSnapshot: base.fxSnapshot,
    rows,
  };
}
