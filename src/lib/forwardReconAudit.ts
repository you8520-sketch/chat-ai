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
  | "fetch_failure"
  | "unverifiable_timestamp"
  | "invalid_observed_since_env";

export type ForwardVerificationStatus =
  | "verified"
  | "unverified"
  | "config_invalid"
  | "fetch_failed";

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
  /**
   * Transport success is `fetchStatus`. This is whether the forward window
   * itself can be classified. Missing timestamps or an invalid cutoff are
   * unverified, not a fictitious zero-new-calls success.
   */
  verificationStatus: ForwardVerificationStatus;
  requestCount: number;
  settledCount: number;
  pendingCount: number;
  matchedLedgerCount: number;
  unmatchedLedgerCount: number;
  settledMicroUsd: number;
  matchedSettledMicroUsd: number;
  unmatchedSettledMicroUsd: number;
  unverifiableTimestampCount: number;
  unverifiableSettledCount: number;
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

const EXPLICIT_ZONE_ISO_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})$/;
const USAGE_CLIENT_UTC_SQL_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

export function inspectObservedSinceEnv(
  raw: string | null | undefined
): { kind: "unset" } | { kind: "valid"; iso: string } | { kind: "invalid" } {
  if (raw == null || raw.trim() === "") return { kind: "unset" };
  const iso = parseProvenObservedSince(raw);
  return iso ? { kind: "valid", iso } : { kind: "invalid" };
}

