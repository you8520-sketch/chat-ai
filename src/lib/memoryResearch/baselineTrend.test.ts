import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { BenchmarkRawMetrics, MeasuredValue } from "@/lib/memory/memory-rp-benchmark";
import {
  evaluateBaselineQualityTrend,
  parseBaselineHistorySnapshot,
  renderBaselineQualityTrendMarkdown,
  type BaselineHistorySnapshot,
} from "@/lib/memoryResearch/baselineTrend";
import type { LabRunSummary } from "@/lib/memoryResearch/gates";

function measured(value: number): MeasuredValue<number> {
  return {
    value,
    status: "MEASURED",
    eligibleCases: 10,
    totalCases: 10,
  };
}

function summary(
  overrides: Partial<Record<
    | "candidateRecallAtK"
    | "finalRecallAt8"
    | "precision"
    | "falseInjectionRate"
    | "falseMemoryRate"
    | "staleStateRecallRate"
    | "relationshipRoleConsistency"
    | "distinctiveUtteranceRecall"
    | "correctionSupersessionAccuracy"
    | "irrelevantInjectionRate",
    number
  >> = {},
  promptTokensInjected = 1000,
  evaluatedTurns = 100
): LabRunSummary {
  const value = (key: keyof typeof overrides, fallback: number) =>
    measured(overrides[key] ?? fallback);
  const metrics = {
    candidateRecallAtK: value("candidateRecallAtK", 0.9),
    finalRecallAt8: value("finalRecallAt8", 0.9),
    precision: value("precision", 0.95),
    falseInjectionRate: value("falseInjectionRate", 0.02),
    falseMemoryRate: value("falseMemoryRate", 0.01),
    staleStateRecallRate: value("staleStateRecallRate", 0.01),
    relationshipRoleConsistency: value("relationshipRoleConsistency", 0.9),
    distinctiveUtteranceRecall: value("distinctiveUtteranceRecall", 0.8),
    correctionSupersessionAccuracy: value("correctionSupersessionAccuracy", 0.9),
    irrelevantInjectionRate: value("irrelevantInjectionRate", 0.02),
  } as unknown as BenchmarkRawMetrics;
  return {
    label: "baseline",
    metrics,
    invariantViolations: [],
    evaluatedTurns,
    promptTokensInjected,
    httpCallsObserved: 0,
    embeddingCalls: { query: 0, index: 0 },
    wallClockMs: 1,
    finalHitByCase: {},
  };
}

function history(
  cycleKey: string,
  finishedAt: string,
  baseline: LabRunSummary,
  fingerprint = "bench-a"
): BaselineHistorySnapshot {
  return {
    cycleKey,
    mainSha: `sha-${cycleKey}`,
    finishedAt,
    architectureFingerprint: `arch-${cycleKey}`,
    benchmarkDefinitionFingerprint: fingerprint,
    baseline,
  };
}

