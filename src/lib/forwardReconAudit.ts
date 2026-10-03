import type { CheaperInferenceUsageRequest } from "@/lib/cheaperInferenceUsage";

/**
 * Forward-only CheaperInference usage audit after API-key rotation.
 * Slices already-fetched usage. Not a second fetcher, scheduler, or cost ledger.
 */

export const FORWARD_RECON_OBSERVED_SINCE_ENV = "HAV_FORWARD_RECON_OBSERVED_SINCE";

export const LUNA_USAGE_MODEL_IDS = ["gpt-5.6-luna", "gpt-6-luna"] as const;

export type ForwardObservationSource =
  | "proven_rotation_env"
  | "first_successful_query"
  | "stored_watermark"
  | "this_query_unpersisted";

export type ForwardReconCase =
  | "zero_new_calls"
  | "matched_luna"
  | "unmatched_luna"
  | "other_key"
  | "pending_settlement"
  | "fetch_failure";

export type ForwardReconFetchStatus =
  | "ok"
  | "no_key"
  | "http"
  | "schema"
  | "network"
  | "incomplete"
  | "not_run";

export type ForwardModelAudit = {
  settledCount: number;
  unmatchedCount: number;
  settledMicroUsd: number;
  unmatchedMicroUsd: number;
};

export type ForwardReconAudit = {
  observedSince: string | null;
  observationSource: ForwardObservationSource | null;
  observationNote: string;
  fetchStatus: ForwardReconFetchStatus;
  requestCount: number;
  settledCount: number;
  pendingCount: number;
  matchedLedgerCount: number;
  unmatchedLedgerCount: number;
  settledMicroUsd: number;
  matchedSettledMicroUsd: number;
  unmatchedSettledMicroUsd: number;
  byModel: Record<string, ForwardModelAudit>;
  distinctApiKeyIds: number;
  otherApiKeyCandidate: boolean;
  havExclusiveCostConfirmed: false;
  productionKeyMapping: "unavailable";
  cases: ForwardReconCase[];
};

const MODEL_UUID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;

export function isLunaUsageModel(model: string | null | undefined): boolean {
  const id = (model ?? "").trim().toLowerCase();
  return (LUNA_USAGE_MODEL_IDS as readonly string[]).includes(id);
}

export function parseProvenObservedSince(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return null;
  if (!/^\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}/.test(trimmed)) return null;
  const ms = Date.parse(trimmed);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

export function sqlOrIsoToUtcMs(value: string | null | undefined): number | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  const iso = trimmed.includes("T") ? trimmed : `${trimmed.replace(" ", "T")}Z`;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

export function resolveForwardObservationBaseline(input: {
  envValue?: string | null;
  storedObservedSince?: string | null;
  nowIso: string;
  allowUnpersisted?: boolean;
}): {
  observedSince: string;
  source: ForwardObservationSource;
  persist: boolean;
} {
  const proven = parseProvenObservedSince(input.envValue);
  if (proven) {
    return { observedSince: proven, source: "proven_rotation_env", persist: true };
  }
  const stored = parseProvenObservedSince(input.storedObservedSince);
  if (stored) {
    return { observedSince: stored, source: "stored_watermark", persist: false };
  }
  if (input.allowUnpersisted) {
    return {
      observedSince: input.nowIso,
      source: "this_query_unpersisted",
      persist: false,
    };
  }
  return {
    observedSince: input.nowIso,
    source: "first_successful_query",
    persist: true,
  };
}

export function observationNoteFor(source: ForwardObservationSource | null): string {
  switch (source) {
    case "proven_rotation_env":
      return "Observation baseline is the proven HAV_FORWARD_RECON_OBSERVED_SINCE UTC instant.";
    case "stored_watermark":
      return "Observation baseline is the stored first successful usage-query watermark. Key-rotation UTC remains unproven.";
    case "first_successful_query":
      return "Key-rotation UTC is unproven. Baseline is the first successful usage query after forward-only audit shipped.";
    case "this_query_unpersisted":
      return "Key-rotation UTC is unproven. This query time is a display-only baseline until the daily reconciler persists it.";
    case null:
      return "No forward observation baseline yet. Month-wide stored reconciliation is historical residue, not a new finding.";
    default: {
      const exhaustive: never = source;
      return exhaustive;
    }
  }
}