export function parseProvenObservedSince(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return null;
  if (!EXPLICIT_ZONE_ISO_RE.test(trimmed)) return null;
  const ms = Date.parse(trimmed);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

export function sqlOrIsoToUtcMs(value: string | null | undefined): number | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  if (USAGE_CLIENT_UTC_SQL_RE.test(trimmed)) {
    const ms = Date.parse(`${trimmed.replace(" ", "T")}Z`);
    return Number.isFinite(ms) ? ms : null;
  }
  if (EXPLICIT_ZONE_ISO_RE.test(trimmed)) {
    const ms = Date.parse(trimmed);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

export function resolveForwardObservationBaseline(input: {
  envValue?: string | null;
  storedObservedSince?: string | null;
  nowIso: string;
  allowUnpersisted?: boolean;
}): {
  observedSince: string | null;
  source: ForwardObservationSource | null;
  persist: boolean;
  configInvalid: boolean;
} {
  const env = inspectObservedSinceEnv(input.envValue);
  if (env.kind === "invalid") {
    return { observedSince: null, source: null, persist: false, configInvalid: true };
  }
  if (env.kind === "valid") {
    return {
      observedSince: env.iso,
      source: "proven_rotation_env",
      persist: true,
      configInvalid: false,
    };
  }
  const stored = parseProvenObservedSince(input.storedObservedSince);
  if (stored) {
    return {
      observedSince: stored,
      source: "stored_watermark",
      persist: false,
      configInvalid: false,
    };
  }
  if (input.allowUnpersisted) {
    return {
      observedSince: input.nowIso,
      source: "this_query_unpersisted",
      persist: false,
      configInvalid: false,
    };
  }
  return {
    observedSince: input.nowIso,
    source: "first_successful_query",
    persist: true,
    configInvalid: false,
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

export function configInvalidObservationNote(): string {
  return "HAV_FORWARD_RECON_OBSERVED_SINCE is set but is not an explicit UTC or offset ISO-8601 instant. The forward window is unverified; no substitute baseline was chosen.";
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
  observationSource: ForwardObservationSource | null,
  opts?: { configInvalid?: boolean }
): ForwardReconAudit {
  if (opts?.configInvalid) {
    return {
      observedSince,
      observationSource,
      observationNote: configInvalidObservationNote(),
      fetchStatus,
      verificationStatus: "config_invalid",
      requestCount: 0,
      settledCount: 0,
      pendingCount: 0,
      matchedLedgerCount: 0,
      unmatchedLedgerCount: 0,
      settledMicroUsd: 0,
      matchedSettledMicroUsd: 0,
      unmatchedSettledMicroUsd: 0,
      unverifiableTimestampCount: 0,
      unverifiableSettledCount: 0,
      byModel: {},
      distinctApiKeyIds: 0,
      otherApiKeyCandidate: false,
      havExclusiveCostConfirmed: false,
      productionKeyMapping: "unavailable",
      cases: ["invalid_observed_since_env"],
    };
  }
  const fetchFailed = fetchStatus !== "ok";
  const cases: ForwardReconCase[] = fetchFailed ? ["fetch_failure"] : ["zero_new_calls"];
  return {
    observedSince,
    observationSource,
    observationNote: observationNoteFor(observationSource),
    fetchStatus,
    verificationStatus: fetchFailed ? "fetch_failed" : "verified",
    requestCount: 0,
    settledCount: 0,
    pendingCount: 0,
    matchedLedgerCount: 0,
    unmatchedLedgerCount: 0,
    settledMicroUsd: 0,
    matchedSettledMicroUsd: 0,
    unmatchedSettledMicroUsd: 0,
    unverifiableTimestampCount: 0,
    unverifiableSettledCount: 0,
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
  configInvalid?: boolean;
}): ForwardReconAudit {
  if (input.configInvalid) {
    return emptyAudit(input.fetchStatus, input.observedSince, input.observationSource, {
      configInvalid: true,
    });
  }
  if (input.fetchStatus !== "ok" || !input.observedSince) {
    return emptyAudit(input.fetchStatus, input.observedSince, input.observationSource);
  }

  const sinceMs = sqlOrIsoToUtcMs(input.observedSince);
  if (sinceMs == null) {
    return emptyAudit(input.fetchStatus, input.observedSince, input.observationSource, {
      configInvalid: true,
    });
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
  let unverifiableTimestampCount = 0;
  let unverifiableSettledCount = 0;

  for (const request of input.requests) {
    const createdMs = sqlOrIsoToUtcMs(request.createdAt);
    if (createdMs == null) {
      unverifiableTimestampCount += 1;
      if (request.settled && request.billedMicroUsd > 0) unverifiableSettledCount += 1;
      continue;
    }
    if (createdMs < sinceMs) continue;
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
  if (unverifiableTimestampCount > 0) cases.push("unverifiable_timestamp");
  if (requestCount === 0 && unverifiableTimestampCount === 0) cases.push("zero_new_calls");
  if (matchedLuna > 0) cases.push("matched_luna");
  if (unmatchedLuna > 0) cases.push("unmatched_luna");
  if (apiKeys.size > 1) cases.push("other_key");
  if (pendingCount > 0) cases.push("pending_settlement");

  return {
    observedSince: input.observedSince,
    observationSource: input.observationSource,
    observationNote: observationNoteFor(input.observationSource),
    fetchStatus: "ok",
    verificationStatus: unverifiableTimestampCount > 0 ? "unverified" : "verified",
    requestCount,
    settledCount,
    pendingCount,
    matchedLedgerCount,
    unmatchedLedgerCount,
    settledMicroUsd,
    matchedSettledMicroUsd,
    unmatchedSettledMicroUsd,
    unverifiableTimestampCount,
    unverifiableSettledCount,
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
    verificationStatus: "fetch_failed",
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

const VERIFICATION_STATUSES = new Set<ForwardVerificationStatus>([
  "verified",
  "unverified",
  "config_invalid",
  "fetch_failed",
]);

const FORWARD_CASES = new Set<ForwardReconCase>([
  "zero_new_calls",
  "matched_luna",
  "unmatched_luna",
  "other_key",
  "pending_settlement",
  "fetch_failure",
  "unverifiable_timestamp",
  "invalid_observed_since_env",
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
    ? row.cases.filter((item): item is ForwardReconCase => FORWARD_CASES.has(item as ForwardReconCase))
    : [];
  const verificationStatus = VERIFICATION_STATUSES.has(row.verificationStatus as ForwardVerificationStatus)
    ? (row.verificationStatus as ForwardVerificationStatus)
    : fetchStatus !== "ok"
      ? "fetch_failed"
      : cases.includes("invalid_observed_since_env")
        ? "config_invalid"
        : cases.includes("unverifiable_timestamp")
          ? "unverified"
          : "verified";
  return {
    observedSince,
    observationSource: source,
    observationNote:
      typeof row.observationNote === "string" && row.observationNote.trim()
        ? row.observationNote
        : verificationStatus === "config_invalid"
          ? configInvalidObservationNote()
          : observationNoteFor(source),
    fetchStatus,
    verificationStatus,
    requestCount: finiteInt(row.requestCount),
    settledCount: finiteInt(row.settledCount),
    pendingCount: finiteInt(row.pendingCount),
    matchedLedgerCount: finiteInt(row.matchedLedgerCount),
    unmatchedLedgerCount: finiteInt(row.unmatchedLedgerCount),
    settledMicroUsd: finiteInt(row.settledMicroUsd),
    matchedSettledMicroUsd: finiteInt(row.matchedSettledMicroUsd),
    unmatchedSettledMicroUsd: finiteInt(row.unmatchedSettledMicroUsd),
    unverifiableTimestampCount: finiteInt(row.unverifiableTimestampCount),
    unverifiableSettledCount: finiteInt(row.unverifiableSettledCount),
    byModel,
    distinctApiKeyIds: finiteInt(row.distinctApiKeyIds),
    otherApiKeyCandidate: row.otherApiKeyCandidate === true,
    havExclusiveCostConfirmed: false,
    productionKeyMapping: "unavailable",
    cases,
  };
}
