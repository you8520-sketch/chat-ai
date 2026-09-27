/**
 * ACCEPT/REJECT gates. Rule-based over raw metrics — no composite score.
 * Order: evidence completeness → regressions → quality gain → efficiency →
 * architecture complexity. The first failing gate decides.
 */
import type { BenchmarkRawMetrics, MeasuredValue } from "@/lib/memory/memory-rp-benchmark";
import type { ArchitectureDelta, DeclaredProductionEfficiency } from "@/lib/memoryResearch/experiments";
import type { CandidateDecisionCode } from "@/lib/memoryResearch/types";

export type LabRunSummary = {
  label: string;
  metrics: BenchmarkRawMetrics;
  invariantViolations: readonly string[];
  evaluatedTurns: number;
  promptTokensInjected: number;
  httpCallsObserved: number;
  embeddingCalls: { query: number; index: number };
  wallClockMs: number;
  /** caseId → expected answer fully injected (positive cases only). */
  finalHitByCase: Readonly<Record<string, boolean>>;
};

export type QualityMetricKey =
  | "candidateRecallAtK"
  | "finalRecallAt8"
  | "precision"
  | "falseInjectionRate"
  | "falseMemoryRate"
  | "staleStateRecallRate"
  | "relationshipRoleConsistency"
  | "distinctiveUtteranceRecall"
  | "correctionSupersessionAccuracy"
  | "irrelevantInjectionRate";

type Direction = "higher_is_better" | "lower_is_better";

export const QUALITY_METRICS: ReadonlyArray<{
  key: QualityMetricKey;
  direction: Direction;
  regression: CandidateDecisionCode;
  /** Core metrics must be comparable, otherwise the evidence is insufficient. */
  core: boolean;
}> = [
  { key: "falseInjectionRate", direction: "lower_is_better", regression: "REJECTED_FALSE_MEMORY_REGRESSION", core: true },
  { key: "falseMemoryRate", direction: "lower_is_better", regression: "REJECTED_FALSE_MEMORY_REGRESSION", core: true },
  { key: "irrelevantInjectionRate", direction: "lower_is_better", regression: "REJECTED_FALSE_MEMORY_REGRESSION", core: false },
  { key: "precision", direction: "higher_is_better", regression: "REJECTED_PRECISION_REGRESSION", core: true },
  { key: "staleStateRecallRate", direction: "lower_is_better", regression: "REJECTED_STALE_STATE_REGRESSION", core: true },
  { key: "correctionSupersessionAccuracy", direction: "higher_is_better", regression: "REJECTED_STALE_STATE_REGRESSION", core: false },
  { key: "relationshipRoleConsistency", direction: "higher_is_better", regression: "REJECTED_QUALITY_REGRESSION", core: false },
  { key: "candidateRecallAtK", direction: "higher_is_better", regression: "REJECTED_QUALITY_REGRESSION", core: true },
  { key: "finalRecallAt8", direction: "higher_is_better", regression: "REJECTED_QUALITY_REGRESSION", core: true },
  { key: "distinctiveUtteranceRecall", direction: "higher_is_better", regression: "REJECTED_QUALITY_REGRESSION", core: false },
];

/** Production budgets a candidate may add per turn before it is rejected on efficiency. */
export const EFFICIENCY_BUDGET = {
  maxPromptTokenDeltaPerTurn: 150,
  maxProviderCallsPerTurnDelta: 1,
  maxEmbeddingCallsPerTurnDelta: 1,
  maxP95LatencyMsPerTurnDelta: 250,
  maxCostUsdPer1kTurnsDelta: 0.5,
  /** New DB / provider / dependency / scheduler additions need at least this many improved metrics or flipped gaps. */
  minGainsPerNewInfraItem: 2,
} as const;

export type MetricComparison = {
  key: QualityMetricKey;
  baseline: number | null;
  candidate: number | null;
  delta: number | null;
  comparable: boolean;
  verdict: "improved" | "regressed" | "unchanged" | "not_comparable";
  note?: string;
};

