/**
 * Site RP Memory Benchmark — raw metrics only, no subjective quality scores.
 *
 * READER AUDIT:
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
 * Metric semantics:
 * - Every metric carries a measurement status. Values that were not actually
 *   measured are null with NOT_MEASURED / NOT_APPLICABLE — never 0/true.
 * - Every rate uses ONLY the cases whose evidence for that stage was actually
 *   produced by a canonical owner (per-metric eligibility). A case that did
 *   not run a stage carries no evidence object for it and never enters that
 *   metric's denominator.
 */

export type MeasurementStatus = "MEASURED" | "DERIVED" | "NOT_MEASURED" | "NOT_APPLICABLE";

export type MeasuredValue<T> = {
  value: T | null;
  status: MeasurementStatus;
  /** Cases that actually executed the owner this metric depends on. */
  eligibleCases?: number;
  totalCases?: number;
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
  | "location_ownership_transition"
  | "zero_relevant_control"
  | "t6"
  | "t20"
  | "t100"
  | "t2000"
  | "relationship_role_consistency"
  | "item_ownership"
  | "npc_durable_state"
  | "distinctive_utterance"
  | "correction_supersession"
  | "false_memory_negative"
  | "continuity_reset"
  | "high_noise_distractors";

/** Categories whose final result is judged for relationship/role consistency. */
export const RELATIONSHIP_ROLE_CATEGORIES: readonly BenchmarkCategory[] = [
  "role_event_direction",
  "relationship_role_consistency",
];

/** Evidence from `fetchEpisodicMemoryCandidatesForDebug` (pre-rank candidate set). */
export type CandidateStageEvidence = {
  expectedAnswerIds: readonly number[];
  candidateIds: readonly number[];
};

/**
 * Evidence from `getEpisodicMemoryForPrompt` (final prompt facts).
 * `allowedFactIds` is the explicit per-case set of facts that may legitimately
 * be injected; anything else injected is a false injection. Fixture names are
 * never used to decide correctness.
 */
export type FinalStageEvidence = {
  expectedAnswerIds: readonly number[];
  allowedFactIds: readonly number[];
  injectedFactIds: readonly number[];
};

/** Evidence from a real stale-vs-latest competition inside one DB. */
export type StaleStateEvidence = {
  staleFactIds: readonly number[];
  injectedFactIds: readonly number[];
};

/**
 * Evidence from the canonical knowledge-store observer isolation owner
 * (`personaSecretKnowledge.getObserverSecretKnowledge`).
 * KNOWLEDGE-STORE ISOLATION ≠ END-TO-END PROMPT NON-LEAKAGE: this proves a
 * wrong observer cannot read another observer's knowledge row; it does NOT
 * prove the final prompt/context assembly omits secret text.
 */
export type ObserverIsolationEvidence = {
  wrongObserverLookups: number;
  wrongObserverHits: number;
};

/** Evidence from a real correction: the corrected value must win, the superseded one must not surface. */
export type CorrectionEvidence = {
  supersededIds: readonly number[];
  correctedIds: readonly number[];
  injectedFactIds: readonly number[];
};

/** Evidence from a case seeded with explicitly irrelevant distractor facts. */
export type DistractorEvidence = {
  distractorIds: readonly number[];
  injectedFactIds: readonly number[];
};

export type BenchmarkCaseOutcome = {
  caseId: string;
  category: BenchmarkCategory;
  candidate?: CandidateStageEvidence;
  final?: FinalStageEvidence;
  stale?: StaleStateEvidence;
  observerIsolation?: ObserverIsolationEvidence;
  correction?: CorrectionEvidence;
  distractor?: DistractorEvidence;
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
  /** Cases with an expected answer that ran candidate discovery. */
  candidateRecallAtK: MeasuredValue<number>;
  /** Cases with an expected answer that ran final retrieval (max 8 facts). */
  finalRecallAt8: MeasuredValue<number>;
  /** Cases that ran final retrieval with an explicit allowed-ID set. */
  falseInjectionRate: MeasuredValue<number>;
  /** Cases that ran a real stale-vs-latest competition. */
  staleStateRecallRate: MeasuredValue<number>;
  /** Fact-level: injected facts inside the allowed set / all injected facts. */
  precision: MeasuredValue<number>;
  /** Negative cases (no expected answer): rate of injecting any fact outside the allowed set. */
  falseMemoryRate: MeasuredValue<number>;
  /** Cases seeded with distractors: rate of injecting at least one distractor. */
  irrelevantInjectionRate: MeasuredValue<number>;
  /** Relationship/role cases: expected recalled, nothing outside allowed, no stale role. */
  relationshipRoleConsistency: MeasuredValue<number>;
  /** distinctive_utterance cases: final recall of the quoted line. */
  distinctiveUtteranceRecall: MeasuredValue<number>;
  /** Correction cases: every corrected fact injected and no superseded fact injected. */
  correctionSupersessionAccuracy: MeasuredValue<number>;
  /** Knowledge-store observer isolation only (see ObserverIsolationEvidence). */
  wrongObserverKnowledgeLeakCount: MeasuredValue<number>;
  /** Prompt/context-level secret leak — requires the final assembly path. */
  secretLeakCount: MeasuredValue<number>;
  baselineVsShadowDelta: MeasuredValue<number>;
  /** Observed transport HTTP calls per evaluated retrieval turn (fetch spy). */
  providerCallsPerTurn: MeasuredValue<number>;
  /** Observed Jev transport invocations per evaluated retrieval turn (fetch spy). */
  jevInvocationRate: MeasuredValue<number>;
  jevP50LatencyMs: MeasuredValue<number>;
  jevP95LatencyMs: MeasuredValue<number>;
  jevCostPer1000Turns: MeasuredValue<number>;
  promptTokenDelta: MeasuredValue<number>;
  fallbackParity: MeasuredValue<boolean>;
};

export type BenchmarkTransportObservation = {
  /** Evaluated retrieval turns (denominator for per-turn rates). */
  evaluatedTurns: number;
  /** Transport-level HTTP calls observed during the run (fetch spy). */
  httpCallsObserved: number;
  /** …of which targeted the Jev Decisions endpoint. */
  jevCallsObserved: number;
};

/** A final result is a false injection iff any injected fact is outside the allowed set. */
export function detectFalseInjection(final: FinalStageEvidence): boolean {
  const allowed = new Set(final.allowedFactIds);
  return final.injectedFactIds.some((id) => !allowed.has(id));
}

function containsAll(haystack: readonly number[], needles: readonly number[]): boolean {
  const set = new Set(haystack);
  return needles.every((id) => set.has(id));
}

function rateMetric(
  eligible: number,
  hits: number,
  totalCases: number,
  notMeasuredReason: string
): MeasuredValue<number> {
  if (eligible === 0) {
    return { value: null, status: "NOT_MEASURED", eligibleCases: 0, totalCases, reason: notMeasuredReason };
  }
  return { value: hits / eligible, status: "MEASURED", eligibleCases: eligible, totalCases };
}

/**
 * Pure aggregation over deterministic case outcomes from actually executed
 * canonical owners. Per-metric denominators include only cases that carry
 * evidence for that stage.
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
  const total = outcomes.length;

  const candidateCases = outcomes.filter(
    (o) => o.candidate && o.candidate.expectedAnswerIds.length > 0
  );
  const candidateHits = candidateCases.filter((o) =>
    containsAll(o.candidate!.candidateIds, o.candidate!.expectedAnswerIds)
  ).length;

  const finalRecallCases = outcomes.filter(
    (o) => o.final && o.final.expectedAnswerIds.length > 0
  );
  const finalRecallHits = finalRecallCases.filter((o) =>
    containsAll(o.final!.injectedFactIds, o.final!.expectedAnswerIds)
  ).length;

  const falseInjectionCases = outcomes.filter((o) => o.final);
  const falseInjectionHits = falseInjectionCases.filter((o) => detectFalseInjection(o.final!)).length;

  const staleCases = outcomes.filter((o) => o.stale);
  const staleHits = staleCases.filter((o) => {
    const stale = new Set(o.stale!.staleFactIds);
    return o.stale!.injectedFactIds.some((id) => stale.has(id));
  }).length;

  const isolationCases = outcomes.filter((o) => o.observerIsolation);
  const isolationLeaks = isolationCases.reduce(
    (sum, o) => sum + o.observerIsolation!.wrongObserverHits,
    0
  );

  let injectedTotal = 0;
  let injectedAllowed = 0;
  for (const o of falseInjectionCases) {
    const allowed = new Set(o.final!.allowedFactIds);
    injectedTotal += o.final!.injectedFactIds.length;
    injectedAllowed += o.final!.injectedFactIds.filter((id) => allowed.has(id)).length;
  }

  const negativeCases = falseInjectionCases.filter((o) => o.final!.expectedAnswerIds.length === 0);
  const negativeHits = negativeCases.filter((o) => detectFalseInjection(o.final!)).length;

  const distractorCases = outcomes.filter((o) => o.distractor);
  const distractorHits = distractorCases.filter((o) => {
    const distractors = new Set(o.distractor!.distractorIds);
    return o.distractor!.injectedFactIds.some((id) => distractors.has(id));
  }).length;

  const roleCases = outcomes.filter(
    (o) => RELATIONSHIP_ROLE_CATEGORIES.includes(o.category) && o.final && o.final.expectedAnswerIds.length > 0
  );
  const roleHits = roleCases.filter((o) => {
    const staleInjected = o.stale
      ? o.stale.injectedFactIds.some((id) => o.stale!.staleFactIds.includes(id))
      : false;
    return containsAll(o.final!.injectedFactIds, o.final!.expectedAnswerIds) && !detectFalseInjection(o.final!) && !staleInjected;
  }).length;

  const utteranceCases = outcomes.filter(
    (o) => o.category === "distinctive_utterance" && o.final && o.final.expectedAnswerIds.length > 0
  );
  const utteranceHits = utteranceCases.filter((o) =>
    containsAll(o.final!.injectedFactIds, o.final!.expectedAnswerIds)
  ).length;

  const correctionCases = outcomes.filter((o) => o.correction);
  const correctionHits = correctionCases.filter(
    (o) =>
      containsAll(o.correction!.injectedFactIds, o.correction!.correctedIds) &&
      !o.correction!.injectedFactIds.some((id) => o.correction!.supersededIds.includes(id))
  ).length;

  const transportMeasured = transport.evaluatedTurns > 0;

  return {
    cases: total,
    coverage: [...coverage],
    candidateRecallAtK: rateMetric(
      candidateCases.length,
      candidateHits,
      total,
      "no case with an expected answer ran candidate discovery"
    ),
    finalRecallAt8: rateMetric(
      finalRecallCases.length,
      finalRecallHits,
      total,
      "no case with an expected answer ran final retrieval"
    ),
    falseInjectionRate: rateMetric(
      falseInjectionCases.length,
      falseInjectionHits,
      total,
      "no case ran final retrieval with an allowed-ID set"
    ),
    staleStateRecallRate: rateMetric(
      staleCases.length,
      staleHits,
      total,
      "no stale-vs-latest competition executed"
    ),
    precision:
      injectedTotal > 0
        ? {
            value: injectedAllowed / injectedTotal,
            status: "MEASURED",
            eligibleCases: falseInjectionCases.length,
            totalCases: total,
            reason: "fact-level over every final retrieval with an allowed-ID set",
          }
        : {
            value: null,
            status: "NOT_MEASURED",
            eligibleCases: falseInjectionCases.length,
            totalCases: total,
            reason: "no fact was injected by any final retrieval",
          },
    falseMemoryRate: rateMetric(
      negativeCases.length,
      negativeHits,
      total,
      "no negative (no-expected-answer) final retrieval executed"
    ),
    irrelevantInjectionRate: rateMetric(
      distractorCases.length,
      distractorHits,
      total,
      "no distractor-seeded case executed"
    ),
    relationshipRoleConsistency: rateMetric(
      roleCases.length,
      roleHits,
      total,
      "no relationship/role case ran final retrieval"
    ),
    distinctiveUtteranceRecall: rateMetric(
      utteranceCases.length,
      utteranceHits,
      total,
      "no distinctive-utterance case ran final retrieval"
    ),
    correctionSupersessionAccuracy: rateMetric(
      correctionCases.length,
      correctionHits,
      total,
      "no correction case executed"
    ),
    wrongObserverKnowledgeLeakCount:
      isolationCases.length > 0
        ? {
            value: isolationLeaks,
            status: "MEASURED",
            eligibleCases: isolationCases.length,
            totalCases: total,
            reason: "knowledge-store observer isolation only; not end-to-end prompt non-leakage",
          }
        : {
            value: null,
            status: "NOT_MEASURED",
            eligibleCases: 0,
            totalCases: total,
            reason: "observer isolation owner not executed",
          },
    secretLeakCount: {
      value: null,
      status: "NOT_MEASURED",
      eligibleCases: 0,
      totalCases: total,
      reason: "final wrong-observer prompt/context assembly not executed",
    },
    baselineVsShadowDelta: {
      value: null,
      status: "NOT_APPLICABLE",
      reason: "no Jev shadow path executed — nothing to compare against baseline",
    },
    providerCallsPerTurn: transportMeasured
      ? {
          value: transport.httpCallsObserved / transport.evaluatedTurns,
          status: "MEASURED",
          reason: "fetch spy over the benchmark run; benchmark imports no provider call path",
        }
      : { value: null, status: "NOT_MEASURED", reason: "no transport observation attached" },
    jevInvocationRate: transportMeasured
      ? {
          value: transport.jevCallsObserved / transport.evaluatedTurns,
          status: "MEASURED",
          reason: "fetch spy filtered to the Jev Decisions endpoint; no live run authorized",
        }
      : { value: null, status: "NOT_MEASURED", reason: "no transport observation attached" },
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

function fmtMetric(name: string, metric: MeasuredValue<number | boolean>): string {
  const v = metric.value;
  const value = v == null ? "null" : typeof v === "boolean" ? String(v) : Number.isInteger(v) ? String(v) : v.toFixed(3);
  const eligibility =
    metric.eligibleCases != null && metric.totalCases != null
      ? `, eligibleCases=${metric.eligibleCases}/${metric.totalCases}`
      : "";
  return `${name}=${value}[${metric.status}${eligibility}]`;
}

export function formatBenchmarkMetricsLine(metrics: BenchmarkRawMetrics): string {
  return [
    `cases=${metrics.cases}`,
    fmtMetric("candidateRecall@K", metrics.candidateRecallAtK),
    fmtMetric("finalRecall@8", metrics.finalRecallAt8),
    fmtMetric("falseInjectionRate", metrics.falseInjectionRate),
    fmtMetric("staleStateRecallRate", metrics.staleStateRecallRate),
    fmtMetric("precision", metrics.precision),
    fmtMetric("falseMemoryRate", metrics.falseMemoryRate),
    fmtMetric("irrelevantInjectionRate", metrics.irrelevantInjectionRate),
    fmtMetric("relationshipRoleConsistency", metrics.relationshipRoleConsistency),
    fmtMetric("distinctiveUtteranceRecall", metrics.distinctiveUtteranceRecall),
    fmtMetric("correctionSupersessionAccuracy", metrics.correctionSupersessionAccuracy),
    fmtMetric("wrongObserverKnowledgeLeakCount", metrics.wrongObserverKnowledgeLeakCount),
    fmtMetric("secretLeakCount", metrics.secretLeakCount),
    fmtMetric("baselineVsShadowDelta", metrics.baselineVsShadowDelta),
    fmtMetric("providerCallsPerTurn", metrics.providerCallsPerTurn),
    fmtMetric("jevInvocationRate", metrics.jevInvocationRate),
    fmtMetric("jevP50", metrics.jevP50LatencyMs),
    fmtMetric("jevP95", metrics.jevP95LatencyMs),
    fmtMetric("jevCostPer1k", metrics.jevCostPer1000Turns),
    fmtMetric("promptTokenDelta", metrics.promptTokenDelta),
    fmtMetric("fallbackParity", metrics.fallbackParity),
  ].join(" ");
}
