import { evaluateSandboxBlueprint, type TrpgScenarioPlan } from "./scenarioPlan";

export type SandboxBlueprintGenerationFailure =
  | null
  | "transport_timeout"
  | "transport_error"
  | "parse_failure"
  | "repair_failure";

export type SandboxBlueprintProbeRunMetrics = {
  STARTING_SITUATION_PRESENT: boolean;
  CENTRAL_CONFLICT_PRESENT: boolean;
  GOAL_PRESENT: boolean;
  ENDING_CONDITIONS_COUNT: number;
  ENDING_CONDITIONS_VALID: boolean;
  ENDING_CANDIDATES_COUNT: number;
  MAJOR_EVENTS_COUNT: number;
  CLUES_COUNT: number;
  CLIMAX_PRESENT: boolean;
  EVALUATE_SANDBOX_BLUEPRINT_PASS: boolean;
  WORLD_CANON_CONTRADICTION: boolean;
  PLAYER_ACTION_PREDECIDED: boolean;
  RAILROAD_MAJOR: boolean;
  ENDING_CONDITION_VAGUE: boolean;
  ENDING_CONDITION_DUPLICATES_ENDING_CANDIDATE: boolean;
  ENDING_CONDITIONS_QUALITY: string;
  GLOBAL_DIRECTION: string;
  MAJOR_EVENTS: string;
  CLUES: string;
  CLIMAX: string;
  ENDING_CANDIDATES: string;
  PLAYER_AGENCY: string;
};

export type SandboxBlueprintProbeRunRecord = {
  worldId: string;
  category: string;
  runIndex: number;
  highRisk: boolean;
  primaryParseSuccess: boolean;
  repairTriggered: boolean;
  repairSuccess: boolean;
  generationFailure: SandboxBlueprintGenerationFailure;
  semanticReject: boolean;
  metrics: SandboxBlueprintProbeRunMetrics | null;
  planSummary: Record<string, unknown> | null;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  error: string | null;
};

export function classifyGenerationFailure(opts: {
  error: unknown;
  primaryParseSuccess: boolean;
  repairTriggered: boolean;
  repairSuccess: boolean;
}): SandboxBlueprintGenerationFailure {
  if (opts.primaryParseSuccess) return null;
  if (opts.repairTriggered && !opts.repairSuccess) return "repair_failure";
  const message = opts.error instanceof Error ? opts.error.message : String(opts.error ?? "");
  if (/deadline exceeded|timed out|timeout/i.test(message)) return "transport_timeout";
  if (/invalid json|parse|JSON/i.test(message)) return "parse_failure";
  if (message.trim()) return "transport_error";
  return "transport_error";
}

export function semanticRejectFromParsedPlan(plan: TrpgScenarioPlan | null | undefined): boolean {
  if (!plan) return false;
  return !evaluateSandboxBlueprint(plan).ok;
}

export function normalizeProbeRunRecord(run: SandboxBlueprintProbeRunRecord): SandboxBlueprintProbeRunRecord {
  const parsed = run.primaryParseSuccess && run.metrics != null;
  const generationFailure = parsed
    ? null
    : classifyGenerationFailure({
        error: run.error,
        primaryParseSuccess: run.primaryParseSuccess,
        repairTriggered: run.repairTriggered,
        repairSuccess: run.repairSuccess,
      });
  const semanticReject = parsed ? run.metrics!.EVALUATE_SANDBOX_BLUEPRINT_PASS === false : false;
  return {
    ...run,
    generationFailure,
    semanticReject,
  };
}

