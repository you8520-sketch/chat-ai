/**
 * Candidate turn billable usage composition owner.
 * Pure resolver: stages/context → NormalizedBillableUsage + UserBillableUsageCoverage.
 * Does NOT own pricing, waiver, settlement, provider economics, or FX.
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
  billableOutputTokens,
  isGeminiBillingStage,
  resolveTurnBillableInput,
  selectBillableStages,
  sumOpenRouterStageOutputTokens,
  sumOpenRouterStageReasoningTokens,
} from "@/lib/points";

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
  apiCompletionTotalTokens: number;
  legacyChargeOutputTokens: number;
  promptAuditCapApplied: boolean;
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
  savedText?: string;
  targetResponseChars?: number | null;
};

function emptyDiagnostics(): TurnBillableUsageDiagnostics {
  return {
    selectedStage: null,
    stageCount: 0,
    billableStageCount: 0,
    apiCompletionTotalTokens: 0,
    legacyChargeOutputTokens: 0,
    promptAuditCapApplied: false,
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

function classifyNumericField(
  raw: unknown,
  opts: { estimatedStage?: boolean; usedFallback?: boolean }
): TurnUsageFieldSource {
  if (opts.usedFallback) return "FALLBACK_VALUE";
  if (opts.estimatedStage) return "ESTIMATED";
  if (raw == null) return "MISSING_BUT_PROVEN_ZERO";
  if (isMalformedRaw(raw)) return "SANITIZED_MALFORMED";
  const n = raw as number;
  if (n === 0) return "MISSING_BUT_PROVEN_ZERO";
  return "PROVIDER_REPORTED_EXACT";
}

function resolveUsageCoverage(
  fieldSources: TurnBillableUsageFieldSources,
  coverageReasons: string[],
  usage: NormalizedBillableUsage
): UserBillableUsageCoverage {
  const values = Object.values(fieldSources);
  if (values.some((s) => s === "MISSING_AND_UNKNOWN")) return "unknown";
  if (values.some((s) => s === "ESTIMATED" || s === "FALLBACK_VALUE" || s === "SANITIZED_MALFORMED")) {
    return "partial";
  }
  if (usage.reasoningAccounting === "unknown") return "unknown";
  if (!validateNormalizedBillableUsage(usage)) return "unknown";
  if (coverageReasons.length > 0) return "partial";
  return "complete";
}

/**
 * Candidate composition owner mirroring current route.ts legacy contract:
 * - prompt/cache: selected primary/fallback stage only (+ promptAudit cap)
 * - completion/reasoning: aggregate non-Gemini successful stages
 * - legacyChargeOutputTokens: value passed to computeTurnBilling as outputTokens
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

  const promptTokens = resolveTurnBillableInput({
    stageInput: Math.max(0, Math.floor(Number(rawStageInput) || 0)),
    promptAuditTotal: promptAuditTotal ?? undefined,
  });
  if (
    promptAuditTotal != null &&
    promptAuditTotal > 0 &&
    rawStageInput != null &&
    Math.max(0, Math.floor(rawStageInput)) > promptAuditTotal
  ) {
    diagnostics.promptAuditCapApplied = true;
    if (promptSource === "PROVIDER_REPORTED_EXACT") {
      promptSource = "DETERMINISTIC_ROUTE_VALUE";
    }
  }

  const rawCacheRead = primaryStage.cacheReadTokens ?? primaryStage.cachedContentTokens;
  const rawCacheWrite = primaryStage.cacheWriteTokens;
  const cacheReadSource = classifyNumericField(rawCacheRead, { estimatedStage: primaryStage.estimated });
  const cacheWriteSource = classifyNumericField(rawCacheWrite, { estimatedStage: primaryStage.estimated });
  const cacheReadTokens = Math.max(0, Math.floor(Number(rawCacheRead) || 0));
  const cacheWriteTokens = Math.max(0, Math.floor(Number(rawCacheWrite) || 0));

  if (cacheReadTokens + cacheWriteTokens > promptTokens) {
    coverageReasons.push("cache_exceeds_capped_prompt");
  }

  const summedApiOutput = sumOpenRouterStageOutputTokens(input.stages);
  const summedApiReasoning = sumOpenRouterStageReasoningTokens(input.stages);
  const apiCompletionTotalTokens =
    summedApiOutput > 0
      ? summedApiOutput
      : Math.max(0, Math.floor(Number(primaryStage.apiOutputTokens ?? primaryStage.output) || 0));

  let completionSource: TurnUsageFieldSource;
  if (summedApiOutput > 0) {
    completionSource = anyEstimatedInComposition ? "ESTIMATED" : "PROVIDER_REPORTED_EXACT";
    if (openRouterStages.length > 1 && !anyEstimatedInComposition) {
      completionSource = "PROVIDER_REPORTED_EXACT";
    }
  } else if ((primaryStage.apiOutputTokens ?? primaryStage.output ?? 0) > 0) {
    completionSource = primaryStage.estimated ? "ESTIMATED" : "PROVIDER_REPORTED_EXACT";
  } else {
    completionSource = "FALLBACK_VALUE";
    coverageReasons.push("completion_text_fallback");
  }

  const reasoningSource =
    summedApiReasoning > 0
      ? anyEstimatedInComposition
        ? "ESTIMATED"
        : "PROVIDER_REPORTED_EXACT"
      : "MISSING_BUT_PROVEN_ZERO";

  const billableApiOutputTokens = billableOpenRouterOutputTokens(
    input.modelId,
    apiCompletionTotalTokens,
    summedApiReasoning
  );
  const legacyChargeOutputTokens =
    billableApiOutputTokens > 0
      ? billableApiOutputTokens
      : billableOutputTokens(
          primaryStage.apiOutputTokens ?? 0,
          input.savedText ?? "",
          input.targetResponseChars ?? null
        );

  diagnostics.apiCompletionTotalTokens = apiCompletionTotalTokens;
  diagnostics.legacyChargeOutputTokens = legacyChargeOutputTokens;
  diagnostics.fieldSources = {
    prompt: promptSource,
    cacheRead: cacheReadSource,
    cacheWrite: cacheWriteSource,
    completion: completionSource,
    reasoning: reasoningSource,
  };
  diagnostics.coverageReasons = coverageReasons;

  const usage = normalizeBillableUsage({
    modelId: input.modelId,
    promptTokens,
    cacheReadTokens,
    cacheWriteTokens,
    outputTokens: apiCompletionTotalTokens,
    reasoningTokens: summedApiReasoning,
  });

  if (cacheReadTokens + cacheWriteTokens > promptTokens) {
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
  diagnostics.coverageReasons = coverageReasons;

  return {
    status: "resolved",
    usage,
    usageCoverage,
    diagnostics,
  };
}
