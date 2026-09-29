import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildBenchmarkCasePortPlan,
  renderBenchmarkCasePortPlansMarkdown,
} from "@/lib/memoryResearch/benchmarkCasePortPlanner";
import type { BenchmarkAdoptionProposal } from "@/lib/memoryResearch/benchmarkAdoptionBridge";

function proposal(
  ability: BenchmarkAdoptionProposal["ability"],
  status: BenchmarkAdoptionProposal["status"]
): BenchmarkAdoptionProposal {
  return {
    candidateKey: `fixture:${ability}`,
    sourceUrl: "https://example.invalid/benchmark",
    sourceVersion: "v1",
    evidenceLevel: "PUBLISHED_BENCHMARK_CAPABILITY_CLAIM",
    ability,
    status,
    localGroups: [],
    localCaseCount: 0,
    coverage: "fixture",
    gap: status === "ALREADY_COVERED" ? null : "fixture gap",
    nextAction: "fixture action",
  };
}

describe("Benchmark Case Port Planner", () => {
  it("routes trajectory recall into the existing deterministic RP benchmark", () => {
    const plan = buildBenchmarkCasePortPlan(
      proposal("trajectory_recall", "PARTIAL_COVERAGE")
    );
    assert.equal(plan.readiness, "READY_DETERMINISTIC_FIXTURE");
    assert.match(plan.canonicalOwner, /memory-rp-benchmark-suite/);
    assert.deepEqual(plan.proposedCaseIds, [
      "active-expired-commitment-01",
      "persona-update-current-01",
    ]);
    assert.ok(plan.reuseMetrics.includes("staleStateRecallRate"));
    assert.ok(plan.reuseMetrics.includes("correctionSupersessionAccuracy"));
    assert.ok(plan.forbidden.includes("LLM-as-judge"));
  });

  it("routes forgetting fidelity to source-mutation lifecycle owners instead of the retrieval suite", () => {
    const plan = buildBenchmarkCasePortPlan(
      proposal("forgetting_fidelity", "PARTIAL_COVERAGE")
    );
    assert.equal(plan.readiness, "READY_MUTATION_LIFECYCLE_FIXTURE");
    assert.deepEqual(plan.proposedCaseIds, ["derived-memory-deletion-residue-01"]);
    assert.ok(plan.targetPaths.includes("src/lib/memory/memory-premerge-blockers.test.ts"));
    assert.ok(plan.targetPaths.includes("src/lib/memory/memory-summary-integrity.test.ts"));
    assert.ok(!plan.targetPaths.includes("src/lib/memory/memory-rp-benchmark-suite.ts"));
    assert.ok(plan.forbidden.includes("copying Memora FAMA"));
  });

  it("blocks persona continuity from being mislabeled as a retrieval fixture", () => {
    const plan = buildBenchmarkCasePortPlan(
      proposal("persona_continuity", "CASE_PORT_WORTHY")
    );
    assert.equal(plan.readiness, "HARNESS_EXTENSION_REQUIRED");
    assert.match(plan.rationale, /generated RP behavior|memory retrieval|generated RP behavior|current benchmark measures memory retrieval/i);
    assert.ok(plan.requirements.some((row) => /deterministic response-behavior assertion/.test(row)));
    assert.ok(plan.forbidden.includes("claiming fact retrieval equals persona behavior"));
  });

  it("requires an objective scorer before persona-conditioned insight can enter the canonical benchmark", () => {
    const plan = buildBenchmarkCasePortPlan(
      proposal("persona_conditioned_insight", "CASE_PORT_WORTHY")
    );
    assert.equal(plan.readiness, "HARNESS_EXTENSION_REQUIRED");
    assert.deepEqual(plan.proposedCaseIds, [
      "persona-grounded-insight-01",
      "unsupported-persona-inference-negative-01",
    ]);
    assert.ok(plan.requirements.some((row) => /mechanically grounded/.test(row)));
    assert.ok(plan.forbidden.includes("free-form psychological inference as ground truth"));
    assert.ok(plan.forbidden.includes("new insight memory store"));
  });

  it("does not create redundant fixture work for already-covered abilities", () => {
    for (const ability of [
      "dynamic_state_tracking",
      "premise_awareness",
      "temporal_reasoning",
    ] as const) {
      const plan = buildBenchmarkCasePortPlan(proposal(ability, "ALREADY_COVERED"));
      assert.equal(plan.readiness, "NO_PORT_REQUIRED");
      assert.deepEqual(plan.proposedCaseIds, []);
      assert.deepEqual(plan.targetPaths, []);
    }
  });

  it("keeps insufficient evidence out of fixture planning", () => {
    const plan = buildBenchmarkCasePortPlan(
      proposal("unclassified", "INSUFFICIENT_EVIDENCE")
    );
    assert.equal(plan.readiness, "NO_PORT_REQUIRED");
    assert.match(plan.rationale, /not specific enough/i);
  });

  it("renders plans as implementation guidance without claiming auto-edit or external judge use", () => {
    const plans = [
      buildBenchmarkCasePortPlan(proposal("trajectory_recall", "PARTIAL_COVERAGE")),
      buildBenchmarkCasePortPlan(proposal("persona_continuity", "CASE_PORT_WORTHY")),
    ];
    const markdown = renderBenchmarkCasePortPlansMarkdown(plans);
    assert.match(markdown, /Benchmark Case Port Planner/);
    assert.match(markdown, /READY_DETERMINISTIC_FIXTURE/);
    assert.match(markdown, /HARNESS_EXTENSION_REQUIRED/);
    assert.match(markdown, /No external dataset or judge is copied/);
    assert.match(markdown, /no benchmark file is edited automatically/i);
  });
});
