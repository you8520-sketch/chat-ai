import { MAIN_RP_MODEL_IDS } from "@/lib/chatModels";
import type { AdminFinanceSummary } from "@/lib/adminFinance";
import type { ForwardReconAudit } from "@/lib/forwardReconAudit";
import type { MainRpPricingObservabilityProjection } from "@/lib/mainRpPricingObservability";

export type FinanceAnomalySeverity = "critical" | "warning";

export type FinanceAnomalyCode =
  | "PROVIDER_RECONCILIATION_MISMATCH"
  | "UNRECONCILED_PROVIDER_SPEND"
  | "PROVIDER_RECONCILIATION_UNAVAILABLE"
  | "FORWARD_UNMATCHED_REMOTE_SPEND"
  | "FORWARD_RECON_FETCH_FAILURE"
  | "FORWARD_RECON_UNVERIFIED"
  | "FORWARD_RECON_CONFIG_INVALID"
  | "DIRECT_COST_WITHOUT_USER_BILLING"
  | "UNDER_RECOVERED_USER_CHARGE"
  | "UNATTRIBUTED_DIRECT_COST"
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

/** Keep a positive sub-1 KRW cost visible. Rounding it to 0 is a false clear. */
function formatAnomalyKrw(value: number): string {
  const tenths = Math.round(value * 10) / 10;
  if (value > 0 && tenths <= 0) return "<0.1";
  return tenths.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function reportStatus(anomalies: readonly FinanceAnomaly[]): FinanceAnomalyReport["status"] {
  if (anomalies.some((row) => row.severity === "critical")) return "CRITICAL";
  if (anomalies.length > 0) return "WARNING";
  return "HEALTHY";
}

function formatForwardModelBreakdown(audit: ForwardReconAudit): string {
  const parts = Object.entries(audit.byModel)
    .filter(([, row]) => row.unmatchedCount > 0)
    .sort((a, b) => b[1].unmatchedMicroUsd - a[1].unmatchedMicroUsd || b[1].unmatchedCount - a[1].unmatchedCount)
    .map(
      ([model, row]) =>
        `${model} × ${row.unmatchedCount} unmatched (${usdFromMicro(row.unmatchedMicroUsd)} USD)`
    );
  return parts.length > 0 ? parts.join("; ") : "no unmatched model rows";
}

function pushForwardReconAnomalies(anomalies: FinanceAnomaly[], audit: ForwardReconAudit): void {
  if (audit.verificationStatus === "config_invalid") {
    anomalies.push({
      id: "provider-reconciliation:forward-config-invalid",
      code: "FORWARD_RECON_CONFIG_INVALID",
      severity: "warning",
      title: "Forward observation cutoff is invalid",
      summary:
        `${audit.observationNote} Historical month reconciliation is not a new finding. ` +
        "No substitute forward window was chosen.",
      sourceRef: "forward_audit:config_invalid",
      href: "/admin/finance",
      modelId: null,
    });
    return;
  }

  if (audit.verificationStatus === "unverified" || audit.cases.includes("unverifiable_timestamp")) {
    anomalies.push({
      id: "provider-reconciliation:forward-unverified",
      code: "FORWARD_RECON_UNVERIFIED",
      severity: "warning",
      title: "Forward usage timestamps are unverifiable",
      summary:
        `${audit.observationNote} ${audit.unverifiableTimestampCount} remote request(s) ` +
        `(${audit.unverifiableSettledCount} settled) lack a parseable createdAt, so whether they ` +
        "are new calls is UNKNOWN/UNVERIFIED. They are not counted as zero new calls and are " +
        "not invented as new unmatched spend.",
      sourceRef: `forward_audit:unverified:${audit.unverifiableTimestampCount}`,
      href: "/admin/finance",
      modelId: null,
    });
  }

  if (audit.fetchStatus !== "ok") {
    anomalies.push({
      id: "provider-reconciliation:forward-fetch-failure",
      code: "FORWARD_RECON_FETCH_FAILURE",
      severity: "warning",
      title: "Forward usage audit fetch failed",
      summary:
        `Usage query after observation baseline ${audit.observedSince} failed (${audit.fetchStatus}). ` +
        `${audit.observationNote} Last successful forward slice is not treated as new unmatched spend.`,
      sourceRef: `forward_audit:${audit.observedSince}:${audit.fetchStatus}`,
      href: "/admin/finance",
      modelId: null,
    });
    return;
  }

  if (audit.unmatchedLedgerCount <= 0 || audit.unmatchedSettledMicroUsd <= 0) return;

  const keyNote = audit.otherApiKeyCandidate
    ? " Forward window saw more than one API-key id; key-level audit is not applied because production key mapping is unavailable."
    : " Production key mapping is unavailable, so remote workspace usage is not confirmed as HAV-exclusive cost.";
  anomalies.push({
    id: "provider-reconciliation:forward-unmatched",
    code: "FORWARD_UNMATCHED_REMOTE_SPEND",
    severity: "warning",
    title: "New unmatched provider spend after observation baseline",
    summary:
      `${audit.observationNote} Period since ${audit.observedSince}: ` +
      `${audit.unmatchedLedgerCount} settled remote request(s) are not linked to the local ledger ` +
      `(${usdFromMicro(audit.unmatchedSettledMicroUsd)} USD confirmed remote settled; ` +
      `${audit.matchedLedgerCount} linked). Models: ${formatForwardModelBreakdown(audit)}.` +
      keyNote +
      " havExclusiveCostConfirmed=false.",
    sourceRef: `forward_unmatched:${audit.observedSince}:${audit.unmatchedLedgerCount}`,
    href: "/admin/finance",
    modelId: audit.cases.includes("unmatched_luna") ? "gpt-6-luna" : null,
  });
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
  const forward = reconciliation?.forwardAudit ?? null;
  const configInvalid = forward?.verificationStatus === "config_invalid";
  const hasForwardBaseline =
    Boolean(forward?.observedSince) && !configInvalid;

  // After a forward observation baseline exists, month-wide mismatch/unreconciled
  // is historical residue. Only the new window can raise a current recon warning.
  // An invalid cutoff is fail-closed: do not invent a substitute window.
  if (configInvalid) {
    pushForwardReconAnomalies(anomalies, forward!);
    if (!forward?.observedSince && reconciliation?.status === "mismatch") {
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
    }
  } else if (hasForwardBaseline) {
    pushForwardReconAnomalies(anomalies, forward!);
    if (
      forward?.fetchStatus === "ok" &&
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
  } else if (reconciliation?.status === "mismatch") {
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

  const suppressHistoricalSpend =
    hasForwardBaseline || (configInvalid && Boolean(forward?.observedSince));
  if (!suppressHistoricalSpend && (reconciliation?.unreconciledProviderMicroUsd ?? 0) > 0) {
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

      const attribution = actual.directCostAttribution;
      const sourceRef = `actual_production:${row.modelId}:${actual.monthKey ?? params.summary.monthKey}`;

      // Known durable settlement failure: provider cost happened, user charge
      // settled 0P, and future generation is blocked. This is not waived,
      // refunded, unlinked, or unknown. CRITICAL matches DIRECT_COST_WITHOUT_
      // USER_BILLING — both are live billing incidents; this one also locks
      // the user until a later resolve owner exists.
      if (
        actual.usageState === "HAS_ACTIVITY" &&
        attribution != null &&
        attribution.userFundedUnderRecoveredKrw > 0
      ) {
        anomalies.push({
          id: `model:${row.modelId}:under-recovered-user-charge`,
          code: "UNDER_RECOVERED_USER_CHARGE",
          severity: "critical",
          title: `${row.modelId} durable under-recovered user charge`,
          summary:
            `Actual production recorded ${formatAnomalyKrw(attribution.userFundedUnderRecoveredKrw)} KRW ` +
            "user-funded provider cost whose chat settlement is durable under-recovered. " +
            "User charge is 0P, the assistant product was kept, and new generation is blocked. " +
            "This is not waived, refunded, unlinked, or unknown.",
          sourceRef,
          href: "/admin/finance",
          modelId: row.modelId,
        });
      }

      if (
        actual.usageState === "HAS_ACTIVITY" &&
        actual.apiCostKrw > 0 &&
        actual.paidRevenueKrw <= 0 &&
        actual.freePointSpend <= 0
      ) {
        // Missing provenance keeps the historical aggregate reading so older
        // snapshots still surface cost with zero billing. Linked platform,
        // waived, refunded, and under-recovered cost is real spend and is not
        // a charge miss. Under-recovered has its own anomaly above.
        if (attribution == null || attribution.userFundedUnlinkedKrw > 0) {
          const unbilledKrw =
            attribution == null ? actual.apiCostKrw : attribution.userFundedUnlinkedKrw;
          anomalies.push({
            id: `model:${row.modelId}:cost-without-billing`,
            code: "DIRECT_COST_WITHOUT_USER_BILLING",
            severity: "critical",
            title: `${row.modelId} provider cost without user billing`,
            summary:
              `Actual production recorded ${formatAnomalyKrw(unbilledKrw)} KRW user-funded provider cost ` +
              "with no linked paid or free charge. This is the direct 0P-style invariant breach.",
            sourceRef,
            href: "/admin/finance",
            modelId: row.modelId,
          });
        } else if (attribution.unknownKrw > 0) {
          anomalies.push({
            id: `model:${row.modelId}:unattributed-direct-cost`,
            code: "UNATTRIBUTED_DIRECT_COST",
            severity: "warning",
            title: `${row.modelId} provider cost with unresolved billing linkage`,
            summary:
              `Actual production recorded ${formatAnomalyKrw(attribution.unknownKrw)} KRW provider cost ` +
              "whose charge owner is not proven. This is not a confirmed billing miss.",
            sourceRef,
            href: "/admin/finance",
            modelId: row.modelId,
          });
        }
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
