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
import {
  buildForwardReconAudit,
  markForwardReconFetchFailure,
  parseProvenObservedSince,
  resolveForwardObservationBaseline,
  type ForwardReconAudit,
} from "@/lib/forwardReconAudit";
import { readProviderReconciliationState } from "@/lib/providerCostReconciliation";

/**
 * Opt-in read-only remote compare for
 * GET /api/admin/finance?diagnose=reconciliation-remote.
 * Reuses fetchAllUsageRequests. Never writes the ledger, never runs reconcile,
 * never issues a paid generation. Returns aggregates only.
 */

export const RECONCILIATION_REMOTE_COMPARE_VALUE = "reconciliation-remote";
export const RECONCILIATION_REMOTE_KEY_GROUPS_PARAM = "keyGroups";
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
  /**
   * Present only when keyGroups=1 is explicitly requested.
   * Groups are anonymous ordinals. No API key id or name.
   */
  apiKeyGroups?: AnonymousApiKeyGroups;
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
  /** New observation window only. Month-wide remote/match totals stay historical. */
  forwardAudit: ForwardReconAudit;
};

const REQUIRED_WHEN_UNVERIFIED = [
  "Existing CHEAPER_INFERENCE_API_KEY must have usage:read for GET /usage/requests.",
  "Re-run admin GET /api/admin/finance?diagnose=reconciliation-remote&month=<KST YYYY-MM> after the fetch completes without a page cap or HTTP error.",
  "Do not POST /api/admin/finance/reconcile and do not issue paid generations.",
] as const;

const REQUIRED_TO_PROVE_CAUSATION = [
  "Correlate unmatched settled request identities with their authorized workspace origin and exact local producer path without exporting raw IDs.",
  "Confirm on an affected call whether the provider supplied a request ID and whether its canonical ledger writer persisted it.",
  "Keep incomplete/external-only usage separate from local costs; do not insert additional ledger rows or POST reconciliation.",
] as const;

export type AnonymousApiKeyGroup = {
  ordinal: number;
  settledCount: number;
  settledMicroUsd: number;
  byModel: Record<string, number>;
  byEndpoint: Record<string, number>;
};

export type AnonymousApiKeyGroups = {
  groups: AnonymousApiKeyGroup[];
  ungroupedSettledCount: number;
  ungroupedSettledMicroUsd: number;
  groupsSettledCount: number;
  groupsSettledMicroUsd: number;
  totalsMatchRemoteSettled: boolean;
  keyIdValueKinds: {
    string: number;
    number: number;
    missing: number;
  };
  productionKeyMapping: "unavailable";
};

type RemoteCompareDeps = {
  fetchRequests?: typeof fetchAllUsageRequests;
  fetchImpl?: UsageFetcher;
  includeKeyGroups?: boolean;
  observedSinceEnv?: string | null;
  now?: () => number;
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

function increment(bucket: Record<string, number>, raw: string | null): void {
  const trimmed = (raw ?? "").trim();
  const key =
    !trimmed
      ? "(null)"
      : trimmed.length > 64 ||
          /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.test(
            trimmed
          )
        ? "(other)"
        : trimmed;
  bucket[key] = (bucket[key] ?? 0) + 1;
}

function buildAnonymousApiKeyGroups(
  requests: CheaperInferenceUsageRequest[],
  settledMicroUsd: number,
  settledCount: number
): AnonymousApiKeyGroups {
  const byKey = new Map<
    string,
    { settledCount: number; settledMicroUsd: number; byModel: Record<string, number>; byEndpoint: Record<string, number> }
  >();
  let ungroupedSettledCount = 0;
  let ungroupedSettledMicroUsd = 0;
  const keyIdValueKinds = { string: 0, number: 0, missing: 0 };
  for (const request of requests) {
    const rawId = request.apiKeyId;
    if (rawId == null || String(rawId).trim() === "") keyIdValueKinds.missing += 1;
    else if (/^\d+$/.test(String(rawId).trim())) keyIdValueKinds.number += 1;
    else keyIdValueKinds.string += 1;
    if (!request.settled || request.billedMicroUsd <= 0) continue;
    const keyId = request.apiKeyId?.trim() || "";
    if (!keyId) {
      ungroupedSettledCount += 1;
      ungroupedSettledMicroUsd += request.billedMicroUsd;
      continue;
    }
    const entry = byKey.get(keyId) ?? {
      settledCount: 0,
      settledMicroUsd: 0,
      byModel: {},
      byEndpoint: {},
    };
    entry.settledCount += 1;
    entry.settledMicroUsd += request.billedMicroUsd;
    increment(entry.byModel, request.model);
    increment(entry.byEndpoint, request.endpoint);
    byKey.set(keyId, entry);
  }
  const groups = [...byKey.values()]
    .sort((a, b) => b.settledMicroUsd - a.settledMicroUsd || b.settledCount - a.settledCount)
    .map((entry, index) => ({
      ordinal: index + 1,
      settledCount: entry.settledCount,
      settledMicroUsd: entry.settledMicroUsd,
      byModel: entry.byModel,
      byEndpoint: entry.byEndpoint,
    }));
  const groupsSettledCount = groups.reduce((sum, row) => sum + row.settledCount, 0);
  const groupsSettledMicroUsd = groups.reduce((sum, row) => sum + row.settledMicroUsd, 0);
  return {
    groups,
    ungroupedSettledCount,
    ungroupedSettledMicroUsd,
    groupsSettledCount,
    groupsSettledMicroUsd,
    totalsMatchRemoteSettled:
      groupsSettledCount + ungroupedSettledCount === settledCount &&
      groupsSettledMicroUsd + ungroupedSettledMicroUsd === settledMicroUsd,
    keyIdValueKinds,
    productionKeyMapping: "unavailable",
  };
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
    local.ledgerInWindow.rows > 0 &&
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
    requiredToConfirm: REQUIRED_TO_PROVE_CAUSATION,
  };
}

