/**
 * Privacy-safe production observational telemetry for TurnBillableUsage canary.
 * Metadata only — no user/chat/request identifiers, text, economics, or raw errors.
 */
import type { UserBillableUsageCoverage } from "@/lib/billingUsage";
import type { StageUsage } from "@/lib/ai";
import {
  compareTurnBillableUsageWithLegacy,
  type LegacyTurnUsageBasis,
  type TurnUsageCanaryComparison,
} from "@/lib/turnBillableUsageCanary";
import {
  resolveTurnBillableUsage,
  type TurnBillableUsageResolution,
  type TurnUsageFieldSource,
} from "@/lib/turnBillableUsage";

export const TURN_BILLABLE_USAGE_CANARY_TELEMETRY_SCHEMA_VERSION = 1 as const;

export type TurnBillableUsageCanaryTelemetryStatus =
  | "match"
  | "mismatch"
  | "not_comparable"
  | "error";

export type TurnBillableUsageCanaryBucketSnapshot = {
  prompt: number;
  cacheRead: number;
  cacheWrite: number;
  completionBasis: number;
  reasoning: number;
  routeChargeOutput: number;
};

export type TurnBillableUsageCanaryFieldSources = {
  prompt: TurnUsageFieldSource;
  cacheRead: TurnUsageFieldSource;
  cacheWrite: TurnUsageFieldSource;
  completion: TurnUsageFieldSource;
  reasoning: TurnUsageFieldSource;
};

export type TurnBillableUsageCanaryTelemetry = {
  schemaVersion: typeof TURN_BILLABLE_USAGE_CANARY_TELEMETRY_SCHEMA_VERSION;
  status: TurnBillableUsageCanaryTelemetryStatus;
  modelId: string;
  provider: string;
  selectedStage: string | null;
  stageCount: number;
  billableStageCount: number;
  candidateStatus: "resolved" | "unavailable" | "error";
  usageCoverage: UserBillableUsageCoverage | "error";
  coverageReason: string;
  mismatchFields: string[];
  fieldSources?: TurnBillableUsageCanaryFieldSources;
  legacyBuckets?: TurnBillableUsageCanaryBucketSnapshot;
  candidateBuckets?: TurnBillableUsageCanaryBucketSnapshot;
  errorName?: string;
};

const ALLOWED_TELEMETRY_KEYS = [
  "schemaVersion",
  "status",
  "modelId",
  "provider",
  "selectedStage",
  "stageCount",
  "billableStageCount",
  "candidateStatus",
  "usageCoverage",
  "coverageReason",
  "mismatchFields",
  "fieldSources",
  "legacyBuckets",
  "candidateBuckets",
  "errorName",
] as const;

const FORBIDDEN_TELEMETRY_KEY_SUBSTRINGS = [
  "userId",
  "chatId",
  "requestId",
  "characterId",
  "prompt",
  "message",
  "text",
  "content",
  "memory",
  "persona",
  "cost",
  "points",
  "krw",
  "usd",
  "margin",
  "stack",
  "raw",
] as const;

const MAX_METADATA_STRING_LENGTH = 64;

function truncateMetadataString(value: string): string {
  return value.slice(0, MAX_METADATA_STRING_LENGTH);
}

function legacyBucketSnapshot(legacy: LegacyTurnUsageBasis): TurnBillableUsageCanaryBucketSnapshot {
  return {
    prompt: legacy.routeTotalInput,
    cacheRead: legacy.cacheReadTokens,
    cacheWrite: legacy.cacheWriteTokens,
    completionBasis: legacy.apiCompletionTotal,
    reasoning: legacy.reasoningTotal,
    routeChargeOutput: legacy.routeChargeOutput,
  };
}

function candidateBucketSnapshot(
  candidate: TurnBillableUsageResolution
): TurnBillableUsageCanaryBucketSnapshot | undefined {
  if (candidate.status !== "resolved" || !candidate.usage) return undefined;
  return {
    prompt: candidate.usage.promptTokens,
    cacheRead: candidate.usage.cacheReadTokens,
    cacheWrite: candidate.usage.cacheWriteTokens,
    completionBasis: candidate.diagnostics.apiCompletionTokensForCost,
    reasoning: candidate.usage.reasoningTokens,
    routeChargeOutput: candidate.diagnostics.routeChargeOutputTokens,
  };
}

function coverageReasonFromCandidate(candidate: TurnBillableUsageResolution): string {
  if (candidate.diagnostics.coverageReasons.length > 0) {
    return truncateMetadataString(candidate.diagnostics.coverageReasons.join(","));
  }
  if (candidate.status === "unavailable") return truncateMetadataString(candidate.reason);
  return "";
}

