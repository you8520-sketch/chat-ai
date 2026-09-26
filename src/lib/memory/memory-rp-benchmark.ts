/**
 * Site RP Memory Benchmark — raw metrics only, no subjective quality scores.
 *
 * The benchmark aggregates deterministic per-case stage outcomes produced by
 * the existing canonical retrieval owners. It never calls a provider, never
 * assigns preference scores, and never writes canonical memory. Final quality
 * judgment stays with GPT/human reviewers reading the raw evidence.
 */

export type BenchmarkCategory =
  | "boundary_5turn"
  | "callback_75turn"
  | "t300"
  | "t1000"
  | "semantic_paraphrase"
  | "promise"
  | "betrayal"
  | "first_never"
  | "role_event_direction"
  | "same_turn_multi_event"
  | "latest_state_replacement"
  | "historical_repeat_events"
  | "irrelevant_critical_vs_relevant_normal"
  | "user_canonical_vs_assistant_hallucination"
  | "regeneration_rejected_event"
  | "message_edit"
  | "delete_rewind"
  | "fork_variant"
  | "persona_secret_wrong_observer"
  | "trpg_quest"
  | "character_state_transition"
  | "location_ownership_transition";

export type BenchmarkCaseOutcome = {
  caseId: string;
  category: BenchmarkCategory;
  /** A correct answer fact exists for this case. */
  expectedPresent: boolean;
  /** Answer fact id was inside the bounded pre-rank candidate set. */
  preCandidateHit: boolean;
  /** Answer fact reached the final prompt block (finalRecall@8). */
  finalInjected: boolean;
  /** An unrelated fact was injected instead/also (false injection). */
  falseInjected: boolean;
  /** A stale state row won over the latest canonical row. */
  staleInjected: boolean;
  /** Persona Secret text leaked into the prompt for the wrong observer. */
  secretLeaked: boolean;
};

export type BenchmarkRawMetrics = {
  cases: number;
  /** Share of expected answers present in the pre-rank candidate set. */
  candidateRecallAtK: number;
  /** Share of expected answers reaching the final prompt (max 8 facts). */
  finalRecallAt8: number;
  /** Share of cases with an unrelated injection. */
  falseInjectionRate: number;
  /** Share of latest-state cases where stale state won. */
  staleStateRecallRate: number;
  secretLeakCount: number;
  /** Shadow-vs-baseline delta stays 0 while shadow integration is STOPped. */
  baselineVsShadowDelta: number;
  providerCallsPerTurn: number;
  jevInvocationRate: number;
  /** Null until a live approved run records real transport timings. */
  jevP50LatencyMs: number | null;
  jevP95LatencyMs: number | null;
  jevCostPer1000Turns: number | null;
  promptTokenDelta: number;
  /** True while Jev DOWN == existing V2 behavior (no integration yet). */
  fallbackParity: boolean;
};

export function emptyBenchmarkMetrics(): BenchmarkRawMetrics {
  return {
    cases: 0,
    candidateRecallAtK: 0,
    finalRecallAt8: 0,
    falseInjectionRate: 0,
    staleStateRecallRate: 0,
    secretLeakCount: 0,
    baselineVsShadowDelta: 0,
    providerCallsPerTurn: 0,
    jevInvocationRate: 0,
    jevP50LatencyMs: null,
    jevP95LatencyMs: null,
    jevCostPer1000Turns: null,
    promptTokenDelta: 0,
    fallbackParity: true,
  };
}

function ratio(hit: number, total: number): number {
  if (total <= 0) return 0;
  return hit / total;
}

/**
 * Pure aggregation over deterministic case outcomes. Provider/latency/cost
 * fields remain at their STOP defaults (0 / null) because no live Jev
 * transport exists on main and no live benchmark is authorized in this PR.
 */
export function computeBenchmarkMetrics(outcomes: readonly BenchmarkCaseOutcome[]): BenchmarkRawMetrics {
  if (outcomes.length === 0) return emptyBenchmarkMetrics();
  const expected = outcomes.filter((o) => o.expectedPresent);
  const latestStateCases = outcomes.filter((o) => o.category === "latest_state_replacement");
  return {
    cases: outcomes.length,
    candidateRecallAtK: ratio(
      expected.filter((o) => o.preCandidateHit).length,
      expected.length
    ),
    finalRecallAt8: ratio(
      expected.filter((o) => o.finalInjected).length,
      expected.length
    ),
    falseInjectionRate: ratio(
      outcomes.filter((o) => o.falseInjected).length,
      outcomes.length
    ),
    staleStateRecallRate: ratio(
      latestStateCases.filter((o) => o.staleInjected).length,
      latestStateCases.length
    ),
    secretLeakCount: outcomes.filter((o) => o.secretLeaked).length,
    baselineVsShadowDelta: 0,
    providerCallsPerTurn: 0,
    jevInvocationRate: 0,
    jevP50LatencyMs: null,
    jevP95LatencyMs: null,
    jevCostPer1000Turns: null,
    promptTokenDelta: 0,
    fallbackParity: true,
  };
}

export function formatBenchmarkMetricsLine(metrics: BenchmarkRawMetrics): string {
  const fmt = (v: number): string => v.toFixed(3);
  return [
    `cases=${metrics.cases}`,
    `candidateRecall@K=${fmt(metrics.candidateRecallAtK)}`,
    `finalRecall@8=${fmt(metrics.finalRecallAt8)}`,
    `falseInjectionRate=${fmt(metrics.falseInjectionRate)}`,
    `staleStateRecallRate=${fmt(metrics.staleStateRecallRate)}`,
    `secretLeakCount=${metrics.secretLeakCount}`,
    `baselineVsShadowDelta=${metrics.baselineVsShadowDelta}`,
    `providerCallsPerTurn=${metrics.providerCallsPerTurn}`,
    `jevInvocationRate=${metrics.jevInvocationRate}`,
    `jevP50=${metrics.jevP50LatencyMs ?? "null"}`,
    `jevP95=${metrics.jevP95LatencyMs ?? "null"}`,
    `jevCostPer1k=${metrics.jevCostPer1000Turns ?? "null"}`,
    `promptTokenDelta=${metrics.promptTokenDelta}`,
    `fallbackParity=${metrics.fallbackParity}`,
  ].join(" ");
}
