/**
 * Server-side status-widget defect evidence for refund validation.
 */

import type { Usage } from "@/lib/chatUsage";
import type { StatusWidgetReasonCode } from "@/lib/statusWidget/diagnostics";

export type StatusWidgetRefundEvidence = {
  widgetRequested: boolean;
  widgetActive: boolean;
  reasonCode: StatusWidgetReasonCode | "UNKNOWN";
};

/** Derive widget refund evidence from persisted usage diagnostics only. */
export function diagnoseStatusWidgetFailureFromUsage(
  usage: Usage
): StatusWidgetRefundEvidence {
  const diag = usage.statusWidgetExtractDiagnostics;
  const extract = usage.statusWidgetExtract;

  const widgetRequested = Boolean(extract || diag);
  const widgetActive = Boolean(extract);

  if (!widgetRequested) {
    return { widgetRequested: false, widgetActive: false, reasonCode: "STATUS_WIDGET_INACTIVE" };
  }

  if (diag?.exhausted) {
    return { widgetRequested: true, widgetActive: true, reasonCode: "STATUS_WIDGET_EXTRACT_EXHAUSTED" };
  }

  if (diag?.usedFallback && diag.attempts.some((a) => a.stage === "fallback" && !a.succeeded)) {
    return { widgetRequested: true, widgetActive: true, reasonCode: "FALLBACK_MODEL_FAILED" };
  }

  const failedAttempt = diag?.attempts.find(
    (a) => a.reasonCode === "V3_PARSE_FAILED" || a.errorCode != null
  );
  if (failedAttempt?.reasonCode) {
    return {
      widgetRequested: true,
      widgetActive: true,
      reasonCode: failedAttempt.reasonCode as StatusWidgetReasonCode,
    };
  }

  if (!extract || (extract.output <= 0 && extract.input <= 0)) {
    return { widgetRequested: true, widgetActive: true, reasonCode: "V3_EMPTY_OUTPUT" };
  }

  return { widgetRequested: true, widgetActive: true, reasonCode: "OK" };
}
