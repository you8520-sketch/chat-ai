import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DECISION_RADAR_BASELINE_MODEL,
  emptyDecisionRadarLedger,
  evaluateDecisionCandidate,
  parseDecisionCatalog,
  selectChangedDecisionCandidates,
  upsertDecisionRadarLedger,
  type DecisionBenchmarkSummary,
  type DecisionRadarRun,
} from "./decisionModelRadar";

function summary(
  model: string,
  accuracy: number,
  criticalMisses: number,
  suites: Array<[string, number, number]>
): DecisionBenchmarkSummary {
  return {
    model,
    total: 10,
    correct: Math.round(accuracy * 10),
    accuracy,
    criticalMisses,
    malformed: 0,
    failures: 0,
    inputTokens: 100,
    outputTokens: 0,
    reportedCostUsd: 0.001,
    latencyMs: { p50: 100, p95: 150, max: 180 },
    bySuite: suites.map(([suite, suiteAccuracy, suiteCriticalMisses]) => ({
      suite,
      total: 10,
      correct: Math.round(suiteAccuracy * 10),
      accuracy: suiteAccuracy,
      criticalMisses: suiteCriticalMisses,
      malformed: 0,
      failures: 0,
    })),
  };
}

describe("decision model radar catalog", () => {
  it("parses decision models, prices per million, and filters aliases/routers", () => {
    const parsed = parseDecisionCatalog({
      data: [
        {
          id: "upstage/solar-decide",
          canonical_slug: "upstage/solar-decide-20260928",
          name: "Solar Decide",
          created: 1790610000,
          description: "structured decision model",
          context_length: 524288,
          pricing: { prompt: "0.00000005", completion: "0" },
        },
        {
          id: "typesafe/jev-latest",
          name: "Jev Latest",
          description: "always redirects to the latest model",
          pricing: { prompt: "0.000000042", completion: "0" },
        },
        {
          id: "typesafe/jev-router",
          name: "Jev Router",
          description: "router",
          pricing: { prompt: "-1", completion: "-1" },
        },
      ],
    });
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0]!.id, "upstage/solar-decide");
    assert.equal(parsed[0]!.promptUsdPerMillion, 0.05);
    assert.equal(parsed[0]!.outputUsdPerMillion, 0);
    assert.ok(parsed[0]!.fingerprint.length >= 32);
  });

  it("keeps deferred candidates eligible until their exact fingerprint is benchmarked", () => {
    const catalog = parseDecisionCatalog({
      data: [
        {
          id: "candidate/new",
          created: 2,
          description: "decision",
          pricing: { prompt: "0.0000001", completion: "0" },
        },
        {
          id: DECISION_RADAR_BASELINE_MODEL,
          created: 1,
          description: "baseline",
          pricing: { prompt: "0.000000042", completion: "0" },
        },
      ],
    });
    const ledger = emptyDecisionRadarLedger();
    const selected = selectChangedDecisionCandidates({ catalog, ledger, maxCandidates: 0 });
    assert.equal(selected.changed.length, 1);
    assert.equal(selected.selected.length, 0);

    const run: DecisionRadarRun = {
      ranAt: "2026-09-29T00:00:00Z",
      mainSha: "abc",
      status: "PARTIAL",
      discoveredModels: 2,
      changedCandidates: ["candidate/new"],
      benchmarkedCandidates: [],
      deferredCandidates: ["candidate/new"],
      providerCalls: 0,
      baseline: null,
      evaluations: [],
      notes: [],
      githubRunUrl: null,
    };
    const next = upsertDecisionRadarLedger({ ledger, catalog, run });
    assert.equal(next.models["candidate/new"]!.lastBenchmarkedFingerprint, null);
    const again = selectChangedDecisionCandidates({ catalog, ledger: next });
    assert.deepEqual(again.selected.map((x) => x.id), ["candidate/new"]);
  });
});

describe("decision model comparison gate", () => {
  it("marks only objectively better suites and never infers a global winner from a weaker overall result", () => {
    const baseline = summary("typesafe/jev-1.13", 0.8, 2, [
      ["authorial_habit", 0.8, 1],
      ["completion_integrity", 0.6, 1],
      ["scene_boundary", 0.9, 0],
    ]);
    const candidate = summary("candidate/model", 0.75, 2, [
      ["authorial_habit", 0.7, 1],
      ["completion_integrity", 0.8, 1],
      ["scene_boundary", 0.8, 0],
    ]);
    const result = evaluateDecisionCandidate(baseline, candidate, "fp");
    assert.equal(result.globalReplacementCandidate, false);
    assert.deepEqual(result.suiteCandidates, ["completion_integrity"]);
  });
});
