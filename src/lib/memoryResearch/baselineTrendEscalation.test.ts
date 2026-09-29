import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildBaselineRegressionIssuePlan,
  findOpenRegressionIssue,
} from "@/lib/memoryResearch/baselineTrendEscalation";
import type { CycleReport } from "@/lib/memoryResearch/cycle";

function report(status: "STABLE" | "REGRESSION" | "MIXED"): CycleReport {
  return {
    cycleKey: "weekly-2026-W40",
    mode: "weekly",
    status: "COMPLETED",
    startedAt: "2026-09-28T01:17:00.000Z",
    finishedAt: "2026-09-28T01:18:00.000Z",
    mainSha: "0123456789abcdef0123456789abcdef01234567",
    architectureFingerprint: "arch",
    sources: [],
    counts: {
      sourcesChecked: 0,
      sourcesFailed: 0,
      observations: 0,
      newCandidates: 0,
      skippedDuplicates: 0,
      evaluated: 0,
      watch: 0,
      reject: 0,
      benchmarked: 0,
      accept: 0,
      draftPrPackets: 0,
    },
    skipped: [],
    decisions: [],
    baseline: { status: "RAN", metricsLine: "fixture", error: null },
    baselineTrend: {
      status,
      previousCycleKey: "weekly-2026-W39",
      benchmarkFingerprint: "bench1234abcd",
      metricDeltas: [
        {
          key: "finalRecallAt8",
          previous: 1,
          current: 0.8,
          delta: -0.2,
          verdict: "regressed",
        },
        {
          key: "precision",
          previous: 0.8,
          current: 0.9,
          delta: 0.1,
          verdict: status === "MIXED" ? "improved" : "unchanged",
        },
      ],
      lostPositiveCases: ["case-b"],
      gainedPositiveCases: status === "MIXED" ? ["case-c"] : [],
      promptTokensPerTurnDelta: 25,
      promptTokenTrend: "INCREASED",
      invariantViolationDelta: 0,
      note: "fixture",
    },
    benchmarks: [],
    providerCalls: {
      paidProviderCalls: 0,
      paidProviderCallBudget: 0,
      httpCalls: 0,
      httpBudget: 56,
    },
    estimatedCostUsd: 0,
    draftPrPackets: [],
    cleanupCandidates: [],
    companionExperimentProposals: [],
    benchmarkAdoptionProposals: [],
    benchmarkCasePortPlans: [],
    benchmarkHarnessFeasibility: [],
    productionTouched: false,
  };
}

describe("Memory baseline regression escalation", () => {
  it("does nothing for stable/non-regression trend", () => {
    assert.equal(buildBaselineRegressionIssuePlan(report("STABLE")), null);
  });

  it("builds one fingerprint-stable investigation issue for REGRESSION", () => {
    const plan = buildBaselineRegressionIssuePlan(report("REGRESSION"));
    assert.ok(plan);
    assert.equal(
      plan.title,
      "[memory-baseline-regression:bench1234abcd] deterministic baseline drift"
    );
    assert.match(plan.body, /finalRecallAt8: 1 → 0.8/);
    assert.match(plan.body, /case-b/);
    assert.match(plan.body, /prompt tokens\/turn delta: 25.00 \(INCREASED\)/);
    assert.match(plan.body, /investigation signal, not an automatic rollback/i);
    assert.doesNotMatch(plan.body, /auto-merge/i);
  });

  it("includes improvement evidence on MIXED without hiding the regression", () => {
    const plan = buildBaselineRegressionIssuePlan(report("MIXED"));
    assert.ok(plan);
    assert.match(plan.body, /trend: \*\*MIXED\*\*/);
    assert.match(plan.body, /precision: 0.8 → 0.9/);
    assert.match(plan.body, /gained case: `case-c`/);
    assert.match(plan.body, /finalRecallAt8: 1 → 0.8/);
  });

  it("deduplicates only by exact fingerprint-stable title", () => {
    const plan = buildBaselineRegressionIssuePlan(report("REGRESSION"))!;
    assert.deepEqual(
      findOpenRegressionIssue(plan, [
        { number: 5, title: "[memory-baseline-regression:other] deterministic baseline drift" },
        { number: 9, title: plan.title },
      ]),
      { number: 9, title: plan.title }
    );
    assert.equal(
      findOpenRegressionIssue(plan, [{ number: 1, title: "unrelated issue" }]),
      null
    );
  });
});
