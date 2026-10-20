import type { CheaperInferenceUsageRequest } from "@/lib/cheaperInferenceUsage";
import { hashForwardRequestId } from "./forwardReconEvidence";

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

/**
 * Production scope is proven only by an exact usage request-id intersection
 * with the local ledger. Key names are not evidence. "unavailable" is not a
 * clearance, and this is never the string "available".
 */
export type ProductionKeyMappingStatus = "unavailable" | "ledger_intersection" | "unmapped";

/** Settled calls on keys proven by ledger request-id intersection. */
export type ForwardProductionScope = {
  /** False on stored snapshots that predate this classification. */
  known: boolean;
  provenKeyCount: number;
  settledCount: number;
  settledMicroUsd: number;
  matchedLedgerCount: number;
  unmatchedLedgerCount: number;
  unmatchedSettledMicroUsd: number;
  unmatchedFirstAt: string | null;
  unmatchedLastAt: string | null;
  byModel: Record<string, ForwardModelAudit>;
};

/**
 * Usage that cannot be placed on a production key. Purpose stays unproven —
 * never an approved-test label. Counts are separate from production misses
 * and from the workspace totals above.
 */
export type ForwardUndeterminedUsage = {
  settledCount: number;
  settledMicroUsd: number;
  keyCount: number;
  missingKeyIdSettledCount: number;
  missingKeyIdSettledMicroUsd: number;
  firstAt: string | null;
  lastAt: string | null;
  purpose: "unproven";
};

