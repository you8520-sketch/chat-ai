/**
 * Candidate turn billable usage composition owner.
 * Pure resolver: stages/context → NormalizedBillableUsage + UserBillableUsageCoverage.
 *
 * Responsibility (LEVEL 1 only): route-assembled user billable usage basis —
 * primary-stage prompt/cache + aggregate completion/reasoning.
 * Does NOT interpret live pricing policy (LEVEL 2 — owned by computeTurnBilling).
 */
import type { StageUsage } from "@/lib/ai";
import {
  normalizeBillableUsage,
  validateNormalizedBillableUsage,
  type NormalizedBillableUsage,
  type UserBillableUsageCoverage,
} from "@/lib/billingUsage";
import {
  billableOpenRouterOutputTokens,
  isGeminiBillingStage,
  resolveRouteApiTokensForCost,
  resolveTurnBillableInput,
  selectBillableStages,
  sumOpenRouterStageOutputTokens,
  sumOpenRouterStageReasoningTokens,
} from "@/lib/stageBillableUsage";

export type TurnUsageFieldSource =
  | "PROVIDER_REPORTED_EXACT"
  | "DETERMINISTIC_ROUTE_VALUE"
  | "ESTIMATED"
  | "FALLBACK_VALUE"
  | "MISSING_BUT_PROVEN_ZERO"
  | "MISSING_AND_UNKNOWN"
  | "SANITIZED_MALFORMED";

export type TurnBillableUsageFieldSources = {
  prompt: TurnUsageFieldSource;
  cacheRead: TurnUsageFieldSource;
  cacheWrite: TurnUsageFieldSource;
  completion: TurnUsageFieldSource;
  reasoning: TurnUsageFieldSource;
};

export type TurnBillableUsageDiagnostics = {
  selectedStage: string | null;
  stageCount: number;
  billableStageCount: number;
  stageInput: number;
  routeTotalInput: number;
  apiPromptTokensForCost: number;
  apiCompletionTokensForCost: number;
  routeChargeOutputTokens: number;
  promptAuditCapApplied: boolean;
  cacheReadReported: boolean;
  cacheWriteReported: boolean;
  fieldSources: TurnBillableUsageFieldSources;
  coverageReasons: string[];
};

export type TurnBillableUsageResolution =
  | {
      status: "resolved";
      usage: NormalizedBillableUsage;
      usageCoverage: UserBillableUsageCoverage;
      diagnostics: TurnBillableUsageDiagnostics;
    }
  | {
      status: "unavailable";
      usage: null;
      usageCoverage: "unknown";
      reason: string;
      diagnostics: TurnBillableUsageDiagnostics;
    };

export type ResolveTurnBillableUsageInput = {
  stages: StageUsage[];
  modelId: string;
  refusalFallbackDelivered?: boolean;
  promptAuditTotal?: number | null;
};

function emptyDiagnostics(): TurnBillableUsageDiagnostics {
  return {
    selectedStage: null,
    stageCount: 0,
    billableStageCount: 0,
    stageInput: 0,
    routeTotalInput: 0,
    apiPromptTokensForCost: 0,
    apiCompletionTokensForCost: 0,
    routeChargeOutputTokens: 0,
    promptAuditCapApplied: false,
    cacheReadReported: false,
    cacheWriteReported: false,
    fieldSources: {
      prompt: "MISSING_AND_UNKNOWN",
      cacheRead: "MISSING_AND_UNKNOWN",
      cacheWrite: "MISSING_AND_UNKNOWN",
      completion: "MISSING_AND_UNKNOWN",
      reasoning: "MISSING_AND_UNKNOWN",
    },
    coverageReasons: [],
  };
}

function isMalformedRaw(n: unknown): boolean {
  if (typeof n !== "number" || !Number.isFinite(n)) return true;
  if (n < 0) return true;
  if (!Number.isInteger(n)) return true;
  return false;
}

function classifyCacheField(
  raw: unknown,
  reported: boolean,
  estimatedStage?: boolean
): TurnUsageFieldSource {
  if (estimatedStage) return "ESTIMATED";
  if (!reported) return "MISSING_AND_UNKNOWN";
  if (isMalformedRaw(raw)) return "SANITIZED_MALFORMED";
  return "PROVIDER_REPORTED_EXACT";
}

