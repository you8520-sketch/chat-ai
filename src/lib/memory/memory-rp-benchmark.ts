/**
 * Site RP Memory Benchmark — raw metrics only, no subjective quality scores.
 *
 * READER AUDIT (Phase 9):
 * - writer/caller: `src/lib/memory/memory-rp-benchmark.test.ts` (the only
 *   benchmark runner; executes every case against real canonical owners on
 *   in-memory SQLite, no network).
 * - runtime reader: NONE by design — no production path imports this module.
 *   (SAFE TO KEEP as the durable baseline-harness owner for the approved
 *   semantic-candidate-discovery follow-up; not a production helper.)
 * - test reader: the benchmark test above.
 * - future approved reader: the semantic-candidate-discovery fix PR, which
 *   re-runs the same harness to show BEFORE miss → AFTER hit on the
 *   KNOWN_GAP_BASELINE_REPRO cases.
 *
 * Every metric carries a measurement status (Phase 3 correction). Values
 * that were not actually measured are reported as null with an explicit
 * NOT_MEASURED / NOT_APPLICABLE status — never as 0/true quality proof.
 */

export type MeasurementStatus = "MEASURED" | "DERIVED" | "NOT_MEASURED" | "NOT_APPLICABLE";

export type MeasuredValue<T> = {
  value: T | null;
  status: MeasurementStatus;
  reason?: string;
};

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

export type BenchmarkCoverageEntry = {
  category: BenchmarkCategory;
  executedCases: number;
  status: "MEASURED" | "NOT_MEASURED";
  reason?: string;
};

export type BenchmarkRawMetrics = {
  cases: number;
  coverage: BenchmarkCoverageEntry[];
  /** Share of expected answers present in the pre-rank candidate set. */
  candidateRecallAtK: MeasuredValue<number>;
  /** Share of expected answers reaching the final prompt (max 8 facts). */
  finalRecallAt8: MeasuredValue<number>;
  /** Share of executed cases with an unrelated injection. */
  falseInjectionRate: MeasuredValue<number>;
  /** Share of executed latest-state cases where stale state won. */
  staleStateRecallRate: MeasuredValue<number>;
  secretLeakCount: MeasuredValue<number>;
  /** No shadow path exists to compare against — not 0-as-proof. */
  baselineVsShadowDelta: MeasuredValue<number>;
  /** Observed transport HTTP calls per evaluated turn (fetch spy). */
  providerCallsPerTurn: MeasuredValue<number>;
  /** Observed Jev transport invocations per evaluated turn (fetch spy). */
  jevInvocationRate: MeasuredValue<number>;
  jevP50LatencyMs: MeasuredValue<number>;
  jevP95LatencyMs: MeasuredValue<number>;
  jevCostPer1000Turns: MeasuredValue<number>;
  promptTokenDelta: MeasuredValue<number>;
  /** No shadow path exists to compare — not true-as-proof. */
  fallbackParity: MeasuredValue<boolean>;
};

function ratio(hit: number, total: number): number {
  if (total <= 0) return 0;
  return hit / total;
}

export type BenchmarkTransportObservation = {
  /** Evaluated benchmark turns (denominator for per-turn rates). */
  evaluatedTurns: number;
  /** Transport-level HTTP calls observed during the run (fetch spy). */
  httpCallsObserved: number;
  /** …of which targeted the Jev Decisions endpoint. */
  jevCallsObserved: number;
};

/**
 * Pure aggregation over deterministic case outcomes from actually executed
 * canonical owners. Unmeasured metrics stay null with explicit statuses:
 * this harness MUST NOT be read as proving Jev latency/cost/parity/delta.
 */