export async function compareProviderReconciliationRemote(
  db: Database.Database,
  monthKey: string,
  deps: RemoteCompareDeps = {}
): Promise<ProviderReconciliationRemoteCompare> {
  const local = loadLocalReconciliationCompareSnapshot(db, monthKey);
  const fetchRequests = deps.fetchRequests ?? fetchAllUsageRequests;
  // The shared usage client caps each request at 15s; add a single 30s
  // deadline across ALL pages so an admin diagnostic cannot occupy a server
  // worker for 8 x 15s while the upstream is slow.
  const deadlineMs = Date.now() + 30_000;
  const baseFetch = deps.fetchImpl ?? fetch;
  const boundedFetch: UsageFetcher = (input, init) => {
    const remainingMs = deadlineMs - Date.now();
    if (remainingMs <= 0) return Promise.reject(new Error("remote_compare_deadline_exceeded"));
    const budgetSignal = AbortSignal.timeout(remainingMs);
    const signal = init?.signal
      ? AbortSignal.any([init.signal, budgetSignal])
      : budgetSignal;
    return baseFetch(input, { ...init, signal });
  };
  const fetched = await fetchRequests({
    startAt: sqlDateTimeToIso(local.windowStart),
    endAt: sqlDateTimeToIso(local.windowEnd),
    maxPages: REMOTE_COMPARE_MAX_PAGES,
    fetchImpl: boundedFetch,
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
    // A failed/incomplete remote read has no verifiable group totals.
    // Never display a misleading 0=0 reconciliation success on error.
    ...(deps.includeKeyGroups && fetched.ok
      ? {
          apiKeyGroups: buildAnonymousApiKeyGroups(
            fetched.value.requests,
            remote.settledMicroUsd,
            remote.settledCount
          ),
        }
      : {}),
    evidence: classify(remote, match, local),
    forwardAudit: buildRemoteForwardAudit(
      db,
      fetched.ok ? fetched.value.requests : [],
      local.ledgerIdsAny,
      fetched.ok ? "ok" : fetched.reason,
      deps
    ),
  };
  assertReconciliationDiagnosisSafePayload(result);
  return result;
}

function buildRemoteForwardAudit(
  db: Database.Database,
  requests: CheaperInferenceUsageRequest[],
  ledgerIds: ReadonlySet<string>,
  fetchStatus: ForwardReconAudit["fetchStatus"],
  deps: RemoteCompareDeps
): ForwardReconAudit {
  const stored = readProviderReconciliationState(db)?.forwardAudit ?? null;
  const envValue =
    deps.observedSinceEnv !== undefined
      ? deps.observedSinceEnv
      : process.env.HAV_FORWARD_RECON_OBSERVED_SINCE;
  if (fetchStatus !== "ok") {
    const proven = parseProvenObservedSince(envValue);
    const seed =
      stored ??
      (proven
        ? buildForwardReconAudit({
            requests: [],
            ledgerIds: new Set(),
            observedSince: proven,
            observationSource: "proven_rotation_env",
            fetchStatus: "ok",
          })
        : null);
    return markForwardReconFetchFailure(
      seed,
      fetchStatus === "not_run" ? "network" : fetchStatus
    );
  }
  const baseline = resolveForwardObservationBaseline({
    envValue,
    storedObservedSince: stored?.observedSince ?? null,
    nowIso: new Date((deps.now ?? Date.now)()).toISOString(),
    allowUnpersisted: stored?.observedSince == null,
  });
  return buildForwardReconAudit({
    requests,
    ledgerIds,
    observedSince: baseline.observedSince,
    observationSource: baseline.source,
    fetchStatus: "ok",
  });
}
