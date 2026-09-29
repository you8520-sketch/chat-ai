/**
 * Baseline memory benchmark trend sentinel.
 *
 * Compares deterministic baseline snapshots across research cycles only when
 * the benchmark definition fingerprint is identical. Research-only evidence:
 * no production reads/writes and no CI blocking policy.
 */
import {
  QUALITY_METRICS,
  type LabRunSummary,
  type QualityMetricKey,
} from "@/lib/memoryResearch/gates";

export type BaselineMetricSnapshot = {
  value: number | null;
  status: string;
  eligibleCases: number | null;
  totalCases: number | null;
};

export type BaselineSnapshot = {
  benchmarkFingerprint: string;
  cases: number;
  evaluatedTurns: number;
  promptTokensPerTurn: number;
  invariantViolationCount: number;
  metrics: Record<QualityMetricKey, BaselineMetricSnapshot>;
  finalHitByCase: Record<string, boolean>;
};

export type BaselineTrendStatus =
  | "UNAVAILABLE"
  | "NO_HISTORY"
  | "BASELINE_FAILED"
  | "BENCHMARK_CHANGED"
  | "STABLE"
  | "REGRESSION"
  | "IMPROVEMENT"
  | "MIXED";

export type BaselineTrendMetricDelta = {
  key: QualityMetricKey;
  previous: number | null;
  current: number | null;
  delta: number | null;
  verdict: "improved" | "regressed" | "unchanged" | "not_comparable";
};

export type BaselineTrendReport = {
  status: BaselineTrendStatus;
  previousCycleKey: string | null;
  benchmarkFingerprint: string | null;
  metricDeltas: BaselineTrendMetricDelta[];
  lostPositiveCases: string[];
  gainedPositiveCases: string[];
  promptTokensPerTurnDelta: number | null;
  promptTokenTrend: "INCREASED" | "DECREASED" | "UNCHANGED" | "NOT_COMPARABLE";
  invariantViolationDelta: number | null;
  note: string;
};

export type HistoricalBaselineEntry = {
  cycleKey: string;
  baseline?: BaselineSnapshot | null;
};

function perTurn(total: number, turns: number): number {
  return turns > 0 ? total / turns : 0;
}

export function buildBaselineSnapshot(
  summary: LabRunSummary,
  benchmarkFingerprint: string
): BaselineSnapshot {
  const metrics = {} as Record<QualityMetricKey, BaselineMetricSnapshot>;
  for (const { key } of QUALITY_METRICS) {
    const metric = summary.metrics[key];
    metrics[key] = {
      value: metric.value,
      status: metric.status,
      eligibleCases: metric.eligibleCases ?? null,
      totalCases: metric.totalCases ?? null,
    };
  }
  return {
    benchmarkFingerprint,
    cases: summary.metrics.cases,
    evaluatedTurns: summary.evaluatedTurns,
    promptTokensPerTurn: perTurn(summary.promptTokensInjected, summary.evaluatedTurns),
    invariantViolationCount: summary.invariantViolations.length,
    metrics,
    finalHitByCase: { ...summary.finalHitByCase },
  };
}

function metricComparable(a: BaselineMetricSnapshot, b: BaselineMetricSnapshot): boolean {
  return (
    a.status === "MEASURED" &&
    b.status === "MEASURED" &&
    a.value !== null &&
    b.value !== null &&
    a.eligibleCases === b.eligibleCases &&
    a.totalCases === b.totalCases
  );
}

export function unavailableBaselineTrend(note: string): BaselineTrendReport {
  return {
    status: "UNAVAILABLE",
    previousCycleKey: null,
    benchmarkFingerprint: null,
    metricDeltas: [],
    lostPositiveCases: [],
    gainedPositiveCases: [],
    promptTokensPerTurnDelta: null,
    invariantViolationDelta: null,
    note,
  };
}