export type EfficiencyReport = {
  measured: {
    promptTokenDeltaPerTurn: number;
    httpCallsPerTurnDelta: number;
    embeddingCallsPerTurnDelta: number;
    indexEmbeddingCallsDelta: number;
    wallClockMsDelta: number;
  };
  declared: DeclaredProductionEfficiency;
};

export type GateResult = {
  decision: CandidateDecisionCode;
  reason: string;
  comparisons: MetricComparison[];
  flippedKnownGaps: string[];
  brokenPositiveCases: string[];
  efficiency: EfficiencyReport;
};

function comparable(a: MeasuredValue<number>, b: MeasuredValue<number>): boolean {
  return (
    a.status === "MEASURED" &&
    b.status === "MEASURED" &&
    a.value !== null &&
    b.value !== null &&
    a.eligibleCases === b.eligibleCases
  );
}

export function compareQuality(baseline: LabRunSummary, candidate: LabRunSummary): MetricComparison[] {
  return QUALITY_METRICS.map(({ key, direction }) => {
    const b = baseline.metrics[key];
    const c = candidate.metrics[key];
    if (!comparable(b, c)) {
      return {
        key,
        baseline: b.value,
        candidate: c.value,
        delta: null,
        comparable: false,
        verdict: "not_comparable" as const,
        note: `baseline=${b.status}/${b.eligibleCases ?? "-"} candidate=${c.status}/${c.eligibleCases ?? "-"}`,
      };
    }
    const delta = c.value! - b.value!;
    const better = direction === "higher_is_better" ? delta > 0 : delta < 0;
    const worse = direction === "higher_is_better" ? delta < 0 : delta > 0;
    return {
      key,
      baseline: b.value,
      candidate: c.value,
      delta,
      comparable: true,
      verdict: better ? ("improved" as const) : worse ? ("regressed" as const) : ("unchanged" as const),
    };
  });
}

function perTurn(total: number, turns: number): number {
  return turns > 0 ? total / turns : 0;
}

export function measureEfficiency(
  baseline: LabRunSummary,
  candidate: LabRunSummary,
  declared: DeclaredProductionEfficiency
): EfficiencyReport {
  return {
    measured: {
      promptTokenDeltaPerTurn:
        perTurn(candidate.promptTokensInjected, candidate.evaluatedTurns) -
        perTurn(baseline.promptTokensInjected, baseline.evaluatedTurns),
      httpCallsPerTurnDelta:
        perTurn(candidate.httpCallsObserved, candidate.evaluatedTurns) -
        perTurn(baseline.httpCallsObserved, baseline.evaluatedTurns),
      embeddingCallsPerTurnDelta:
        perTurn(candidate.embeddingCalls.query, candidate.evaluatedTurns) -
        perTurn(baseline.embeddingCalls.query, baseline.evaluatedTurns),
      indexEmbeddingCallsDelta: candidate.embeddingCalls.index - baseline.embeddingCalls.index,
      wallClockMsDelta: candidate.wallClockMs - baseline.wallClockMs,
    },
    declared,
  };
}

function newInfraItems(delta: ArchitectureDelta): string[] {
  return [
    ...delta.newDb.map((x) => `db:${x}`),
    ...delta.newProviders.map((x) => `provider:${x}`),
    ...delta.newDependencies.map((x) => `dependency:${x}`),
    ...delta.newSchedulers.map((x) => `scheduler:${x}`),
  ];
}

