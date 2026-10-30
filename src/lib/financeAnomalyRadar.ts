import { MAIN_RP_MODEL_IDS } from "@/lib/chatModels";
import type { AdminFinanceSummary } from "@/lib/adminFinance";
import { isLunaUsageModel, type ForwardReconAudit, type ForwardUnmatchedRequest } from "@/lib/forwardReconAudit";
import { forwardEvidenceFingerprint, type ForwardReviewProjection } from "@/lib/forwardReconReview";
import type { MainRpPricingObservabilityProjection } from "@/lib/mainRpPricingObservability";

export type FinanceAnomalySeverity = "critical" | "warning";

export type FinanceAnomalyCode =
  | "PROVIDER_RECONCILIATION_MISMATCH"
  | "UNRECONCILED_PROVIDER_SPEND"
  | "PROVIDER_RECONCILIATION_UNAVAILABLE"
  | "FORWARD_UNMATCHED_REMOTE_SPEND"
  | "FORWARD_UNDETERMINED_USAGE_SOURCE"
  | "FORWARD_USAGE_SOURCE_UNCLASSIFIED"
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
  /** Provider call time when this anomaly has one. Report generation time is not a call time. */
  occurredAt?: string | null;
  /**
   * Spend witness from forwardRequestReviewKey. Notification identity only.
   * Not a request id, and not part of the ops sourceRef.
   */
  evidenceKey?: string;
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

function formatForwardModelBreakdown(byModel: ForwardReconAudit["byModel"]): string {
  const parts = Object.entries(byModel)
    .filter(([, row]) => row.unmatchedCount > 0)
    .sort((a, b) => b[1].unmatchedMicroUsd - a[1].unmatchedMicroUsd || b[1].unmatchedCount - a[1].unmatchedCount)
    .map(
      ([model, row]) =>
        `${model} × ${row.unmatchedCount} unmatched (${usdFromMicro(row.unmatchedMicroUsd)} USD)`
    );
  return parts.length > 0 ? parts.join("; ") : "no unmatched model rows";
}

function spendEvidence(
  audit: ForwardReconAudit,
  scope: "production" | "undetermined" | "workspace"
): string | undefined {
  const rows = (audit.unmatchedRequests ?? []).filter((row: ForwardUnmatchedRequest) =>
    scope === "workspace" ? true : row.scope === scope
  );
  return forwardEvidenceFingerprint(audit.observedSince, rows) ?? undefined;
}