function resolveUsageCoverage(
  fieldSources: TurnBillableUsageFieldSources,
  coverageReasons: string[],
  usage: NormalizedBillableUsage
): UserBillableUsageCoverage {
  const required = [fieldSources.prompt, fieldSources.completion];
  if (required.some((s) => s === "MISSING_AND_UNKNOWN")) return "unknown";

  const all = Object.values(fieldSources);
  if (all.some((s) => s === "SANITIZED_MALFORMED")) return "partial";
  if (all.some((s) => s === "ESTIMATED" || s === "FALLBACK_VALUE")) return "partial";
  if ([fieldSources.cacheRead, fieldSources.cacheWrite].some((s) => s === "MISSING_AND_UNKNOWN")) {
    return "partial";
  }
  if (usage.reasoningAccounting === "unknown") return "unknown";
  if (!validateNormalizedBillableUsage(usage)) return "unknown";
  if (coverageReasons.length > 0) return "partial";
  return "complete";
}

/**
 * Candidate composition owner mirroring route.ts LEVEL 1 assembly:
 * - prompt/cache: selected primary/fallback stage only (+ promptAudit cap)
 * - completion/reasoning: aggregate non-Gemini successful stages
 */
export function resolveTurnBillableUsage(
  input: ResolveTurnBillableUsageInput
): TurnBillableUsageResolution {
  const diagnostics = emptyDiagnostics();
  const coverageReasons: string[] = [];
  diagnostics.stageCount = input.stages.length;

  if (input.stages.length === 0) {
    return {
      status: "unavailable",
      usage: null,
      usageCoverage: "unknown",
      reason: "no_stages",
      diagnostics: { ...diagnostics, coverageReasons: ["no_stages"] },
    };
  }

  const billableStages = selectBillableStages(input.stages, {
    refusalFallbackDelivered: input.refusalFallbackDelivered ?? false,
  });
  diagnostics.billableStageCount = billableStages.length;
  const primaryStage = billableStages[0];
  if (!primaryStage) {
    return {
      status: "unavailable",
      usage: null,
      usageCoverage: "unknown",
      reason: "no_billable_stage",
      diagnostics: { ...diagnostics, coverageReasons: ["no_billable_stage"] },
    };
  }

  diagnostics.selectedStage = primaryStage.stage;

  const openRouterStages = input.stages.filter((s) => !isGeminiBillingStage(s));
  const anyEstimatedInComposition =
    primaryStage.estimated === true ||
    openRouterStages.some((s) => s.estimated === true);

  const rawStageInput = primaryStage.input;
  const promptAuditTotal = input.promptAuditTotal ?? null;
  let promptSource: TurnUsageFieldSource;
  if (rawStageInput == null || isMalformedRaw(rawStageInput)) {
    promptSource = rawStageInput == null ? "MISSING_AND_UNKNOWN" : "SANITIZED_MALFORMED";
    coverageReasons.push("prompt_unavailable");
  } else if (primaryStage.estimated) {
    promptSource = "ESTIMATED";
  } else {
    promptSource = "PROVIDER_REPORTED_EXACT";
  }

  const stageInput = Math.max(0, Math.floor(Number(rawStageInput) || 0));
  diagnostics.stageInput = stageInput;
  const routeTotalInput = resolveTurnBillableInput({
    stageInput,
    promptAuditTotal: promptAuditTotal ?? undefined,
  });
  diagnostics.routeTotalInput = routeTotalInput;
  if (
    promptAuditTotal != null &&
    promptAuditTotal > 0 &&
    stageInput > promptAuditTotal
  ) {
    diagnostics.promptAuditCapApplied = true;
    if (promptSource === "PROVIDER_REPORTED_EXACT") {
      promptSource = "DETERMINISTIC_ROUTE_VALUE";
    }
  }

  const cacheReadReported =
    primaryStage.cacheReadTokens != null || primaryStage.cachedContentTokens != null;
  const cacheWriteReported = primaryStage.cacheWriteTokens != null;
  diagnostics.cacheReadReported = cacheReadReported;
  diagnostics.cacheWriteReported = cacheWriteReported;

  const rawCacheRead = primaryStage.cacheReadTokens ?? primaryStage.cachedContentTokens;
  const rawCacheWrite = primaryStage.cacheWriteTokens;
  const cacheReadSource = classifyCacheField(rawCacheRead, cacheReadReported, primaryStage.estimated);
  const cacheWriteSource = classifyCacheField(rawCacheWrite, cacheWriteReported, primaryStage.estimated);
  if (!cacheReadReported) coverageReasons.push("cache_read_unreported");
  if (!cacheWriteReported) coverageReasons.push("cache_write_unreported");

  const cacheReadTokens = cacheReadReported ? Math.max(0, Math.floor(Number(rawCacheRead) || 0)) : 0;
  const cacheWriteTokens = cacheWriteReported ? Math.max(0, Math.floor(Number(rawCacheWrite) || 0)) : 0;

  if (cacheReadTokens + cacheWriteTokens > routeTotalInput) {
    coverageReasons.push("cache_exceeds_capped_prompt");
  }

  const summedApiOutput = sumOpenRouterStageOutputTokens(input.stages);
  const summedApiReasoning = sumOpenRouterStageReasoningTokens(input.stages);
  const apiTokens = resolveRouteApiTokensForCost(primaryStage, summedApiOutput);
  diagnostics.apiPromptTokensForCost = apiTokens.apiPromptTokensForCost;
  diagnostics.apiCompletionTokensForCost = apiTokens.apiCompletionTokensForCost;

  const apiCompletionTotalTokens = apiTokens.apiCompletionTokensForCost;

  let completionSource: TurnUsageFieldSource;
  if (summedApiOutput > 0) {
    completionSource = anyEstimatedInComposition ? "ESTIMATED" : "PROVIDER_REPORTED_EXACT";
  } else if ((primaryStage.apiOutputTokens ?? primaryStage.output ?? 0) > 0) {
    completionSource = primaryStage.estimated ? "ESTIMATED" : "PROVIDER_REPORTED_EXACT";
  } else {
    completionSource = "MISSING_AND_UNKNOWN";
    coverageReasons.push("completion_api_missing");
  }

  const reasoningSource =
    summedApiReasoning > 0
      ? anyEstimatedInComposition
        ? "ESTIMATED"
        : "PROVIDER_REPORTED_EXACT"
      : "MISSING_BUT_PROVEN_ZERO";

  const routeChargeOutputTokens = billableOpenRouterOutputTokens(
    input.modelId,
    apiCompletionTotalTokens,
    summedApiReasoning
  );
  diagnostics.routeChargeOutputTokens = routeChargeOutputTokens;

  diagnostics.fieldSources = {
    prompt: promptSource,
    cacheRead: cacheReadSource,
    cacheWrite: cacheWriteSource,
    completion: completionSource,
    reasoning: reasoningSource,
  };
  diagnostics.coverageReasons = coverageReasons;

  if (completionSource === "MISSING_AND_UNKNOWN") {
    return {
      status: "unavailable",
      usage: null,
      usageCoverage: "unknown",
      reason: "completion_api_missing",
      diagnostics,
    };
  }

  const usage = normalizeBillableUsage({
    modelId: input.modelId,
    promptTokens: routeTotalInput,
    cacheReadTokens,
    cacheWriteTokens,
    outputTokens: apiCompletionTotalTokens,
    reasoningTokens: summedApiReasoning,
  });

  if (cacheReadTokens + cacheWriteTokens > routeTotalInput) {
    return {
      status: "unavailable",
      usage: null,
      usageCoverage: "unknown",
      reason: "cache_exceeds_capped_prompt",
      diagnostics,
    };
  }

  if (!validateNormalizedBillableUsage(usage)) {
    return {
      status: "unavailable",
      usage: null,
      usageCoverage: "unknown",
      reason: "invalid_normalized_usage",
      diagnostics: { ...diagnostics, coverageReasons: [...coverageReasons, "invalid_normalized_usage"] },
    };
  }

  const usageCoverage = resolveUsageCoverage(diagnostics.fieldSources, coverageReasons, usage);

  return {
    status: "resolved",
    usage,
    usageCoverage,
    diagnostics,
  };
}