export function summarizeSandboxBlueprintProbeRuns(
  runs: SandboxBlueprintProbeRunRecord[],
  opts?: { primaryWorldCount?: number; humanReview?: SandboxBlueprintProbeHumanReview }
): SandboxBlueprintProbeSummary {
  const normalized = runs.map((run) => normalizeProbeRunRecord(run));
  const parsedRuns = normalized.filter((run) => run.primaryParseSuccess && run.metrics != null);
  const acceptedRuns = parsedRuns.filter((run) => run.metrics?.EVALUATE_SANDBOX_BLUEPRINT_PASS);
  const primaryRuns = normalized.filter((run) => run.runIndex === 0);
  const primaryParsed = primaryRuns.filter((run) => run.primaryParseSuccess && run.metrics != null);
  const primaryAccepted = primaryParsed.filter((run) => run.metrics?.EVALUATE_SANDBOX_BLUEPRINT_PASS);
  const highRiskRepeats = normalized.filter((run) => run.highRisk && run.runIndex > 0);

  const agencyHeuristicHits = parsedRuns.filter((run) => run.metrics?.PLAYER_AGENCY === "VIOLATED").length;
  const railroadHeuristicHits = parsedRuns.filter((run) => run.metrics?.RAILROAD_MAJOR).length;

  return {
    generatedAt: new Date().toISOString(),
    frozenWorldCount: opts?.primaryWorldCount ?? primaryRuns.length,
    highRiskRepeatCalls: highRiskRepeats.length,
    totalProviderRuns: normalized.length,
    successfulParsedBlueprints: parsedRuns.length,
    transportFailures: normalized.filter((run) =>
      run.generationFailure === "transport_timeout" || run.generationFailure === "transport_error"
    ).length,
    parseFailures: normalized.filter((run) => run.generationFailure === "parse_failure").length,
    repairFailures: normalized.filter((run) => run.generationFailure === "repair_failure").length,
    semanticBlueprintRejects: parsedRuns.filter((run) => run.semanticReject).length,
    endToEndGenerationSuccessRate: acceptedRuns.length / Math.max(1, normalized.length),
    parsedBlueprintAcceptanceRate: acceptedRuns.length / Math.max(1, parsedRuns.length),
    primaryWorldEndToEndPassRate: primaryAccepted.length / Math.max(1, primaryRuns.length),
    primaryParsedBlueprintAcceptanceRate: primaryAccepted.length / Math.max(1, primaryParsed.length),
    missingStartingSituation: parsedRuns.filter((run) => !run.metrics?.STARTING_SITUATION_PRESENT).length,
    missingCentralConflict: parsedRuns.filter((run) => !run.metrics?.CENTRAL_CONFLICT_PRESENT).length,
    missingGoal: parsedRuns.filter((run) => !run.metrics?.GOAL_PRESENT).length,
    missingEndingConditionsAmongParsed: parsedRuns.filter((run) => (run.metrics?.ENDING_CONDITIONS_COUNT ?? 0) === 0)
      .length,
    highRiskTransportFailures: highRiskRepeats.filter(
      (run) => run.generationFailure === "transport_timeout" || run.generationFailure === "transport_error"
    ).length,
    highRiskMissingEndingConditions: highRiskRepeats.filter(
      (run) => run.primaryParseSuccess && (run.metrics?.ENDING_CONDITIONS_COUNT ?? 0) === 0
    ).length,
    agencyHeuristicHits,
    agencyHumanConfirmedFailures: opts?.humanReview?.agencyHumanConfirmedFailures ?? 0,
    railroadHeuristicHits,
    railroadHumanConfirmedFailures: opts?.humanReview?.railroadHumanConfirmedFailures ?? 0,
    humanReviewNotes: opts?.humanReview?.notes ?? "",
    medianLatencyMs: percentile(
      normalized.map((run) => run.latencyMs).filter((n) => n > 0),
      50
    ),
    p95LatencyMs: percentile(
      normalized.map((run) => run.latencyMs).filter((n) => n > 0),
      95
    ),
    avgInputTokens:
      normalized.reduce((sum, run) => sum + run.inputTokens, 0) /
      Math.max(1, normalized.filter((run) => run.inputTokens > 0).length),
    avgOutputTokens:
      normalized.reduce((sum, run) => sum + run.outputTokens, 0) /
      Math.max(1, normalized.filter((run) => run.outputTokens > 0).length),
    jsonRepairTriggered: normalized.filter((run) => run.repairTriggered).length,
    jsonRepairSuccess: normalized.filter((run) => run.repairSuccess).length,
    runs: normalized,
  };
}

export type SandboxBlueprintProbeHumanReview = {
  agencyHumanConfirmedFailures: number;
  railroadHumanConfirmedFailures: number;
  notes: string;
};

export type SandboxBlueprintProbeSummary = {
  generatedAt: string;
  frozenWorldCount: number;
  highRiskRepeatCalls: number;
  totalProviderRuns: number;
  successfulParsedBlueprints: number;
  transportFailures: number;
  parseFailures: number;
  repairFailures: number;
  semanticBlueprintRejects: number;
  endToEndGenerationSuccessRate: number;
  parsedBlueprintAcceptanceRate: number;
  primaryWorldEndToEndPassRate: number;
  primaryParsedBlueprintAcceptanceRate: number;
  missingStartingSituation: number;
  missingCentralConflict: number;
  missingGoal: number;
  missingEndingConditionsAmongParsed: number;
  highRiskTransportFailures: number;
  highRiskMissingEndingConditions: number;
  agencyHeuristicHits: number;
  agencyHumanConfirmedFailures: number;
  railroadHeuristicHits: number;
  railroadHumanConfirmedFailures: number;
  humanReviewNotes: string;
  medianLatencyMs: number;
  p95LatencyMs: number;
  avgInputTokens: number;
  avgOutputTokens: number;
  jsonRepairTriggered: number;
  jsonRepairSuccess: number;
  runs: SandboxBlueprintProbeRunRecord[];
};

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)] ?? 0;
}

export function migrateLegacyProbeResults(raw: {
  runs: Array<Record<string, unknown>>;
  generatedAt?: string;
}): SandboxBlueprintProbeSummary {
  const runs: SandboxBlueprintProbeRunRecord[] = raw.runs.map((run) => ({
    worldId: String(run.worldId),
    category: String(run.category),
    runIndex: Number(run.runIndex),
    highRisk: Boolean(run.highRisk),
    primaryParseSuccess: Boolean(run.primaryParseSuccess),
    repairTriggered: Boolean(run.repairTriggered),
    repairSuccess: Boolean(run.repairSuccess),
    generationFailure: null,
    semanticReject: Boolean(run.semanticReject),
    metrics: (run.metrics as SandboxBlueprintProbeRunMetrics | null) ?? null,
    planSummary: (run.planSummary as Record<string, unknown> | null) ?? null,
    inputTokens: Number(run.inputTokens ?? 0),
    outputTokens: Number(run.outputTokens ?? 0),
    latencyMs: Number(run.latencyMs ?? 0),
    error: run.error == null ? null : String(run.error),
  }));
  return summarizeSandboxBlueprintProbeRuns(runs, {
    primaryWorldCount: 12,
    humanReview: {
      agencyHumanConfirmedFailures: 0,
      railroadHumanConfirmedFailures: 0,
      notes: "W06/W07 goal phrasing heuristic false positives; human review found no agency or railroad failures.",
    },
  });
}

export function migrateLegacyProbeResultsWithTimestamp(raw: {
  runs: Array<Record<string, unknown>>;
  generatedAt?: string;
}): SandboxBlueprintProbeSummary {
  const summary = migrateLegacyProbeResults(raw);
  if (raw.generatedAt) summary.generatedAt = raw.generatedAt;
  return summary;
}
