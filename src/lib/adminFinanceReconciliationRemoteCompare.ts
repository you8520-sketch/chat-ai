import "server-only";

import type Database from "better-sqlite3";
import {
  RECONCILIATION_ROOT_CAUSE_UNCONFIRMED,
  assertReconciliationDiagnosisSafePayload,
  loadLocalReconciliationCompareSnapshot,
  type LocalReconciliationCompareSnapshot,
} from "@/lib/adminFinanceReconciliationDiagnose";
import {
  fetchAllUsageRequests,
  type CheaperInferenceUsageRequest,
  type UsageFetcher,
} from "@/lib/cheaperInferenceUsage";

/**
 * Opt-in read-only remote compare for
 * GET /api/admin/finance?diagnose=reconciliation-remote.
 * Reuses fetchAllUsageRequests. Never writes the ledger, never runs reconcile,
 * never issues a paid generation. Returns aggregates only.
 */

export const RECONCILIATION_REMOTE_COMPARE_VALUE = "reconciliation-remote";
export const RECONCILIATION_REMOTE_UNVERIFIED = "UNVERIFIED" as const;
export const REMOTE_COMPARE_MAX_PAGES = 8;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export type RemoteCompareClassification =
  | typeof RECONCILIATION_ROOT_CAUSE_UNCONFIRMED
  | typeof RECONCILIATION_REMOTE_UNVERIFIED;

/** Observed diagnostic fact, never proof of the full provider-spend mismatch. */
export type RemoteCompareConfirmedMechanism = "LEDGER_REQUEST_IDS_ABSENT" | null;

export type ProviderReconciliationRemoteCompare = {
  monthKey: string;
  windowStart: string;
  windowEnd: string;
  windowSemantics: "naive_calendar_month_treated_as_utc";
  remote: {
    fetchStatus: "ok" | "no_key" | "http" | "schema" | "network" | "incomplete";
    httpStatus: number | null;
    pages: number;
    requestCount: number;
    settledCount: number;
    pendingOrUnsettledCount: number;
    settledMicroUsd: number;
    distinctRequestIds: number;
    duplicateRequestIds: number;
    apiKeyDistinction: "available" | "unavailable";
    distinctApiKeyIds: number;
    createdAtPresent: number;
    createdAtMissing: number;
    nearBoundary9h: number;
  };
  match: {
    remoteSettledMatchedLedgerAny: number;
    remoteSettledMatchedLedgerInWindow: number;
    remoteSettledUnmatchedLedger: number;
    remoteSettledMatchedMessagesInWindow: number;
    remoteSettledMatchedMessagesOutOfWindow: number;
    remoteSettledUnmatchedMessages: number;
  };
  localLedgerInWindow: LocalReconciliationCompareSnapshot["ledgerInWindow"];
  evidence: {
    ledgerIdsAbsentInWindow: boolean;
    backgroundRowsExplainNoIdLedger: boolean;
    timezoneBoundaryCandidate: boolean;
    otherApiKeyCandidate: boolean;
    remoteOnlyCandidate: boolean;
    classification: RemoteCompareClassification;
    confirmedMechanism: RemoteCompareConfirmedMechanism;
    requiredToConfirm: readonly string[];
  };
};

const REQUIRED_WHEN_UNVERIFIED = [
  "Existing CHEAPER_INFERENCE_API_KEY must have usage:read for GET /usage/requests.",
  "Re-run admin GET /api/admin/finance?diagnose=reconciliation-remote&month=<KST YYYY-MM> after the fetch completes without a page cap or HTTP error.",
  "Do not POST /api/admin/finance/reconcile and do not issue paid generations.",
] as const;

type RemoteCompareDeps = {
  fetchRequests?: typeof fetchAllUsageRequests;
  fetchImpl?: UsageFetcher;
};

function sqlDateTimeToIso(value: string): string {
  const trimmed = value.trim();
  if (trimmed.includes("T")) return trimmed;
  return `${trimmed.replace(" ", "T")}Z`;
}

function sqlDateTimeToUtcMs(value: string): number {
  const trimmed = value.trim();
  const iso = trimmed.includes("T") ? trimmed : `${trimmed.replace(" ", "T")}Z`;
  return Date.parse(iso);
}

function isNearBoundary(createdAt: string, start: string, end: string): boolean {
  const createdMs = sqlDateTimeToUtcMs(createdAt);
  const startMs = sqlDateTimeToUtcMs(start);
  const endMs = sqlDateTimeToUtcMs(end);
  if (![createdMs, startMs, endMs].every(Number.isFinite)) return false;
  return (
    (createdMs >= startMs - KST_OFFSET_MS && createdMs < startMs) ||
    (createdMs >= endMs && createdMs < endMs + KST_OFFSET_MS)
  );
}

