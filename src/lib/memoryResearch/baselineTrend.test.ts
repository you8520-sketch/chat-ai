import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildBaselineSnapshot,
  compareBaselineSnapshots,
  renderBaselineTrendMarkdown,
  unavailableBaselineTrend,
} from "@/lib/memoryResearch/baselineTrend";
import type { LabRunSummary } from "@/lib/memoryResearch/gates";

function measured(value: number, eligible = 2, total = 2) {
  return {
    value,
    status: "MEASURED" as const,
    eligibleCases: eligible,
    totalCases: total,
  };
}

function summary(overrides: {
  finalRecall?: number;
  falseMemory?: number;
  stale?: number;
  precision?: number;
  promptTokens?: number;
  finalHits?: Record<string, boolean>;
  invariantViolations?: string[];
} = {}): LabRunSummary {
  const finalRecall = overrides.finalRecall ?? 1;
  const falseMemory = overrides.falseMemory ?? 0;
  const stale = overrides.stale ?? 0;
  const precision = overrides.precision ?? 1;
  const m = {
    cases: 2,
    coverage: [],
    candidateRecallAtK: measured(1),
    finalRecallAt8: measured(finalRecall),
    falseInjectionRate: measured(falseMemory),
    staleStateRecallRate: measured(stale),
    precision: measured(precision),
    falseMemoryRate: measured(falseMemory),
    irrelevantInjectionRate: measured(0),
    relationshipRoleConsistency: measured(1),
    distinctiveUtteranceRecall: measured(1),
    correctionSupersessionAccuracy: measured(1),
    wrongObserverKnowledgeLeakCount: measured(0),
    secretLeakCount: measured(0),
    baselineVsShadowDelta: measured(0),
    providerCallsPerTurn: measured(0),
    jevInvocationRate: measured(0),
    jevP50LatencyMs: measured(0),
    jevP95LatencyMs: measured(0),
    jevCostPer1000Turns: measured(0),
    promptTokenDelta: measured(0),
    fallbackParity: {
      value: true,
      status: "MEASURED" as const,
      eligibleCases: 2,
      totalCases: 2,
    },
  } as LabRunSummary["metrics"];

  return {
    label: "baseline",
    metrics: m,
    invariantViolations: overrides.invariantViolations ?? [],
    evaluatedTurns: 2,
    promptTokensInjected: overrides.promptTokens ?? 200,
    httpCallsObserved: 0,
    embeddingCalls: { query: 0, index: 0 },
    wallClockMs: 1,
    finalHitByCase: overrides.finalHits ?? { "case-a": true, "case-b": true },
  };
}

describe("Memory baseline trend sentinel", () => {
  it("starts with NO_HISTORY and keeps a compact deterministic snapshot", () => {
    const snapshot = buildBaselineSnapshot(summary(), "bench-v1");
    assert.equal(snapshot.benchmarkFingerprint, "bench-v1");
    assert.equal(snapshot.promptTokensPerTurn, 100);
    assert.deepEqual(snapshot.finalHitByCase, { "case-a": true, "case-b": true });

    const trend = compareBaselineSnapshots(snapshot, []);
    assert.equal(trend.status, "NO_HISTORY");
    assert.equal(trend.previousCycleKey, null);
  });

  it("reports STABLE only when the same benchmark definition has unchanged raw evidence", () => {
    const before = buildBaselineSnapshot(summary(), "bench-v1");
    const current = buildBaselineSnapshot(summary(), "bench-v1");
    const trend = compareBaselineSnapshots(current, [
      { cycleKey: "weekly-1", baseline: before },
    ]);
    assert.equal(trend.status, "STABLE");
    assert.ok(trend.metricDeltas.every((row) => row.verdict === "unchanged"));
    assert.deepEqual(trend.lostPositiveCases, []);
  });

  it("detects quality regression and lost positive cases without turning token growth into a quality verdict", () => {
    const before = buildBaselineSnapshot(summary(), "bench-v1");
    const current = buildBaselineSnapshot(
      summary({
        finalRecall: 0.5,
        promptTokens: 260,
        finalHits: { "case-a": true, "case-b": false },
      }),
      "bench-v1"
    );
    const trend = compareBaselineSnapshots(current, [
      { cycleKey: "weekly-1", baseline: before },
    ]);
    assert.equal(trend.status, "REGRESSION");
    assert.deepEqual(trend.lostPositiveCases, ["case-b"]);
    assert.equal(trend.promptTokensPerTurnDelta, 30);
    assert.match(trend.note, /token increase is evidence/i);
  });

  it("does not compare aggregates when the benchmark definition changed", () => {
    const before = buildBaselineSnapshot(summary(), "bench-v1");
    const current = buildBaselineSnapshot(summary({ finalRecall: 0.5 }), "bench-v2");
    const trend = compareBaselineSnapshots(current, [
      { cycleKey: "weekly-1", baseline: before },
    ]);
    assert.equal(trend.status, "BENCHMARK_CHANGED");
    assert.deepEqual(trend.metricDeltas, []);
    assert.match(trend.note, /not compared/i);
  });

  it("can distinguish improvement from mixed movement", () => {
    const before = buildBaselineSnapshot(
      summary({ finalRecall: 0.5, falseMemory: 0.5, finalHits: { "case-a": true, "case-b": false } }),
      "bench-v1"
    );
    const improved = buildBaselineSnapshot(
      summary({ finalRecall: 1, falseMemory: 0, finalHits: { "case-a": true, "case-b": true } }),
      "bench-v1"
    );
    assert.equal(
      compareBaselineSnapshots(improved, [{ cycleKey: "weekly-1", baseline: before }]).status,
      "IMPROVEMENT"
    );

    const mixed = buildBaselineSnapshot(
      summary({ finalRecall: 1, falseMemory: 1, finalHits: { "case-a": true, "case-b": true } }),
      "bench-v1"
    );
    assert.equal(
      compareBaselineSnapshots(mixed, [{ cycleKey: "weekly-1", baseline: before }]).status,
      "MIXED"
    );
  });

  it("renders unavailable evidence without pretending a regression was measured", () => {
    const report = unavailableBaselineTrend("fingerprint missing");
    const markdown = renderBaselineTrendMarkdown(report);
    assert.equal(report.status, "UNAVAILABLE");
    assert.match(markdown, /UNAVAILABLE/);
    assert.match(markdown, /fingerprint missing/);
  });
});
