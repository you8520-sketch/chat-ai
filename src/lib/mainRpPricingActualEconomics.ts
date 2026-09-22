/**
 * Main RP actual production economics — read-only compose over Admin Finance.
 * Never duplicates margin formulas or aggregates ledger cost twice.
 */

import type { AdminFinanceSummary, FinanceMarginCoverage } from "@/lib/adminFinance";
import { MAIN_RP_USER_SELECTABLE_OPTIONS } from "@/lib/chatModels";

export type ActualProductionUsageState = "NO_USAGE" | "HAS_ACTIVITY" | "FINANCE_UNAVAILABLE";

export type ActualProductionEconomicsObservation = {
  domain: "ACTUAL_PRODUCTION";
  monthKey: string | null;
  usageState: ActualProductionUsageState;
  paidRevenueKrw: number;
  freePointSpend: number;
  /** Canonical modelBreakdown provider cost — never merged with aiModelCosts.actualKrw. */
  apiCostKrw: number;
  netProfitKrw: number | null;
  marginRate: number | null;
  marginCoverage: FinanceMarginCoverage | null;
  realizedMarginExact: boolean;
  marginDisplay: string;
  financeModelKey: string | null;
  costEvidence: {
    sourceState: string | null;
    actualKrw: number | null;
    estimatedKrw: number | null;
    calls: number | null;
  };
};

/** Finance identity keys for a Main RP model (id + display label). */
export function financeModelIdentityKeys(modelId: string): readonly string[] {
  const option = MAIN_RP_USER_SELECTABLE_OPTIONS.find(
    (candidate) => candidate.id.toLowerCase() === modelId.trim().toLowerCase()
  );
  if (!option) return [modelId.trim()];
  return [option.id, option.label];
}

function identityMatches(modelKey: string, modelId: string): boolean {
  const normalized = modelKey.trim().toLowerCase();
  return financeModelIdentityKeys(modelId).some((key) => key.toLowerCase() === normalized);
}

function findModelBreakdown(summary: AdminFinanceSummary, modelId: string) {
  return summary.modelBreakdown.find((row) => identityMatches(row.model, modelId)) ?? null;
}

function findDirectAiModelCost(summary: AdminFinanceSummary, modelId: string) {
  return (
    summary.aiModelCosts.find(
      (row) => row.kind === "direct" && identityMatches(row.model, modelId)
    ) ?? null
  );
}

function isZeroUseModel(summary: AdminFinanceSummary, modelId: string): boolean {
  return summary.zeroUseModels.some((row) => row.id.toLowerCase() === modelId.trim().toLowerCase());
}

function formatMarginCoverageLabel(coverage: FinanceMarginCoverage): string {
  switch (coverage) {
    case "complete":
      return "COMPLETE";
    case "partial":
      return "PARTIAL";
    case "estimated":
      return "ESTIMATED";
    case "unavailable":
      return "UNAVAILABLE";
    default: {
      const _exhaustive: never = coverage;
      return _exhaustive;
    }
  }
}

function buildMarginDisplay(params: {
  usageState: ActualProductionUsageState;
  paidRevenueKrw: number;
  freePointSpend: number;
  apiCostKrw: number;
  marginRate: number | null;
  marginCoverage: FinanceMarginCoverage | null;
  realizedMarginExact: boolean;
}): string {
  if (params.usageState === "NO_USAGE") return "NO_USAGE";
  if (params.usageState === "FINANCE_UNAVAILABLE") return "Finance unavailable";
  if (params.paidRevenueKrw <= 0 && params.freePointSpend > 0) {
    return "Realized margin unavailable — free-only usage";
  }
  if (params.paidRevenueKrw <= 0 && params.apiCostKrw > 0) {
    return `Known provider cost ${Math.round(params.apiCostKrw).toLocaleString()} KRW — margin unavailable`;
  }
  if (!params.realizedMarginExact || params.marginRate == null || params.paidRevenueKrw <= 0) {
    const coverage = params.marginCoverage
      ? formatMarginCoverageLabel(params.marginCoverage)
      : "UNAVAILABLE";
    if (params.apiCostKrw > 0) {
      return `Realized margin unavailable — ${coverage.toLowerCase()} provider cost`;
    }
    return `Realized margin unavailable — ${coverage.toLowerCase()}`;
  }
  return `Realized margin ${(params.marginRate * 100).toFixed(1)}%`;
}

/** Compose read-only actual monthly economics for one Main RP model from Admin Finance. */
export function composeActualProductionEconomics(
  modelId: string,
  summary: AdminFinanceSummary | null | undefined
): ActualProductionEconomicsObservation {
  if (summary == null) {
    return {
      domain: "ACTUAL_PRODUCTION",
      monthKey: null,
      usageState: "FINANCE_UNAVAILABLE",
      paidRevenueKrw: 0,
      freePointSpend: 0,
      apiCostKrw: 0,
      netProfitKrw: null,
      marginRate: null,
      marginCoverage: null,
      realizedMarginExact: false,
      marginDisplay: "Finance unavailable",
      financeModelKey: null,
      costEvidence: {
        sourceState: null,
        actualKrw: null,
        estimatedKrw: null,
        calls: null,
      },
    };
  }

  const breakdown = findModelBreakdown(summary, modelId);
  const aiCost = findDirectAiModelCost(summary, modelId);
  const zeroUse = isZeroUseModel(summary, modelId);

  if (zeroUse && breakdown == null) {
    return {
      domain: "ACTUAL_PRODUCTION",
      monthKey: summary.monthKey,
      usageState: "NO_USAGE",
      paidRevenueKrw: 0,
      freePointSpend: 0,
      apiCostKrw: 0,
      netProfitKrw: null,
      marginRate: null,
      marginCoverage: null,
      realizedMarginExact: false,
      marginDisplay: "NO_USAGE",
      financeModelKey: null,
      costEvidence: {
        sourceState: null,
        actualKrw: null,
        estimatedKrw: null,
        calls: null,
      },
    };
  }

  const paidRevenueKrw = breakdown?.paidRevenueKrw ?? 0;
  const freePointSpend = breakdown?.freePointSpend ?? 0;
  const apiCostKrw = breakdown?.apiCostKrw ?? 0;
  const marginRate =
    breakdown != null &&
    breakdown.realizedMarginExact &&
    breakdown.paidRevenueKrw > 0
      ? breakdown.marginRate
      : null;
  const marginDisplay = buildMarginDisplay({
    usageState: "HAS_ACTIVITY",
    paidRevenueKrw,
    freePointSpend,
    apiCostKrw,
    marginRate,
    marginCoverage: breakdown?.marginCoverage ?? null,
    realizedMarginExact: breakdown?.realizedMarginExact ?? false,
  });

  return {
    domain: "ACTUAL_PRODUCTION",
    monthKey: summary.monthKey,
    usageState: "HAS_ACTIVITY",
    paidRevenueKrw,
    freePointSpend,
    apiCostKrw,
    netProfitKrw: breakdown?.netProfitKrw ?? null,
    marginRate,
    marginCoverage: breakdown?.marginCoverage ?? null,
    realizedMarginExact: breakdown?.realizedMarginExact ?? false,
    marginDisplay,
    financeModelKey: breakdown?.model ?? aiCost?.model ?? null,
    costEvidence: {
      sourceState: aiCost?.sourceState ?? null,
      actualKrw: aiCost?.actualKrw ?? null,
      estimatedKrw: aiCost?.estimatedKrw ?? null,
      calls: aiCost?.calls ?? null,
    },
  };
}