function emptyRemote(status: ProviderReconciliationRemoteCompare["remote"]["fetchStatus"]): ProviderReconciliationRemoteCompare["remote"] {
  return {
    fetchStatus: status,
    httpStatus: null,
    pages: 0,
    requestCount: 0,
    settledCount: 0,
    pendingOrUnsettledCount: 0,
    settledMicroUsd: 0,
    distinctRequestIds: 0,
    duplicateRequestIds: 0,
    apiKeyDistinction: "unavailable",
    distinctApiKeyIds: 0,
    createdAtPresent: 0,
    createdAtMissing: 0,
    nearBoundary9h: 0,
  };
}

function summarizeRemote(
  requests: CheaperInferenceUsageRequest[],
  pages: number,
  start: string,
  end: string
): ProviderReconciliationRemoteCompare["remote"] {
  const seen = new Set<string>();
  let duplicates = 0;
  const apiKeys = new Set<string>();
  let settledCount = 0;
  let pending = 0;
  let settledMicroUsd = 0;
  let createdAtPresent = 0;
  let createdAtMissing = 0;
  let near = 0;
  for (const request of requests) {
    if (seen.has(request.requestId)) duplicates += 1;
    else seen.add(request.requestId);
    const keyId = request.apiKeyId?.trim();
    if (keyId) apiKeys.add(keyId);
    if (request.settled && request.billedMicroUsd > 0) {
      settledCount += 1;
      settledMicroUsd += request.billedMicroUsd;
    } else {
      pending += 1;
    }
    if (request.createdAt) {
      createdAtPresent += 1;
      if (isNearBoundary(request.createdAt, start, end)) near += 1;
    } else {
      createdAtMissing += 1;
    }
  }
  return {
    fetchStatus: "ok",
    httpStatus: null,
    pages,
    requestCount: requests.length,
    settledCount,
    pendingOrUnsettledCount: pending,
    settledMicroUsd,
    distinctRequestIds: seen.size,
    duplicateRequestIds: duplicates,
    apiKeyDistinction: apiKeys.size > 0 ? "available" : "unavailable",
    distinctApiKeyIds: apiKeys.size,
    createdAtPresent,
    createdAtMissing,
    nearBoundary9h: near,
  };
}

function matchRemote(
  requests: CheaperInferenceUsageRequest[],
  local: LocalReconciliationCompareSnapshot
): ProviderReconciliationRemoteCompare["match"] {
  let matchedLedgerAny = 0;
  let matchedLedgerInWindow = 0;
  let matchedMessagesIn = 0;
  let matchedMessagesOut = 0;
  let unmatchedMessages = 0;
  const seen = new Set<string>();
  for (const request of requests) {
    if (!request.settled || request.billedMicroUsd <= 0) continue;
    if (seen.has(request.requestId)) continue;
    seen.add(request.requestId);
    if (local.ledgerIdsAny.has(request.requestId)) matchedLedgerAny += 1;
    if (local.ledgerIdsInWindow.has(request.requestId)) matchedLedgerInWindow += 1;
    const inMsgIn = local.messageIdsInWindow.has(request.requestId);
    const inMsgOut = local.messageIdsOutOfWindow.has(request.requestId);
    if (inMsgIn) matchedMessagesIn += 1;
    if (inMsgOut) matchedMessagesOut += 1;
    if (!inMsgIn && !inMsgOut) unmatchedMessages += 1;
  }
  return {
    remoteSettledMatchedLedgerAny: matchedLedgerAny,
    remoteSettledMatchedLedgerInWindow: matchedLedgerInWindow,
    remoteSettledUnmatchedLedger: seen.size - matchedLedgerAny,
    remoteSettledMatchedMessagesInWindow: matchedMessagesIn,
    remoteSettledMatchedMessagesOutOfWindow: matchedMessagesOut,
    remoteSettledUnmatchedMessages: unmatchedMessages,
  };
}