export function evaluateGates(input: {
  baseline: LabRunSummary;
  candidate: LabRunSummary;
  declared: DeclaredProductionEfficiency;
  architectureDelta: ArchitectureDelta;
}): GateResult {
  const { baseline, candidate, declared, architectureDelta } = input;
  const comparisons = compareQuality(baseline, candidate);
  const efficiency = measureEfficiency(baseline, candidate, declared);
  const flippedKnownGaps = Object.entries(candidate.finalHitByCase)
    .filter(([caseId, hit]) => hit && baseline.finalHitByCase[caseId] === false)
    .map(([caseId]) => caseId)
    .sort();
  const brokenPositiveCases = Object.entries(baseline.finalHitByCase)
    .filter(([caseId, hit]) => hit && candidate.finalHitByCase[caseId] !== true)
    .map(([caseId]) => caseId)
    .sort();
  const result = (decision: CandidateDecisionCode, reason: string): GateResult => ({
    decision,
    reason,
    comparisons,
    flippedKnownGaps,
    brokenPositiveCases,
    efficiency,
  });

  const missingCore = QUALITY_METRICS.filter((m) => m.core).filter(
    (m) => !comparisons.find((c) => c.key === m.key)!.comparable
  );
  if (missingCore.length > 0) {
    return result(
      "WATCH_INSUFFICIENT_EVIDENCE",
      `core metrics not comparable: ${missingCore.map((m) => m.key).join(", ")}`
    );
  }

  const regressions = QUALITY_METRICS.filter(
    (metric) => comparisons.find((c) => c.key === metric.key)!.verdict === "regressed"
  );
  if (regressions.length > 0) {
    return result(
      regressions[0]!.regression,
      regressions
        .map((metric) => {
          const cmp = comparisons.find((c) => c.key === metric.key)!;
          return `${metric.key} regressed ${cmp.baseline} → ${cmp.candidate}`;
        })
        .join("; ")
    );
  }
  if (brokenPositiveCases.length > 0) {
    return result("REJECTED_QUALITY_REGRESSION", `baseline hits lost: ${brokenPositiveCases.join(", ")}`);
  }
  if (candidate.invariantViolations.length > baseline.invariantViolations.length) {
    return result(
      "REJECTED_QUALITY_REGRESSION",
      `benchmark invariants violated: ${candidate.invariantViolations.slice(0, 5).join(", ")}`
    );
  }

  const gains = comparisons.filter((c) => c.verdict === "improved").length + flippedKnownGaps.length;
  if (gains === 0) return result("REJECTED_NO_QUALITY_GAIN", "no metric improved and no known gap flipped");

  const m = efficiency.measured;
  if (m.promptTokenDeltaPerTurn > EFFICIENCY_BUDGET.maxPromptTokenDeltaPerTurn) {
    return result("REJECTED_COST_REGRESSION", `prompt tokens +${m.promptTokenDeltaPerTurn.toFixed(1)}/turn`);
  }
  if (declared.providerCallsPerTurn > EFFICIENCY_BUDGET.maxProviderCallsPerTurnDelta) {
    return result("REJECTED_COST_REGRESSION", `declared provider calls +${declared.providerCallsPerTurn}/turn`);
  }
  if (
    declared.embeddingCallsPerTurn > EFFICIENCY_BUDGET.maxEmbeddingCallsPerTurnDelta ||
    m.embeddingCallsPerTurnDelta > EFFICIENCY_BUDGET.maxEmbeddingCallsPerTurnDelta
  ) {
    return result("REJECTED_COST_REGRESSION", "embedding calls per turn exceed budget");
  }
  if (declared.costUsdPer1kTurns > EFFICIENCY_BUDGET.maxCostUsdPer1kTurnsDelta) {
    return result("REJECTED_COST_REGRESSION", `declared cost +$${declared.costUsdPer1kTurns}/1k turns`);
  }
  if (declared.p95LatencyMsPerTurn > EFFICIENCY_BUDGET.maxP95LatencyMsPerTurnDelta) {
    return result("REJECTED_LATENCY_REGRESSION", `declared p95 latency +${declared.p95LatencyMsPerTurn}ms/turn`);
  }

  const infra = newInfraItems(architectureDelta);
  if (infra.length > 0 && gains < infra.length * EFFICIENCY_BUDGET.minGainsPerNewInfraItem) {
    return result(
      "REJECTED_INFRA_COMPLEXITY",
      `${gains} gain(s) do not justify new ${infra.join(", ")}`
    );
  }

  return result(
    "ACCEPTED_QUALITY_GAIN",
    `${gains} gain(s): ${[
      ...comparisons.filter((c) => c.verdict === "improved").map((c) => c.key),
      ...flippedKnownGaps.map((id) => `gap:${id}`),
    ].join(", ")}`
  );
}