/** Request witnesses for review only; no key material or second cost ledger. */
export type ForwardUnmatchedRequest = {
  requestHash: string;
  model: string;
  billedMicroUsd: number;
  createdAt: string;
  scope: "production" | "undetermined";
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
  /** Workspace totals. Not a production-miss count. */
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
  productionKeyMapping: ProductionKeyMappingStatus;
  productionScope: ForwardProductionScope;
  undeterminedUsage: ForwardUndeterminedUsage;
  cases: ForwardReconCase[];
  /** Missing on old aggregate-only snapshots. Missing never means zero. */
  unmatchedRequests?: ForwardUnmatchedRequest[];
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

function blankProductionScope(known: boolean): ForwardProductionScope {
  return {
    known,
    provenKeyCount: 0,
    settledCount: 0,
    settledMicroUsd: 0,
    matchedLedgerCount: 0,
    unmatchedLedgerCount: 0,
    unmatchedSettledMicroUsd: 0,
    unmatchedFirstAt: null,
    unmatchedLastAt: null,
    byModel: {},
  };
}

function blankUndeterminedUsage(): ForwardUndeterminedUsage {
  return {
    settledCount: 0,
    settledMicroUsd: 0,
    keyCount: 0,
    missingKeyIdSettledCount: 0,
    missingKeyIdSettledMicroUsd: 0,
    firstAt: null,
    lastAt: null,
    purpose: "unproven",
  };
}

function isoFromUsageTime(value: string | null | undefined): string | null {
  const ms = sqlOrIsoToUtcMs(value);
  return ms == null ? null : new Date(ms).toISOString();
}

function earlierIso(current: string | null, next: string | null): string | null {
  if (!next) return current;
  if (!current) return next;
  return next < current ? next : current;
}

function laterIso(current: string | null, next: string | null): string | null {
  if (!next) return current;
  if (!current) return next;
  return next > current ? next : current;
}

/**
 * A key id is production-proven only when at least one usage request id on
 * that key is already in the local ledger. The returned set is internal;
 * callers persist the count, never the ids.
 */
export function proveProductionKeyIds(
  requests: readonly { requestId: string; apiKeyId?: string | null }[],
  ledgerIds: ReadonlySet<string>
): Set<string> {
  const proven = new Set<string>();
  for (const request of requests) {
    const keyId = request.apiKeyId?.trim() ?? "";
    if (!keyId) continue;
    if (!ledgerIds.has(request.requestId)) continue;
    proven.add(keyId);
  }
  return proven;
}

export function mappingForProvenKeys(
  provenKeyCount: number,
  settledCount: number
): ProductionKeyMappingStatus {
  if (provenKeyCount > 0) return "ledger_intersection";
  if (settledCount > 0) return "unmapped";
  return "unavailable";
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
      productionScope: blankProductionScope(true),
      undeterminedUsage: blankUndeterminedUsage(),
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
    productionScope: blankProductionScope(true),
    undeterminedUsage: blankUndeterminedUsage(),
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

  const provenKeys = proveProductionKeyIds(input.requests, input.ledgerIds);
  const apiKeys = new Set<string>();
  const byModel: Record<string, ForwardModelAudit> = {};
  const productionByModel: Record<string, ForwardModelAudit> = {};
  const seen = new Set<string>();
  const undeterminedKeys = new Set<string>();
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
  const productionScope = blankProductionScope(true);
  productionScope.provenKeyCount = provenKeys.size;
  const undeterminedUsage = blankUndeterminedUsage();
  const unmatchedRequests: ForwardUnmatchedRequest[] = [];

  for (const request of input.requests) {
    const createdMs = sqlOrIsoToUtcMs(request.createdAt);
    if (createdMs == null) {
      unverifiableTimestampCount += 1;
      if (request.settled && request.billedMicroUsd > 0) unverifiableSettledCount += 1;
      continue;
    }
    if (createdMs < sinceMs) continue;
    requestCount += 1;
    const keyId = request.apiKeyId?.trim() ?? "";
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

    const productionKey = keyId !== "" && provenKeys.has(keyId);
    const linked = input.ledgerIds.has(request.requestId);
    if (productionKey) {
      productionScope.settledCount += 1;
      productionScope.settledMicroUsd += request.billedMicroUsd;
      const productionBucket = productionByModel[modelKey] ?? {
        settledCount: 0,
        unmatchedCount: 0,
        settledMicroUsd: 0,
        unmatchedMicroUsd: 0,
      };
      productionBucket.settledCount += 1;
      productionBucket.settledMicroUsd += request.billedMicroUsd;
      productionByModel[modelKey] = productionBucket;
    }
    if (linked) {
      matchedLedgerCount += 1;
      matchedSettledMicroUsd += request.billedMicroUsd;
      if (isLunaUsageModel(request.model)) matchedLuna += 1;
      if (productionKey) productionScope.matchedLedgerCount += 1;
    } else {
      unmatchedLedgerCount += 1;
      unmatchedSettledMicroUsd += request.billedMicroUsd;
      bucket.unmatchedCount += 1;
      bucket.unmatchedMicroUsd += request.billedMicroUsd;
      if (isLunaUsageModel(request.model)) unmatchedLuna += 1;
      const occurredAt = isoFromUsageTime(request.createdAt);
      unmatchedRequests.push({
        requestHash: hashForwardRequestId(request.requestId),
        model: modelKey,
        billedMicroUsd: request.billedMicroUsd,
        createdAt: occurredAt!,
        scope: productionKey ? "production" : "undetermined",
      });
      if (productionKey) {
        productionScope.unmatchedLedgerCount += 1;
        productionScope.unmatchedSettledMicroUsd += request.billedMicroUsd;
        productionScope.unmatchedFirstAt = earlierIso(productionScope.unmatchedFirstAt, occurredAt);
        productionScope.unmatchedLastAt = laterIso(productionScope.unmatchedLastAt, occurredAt);
        const productionBucket = productionByModel[modelKey];
        if (productionBucket) {
          productionBucket.unmatchedCount += 1;
          productionBucket.unmatchedMicroUsd += request.billedMicroUsd;
        }
      } else if (!keyId) {
        undeterminedUsage.missingKeyIdSettledCount += 1;
        undeterminedUsage.missingKeyIdSettledMicroUsd += request.billedMicroUsd;
        undeterminedUsage.firstAt = earlierIso(undeterminedUsage.firstAt, occurredAt);
        undeterminedUsage.lastAt = laterIso(undeterminedUsage.lastAt, occurredAt);
      } else {
        undeterminedKeys.add(keyId);
        undeterminedUsage.settledCount += 1;
        undeterminedUsage.settledMicroUsd += request.billedMicroUsd;
        undeterminedUsage.firstAt = earlierIso(undeterminedUsage.firstAt, occurredAt);
        undeterminedUsage.lastAt = laterIso(undeterminedUsage.lastAt, occurredAt);
      }
    }
    byModel[modelKey] = bucket;
  }
  productionScope.byModel = productionByModel;
  undeterminedUsage.keyCount = undeterminedKeys.size;

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
    productionKeyMapping: mappingForProvenKeys(provenKeys.size, settledCount),
    productionScope,
    undeterminedUsage,
    unmatchedRequests,
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

const PRODUCTION_KEY_MAPPINGS = new Set<ProductionKeyMappingStatus>([
  "unavailable",
  "ledger_intersection",
  "unmapped",
]);

function parseModelAudits(raw: unknown): Record<string, ForwardModelAudit> {
  const byModel: Record<string, ForwardModelAudit> = {};
  if (!raw || typeof raw !== "object") return byModel;
  for (const [key, bucket] of Object.entries(raw as Record<string, unknown>)) {
    if (!bucket || typeof bucket !== "object") continue;
    const entry = bucket as Record<string, unknown>;
    byModel[sanitizeModelKey(key)] = {
      settledCount: finiteInt(entry.settledCount),
      unmatchedCount: finiteInt(entry.unmatchedCount),
      settledMicroUsd: finiteInt(entry.settledMicroUsd),
      unmatchedMicroUsd: finiteInt(entry.unmatchedMicroUsd),
    };
  }
  return byModel;
}

function parseIsoInstant(value: unknown): string | null {
  return typeof value === "string" ? parseProvenObservedSince(value) : null;
}

/**
 * Old snapshots and any payload that does not carry a consistent
 * ledger-intersection classification stay unknown. A mapping string alone
 * is not proof, and a stored "available" or name is ignored.
 */
function parseStoredProductionClassification(row: Record<string, unknown>): {
  productionKeyMapping: ProductionKeyMappingStatus;
  productionScope: ForwardProductionScope;
  undeterminedUsage: ForwardUndeterminedUsage;
} {
  const unavailable = {
    productionKeyMapping: "unavailable" as const,
    productionScope: blankProductionScope(false),
    undeterminedUsage: blankUndeterminedUsage(),
  };
  const scopeRaw = row.productionScope;
  const undeterminedRaw = row.undeterminedUsage;
  if (!scopeRaw || typeof scopeRaw !== "object") return unavailable;
  if (!undeterminedRaw || typeof undeterminedRaw !== "object") return unavailable;
  const scope = scopeRaw as Record<string, unknown>;
  const undetermined = undeterminedRaw as Record<string, unknown>;
  if (scope.known !== true) return unavailable;
  if (undetermined.purpose !== "unproven") return unavailable;
  const mapping = row.productionKeyMapping;
  if (typeof mapping !== "string" || !PRODUCTION_KEY_MAPPINGS.has(mapping as ProductionKeyMappingStatus)) {
    return unavailable;
  }
  const provenKeyCount = finiteInt(scope.provenKeyCount);
  if (mapping === "ledger_intersection" && provenKeyCount <= 0) return unavailable;
  if (mapping !== "ledger_intersection" && provenKeyCount > 0) return unavailable;
  return {
    productionKeyMapping: mapping as ProductionKeyMappingStatus,
    productionScope: {
      known: true,
      provenKeyCount,
      settledCount: finiteInt(scope.settledCount),
      settledMicroUsd: finiteInt(scope.settledMicroUsd),
      matchedLedgerCount: finiteInt(scope.matchedLedgerCount),
      unmatchedLedgerCount: finiteInt(scope.unmatchedLedgerCount),
      unmatchedSettledMicroUsd: finiteInt(scope.unmatchedSettledMicroUsd),
      unmatchedFirstAt: parseIsoInstant(scope.unmatchedFirstAt),
      unmatchedLastAt: parseIsoInstant(scope.unmatchedLastAt),
      byModel: parseModelAudits(scope.byModel),
    },
    undeterminedUsage: {
      settledCount: finiteInt(undetermined.settledCount),
      settledMicroUsd: finiteInt(undetermined.settledMicroUsd),
      keyCount: finiteInt(undetermined.keyCount),
      missingKeyIdSettledCount: finiteInt(undetermined.missingKeyIdSettledCount),
      missingKeyIdSettledMicroUsd: finiteInt(undetermined.missingKeyIdSettledMicroUsd),
      firstAt: parseIsoInstant(undetermined.firstAt),
      lastAt: parseIsoInstant(undetermined.lastAt),
      purpose: "unproven",
    },
  };
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
  const byModel = parseModelAudits(row.byModel);
  const classification = parseStoredProductionClassification(row);
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
    productionKeyMapping: classification.productionKeyMapping,
    productionScope: classification.productionScope,
    undeterminedUsage: classification.undeterminedUsage,
    unmatchedRequests: Array.isArray(row.unmatchedRequests)
      ? row.unmatchedRequests as ForwardUnmatchedRequest[]
      : undefined,
    cases,
  };
}