function sanitizeModelKey(raw: string | null): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "(null)";
  if (trimmed.length > 64 || MODEL_UUID_RE.test(trimmed)) return "(other)";
  return trimmed;
}

function emptyAudit(
  fetchStatus: ForwardReconFetchStatus,
  observedSince: string | null,
  observationSource: ForwardObservationSource | null
): ForwardReconAudit {
  const cases: ForwardReconCase[] =
    fetchStatus === "ok" ? ["zero_new_calls"] : ["fetch_failure"];
  return {
    observedSince,
    observationSource,
    observationNote: observationNoteFor(observationSource),
    fetchStatus,
    requestCount: 0,
    settledCount: 0,
    pendingCount: 0,
    matchedLedgerCount: 0,
    unmatchedLedgerCount: 0,
    settledMicroUsd: 0,
    matchedSettledMicroUsd: 0,
    unmatchedSettledMicroUsd: 0,
    byModel: {},
    distinctApiKeyIds: 0,
    otherApiKeyCandidate: false,
    havExclusiveCostConfirmed: false,
    productionKeyMapping: "unavailable",
    cases,
  };
}

export function buildForwardReconAudit(input: {
  requests: readonly CheaperInferenceUsageRequest[];
  ledgerIds: ReadonlySet<string>;
  observedSince: string | null;
  observationSource: ForwardObservationSource | null;
  fetchStatus: ForwardReconFetchStatus;
}): ForwardReconAudit {
  if (input.fetchStatus !== "ok" || !input.observedSince) {
    return emptyAudit(input.fetchStatus, input.observedSince, input.observationSource);
  }

  const sinceMs = sqlOrIsoToUtcMs(input.observedSince);
  if (sinceMs == null) {
    return emptyAudit(input.fetchStatus, input.observedSince, input.observationSource);
  }

  const apiKeys = new Set<string>();
  const byModel: Record<string, ForwardModelAudit> = {};
  const seen = new Set<string>();
  let requestCount = 0;
  let settledCount = 0;
  let pendingCount = 0;
  let matchedLedgerCount = 0;
  let unmatchedLedgerCount = 0;
  let settledMicroUsd = 0;
  let matchedSettledMicroUsd = 0;
  let unmatchedSettledMicroUsd = 0;
  let matchedLuna = 0;
  let unmatchedLuna = 0;

  for (const request of input.requests) {
    const createdMs = sqlOrIsoToUtcMs(request.createdAt);
    if (createdMs == null || createdMs < sinceMs) continue;
    requestCount += 1;
    const keyId = request.apiKeyId?.trim();
    if (keyId) apiKeys.add(keyId);

    if (!request.settled || request.billedMicroUsd <= 0) {
      pendingCount += 1;
      continue;
    }
    if (seen.has(request.requestId)) continue;
    seen.add(request.requestId);

    const modelKey = sanitizeModelKey(request.model);
    const bucket = byModel[modelKey] ?? {
      settledCount: 0,
      unmatchedCount: 0,
      settledMicroUsd: 0,
      unmatchedMicroUsd: 0,
    };
    bucket.settledCount += 1;
    bucket.settledMicroUsd += request.billedMicroUsd;
    settledCount += 1;
    settledMicroUsd += request.billedMicroUsd;

    const linked = input.ledgerIds.has(request.requestId);
    if (linked) {
      matchedLedgerCount += 1;
      matchedSettledMicroUsd += request.billedMicroUsd;
      if (isLunaUsageModel(request.model)) matchedLuna += 1;
    } else {
      unmatchedLedgerCount += 1;
      unmatchedSettledMicroUsd += request.billedMicroUsd;
      bucket.unmatchedCount += 1;
      bucket.unmatchedMicroUsd += request.billedMicroUsd;
      if (isLunaUsageModel(request.model)) unmatchedLuna += 1;
    }
    byModel[modelKey] = bucket;
  }

  const cases: ForwardReconCase[] = [];
  if (requestCount === 0) cases.push("zero_new_calls");
  if (matchedLuna > 0) cases.push("matched_luna");
  if (unmatchedLuna > 0) cases.push("unmatched_luna");
  if (apiKeys.size > 1) cases.push("other_key");
  if (pendingCount > 0) cases.push("pending_settlement");

  return {
    observedSince: input.observedSince,
    observationSource: input.observationSource,
    observationNote: observationNoteFor(input.observationSource),
    fetchStatus: "ok",
    requestCount,
    settledCount,
    pendingCount,
    matchedLedgerCount,
    unmatchedLedgerCount,
    settledMicroUsd,
    matchedSettledMicroUsd,
    unmatchedSettledMicroUsd,
    byModel,
    distinctApiKeyIds: apiKeys.size,
    otherApiKeyCandidate: apiKeys.size > 1,
    havExclusiveCostConfirmed: false,
    productionKeyMapping: "unavailable",
    cases,
  };
}

