/**
 * Memory baseline quality trend evidence.
 *
 * Reuses the canonical compareQuality() semantics. This module never creates a
 * second scorer, never touches production, and treats benchmark-definition
 * changes as a rebase instead of comparing incompatible denominators.
 */
import {
  compareQuality,
  type LabRunSummary,
  type MetricComparison,
} from "@/lib/memoryResearch/gates";

export type BaselineHistorySnapshot = {
  cycleKey: string;
  mainSha: string;
  architectureFingerprint: string;
  benchmarkDefinitionFingerprint: string;
  baseline: LabRunSummary;
};

export type BaselineTrendStatus =
  | "NO_HISTORY"
  | "REBASE"
  | "STABLE"
  | "IMPROVED"
  | "REGRESSION";

export type BaselineTrendReport = {
  status: BaselineTrendStatus;
  comparedCycleKey: string | null;
  comparedMainSha: string | null;
  benchmarkDefinitionFingerprint: string;
  comparisons: MetricComparison[];
  regressedMetrics: string[];
  improvedMetrics: string[];
  promptTokensPerTurn: {
    previous: number | null;
    current: number;
    delta: number | null;
    deltaPct: number | null;
    warning: boolean;
  };
  note: string;
};

const TOKEN_WARNING_FRACTION = 0.05;

function perTurn(summary: LabRunSummary): number {
  return summary.evaluatedTurns > 0
    ? summary.promptTokensInjected / summary.evaluatedTurns
    : 0;
}

export function parseBaselineHistorySnapshot(
  value: unknown
): BaselineHistorySnapshot | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const baseline = row.baseline;
  const fingerprint = row.benchmarkDefinitionFingerprint;
  if (
    typeof row.cycleKey !== "string" ||
    typeof row.mainSha !== "string" ||
    typeof row.architectureFingerprint !== "string" ||
    typeof fingerprint !== "string" ||
    !baseline ||
    typeof baseline !== "object"
  ) {
    return null;
  }
  const baselineRow = baseline as Record<string, unknown>;
  const summary = baselineRow.summary;
  if (!summary || typeof summary !== "object") return null;
  const s = summary as Record<string, unknown>;
  if (
    typeof s.label !== "string" ||
    !s.metrics ||
    typeof s.metrics !== "object" ||
    !Array.isArray(s.invariantViolations) ||
    typeof s.evaluatedTurns !== "number" ||
    typeof s.promptTokensInjected !== "number" ||
    typeof s.httpCallsObserved !== "number" ||
    !s.embeddingCalls ||
    typeof s.embeddingCalls !== "object" ||
    typeof s.wallClockMs !== "number" ||
    !s.finalHitByCase ||
    typeof s.finalHitByCase !== "object"
  ) {
    return null;
  }
  return {
    cycleKey: row.cycleKey,
    mainSha: row.mainSha,
    architectureFingerprint: row.architectureFingerprint,
    benchmarkDefinitionFingerprint: fingerprint,
    baseline: summary as unknown as LabRunSummary,
  };
}

export function evaluateBaselineQualityTrend(input: {
  current: LabRunSummary;
  benchmarkDefinitionFingerprint: string;
  history: readonly BaselineHistorySnapshot[];
}): BaselineTrendReport {
  const currentTokens = perTurn(input.current);
  const latestAny = input.history.at(-1) ?? null;
  const previous =
    [...input.history]
      .reverse()
      .find(
        (row) =>
          row.benchmarkDefinitionFingerprint ===
          input.benchmarkDefinitionFingerprint
      ) ?? null;

  if (!previous) {
    return {
      status: latestAny ? "REBASE" : "NO_HISTORY",
      comparedCycleKey: null,
      comparedMainSha: null,
      benchmarkDefinitionFingerprint: input.benchmarkDefinitionFingerprint,
      comparisons: [],
      regressedMetrics: [],
      improvedMetrics: [],
      promptTokensPerTurn: {
        previous: null,
        current: currentTokens,
        delta: null,
        deltaPct: null,
        warning: false,
      },
      note: latestAny
        ? "No prior snapshot uses the current benchmark definition; establish a new comparable baseline."
        : "No prior structured baseline snapshot is available yet.",
    };
  }

  const comparisons = compareQuality(previous.baseline, input.current);
  const regressedMetrics = comparisons
    .filter((row) => row.verdict === "regressed")
    .map((row) => row.key);
  const improvedMetrics = comparisons
    .filter((row) => row.verdict === "improved")
    .map((row) => row.key);

  const previousTokens = perTurn(previous.baseline);
  const tokenDelta = currentTokens - previousTokens;
  const tokenDeltaPct =
    previousTokens > 0 ? tokenDelta / previousTokens : tokenDelta === 0 ? 0 : null;
  const tokenWarning =
    tokenDeltaPct !== null && tokenDeltaPct > TOKEN_WARNING_FRACTION;

  const status: BaselineTrendStatus =
    regressedMetrics.length > 0
      ? "REGRESSION"
      : improvedMetrics.length > 0
        ? "IMPROVED"
        : "STABLE";

  return {
    status,
    comparedCycleKey: previous.cycleKey,
    comparedMainSha: previous.mainSha,
    benchmarkDefinitionFingerprint: input.benchmarkDefinitionFingerprint,
    comparisons,
    regressedMetrics,
    improvedMetrics,
    promptTokensPerTurn: {
      previous: previousTokens,
      current: currentTokens,
      delta: tokenDelta,
      deltaPct: tokenDeltaPct,
      warning: tokenWarning,
    },
    note:
      status === "REGRESSION"
        ? "One or more canonical raw quality metrics regressed; improvements do not offset regressions."
        : tokenWarning
          ? "Quality metrics did not regress, but prompt tokens per evaluated turn increased by more than 5%."
          : "No canonical raw quality regression detected against the latest compatible snapshot.",
  };
}

export function renderBaselineQualityTrendMarkdown(
  report: BaselineTrendReport
): string {
  const pct =
    report.promptTokensPerTurn.deltaPct == null
      ? "-"
      : `${(report.promptTokensPerTurn.deltaPct * 100).toFixed(1)}%`;
  const lines = [
    "## Memory Quality Trend Sentinel",
    "",
    `- status: **${report.status}**`,
    `- benchmark definition: \`${report.benchmarkDefinitionFingerprint}\``,
    `- compared cycle: ${report.comparedCycleKey ?? "-"}`,
    `- compared main: ${report.comparedMainSha ?? "-"}`,
    `- prompt tokens/evaluated turn: ${report.promptTokensPerTurn.current.toFixed(2)} (delta ${pct}${report.promptTokensPerTurn.warning ? ", WARNING" : ""})`,
    `- regressed metrics: ${report.regressedMetrics.join(", ") || "none"}`,
    `- improved metrics: ${report.improvedMetrics.join(", ") || "none"}`,
    `- note: ${report.note}`,
    "",
  ];
  if (report.comparisons.length > 0) {
    lines.push(
      "| metric | previous | current | delta | verdict |",
      "|---|---:|---:|---:|---|"
    );
    for (const row of report.comparisons) {
      lines.push(
        `| ${row.key} | ${row.baseline ?? "-"} | ${row.candidate ?? "-"} | ${row.delta ?? "-"} | ${row.verdict} |`
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}