function classify(
  remote: ProviderReconciliationRemoteCompare["remote"],
  match: ProviderReconciliationRemoteCompare["match"],
  local: LocalReconciliationCompareSnapshot
): ProviderReconciliationRemoteCompare["evidence"] {
  if (remote.fetchStatus !== "ok") {
    return {
      ledgerIdsAbsentInWindow: local.ledgerInWindow.withProviderRequestId === 0,
      backgroundRowsExplainNoIdLedger: false,
      timezoneBoundaryCandidate: false,
      otherApiKeyCandidate: false,
      remoteOnlyCandidate: false,
      classification: RECONCILIATION_REMOTE_UNVERIFIED,
      confirmedMechanism: null,
      requiredToConfirm: REQUIRED_WHEN_UNVERIFIED,
    };
  }

  const ledgerIdsAbsentInWindow = local.ledgerInWindow.withProviderRequestId === 0;
  const backgroundRowsExplainNoIdLedger =
    local.ledgerInWindow.rows > 0 &&
    local.ledgerInWindow.backgroundWithoutProviderRequestId === local.ledgerInWindow.withoutProviderRequestId &&
    local.ledgerInWindow.withoutProviderRequestId === local.ledgerInWindow.rows;
  const timezoneBoundaryCandidate =
    remote.nearBoundary9h > 0 || local.messageNearBoundary9h > 0;
  const otherApiKeyCandidate = remote.distinctApiKeyIds > 1;
  const remoteOnlyCandidate =
    remote.settledCount > 0 &&
    match.remoteSettledMatchedLedgerAny === 0 &&
    match.remoteSettledMatchedMessagesInWindow === 0 &&
    match.remoteSettledMatchedMessagesOutOfWindow === 0;

  const confirmedLedgerIdsAbsent =
    remote.settledCount > 0 &&
    ledgerIdsAbsentInWindow &&
    match.remoteSettledMatchedLedgerAny === 0 &&
    !timezoneBoundaryCandidate;

  return {
    ledgerIdsAbsentInWindow,
    backgroundRowsExplainNoIdLedger,
    timezoneBoundaryCandidate,
    otherApiKeyCandidate,
    remoteOnlyCandidate,
    // Missing local ledger IDs is a proven linkage gap, NOT proof that the
    // remote spend originated from those local calls: external/workspace-only
    // requests can coexist. A root-cause verdict requires per-request provenance.
    classification: RECONCILIATION_ROOT_CAUSE_UNCONFIRMED,
    confirmedMechanism: confirmedLedgerIdsAbsent ? "LEDGER_REQUEST_IDS_ABSENT" : null,
    requiredToConfirm: REQUIRED_WHEN_UNVERIFIED,
  };
}

export async function compareProviderReconciliationRemote(
  db: Database.Database,
  monthKey: string,
  deps: RemoteCompareDeps = {}
): Promise<ProviderReconciliationRemoteCompare> {
  const local = loadLocalReconciliationCompareSnapshot(db, monthKey);
  const fetchRequests = deps.fetchRequests ?? fetchAllUsageRequests;
  const fetched = await fetchRequests({
    startAt: sqlDateTimeToIso(local.windowStart),
    endAt: sqlDateTimeToIso(local.windowEnd),
    maxPages: REMOTE_COMPARE_MAX_PAGES,
    fetchImpl: deps.fetchImpl,
  });

  let remote = emptyRemote("ok");
  let match: ProviderReconciliationRemoteCompare["match"] = {
    remoteSettledMatchedLedgerAny: 0,
    remoteSettledMatchedLedgerInWindow: 0,
    remoteSettledUnmatchedLedger: 0,
    remoteSettledMatchedMessagesInWindow: 0,
    remoteSettledMatchedMessagesOutOfWindow: 0,
    remoteSettledUnmatchedMessages: 0,
  };

  if (!fetched.ok) {
    switch (fetched.reason) {
      case "no_key":
        remote = emptyRemote("no_key");
        break;
      case "http":
        remote = emptyRemote("http");
        remote.httpStatus = fetched.status ?? null;
        break;
      case "schema":
        remote = emptyRemote("schema");
        break;
      case "network":
        remote = emptyRemote("network");
        break;
      case "incomplete":
        remote = emptyRemote("incomplete");
        break;
      default: {
        const exhaustive: never = fetched.reason;
        throw new Error(`unexpected usage fetch reason: ${exhaustive}`);
      }
    }
  } else {
    remote = summarizeRemote(
      fetched.value.requests,
      fetched.value.pages,
      local.windowStart,
      local.windowEnd
    );
    match = matchRemote(fetched.value.requests, local);
  }

  const result: ProviderReconciliationRemoteCompare = {
    monthKey,
    windowStart: local.windowStart,
    windowEnd: local.windowEnd,
    windowSemantics: "naive_calendar_month_treated_as_utc",
    remote,
    match,
    localLedgerInWindow: local.ledgerInWindow,
    evidence: classify(remote, match, local),
  };
  assertReconciliationDiagnosisSafePayload(result);
  return result;
}