export function buildTurnBillableUsageCanaryTelemetry(opts: {
  modelId: string;
  provider: string;
  stageCount: number;
  billableStageCount: number;
  legacy: LegacyTurnUsageBasis;
  candidate: TurnBillableUsageResolution;
  comparison: TurnUsageCanaryComparison;
}): TurnBillableUsageCanaryTelemetry {
  const base = {
    schemaVersion: TURN_BILLABLE_USAGE_CANARY_TELEMETRY_SCHEMA_VERSION,
    modelId: opts.modelId,
    provider: opts.provider,
    selectedStage: opts.candidate.diagnostics.selectedStage,
    stageCount: opts.stageCount,
    billableStageCount: opts.billableStageCount,
    candidateStatus: opts.candidate.status,
    usageCoverage: opts.candidate.usageCoverage,
    coverageReason: coverageReasonFromCandidate(opts.candidate),
    fieldSources: opts.candidate.diagnostics.fieldSources,
  };

  switch (opts.comparison.status) {
    case "match":
      return {
        ...base,
        status: "match",
        mismatchFields: [],
      };
    case "mismatch":
      return {
        ...base,
        status: "mismatch",
        mismatchFields: [...opts.comparison.fields],
        legacyBuckets: legacyBucketSnapshot(opts.legacy),
        candidateBuckets: candidateBucketSnapshot(opts.candidate),
      };
    case "not_comparable":
      return {
        ...base,
        status: "not_comparable",
        mismatchFields: [],
        coverageReason: truncateMetadataString(
          opts.comparison.reason || base.coverageReason
        ),
        candidateStatus: opts.comparison.candidateStatus,
        usageCoverage: opts.comparison.usageCoverage,
      };
    default: {
      const _exhaustive: never = opts.comparison;
      return _exhaustive;
    }
  }
}

export function buildTurnBillableUsageCanaryErrorTelemetry(opts: {
  modelId: string;
  provider: string;
  stageCount: number;
  billableStageCount: number;
  errorName: string;
}): TurnBillableUsageCanaryTelemetry {
  return {
    schemaVersion: TURN_BILLABLE_USAGE_CANARY_TELEMETRY_SCHEMA_VERSION,
    status: "error",
    modelId: opts.modelId,
    provider: opts.provider,
    selectedStage: null,
    stageCount: opts.stageCount,
    billableStageCount: opts.billableStageCount,
    candidateStatus: "error",
    usageCoverage: "error",
    coverageReason: "canary_observation_error",
    mismatchFields: [],
    errorName: opts.errorName.slice(0, MAX_METADATA_STRING_LENGTH),
  };
}

/** Emit one structured server log line per evaluated canary turn. */
export function logTurnBillableUsageCanaryTelemetry(
  payload: TurnBillableUsageCanaryTelemetry
): void {
  console.info("[turn-billable-usage-canary]", payload);
}

type ObserveTurnBillableUsageCanaryDeps = {
  resolveTurnBillableUsage?: typeof resolveTurnBillableUsage;
};

export function assertTurnBillableUsageCanaryTelemetryPrivacySafe(
  payload: TurnBillableUsageCanaryTelemetry
): void {
  const keys = Object.keys(payload);
  for (const key of keys) {
    if (!(ALLOWED_TELEMETRY_KEYS as readonly string[]).includes(key)) {
      throw new Error(`unexpected telemetry key: ${key}`);
    }
    for (const forbidden of FORBIDDEN_TELEMETRY_KEY_SUBSTRINGS) {
      if (key.toLowerCase().includes(forbidden.toLowerCase())) {
        throw new Error(`forbidden telemetry key substring: ${key}`);
      }
    }
  }

  for (const value of Object.values(payload)) {
    if (typeof value === "string" && value.length > MAX_METADATA_STRING_LENGTH) {
      throw new Error("telemetry string field exceeds safe metadata length");
    }
  }

  if ("fieldSources" in payload && payload.fieldSources) {
    for (const value of Object.values(payload.fieldSources)) {
      if (typeof value === "string" && value.length > MAX_METADATA_STRING_LENGTH) {
        throw new Error("fieldSources string exceeds safe metadata length");
      }
    }
  }
}

/**
 * Run candidate comparison and emit exactly one privacy-safe telemetry event.
 * Fail-open — never throws to caller.
 */
export function observeTurnBillableUsageCanary(
  opts: {
    stages: StageUsage[];
    modelId: string;
    provider: string;
    refusalFallbackDelivered?: boolean;
    promptAuditTotal?: number | null;
    stageCount: number;
    billableStageCount: number;
    legacy: LegacyTurnUsageBasis;
  },
  deps?: ObserveTurnBillableUsageCanaryDeps
): void {
  const resolve = deps?.resolveTurnBillableUsage ?? resolveTurnBillableUsage;
  try {
    const candidate = resolve({
      stages: opts.stages,
      modelId: opts.modelId,
      refusalFallbackDelivered: opts.refusalFallbackDelivered ?? false,
      promptAuditTotal: opts.promptAuditTotal ?? undefined,
    });
    const comparison = compareTurnBillableUsageWithLegacy(candidate, opts.legacy);
    const payload = buildTurnBillableUsageCanaryTelemetry({
      modelId: opts.modelId,
      provider: opts.provider,
      stageCount: opts.stageCount,
      billableStageCount: opts.billableStageCount,
      legacy: opts.legacy,
      candidate,
      comparison,
    });
    assertTurnBillableUsageCanaryTelemetryPrivacySafe(payload);
    logTurnBillableUsageCanaryTelemetry(payload);
  } catch (err) {
    const errorName =
      err instanceof Error && typeof err.name === "string" && err.name.length > 0
        ? err.name
        : "Error";
    const payload = buildTurnBillableUsageCanaryErrorTelemetry({
      modelId: opts.modelId,
      provider: opts.provider,
      stageCount: opts.stageCount,
      billableStageCount: opts.billableStageCount,
      errorName,
    });
    assertTurnBillableUsageCanaryTelemetryPrivacySafe(payload);
    logTurnBillableUsageCanaryTelemetry(payload);
  }
}
