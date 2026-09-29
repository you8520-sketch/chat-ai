import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildBenchmarkAdoptionProposals,
  renderBenchmarkAdoptionMarkdown,
} from "@/lib/memoryResearch/benchmarkAdoptionBridge";
import type { ResearchObservation } from "@/lib/memoryResearch/types";

function benchmarkObservation(input: {
  key: string;
  claimedAdvantage: string;
}): ResearchObservation {
  return {
    candidateKey: input.key,
    sourceKind: "github_repository",
    sourceUrl: `https://github.com/example/${input.key}`,
    title: input.key,
    version: "fixture-v1",
    publishedAt: null,
    summary: input.claimedAdvantage,
    claimedAdvantage: input.claimedAdvantage,
    category: "memory_benchmark",
    evidence: {
      hasReproducibleCode: true,
      hasPublishedBenchmark: true,
      archived: false,
      lastActivityAt: "2026-09-01T00:00:00Z",
    },
    infraRequirements: ["none"],
    privacyImplications: ["none"],
    migrationRequirement: "none",
    riskFlags: [],
  };
}

describe("RP Memory Benchmark Adoption Radar", () => {
  it("maps ANCHOR-style persona continuity and trajectory recall separately", () => {
    const proposals = buildBenchmarkAdoptionProposals(
      benchmarkObservation({
        key: "anchor",
        claimedAdvantage:
          "Persona continuity covers role, boundaries, values and style. Trajectory recall covers active commitment, expired commitment, persona update, temporal order and user-state change.",
      })
    );
    const persona = proposals.find((p) => p.ability === "persona_continuity");
    const trajectory = proposals.find((p) => p.ability === "trajectory_recall");
    assert.ok(persona);
    assert.equal(persona.status, "CASE_PORT_WORTHY");
    assert.deepEqual(persona.localGroups, ["IDENTITY_TRAJECTORY"]);
    assert.match(persona.gap ?? "", /boundaries|values|style/i);
    assert.ok(trajectory);
    assert.equal(trajectory.status, "PARTIAL_COVERAGE");
    assert.deepEqual(trajectory.localGroups, [
      "DYNAMIC_STATE_TRACKING",
      "TEMPORAL_REASONING",
      "PREMISE_AWARENESS",
    ]);
    assert.match(trajectory.gap ?? "", /active vs expired commitments|persona updates/i);
  });

  it("maps RoleMemo fact→persona insight as a missing RP-specific case family", () => {
    const proposals = buildBenchmarkAdoptionProposals(
      benchmarkObservation({
        key: "rolememo",
        claimedAdvantage:
          "Factual cognition and persona-conditioned insight cognition expose a facts to insights bottleneck in long role-playing conversations.",
      })
    );
    const insight = proposals.find((p) => p.ability === "persona_conditioned_insight");
    assert.ok(insight);
    assert.equal(insight.status, "CASE_PORT_WORTHY");
    assert.deepEqual(insight.localGroups, ["IDENTITY_TRAJECTORY"]);
    assert.match(insight.gap ?? "", /persona-grounded-insight/i);
    assert.match(insight.nextAction, /unsupported-inference/i);
  });

  it("maps Memora forgetting to existing invalidation coverage plus a derived-tier residue gap", () => {
    const proposals = buildBenchmarkAdoptionProposals(
      benchmarkObservation({
        key: "memora",
        claimedAdvantage:
          "Forgetting-aware memory evaluates remembering while penalizing obsolete or invalidated memories that were deleted or updated.",
      })
    );
    const forgetting = proposals.find((p) => p.ability === "forgetting_fidelity");
    assert.ok(forgetting);
    assert.equal(forgetting.status, "PARTIAL_COVERAGE");
    assert.deepEqual(forgetting.localGroups, [
      "DYNAMIC_STATE_TRACKING",
      "PREMISE_AWARENESS",
    ]);
    assert.match(forgetting.gap ?? "", /derived-tier forgetting-residue/i);
    assert.match(forgetting.nextAction, /full-pipeline deletion-residue/i);
  });

  it("does not create duplicate case families for abilities already represented locally", () => {
    const proposals = buildBenchmarkAdoptionProposals(
      benchmarkObservation({
        key: "lmev2",
        claimedAdvantage:
          "dynamic state tracking, premise awareness, and temporal reasoning for long-term agent memory",
      })
    );
    assert.deepEqual(
      proposals.map((p) => [p.ability, p.status]),
      [
        ["dynamic_state_tracking", "ALREADY_COVERED"],
        ["premise_awareness", "ALREADY_COVERED"],
        ["temporal_reasoning", "ALREADY_COVERED"],
      ]
    );
    for (const proposal of proposals) {
      assert.ok(proposal.localCaseCount > 0);
      assert.equal(proposal.gap, null);
    }
  });

  it("ignores non-benchmark candidates", () => {
    const obs = benchmarkObservation({
      key: "framework",
      claimedAdvantage: "persona continuity",
    });
    assert.deepEqual(
      buildBenchmarkAdoptionProposals({ ...obs, category: "agent_memory_framework" }),
      []
    );
  });

  it("keeps vague benchmark descriptions as insufficient evidence", () => {
    const proposals = buildBenchmarkAdoptionProposals(
      benchmarkObservation({
        key: "vague",
        claimedAdvantage: "A benchmark for better memories.",
      })
    );
    assert.equal(proposals.length, 1);
    assert.equal(proposals[0]!.ability, "unclassified");
    assert.equal(proposals[0]!.status, "INSUFFICIENT_EVIDENCE");
    assert.equal(proposals[0]!.localCaseCount, 0);
  });

  it("renders capability mapping without importing leaderboard scores or winner language", () => {
    const proposals = buildBenchmarkAdoptionProposals(
      benchmarkObservation({
        key: "anchor",
        claimedAdvantage: "persona continuity and trajectory recall with active commitment",
      })
    );
    const markdown = renderBenchmarkAdoptionMarkdown(proposals);
    assert.match(markdown, /RP Memory Benchmark Adoption Radar/);
    assert.match(markdown, /CASE_PORT_WORTHY/);
    assert.match(markdown, /PARTIAL_COVERAGE/);
    assert.doesNotMatch(markdown, /leaderboard score|winner|best model/i);
    assert.match(markdown, /No external dataset/);
  });
});