function pushForwardReconAnomalies(anomalies: FinanceAnomaly[], audit: ForwardReconAudit, review?: ForwardReviewProjection | null): void {
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

  const scope = audit.productionScope;
  const scopeKnown = scope?.known === true;
  if (!scopeKnown) {
    if (audit.unmatchedLedgerCount > 0 && audit.unmatchedSettledMicroUsd > 0) {
      anomalies.push({
        id: "provider-reconciliation:forward-unclassified",
        code: "FORWARD_USAGE_SOURCE_UNCLASSIFIED",
        severity: "warning",
        title: "Forward usage source is unclassified",
        summary:
          `${audit.observationNote} The stored forward audit has ${audit.unmatchedLedgerCount} ` +
          `workspace-unmatched settled request(s) (${usdFromMicro(audit.unmatchedSettledMicroUsd)} USD) ` +
          "but no production-key classification. That workspace total is not a production-miss count " +
          "and it is not a clearance. havExclusiveCostConfirmed=false.",
        sourceRef: `forward_unclassified:${audit.observedSince}:${audit.unmatchedLedgerCount}`,
        href: "/admin/finance",
        modelId: null,
        evidenceKey: spendEvidence(audit, "workspace"),
      });
    }
    return;
  }

  if (review?.available) {
    for (const [group, production] of [[review.pendingProduction, true], [review.pendingUndetermined, false]] as const) {
      if (group.count === 0) continue;
      anomalies.push({
        id: production ? "provider-reconciliation:forward-unmatched" : "provider-reconciliation:forward-undetermined-source",
        code: production ? "FORWARD_UNMATCHED_REMOTE_SPEND" : "FORWARD_UNDETERMINED_USAGE_SOURCE",
        severity: "warning",
        title: production ? "미검토 운영 키 장부 누락" : "미검토 출처 미확정 사용량",
        summary: `${group.count}건 / ${usdFromMicro(group.microUsd)} USD. ` +
          (review.reviewedAt ? `마지막 보관 ${review.reviewedAt} 이후 추가됐거나 변경된 요청입니다. ` : "아직 검토·보관하지 않은 요청입니다. ") +
          `첫 호출 ${group.firstAt}, 마지막 ${group.lastAt}. ` +
          `과거 보관 미해결 ${review.reviewedUnresolved.count}건, 출처 확인된 실측 ${review.identifiedMeasurements.count}건은 별도 표시합니다. ` +
          `공급자 전체 미연결 누적 ${audit.unmatchedLedgerCount}건은 그대로 보존됩니다.`,
        sourceRef: `forward_${production ? "unmatched" : "undetermined"}:${audit.observedSince}:${group.count}`,
        href: "/admin/finance",
        modelId: Object.keys(group.byModel).some(isLunaUsageModel) ? "gpt-6-luna" : null,
        occurredAt: group.firstAt,
        evidenceKey: group.evidenceFingerprint ?? undefined,
      });
    }
    return;
  }

  if (scope.unmatchedLedgerCount > 0 && scope.unmatchedSettledMicroUsd > 0) {
    const productionLuna = Object.entries(scope.byModel).some(
      ([model, row]) => row.unmatchedCount > 0 && isLunaUsageModel(model)
    );
    anomalies.push({
      id: "provider-reconciliation:forward-unmatched",
      code: "FORWARD_UNMATCHED_REMOTE_SPEND",
      severity: "warning",
      title: "Unmatched production-key provider spend after observation baseline",
      summary:
        `${audit.observationNote} Period since ${audit.observedSince}: ` +
        `${scope.unmatchedLedgerCount} settled request(s) on ${scope.provenKeyCount} production key(s) ` +
        `proven by ledger request-id intersection are still absent from the local ledger ` +
        `(${usdFromMicro(scope.unmatchedSettledMicroUsd)} USD). ` +
        `First ${scope.unmatchedFirstAt ?? "unknown"}, last ${scope.unmatchedLastAt ?? "unknown"}. ` +
        `Models: ${formatForwardModelBreakdown(scope.byModel)}. ` +
        `Workspace unmatched is ${audit.unmatchedLedgerCount} and is not this production-miss total. ` +
        "These rows are not backfilled. havExclusiveCostConfirmed=false.",
      sourceRef: `forward_unmatched:${audit.observedSince}:${scope.unmatchedLedgerCount}`,
      href: "/admin/finance",
      modelId: productionLuna ? "gpt-6-luna" : null,
      occurredAt: scope.unmatchedFirstAt,
      evidenceKey: spendEvidence(audit, "production"),
    });
  }

  const undetermined = audit.undeterminedUsage;
  const undeterminedSettled =
    (undetermined?.settledCount ?? 0) + (undetermined?.missingKeyIdSettledCount ?? 0);
  const undeterminedMicro =
    (undetermined?.settledMicroUsd ?? 0) + (undetermined?.missingKeyIdSettledMicroUsd ?? 0);
  if (audit.productionKeyMapping === "unmapped" || (undeterminedSettled > 0 && undeterminedMicro > 0)) {
    anomalies.push({
      id: "provider-reconciliation:forward-undetermined-source",
      code: "FORWARD_UNDETERMINED_USAGE_SOURCE",
      severity: "warning",
      title: "Undetermined usage source outside the production ledger",
      summary:
        `${audit.observationNote} ${undetermined?.settledCount ?? 0} settled request(s) on ` +
        `${undetermined?.keyCount ?? 0} key id(s) have no ledger request-id intersection ` +
        `(${usdFromMicro(undetermined?.settledMicroUsd ?? 0)} USD), and ` +
        `${undetermined?.missingKeyIdSettledCount ?? 0} settled request(s) have no key id ` +
        `(${usdFromMicro(undetermined?.missingKeyIdSettledMicroUsd ?? 0)} USD). ` +
        "These are not production-ledger misses. Their purpose is unproven, not an approved test. " +
        `Workspace unmatched remains ${audit.unmatchedLedgerCount}. havExclusiveCostConfirmed=false.`,
      sourceRef: `forward_undetermined:${audit.observedSince}:${undeterminedSettled}`,
      href: "/admin/finance",
      modelId: null,
      occurredAt: undetermined?.firstAt ?? null,
      evidenceKey: spendEvidence(audit, "undetermined"),
    });
  }
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
    pushForwardReconAnomalies(anomalies, forward!, reconciliation?.forwardOps);
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
    pushForwardReconAnomalies(anomalies, forward!, reconciliation?.forwardOps);
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
