import { MAIN_RP_MODEL_IDS } from "@/lib/chatModels";
import type { AdminFinanceSummary } from "@/lib/adminFinance";
import type { MainRpPricingObservabilityProjection } from "@/lib/mainRpPricingObservability";

export type FinanceAnomalySeverity = "critical" | "warning";

export type FinanceAnomalyCode =
  | "PROVIDER_RECONCILIATION_MISMATCH"
  | "UNRECONCILED_PROVIDER_SPEND"
  | "PROVIDER_RECONCILIATION_UNAVAILABLE"
  | "DIRECT_COST_WITHOUT_USER_BILLING"
  | "ACTUAL_MARGIN_BELOW_FLOOR"
  | "REPRESENTATIVE_MARGIN_BELOW_FLOOR";

export type FinanceAnomaly = {
  id: string;
  code: FinanceAnomalyCode;
  severity: FinanceAnomalySeverity;
  title: string;
  summary: string;
  sourceRef: string;
  href: "/admin/finance" | "/admin/pricing";
  modelId: string | null;
};

export type FinanceAnomalyReport = {
  generatedAt: string;
  monthKey: string;
  status: "HEALTHY" | "WARNING" | "CRITICAL";
  criticalCount: number;
  warningCount: number;
  anomalies: FinanceAnomaly[];
};

function usdFromMicro(value: number): string {
  return (Math.max(0, value) / 1_000_000).toFixed(6);
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function reportStatus(anomalies: readonly FinanceAnomaly[]): FinanceAnomalyReport["status"] {
  if (anomalies.some((row) => row.severity === "critical")) return "CRITICAL";
  if (anomalies.length > 0) return "WARNING";
  return "HEALTHY";
}

/**
 * Read-only deterministic anomaly projection over canonical finance/pricing owners.
 *
 * This intentionally starts with high-confidence invariants only. It does not
 * guess statistical spend anomalies, mutate prices/routes, or create a second
 * cost owner.
 */
export function buildFinanceAnomalyReport(params: {
  summary: AdminFinanceSummary;
  pricing: MainRpPricingObservabilityProjection | null;
  now?: Date;
}): FinanceAnomalyReport {
  const generatedAt = (params.now ?? new Date()).toISOString();
  const anomalies: FinanceAnomaly[] = [];
  const reconciliation = params.summary.providerReconciliation;

  if (reconciliation?.status === "mismatch") {
    anomalies.push({
      id: "provider-reconciliation:mismatch",
      code: "PROVIDER_RECONCILIATION_MISMATCH",
      severity: "critical",
      title: "Provider cost reconciliation mismatch",
      summary:
        `CheaperInference daily checksum and canonical local ledger differ by ` +
        `${reconciliation.dailyDeltaMicroUsd ?? "unknown"} micro-USD. ` +
        "Do not change billing from this projection; reconcile the existing provider-cost owner.",
      sourceRef: `provider_reconciliation:${reconciliation.windowStart}..${reconciliation.windowEnd}`,
      href: "/admin/finance",
      modelId: null,
    });
  } else if (
    reconciliation &&
    ["pending", "provider_unavailable", "not_configured"].includes(reconciliation.status)
  ) {
    anomalies.push({
      id: `provider-reconciliation:${reconciliation.status}`,
      code: "PROVIDER_RECONCILIATION_UNAVAILABLE",
      severity: "warning",
      title: `Provider reconciliation ${reconciliation.status}`,
      summary:
        "Latest provider reconciliation did not produce matched settled truth. " +
        "The previous canonical ledger remains authoritative until reconciliation recovers.",
      sourceRef: `provider_reconciliation:${reconciliation.status}`,
      href: "/admin/finance",
      modelId: null,
    });
  }

  if ((reconciliation?.unreconciledProviderMicroUsd ?? 0) > 0) {
    anomalies.push({
      id: "provider-reconciliation:unreconciled-spend",
      code: "UNRECONCILED_PROVIDER_SPEND",
      severity: "critical",
      title: "Settled provider spend lacks local attribution",
      summary:
        `${usdFromMicro(reconciliation!.unreconciledProviderMicroUsd)} USD of settled provider spend ` +
        "could not be reconciled to the canonical local identity/ledger path.",
      sourceRef: `unreconciled_micro_usd:${reconciliation!.unreconciledProviderMicroUsd}`,
      href: "/admin/finance",
      modelId: null,
    });
  }

  if (params.pricing) {
    const active = new Set<string>(MAIN_RP_MODEL_IDS);
    for (const row of params.pricing.models) {
      if (!active.has(row.modelId)) continue;
      const actual = row.actual;

      if (
        actual.usageState === "HAS_ACTIVITY" &&
        actual.apiCostKrw > 0 &&
        actual.paidRevenueKrw <= 0 &&
        actual.freePointSpend <= 0
      ) {
        anomalies.push({
          id: `model:${row.modelId}:cost-without-billing`,
          code: "DIRECT_COST_WITHOUT_USER_BILLING",
          severity: "critical",
          title: `${row.modelId} provider cost without user billing`,
          summary:
            `Actual production recorded ${Math.round(actual.apiCostKrw).toLocaleString()} KRW provider cost ` +
            "while both paid and free user billing are zero. This is the direct 0P-style invariant breach.",
          sourceRef: `actual_production:${row.modelId}:${actual.monthKey ?? params.summary.monthKey}`,
          href: "/admin/finance",
          modelId: row.modelId,
        });
      }

      const actualBelowFloor =
        actual.usageState === "HAS_ACTIVITY" &&
        actual.realizedMarginExact &&
        actual.marginRate != null &&
        actual.paidRevenueKrw > 0 &&
        actual.marginRate < row.representative.minimumMarginFloor;

      if (actualBelowFloor) {
        anomalies.push({
          id: `model:${row.modelId}:actual-margin-floor`,
          code: "ACTUAL_MARGIN_BELOW_FLOOR",
          severity: "critical",
          title: `${row.modelId} actual margin below floor`,
          summary:
            `Exact realized margin ${percent(actual.marginRate!)} is below the canonical minimum ` +
            `${percent(row.representative.minimumMarginFloor)} for observed production usage.`,
          sourceRef: `actual_margin:${row.modelId}:${actual.monthKey ?? params.summary.monthKey}`,
          href: "/admin/pricing",
          modelId: row.modelId,
        });
      } else if (
        row.representative.status === "below_floor" &&
        row.representative.procurementCostFreshness === "FRESH"
      ) {
        anomalies.push({
          id: `model:${row.modelId}:representative-margin-floor`,
          code: "REPRESENTATIVE_MARGIN_BELOW_FLOOR",
          severity: "warning",
          title: `${row.modelId} representative margin below floor`,
          summary:
            "Fresh current procurement evidence puts the canonical representative workload below the " +
            "minimum margin floor. This is review evidence only; no automatic price or route change is allowed.",
          sourceRef: `representative_margin:${row.modelId}:${row.representative.representativeWorkloadLabel}`,
          href: "/admin/pricing",
          modelId: row.modelId,
        });
      }
    }
  }

  const criticalCount = anomalies.filter((row) => row.severity === "critical").length;
  const warningCount = anomalies.length - criticalCount;
  return {
    generatedAt,
    monthKey: params.summary.monthKey,
    status: reportStatus(anomalies),
    criticalCount,
    warningCount,
    anomalies,
  };
}
