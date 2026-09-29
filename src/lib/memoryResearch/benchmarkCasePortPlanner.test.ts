import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildBenchmarkCasePortPlans,
  renderBenchmarkCasePortPlansMarkdown,
  type BenchmarkCasePortPlan,
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

function plansFor(
  ability: BenchmarkAdoptionProposal["ability"],
  status: BenchmarkAdoptionProposal["status"]
): BenchmarkCasePortPlan[] {
  return buildBenchmarkCasePortPlans([proposal(ability, status)]);
}

describe("Benchmark Case Port Planner", () => {
  it("splits trajectory recall by canonical owner instead of forcing both gaps into episodic retrieval", () => {
    const plans = plansFor("trajectory_recall", "PARTIAL_COVERAGE");
    assert.equal(plans.length, 2);

    const commitment = plans.find((plan) =>
      plan.planId.endsWith(":active-expired-commitment")
    );
    assert.ok(commitment);
    assert.equal(
      commitment.readiness,
      "READY_RELATIONSHIP_LIFECYCLE_FIXTURE"
    );
    assert.match(commitment.canonicalOwner, /Relationship Durable promises/);
    assert.deepEqual(commitment.proposedCaseIds, [
      "active-expired-commitment-01",
    ]);
    assert.ok(commitment.targetPaths.includes("src/lib/chatMemory.test.ts"));
    assert.ok(
      commitment.requirements.some((row) =>
        /promisesAdd\/promisesRemove/.test(row)
      )
    );
    assert.ok(
      commitment.forbidden.includes("episodic fact as formal-promise owner")
    );

    const personaUpdate = plans.find((plan) =>
      plan.planId.endsWith(":legitimate-persona-update")
    );
    assert.ok(personaUpdate);
    assert.equal(personaUpdate.readiness, "HARNESS_EXTENSION_REQUIRED");
    assert.equal(personaUpdate.canonicalOwner, "unresolved mutable-persona-state owner");
    assert.deepEqual(personaUpdate.targetPaths, []);
    assert.ok(
      personaUpdate.forbidden.includes(
        "using episodic facts as a fallback persona owner"
      )
    );
  });

  it("routes forgetting fidelity to source-mutation lifecycle owners instead of the retrieval suite", () => {
    const [plan] = plansFor("forgetting_fidelity", "PARTIAL_COVERAGE");
    assert.ok(plan);
    assert.equal(plan.readiness, "READY_MUTATION_LIFECYCLE_FIXTURE");
    assert.deepEqual(plan.proposedCaseIds, [
      "derived-memory-deletion-residue-01",
    ]);
    assert.ok(
      plan.targetPaths.includes("src/lib/memory/memory-premerge-blockers.test.ts")
    );
    assert.ok(
      plan.targetPaths.includes("src/lib/memory/memory-summary-integrity.test.ts")
    );
    assert.ok(
      !plan.targetPaths.includes("src/lib/memory/memory-rp-benchmark-suite.ts")
    );
    assert.ok(plan.forbidden.includes("copying Memora FAMA"));
  });

  it("blocks persona continuity from being mislabeled as a retrieval fixture", () => {
    const [plan] = plansFor("persona_continuity", "CASE_PORT_WORTHY");
    assert.ok(plan);
    assert.equal(plan.readiness, "HARNESS_EXTENSION_REQUIRED");
    assert.match(
      plan.rationale,
      /current benchmark measures memory retrieval|generated RP behavior/i
    );
    assert.ok(
      plan.requirements.some((row) =>
        /deterministic response-behavior assertion/.test(row)
      )
    );
    assert.ok(
      plan.forbidden.includes("claiming fact retrieval equals persona behavior")
    );
  });

  it("requires an objective scorer before persona-conditioned insight can enter the canonical benchmark", () => {
    const [plan] = plansFor(
      "persona_conditioned_insight",
      "CASE_PORT_WORTHY"
    );
    assert.ok(plan);
    assert.equal(plan.readiness, "HARNESS_EXTENSION_REQUIRED");
    assert.deepEqual(plan.proposedCaseIds, [
      "persona-grounded-insight-01",
      "unsupported-persona-inference-negative-01",
    ]);
    assert.ok(
      plan.requirements.some((row) => /mechanically grounded/.test(row))
    );
    assert.ok(
      plan.forbidden.includes("free-form psychological inference as ground truth")
    );
    assert.ok(plan.forbidden.includes("new insight memory store"));
  });

  it("does not create redundant fixture work for already-covered abilities", () => {
    for (const ability of [
      "dynamic_state_tracking",
      "premise_awareness",
      "temporal_reasoning",
    ] as const) {
      const [plan] = plansFor(ability, "ALREADY_COVERED");
      assert.ok(plan);
      assert.equal(plan.readiness, "NO_PORT_REQUIRED");
      assert.deepEqual(plan.proposedCaseIds, []);
      assert.deepEqual(plan.targetPaths, []);
    }
  });

  it("keeps insufficient evidence out of fixture planning", () => {
    const [plan] = plansFor("unclassified", "INSUFFICIENT_EVIDENCE");
    assert.ok(plan);
    assert.equal(plan.readiness, "NO_PORT_REQUIRED");
    assert.match(plan.rationale, /not specific enough/i);
  });

  it("renders plans as implementation guidance without claiming auto-edit or external judge use", () => {
    const plans = [
      ...plansFor("trajectory_recall", "PARTIAL_COVERAGE"),
      ...plansFor("persona_continuity", "CASE_PORT_WORTHY"),
    ];
    const markdown = renderBenchmarkCasePortPlansMarkdown(plans);
    assert.match(markdown, /Benchmark Case Port Planner/);
    assert.match(markdown, /READY_RELATIONSHIP_LIFECYCLE_FIXTURE/);
    assert.match(markdown, /HARNESS_EXTENSION_REQUIRED/);
    assert.match(markdown, /No external dataset or judge is copied/);
    assert.match(markdown, /no benchmark\/runtime file is edited automatically/i);
  });
});