export function markForwardReconFetchFailure(
  previous: ForwardReconAudit | null,
  fetchStatus: Exclude<ForwardReconFetchStatus, "ok" | "not_run">
): ForwardReconAudit {
  if (!previous?.observedSince) {
    return emptyAudit(fetchStatus, null, null);
  }
  const cases = new Set<ForwardReconCase>(["fetch_failure"]);
  return {
    ...previous,
    fetchStatus,
    observationNote: previous.observationNote,
    havExclusiveCostConfirmed: false,
    productionKeyMapping: "unavailable",
    cases: [...cases],
  };
}

const FETCH_STATUSES = new Set<ForwardReconFetchStatus>([
  "ok",
  "no_key",
  "http",
  "schema",
  "network",
  "incomplete",
  "not_run",
]);

const OBSERVATION_SOURCES = new Set<ForwardObservationSource>([
  "proven_rotation_env",
  "first_successful_query",
  "stored_watermark",
  "this_query_unpersisted",
]);

function finiteInt(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function parseStoredForwardReconAudit(raw: unknown): ForwardReconAudit | null {
  if (raw == null) return null;
  let value: unknown = raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
      value = JSON.parse(trimmed) as unknown;
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const fetchStatus = FETCH_STATUSES.has(row.fetchStatus as ForwardReconFetchStatus)
    ? (row.fetchStatus as ForwardReconFetchStatus)
    : null;
  if (!fetchStatus) return null;
  const source =
    row.observationSource == null
      ? null
      : OBSERVATION_SOURCES.has(row.observationSource as ForwardObservationSource)
        ? (row.observationSource as ForwardObservationSource)
        : null;
  if (row.observationSource != null && source == null) return null;
  const observedSince =
    typeof row.observedSince === "string" ? parseProvenObservedSince(row.observedSince) : null;
  const byModel: Record<string, ForwardModelAudit> = {};
  if (row.byModel && typeof row.byModel === "object") {
    for (const [key, bucket] of Object.entries(row.byModel as Record<string, unknown>)) {
      if (!bucket || typeof bucket !== "object") continue;
      const entry = bucket as Record<string, unknown>;
      byModel[sanitizeModelKey(key)] = {
        settledCount: finiteInt(entry.settledCount),
        unmatchedCount: finiteInt(entry.unmatchedCount),
        settledMicroUsd: finiteInt(entry.settledMicroUsd),
        unmatchedMicroUsd: finiteInt(entry.unmatchedMicroUsd),
      };
    }
  }
  const cases = Array.isArray(row.cases)
    ? row.cases.filter((item): item is ForwardReconCase =>
        [
          "zero_new_calls",
          "matched_luna",
          "unmatched_luna",
          "other_key",
          "pending_settlement",
          "fetch_failure",
        ].includes(String(item))
      )
    : [];
  return {
    observedSince,
    observationSource: source,
    observationNote:
      typeof row.observationNote === "string" && row.observationNote.trim()
        ? row.observationNote
        : observationNoteFor(source),
    fetchStatus,
    requestCount: finiteInt(row.requestCount),
    settledCount: finiteInt(row.settledCount),
    pendingCount: finiteInt(row.pendingCount),
    matchedLedgerCount: finiteInt(row.matchedLedgerCount),
    unmatchedLedgerCount: finiteInt(row.unmatchedLedgerCount),
    settledMicroUsd: finiteInt(row.settledMicroUsd),
    matchedSettledMicroUsd: finiteInt(row.matchedSettledMicroUsd),
    unmatchedSettledMicroUsd: finiteInt(row.unmatchedSettledMicroUsd),
    byModel,
    distinctApiKeyIds: finiteInt(row.distinctApiKeyIds),
    otherApiKeyCandidate: row.otherApiKeyCandidate === true,
    havExclusiveCostConfirmed: false,
    productionKeyMapping: "unavailable",
    cases,
  };
}
