import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DECISION_RADAR_BASELINE_MODEL,
  DECISION_RADAR_MAX_CANDIDATES_PER_RUN,
  decisionCatalogModelsUrl,
  emptyDecisionRadarLedger,
  evaluateDecisionCandidate,
  formatDecisionCatalogHttpError,
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

describe("decision catalog request contract", () => {
  it("uses output_modalities=decisions and never the invalid category query", () => {
    const url = new URL(decisionCatalogModelsUrl());
    assert.equal(url.origin + url.pathname, "https://openrouter.ai/api/v1/models");
    assert.equal(url.searchParams.get("output_modalities"), "decisions");
    assert.equal(url.searchParams.get("sort"), "newest");
    assert.equal(url.searchParams.get("category"), null);
    assert.doesNotMatch(url.search, /category=decisions/);
  });

  it("records HTTP status and a bounded non-secret diagnostic", () => {
    const message = formatDecisionCatalogHttpError(
      400,
      JSON.stringify({
        error: {
          message:
            'Invalid option: expected one of "programming"|"roleplay" Bearer sk-or-secretvalue ' +
            "x".repeat(400),
        },
      })
    );
    assert.match(message, /^OpenRouter decision catalog HTTP 400: /);
    assert.doesNotMatch(message, /sk-or-secretvalue/);
    assert.doesNotMatch(message, /Bearer sk-or/);
    assert.ok(message.length < 320);
  });
});

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
    assert.ok(Math.abs((parsed[0]!.promptUsdPerMillion ?? 0) - 0.05) < 1e-12);
    assert.equal(parsed[0]!.outputUsdPerMillion, 0);
    assert.ok(parsed[0]!.fingerprint.length >= 32);
  });

  it("parses the live decisions catalog shape and drops text models and aliases", () => {
    const parsed = parseDecisionCatalog({
      data: [
        {
          id: "upstage/solar-decide-flash",
          canonical_slug: "upstage/solar-decide-flash-20261008",
          name: "Upstage: Solar Decide Flash",
          created: 1791419983,
          description: "structured decision model",
          context_length: 524288,
          pricing: { prompt: "0.00000005", completion: "0", input_cache_read: "0.00000001" },
          architecture: { output_modalities: ["decisions"] },
        },
        {
          id: "openai/gpt-4",
          name: "GPT-4",
          created: 1692901234,
          description: "text model",
          context_length: 8192,
          pricing: { prompt: "0.00003", completion: "0.00006" },
          architecture: { output_modalities: ["text"] },
        },
        {
          id: "~typesafe/jev-latest",
          name: "Jev Latest",
          created: 1789689685,
          description: "This model always redirects to the latest model in the Jev family.",
          pricing: { prompt: "0.000000042", completion: "0" },
          architecture: { output_modalities: ["decisions"] },
        },
      ],
    });
    assert.deepEqual(parsed.map((model) => model.id), ["upstage/solar-decide-flash"]);
    assert.equal(parsed[0]!.canonicalSlug, "upstage/solar-decide-flash-20261008");
    assert.equal(parsed[0]!.contextLength, 524288);
    assert.ok(Math.abs((parsed[0]!.promptUsdPerMillion ?? 0) - 0.05) < 1e-12);
  });

  it("schedules zero benchmark candidates when every fingerprint is already benchmarked", () => {
    const catalog = parseDecisionCatalog({
      data: [
        {
          id: "candidate/stable",
          created: 2,
          description: "decision",
          pricing: { prompt: "0.0000001", completion: "0" },
          architecture: { output_modalities: ["decisions"] },
        },
      ],
    });
    const observed = upsertDecisionRadarLedger({
      ledger: emptyDecisionRadarLedger(),
      catalog,
      run: {
        ranAt: "2026-10-08T00:00:00Z",
        mainSha: "sha",
        status: "BENCHMARKED",
        discoveredModels: 1,
        changedCandidates: ["candidate/stable"],
        benchmarkedCandidates: ["candidate/stable"],
        deferredCandidates: [],
        providerCalls: 1,
        baseline: summary(DECISION_RADAR_BASELINE_MODEL, 0.8, 0, [["authorial_habit", 0.8, 0]]),
        evaluations: [
          evaluateDecisionCandidate(
            summary(DECISION_RADAR_BASELINE_MODEL, 0.8, 0, [["authorial_habit", 0.8, 0]]),
            summary("candidate/stable", 0.8, 0, [["authorial_habit", 0.8, 0]]),
            catalog[0]!.fingerprint
          ),
        ],
        notes: [],
        githubRunUrl: null,
      },
    });
    const again = selectChangedDecisionCandidates({ catalog, ledger: observed });
    assert.deepEqual(again.changed, []);
    assert.deepEqual(again.selected, []);
  });

  it("keeps changed-candidate selection inside the existing per-run cap", () => {
    const catalog = parseDecisionCatalog({
      data: [1, 2, 3, 4].map((created) => ({
        id: `candidate/${created}`,
        created,
        description: "decision",
        pricing: { prompt: "0.0000001", completion: "0" },
        architecture: { output_modalities: ["decisions"] },
      })),
    });
    const selected = selectChangedDecisionCandidates({
      catalog,
      ledger: emptyDecisionRadarLedger(),
    });
    assert.equal(selected.changed.length, 4);
    assert.equal(selected.selected.length, DECISION_RADAR_MAX_CANDIDATES_PER_RUN);
    assert.equal(selected.deferred.length, 1);
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
