import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildBenchmarkCasePortPlan,
  buildBenchmarkCasePortPlansForProposal,
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
  it("decomposes trajectory recall by canonical owner instead of forcing it into episodic retrieval", () => {
    const plans = buildBenchmarkCasePortPlansForProposal(
      proposal("trajectory_recall", "PARTIAL_COVERAGE")
    );
    assert.deepEqual(
      plans.map((plan) => [plan.planKey, plan.readiness]),
      [
        ["trajectory_recall:commitment_lifecycle", "NO_PORT_REQUIRED"],
        ["trajectory_recall:persona_update", "HARNESS_EXTENSION_REQUIRED"],
        ["trajectory_recall:existing_temporal_user_state", "NO_PORT_REQUIRED"],
      ]
    );

    const commitment = plans[0]!;
    assert.equal(commitment.readiness, "NO_PORT_REQUIRED");
    assert.match(commitment.canonicalOwner, /existing durable Relationship Memory/i);
    assert.deepEqual(commitment.targetPaths, []);
    assert.deepEqual(commitment.proposedCaseIds, []);
    assert.ok(commitment.requirements.some((row) => /active-expired-commitment-lifecycle-01/.test(row)));
    assert.ok(commitment.requirements.some((row) => /promisesAdd\/promisesRemove/.test(row)));
    assert.ok(commitment.forbidden.includes("duplicate active-expired commitment fixture"));
    assert.match(commitment.rationale, /already closed by the merged durable-ledger regression/i);

    const personaUpdate = plans[1]!;
    assert.equal(personaUpdate.targetPaths.length, 0);
    assert.ok(personaUpdate.forbidden.includes("inventing a mutable persona owner"));

    const covered = plans[2]!;
    assert.deepEqual(covered.proposedCaseIds, []);
    assert.ok(covered.reuseMetrics.includes("correctionSupersessionAccuracy"));
  });

  it("does not re-port the resolved local forgetting-residue gap", () => {
    const plan = buildBenchmarkCasePortPlan(
      proposal("forgetting_fidelity", "PARTIAL_COVERAGE")
    );
    assert.equal(plan.readiness, "NO_PORT_REQUIRED");
    assert.equal(plan.planKey, "forgetting_fidelity:current_local_gap_closed");
    assert.deepEqual(plan.proposedCaseIds, []);
    assert.deepEqual(plan.targetPaths, []);
    assert.ok(plan.forbidden.includes("duplicate derived-memory-deletion-residue fixture"));
    assert.match(plan.rationale, /last-turn delete atomically removes/i);
    assert.match(plan.rationale, /broader external forgetting benchmark remains PARTIAL_COVERAGE/i);
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
      ...buildBenchmarkCasePortPlansForProposal(
        proposal("trajectory_recall", "PARTIAL_COVERAGE")
      ),
      buildBenchmarkCasePortPlan(
        proposal("persona_continuity", "CASE_PORT_WORTHY")
      ),
    ];
    const markdown = renderBenchmarkCasePortPlansMarkdown(plans);
    assert.match(markdown, /Benchmark Case Port Planner/);
    assert.match(markdown, /NO_PORT_REQUIRED/);
    assert.match(markdown, /HARNESS_EXTENSION_REQUIRED/);
    assert.match(markdown, /No external dataset or judge is copied/);
    assert.match(markdown, /no benchmark file is edited automatically/i);
  });
});