export function compareBaselineSnapshots(
  current: BaselineSnapshot | null,
  history: readonly HistoricalBaselineEntry[]
): BaselineTrendReport {
  if (!current) {
    return {
      status: "BASELINE_FAILED",
      previousCycleKey: null,
      benchmarkFingerprint: null,
      metricDeltas: [],
      lostPositiveCases: [],
      gainedPositiveCases: [],
      promptTokensPerTurnDelta: null,
      promptTokenTrend: "NOT_COMPARABLE",
      invariantViolationDelta: null,
      note: "Current deterministic baseline did not run successfully.",
    };
  }

  const previousEntry = [...history].reverse().find((entry) => entry.baseline != null);
  const previous = previousEntry?.baseline ?? null;
  if (!previous || !previousEntry) {
    return {
      status: "NO_HISTORY",
      previousCycleKey: null,
      benchmarkFingerprint: current.benchmarkFingerprint,
      metricDeltas: [],
      lostPositiveCases: [],
      gainedPositiveCases: [],
      promptTokensPerTurnDelta: null,
      promptTokenTrend: "NOT_COMPARABLE",
      invariantViolationDelta: null,
      note: "No prior baseline snapshot is available yet.",
    };
  }

  if (previous.benchmarkFingerprint !== current.benchmarkFingerprint) {
    return {
      status: "BENCHMARK_CHANGED",
      previousCycleKey: previousEntry.cycleKey,
      benchmarkFingerprint: current.benchmarkFingerprint,
      metricDeltas: [],
      lostPositiveCases: [],
      gainedPositiveCases: [],
      promptTokensPerTurnDelta: null,
      promptTokenTrend: "NOT_COMPARABLE",
      invariantViolationDelta: null,
      note:
        "Benchmark definition fingerprint changed; aggregate metrics are intentionally not compared across different case definitions.",
    };
  }

  const metricDeltas: BaselineTrendMetricDelta[] = QUALITY_METRICS.map(({ key, direction }) => {
    const before = previous.metrics[key];
    const after = current.metrics[key];
    if (!before || !after || !metricComparable(before, after)) {
      return {
        key,
        previous: before?.value ?? null,
        current: after?.value ?? null,
        delta: null,
        verdict: "not_comparable" as const,
      };
    }
    const delta = after.value! - before.value!;
    const improved = direction === "higher_is_better" ? delta > 0 : delta < 0;
    const regressed = direction === "higher_is_better" ? delta < 0 : delta > 0;
    return {
      key,
      previous: before.value,
      current: after.value,
      delta,
      verdict: improved
        ? ("improved" as const)
        : regressed
          ? ("regressed" as const)
          : ("unchanged" as const),
    };
  });

  const lostPositiveCases = Object.entries(previous.finalHitByCase)
    .filter(([caseId, hit]) => hit === true && current.finalHitByCase[caseId] === false)
    .map(([caseId]) => caseId)
    .sort();
  const gainedPositiveCases = Object.entries(current.finalHitByCase)
    .filter(([caseId, hit]) => hit === true && previous.finalHitByCase[caseId] === false)
    .map(([caseId]) => caseId)
    .sort();

  const promptTokensPerTurnDelta =
    current.promptTokensPerTurn - previous.promptTokensPerTurn;
  const invariantViolationDelta =
    current.invariantViolationCount - previous.invariantViolationCount;

  const hasRegression =
    metricDeltas.some((row) => row.verdict === "regressed") ||
    lostPositiveCases.length > 0 ||
    invariantViolationDelta > 0;
  const hasImprovement =
    metricDeltas.some((row) => row.verdict === "improved") ||
    gainedPositiveCases.length > 0 ||
    invariantViolationDelta < 0;
  const status: BaselineTrendStatus =
    hasRegression && hasImprovement
      ? "MIXED"
      : hasRegression
        ? "REGRESSION"
        : hasImprovement
          ? "IMPROVEMENT"
          : "STABLE";

  return {
    status,
    previousCycleKey: previousEntry.cycleKey,
    benchmarkFingerprint: current.benchmarkFingerprint,
    metricDeltas,
    lostPositiveCases,
    gainedPositiveCases,
    promptTokensPerTurnDelta,
    promptTokenTrend:
      promptTokensPerTurnDelta > 0
        ? "INCREASED"
        : promptTokensPerTurnDelta < 0
          ? "DECREASED"
          : "UNCHANGED",
    invariantViolationDelta,
    note:
      promptTokensPerTurnDelta > 0
        ? "Quality trend is reported separately from prompt-token growth; token increase is evidence, not an automatic quality regression."
        : "Deterministic baseline comparison uses raw metric directions and per-case hit evidence only.",
  };
}

export function renderBaselineTrendMarkdown(report: BaselineTrendReport): string {
  const lines = [
    "## Memory Baseline Trend Sentinel",
    "",
    `- status: **${report.status}**`,
    `- previous comparable cycle: ${report.previousCycleKey ?? "-"}`,
    `- benchmark fingerprint: ${report.benchmarkFingerprint ?? "-"}`,
    `- prompt tokens/turn delta: ${report.promptTokensPerTurnDelta == null ? "-" : report.promptTokensPerTurnDelta.toFixed(2)} (${report.promptTokenTrend})`,
    `- invariant violation delta: ${report.invariantViolationDelta == null ? "-" : report.invariantViolationDelta}`,
    `- lost positive cases: ${report.lostPositiveCases.join(", ") || "-"}`,
    `- gained positive cases: ${report.gainedPositiveCases.join(", ") || "-"}`,
    "",
    "| metric | previous | current | delta | verdict |",
    "|---|---:|---:|---:|---|",
    ...report.metricDeltas.map(
      (row) =>
        `| ${row.key} | ${row.previous ?? "-"} | ${row.current ?? "-"} | ${row.delta ?? "-"} | ${row.verdict} |`
    ),
    "",
    `- ${report.note}`,
    "",
  ];
  return lines.join("\n");
}