export function computeBenchmarkMetrics(
  outcomes: readonly BenchmarkCaseOutcome[],
  coverage: readonly BenchmarkCoverageEntry[],
  transport: BenchmarkTransportObservation = {
    evaluatedTurns: 0,
    httpCallsObserved: 0,
    jevCallsObserved: 0,
  }
): BenchmarkRawMetrics {
  const expected = outcomes.filter((o) => o.expectedPresent);
  const latestStateCases = outcomes.filter((o) => o.category === "latest_state_replacement");
  const secretCases = outcomes.filter((o) => o.category === "persona_secret_wrong_observer");
  const transportMeasured = transport.evaluatedTurns > 0;
  return {
    cases: outcomes.length,
    coverage: [...coverage],
    candidateRecallAtK: {
      value: ratio(
        expected.filter((o) => o.preCandidateHit).length,
        expected.length
      ),
      status: "MEASURED",
    },
    finalRecallAt8: {
      value: ratio(
        expected.filter((o) => o.finalInjected).length,
        expected.length
      ),
      status: "MEASURED",
    },
    falseInjectionRate: {
      value: ratio(
        outcomes.filter((o) => o.falseInjected).length,
        outcomes.length
      ),
      status: "MEASURED",
    },
    staleStateRecallRate: {
      value: ratio(
        latestStateCases.filter((o) => o.staleInjected).length,
        latestStateCases.length
      ),
      status: "MEASURED",
    },
    secretLeakCount: {
      value: secretCases.reduce((sum, o) => sum + (o.secretLeaked ? 1 : 0), 0),
      status: secretCases.length > 0 ? "MEASURED" : "NOT_MEASURED",
      ...(secretCases.length > 0
        ? {}
        : { reason: "no wrong-observer production path executed" }),
    },
    baselineVsShadowDelta: {
      value: null,
      status: "NOT_APPLICABLE",
      reason: "no Jev shadow path executed — nothing to compare against baseline",
    },
    providerCallsPerTurn: {
      value: transportMeasured ? transport.httpCallsObserved / transport.evaluatedTurns : null,
      status: transportMeasured ? "MEASURED" : "NOT_MEASURED",
      ...(transportMeasured
        ? { reason: "fetch spy over the benchmark run; benchmark imports no provider modules" }
        : { reason: "no transport observation attached" }),
    },
    jevInvocationRate: {
      value: transportMeasured ? transport.jevCallsObserved / transport.evaluatedTurns : null,
      status: transportMeasured ? "MEASURED" : "NOT_MEASURED",
      ...(transportMeasured
        ? { reason: "fetch spy filtered to the Jev Decisions endpoint; no live run authorized" }
        : { reason: "no transport observation attached" }),
    },
    jevP50LatencyMs: {
      value: null,
      status: "NOT_APPLICABLE",
      reason: "no live Jev run; no benchmark-only Jev credential owner exists",
    },
    jevP95LatencyMs: {
      value: null,
      status: "NOT_APPLICABLE",
      reason: "no live Jev run; no benchmark-only Jev credential owner exists",
    },
    jevCostPer1000Turns: {
      value: null,
      status: "NOT_APPLICABLE",
      reason: "no live Jev run; production OPENROUTER_API_KEY must not be reused for tests",
    },
    promptTokenDelta: {
      value: null,
      status: "NOT_APPLICABLE",
      reason: "no shadow prompt exists to compare against the production prompt",
    },
    fallbackParity: {
      value: null,
      status: "NOT_APPLICABLE",
      reason: "no shadow path exists; production V2 is untouched so parity is structural, not measured",
    },
  };
}

function fmtMetric(value: number | boolean | null): string {
  if (value == null) return "null";
  if (typeof value === "boolean") return String(value);
  return value.toFixed(3);
}

export function formatBenchmarkMetricsLine(metrics: BenchmarkRawMetrics): string {
  const parts = [
    `cases=${metrics.cases}`,
    `candidateRecall@K=${fmtMetric(metrics.candidateRecallAtK.value)}[${metrics.candidateRecallAtK.status}]`,
    `finalRecall@8=${fmtMetric(metrics.finalRecallAt8.value)}[${metrics.finalRecallAt8.status}]`,
    `falseInjectionRate=${fmtMetric(metrics.falseInjectionRate.value)}[${metrics.falseInjectionRate.status}]`,
    `staleStateRecallRate=${fmtMetric(metrics.staleStateRecallRate.value)}[${metrics.staleStateRecallRate.status}]`,
    `secretLeakCount=${fmtMetric(metrics.secretLeakCount.value)}[${metrics.secretLeakCount.status}]`,
    `baselineVsShadowDelta=${fmtMetric(metrics.baselineVsShadowDelta.value)}[${metrics.baselineVsShadowDelta.status}]`,
    `providerCallsPerTurn=${fmtMetric(metrics.providerCallsPerTurn.value)}[${metrics.providerCallsPerTurn.status}]`,
    `jevInvocationRate=${fmtMetric(metrics.jevInvocationRate.value)}[${metrics.jevInvocationRate.status}]`,
    `jevP50=${fmtMetric(metrics.jevP50LatencyMs.value)}[${metrics.jevP50LatencyMs.status}]`,
    `jevP95=${fmtMetric(metrics.jevP95LatencyMs.value)}[${metrics.jevP95LatencyMs.status}]`,
    `jevCostPer1k=${fmtMetric(metrics.jevCostPer1000Turns.value)}[${metrics.jevCostPer1000Turns.status}]`,
    `promptTokenDelta=${fmtMetric(metrics.promptTokenDelta.value)}[${metrics.promptTokenDelta.status}]`,
    `fallbackParity=${fmtMetric(metrics.fallbackParity.value)}[${metrics.fallbackParity.status}]`,
  ];
  return parts.join(" ");
}