describe("Memory Quality Trend Sentinel", () => {
  it("reports NO_HISTORY for the first structured snapshot", () => {
    const report = evaluateBaselineQualityTrend({
      current: summary(),
      benchmarkDefinitionFingerprint: "bench-a",
      history: [],
    });
    assert.equal(report.status, "NO_HISTORY");
    assert.equal(report.comparedCycleKey, null);
    assert.equal(report.comparisons.length, 0);
  });

  it("rebases instead of comparing incompatible benchmark definitions", () => {
    const report = evaluateBaselineQualityTrend({
      current: summary(),
      benchmarkDefinitionFingerprint: "bench-b",
      history: [
        history("weekly-old", "2026-09-20T00:00:00.000Z", summary(), "bench-a"),
      ],
    });
    assert.equal(report.status, "REBASE");
    assert.equal(report.comparedCycleKey, null);
    assert.equal(report.regressedMetrics.length, 0);
    assert.match(report.note, /new comparable baseline/i);
  });

  it("uses canonical compareQuality semantics and never lets improvements offset regressions", () => {
    const previous = summary();
    const current = summary({
      finalRecallAt8: 0.8,
      precision: 0.98,
    });
    const report = evaluateBaselineQualityTrend({
      current,
      benchmarkDefinitionFingerprint: "bench-a",
      history: [
        history("weekly-1", "2026-09-20T00:00:00.000Z", previous),
      ],
    });
    assert.equal(report.status, "REGRESSION");
    assert.ok(report.regressedMetrics.includes("finalRecallAt8"));
    assert.ok(report.improvedMetrics.includes("precision"));
    assert.match(report.note, /improvements do not offset regressions/i);
  });

  it("flags a core metric that becomes non-comparable as EVIDENCE_GAP", () => {
    const current = summary();
    current.metrics.finalRecallAt8 = {
      value: null,
      status: "NOT_MEASURED",
      eligibleCases: 0,
      totalCases: 10,
      reason: "final owner did not execute",
    };
    const report = evaluateBaselineQualityTrend({
      current,
      benchmarkDefinitionFingerprint: "bench-a",
      history: [
        history("weekly-1", "2026-09-20T00:00:00.000Z", summary()),
      ],
    });
    assert.equal(report.status, "EVIDENCE_GAP");
    assert.deepEqual(report.notComparableCoreMetrics, ["finalRecallAt8"]);
    assert.match(report.note, /no longer comparable/i);
  });

  it("warns on >5% prompt-token growth without fabricating a quality regression", () => {
    const report = evaluateBaselineQualityTrend({
      current: summary({}, 1100, 100),
      benchmarkDefinitionFingerprint: "bench-a",
      history: [
        history("weekly-1", "2026-09-20T00:00:00.000Z", summary({}, 1000, 100)),
      ],
    });
    assert.equal(report.status, "STABLE");
    assert.equal(report.promptTokensPerTurn.warning, true);
    assert.ok((report.promptTokensPerTurn.deltaPct ?? 0) > 0.05);
    assert.match(report.note, /prompt tokens per evaluated turn increased/i);
  });

  it("selects the latest compatible snapshot by finishedAt, not filename/input order", () => {
    const older = history(
      "weekly-z",
      "2026-09-01T00:00:00.000Z",
      summary({ finalRecallAt8: 0.8 })
    );
    const newer = history(
      "monthly-a",
      "2026-09-25T00:00:00.000Z",
      summary({ finalRecallAt8: 0.9 })
    );
    const report = evaluateBaselineQualityTrend({
      current: summary({ finalRecallAt8: 0.9 }),
      benchmarkDefinitionFingerprint: "bench-a",
      history: [newer, older],
    });
    assert.equal(report.comparedCycleKey, "monthly-a");
    assert.equal(report.status, "STABLE");
  });

  it("parses new structured cycle reports and ignores legacy reports without a summary", () => {
    assert.equal(
      parseBaselineHistorySnapshot({
        cycleKey: "legacy",
        mainSha: "abc",
        finishedAt: "2026-09-01T00:00:00.000Z",
        architectureFingerprint: "arch",
        baseline: { status: "RAN", metricsLine: "legacy", error: null },
      }),
      null
    );

    const s = summary();
    const parsed = parseBaselineHistorySnapshot({
      cycleKey: "weekly-1",
      mainSha: "abc",
      finishedAt: "2026-09-20T00:00:00.000Z",
      architectureFingerprint: "arch",
      benchmarkDefinitionFingerprint: "bench-a",
      baseline: {
        status: "RAN",
        metricsLine: "line",
        error: null,
        summary: s,
      },
    });
    assert.ok(parsed);
    assert.equal(parsed.cycleKey, "weekly-1");
    assert.equal(parsed.baseline.promptTokensInjected, 1000);
  });

  it("renders raw regressions and token evidence without a composite score", () => {
    const report = evaluateBaselineQualityTrend({
      current: summary({ staleStateRecallRate: 0.05 }),
      benchmarkDefinitionFingerprint: "bench-a",
      history: [
        history("weekly-1", "2026-09-20T00:00:00.000Z", summary()),
      ],
    });
    const markdown = renderBaselineQualityTrendMarkdown(report);
    assert.match(markdown, /Memory Quality Trend Sentinel/);
    assert.match(markdown, /staleStateRecallRate/);
    assert.match(markdown, /REGRESSION/);
    assert.doesNotMatch(markdown, /composite score/i);
  });
});
