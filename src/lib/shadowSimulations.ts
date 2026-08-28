/**
 * Shadow simulations for premium market competitiveness.
 * Uses published reference rates (stable) vs competitor benchmarks.
 * No billing owner — admin diagnostics only.
 */
import { getPublishedPricing } from "@/lib/publishedModelPricing";
import { computeShadowPricing } from "@/lib/shadowPricing";

export type SimulationRow = {
  margin: number;
  shadowChargeP: number;
  grossProfitP: number;
  competitiveDeviationPct: number | null;
  benchmarkImpliedMaxMarginPct: number | null;
  flag: "GREEN" | "YELLOW" | "RED";
};

function benchmarkImpliedMaxMargin(referenceCostKrw: number, benchmarkChargeP: number): number | null {
  if (benchmarkChargeP <= 0 || referenceCostKrw <= 0) return null;
  return 1 - referenceCostKrw / benchmarkChargeP;
}

export function simulatePremiumCompetitive(params: {
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  benchmarkChargeP: number;
  candidateMargins: number[];
  minimumMarginFloor: number;
}): { referenceCostKrw: number; rows: SimulationRow[] } {
  const pub = getPublishedPricing(params.modelId);
  const base = computeShadowPricing({
    modelId: params.modelId,
    promptTokens: params.inputTokens,
    outputTokens: params.outputTokens,
  });
  const referenceCostKrw = base.billingReferenceCostKrw;
  const impliedMax = benchmarkImpliedMaxMargin(referenceCostKrw, params.benchmarkChargeP);
  const rows: SimulationRow[] = params.candidateMargins.map((m) => {
    // override targetMargin for simulation
    const shadow = computeShadowPricing({
      modelId: params.modelId,
      promptTokens: params.inputTokens,
      outputTokens: params.outputTokens,
    });
    // recompute with candidate margin (bypass published target)
    const standard = referenceCostKrw / (1 - m);
    const final = Math.ceil(standard - 1e-9);
    const grossProfit = final - shadow.actualProviderCostKrw;
    const competitiveDeviation =
      params.benchmarkChargeP > 0 ? (final - params.benchmarkChargeP) / params.benchmarkChargeP : null;
    const minimumSafe = referenceCostKrw / (1 - params.minimumMarginFloor);
    let flag: SimulationRow["flag"] = "GREEN";
    if (final <= params.benchmarkChargeP && m >= params.minimumMarginFloor) flag = "GREEN";
    else if (minimumSafe <= params.benchmarkChargeP) flag = "YELLOW";
    else flag = "RED";
    void impliedMax;
    return {
      margin: m,
      shadowChargeP: final,
      grossProfitP: Math.round(grossProfit * 10) / 10,
      competitiveDeviationPct: competitiveDeviation != null ? Math.round(competitiveDeviation * 1000) / 10 : null,
      benchmarkImpliedMaxMarginPct: impliedMax != null ? Math.round(impliedMax * 1000) / 10 : null,
      flag,
    };
  });
  return { referenceCostKrw, rows };
}

// Pre-baked competitor benchmarks
export const COMPETITOR_BENCHMARKS = {
  gemini31: { inputTokens: 40689, outputTokens: 4307, chargeP: 244.2, label: "Gemini 3.1 Pro Preview" },
  opus5: { inputTokens: 63749, outputTokens: 3629, chargeP: 741.5, label: "Claude Opus 5" },
  opusChars: { outputChars: 1800, chargeP: 250, label: "Opus 1800chars" },
} as const;
