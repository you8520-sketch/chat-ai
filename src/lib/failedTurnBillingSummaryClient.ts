"use client";

import type { UserMessageBillingSummary } from "@/lib/storedTurnChargeEvidenceShared";

export type FailedTurnMessageLike = {
  id?: number | null;
  role: string;
  requestId?: string | null;
  generationStatus?: string | null;
  billingChargeSummary?: UserMessageBillingSummary | null;
  usage?: { cost?: number | null; billingWaived?: boolean } | null;
};

function normalizeStatus(status: string | null | undefined): string {
  return (status ?? "").toLowerCase();
}

/** Terminal failed statuses that require immediate charge visibility. */
export function isTerminalFailedBillingStatus(status: string | null | undefined): boolean {
  const s = normalizeStatus(status);
  return s === "interrupted" || s === "failed" || s === "failed_partial";
}

/**
 * Client gate for lazy billing-summary fetch.
 * Mirrors server `shouldAttachClientBillingChargeSummary` intent without importing
 * server-only modules: fetch only when the turn is terminal-failed, has a persisted
 * id, and has no summary yet.
 */
export function shouldFetchFailedTurnBillingSummary(
  message: FailedTurnMessageLike
): boolean {
  if (message.role !== "assistant") return false;
  if (message.id == null || message.id <= 0) return false;
  if (message.billingChargeSummary != null) return false;
  return isTerminalFailedBillingStatus(message.generationStatus);
}

/**
 * Race-guarded patch — only the exact generation gets the summary.
 * Stale regen responses (same messageId, different requestId) are ignored.
 */
export function applyBillingSummaryToMessages<T extends FailedTurnMessageLike>(
  prev: T[],
  summary: UserMessageBillingSummary
): T[] {
  const idx = prev.findIndex((m) => m.id === summary.messageId);
  if (idx < 0) return prev;
  const cur = prev[idx]!;
  if (cur.role !== "assistant") return prev;
  // Generation identity guard: if both sides carry requestId, they must match.
  if (
    cur.requestId &&
    summary.requestId &&
    cur.requestId !== summary.requestId
  ) {
    return prev;
  }
  // Only patch terminal-failed rows; never clobber in-flight or completed rows.
  if (!isTerminalFailedBillingStatus(cur.generationStatus)) return prev;
  if (cur.billingChargeSummary?.messageId === summary.messageId &&
      cur.billingChargeSummary?.requestId === summary.requestId) {
    return prev;
  }
  const copy = [...prev];
  copy[idx] = { ...cur, billingChargeSummary: summary };
  return copy;
}

/** SSR merge — copy server billingChargeSummary onto matching client rows. */
export function mergeBillingChargeSummaryFieldsById<T extends FailedTurnMessageLike>(
  prev: T[],
  server: T[]
): T[] {
  const serverById = new Map(
    server
      .filter((m) => m.id != null && m.id > 0 && m.billingChargeSummary != null)
      .map((m) => [m.id!, m.billingChargeSummary!])
  );
  if (serverById.size === 0) return prev;
  return prev.map((m) => {
    if (m.id == null || m.id <= 0) return m;
    const summary = serverById.get(m.id);
    if (!summary) return m;
    // Same generation guard as live patch.
    if (m.requestId && summary.requestId && m.requestId !== summary.requestId) {
      return m;
    }
    if (m.billingChargeSummary?.messageId === summary.messageId &&
        m.billingChargeSummary?.requestId === summary.requestId) {
      return m;
    }
    return { ...m, billingChargeSummary: summary };
  });
}
