import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assessBenchmarkHarnessFeasibility,
  renderBenchmarkHarnessFeasibilityMarkdown,
} from "@/lib/memoryResearch/benchmarkHarnessFeasibility";
import type { BenchmarkCasePortPlan } from "@/lib/memoryResearch/benchmarkCasePortPlanner";

function plan(
  input: Pick<
    BenchmarkCasePortPlan,
    "planKey" | "ability" | "readiness" | "canonicalOwner"
  >
): BenchmarkCasePortPlan {
  return {
    planKey: input.planKey,
    candidateKey: `fixture:${input.planKey}`,
    sourceVersion: "v1",
    ability: input.ability,
    readiness: input.readiness,
    canonicalOwner: input.canonicalOwner,
    targetPaths: [],
    proposedCaseIds: [],
    reuseMetrics: [],
    requirements: [],
    forbidden: [],
    rationale: "fixture",
  };
}

describe("Benchmark Harness Feasibility Gate", () => {
  it("allows already-routed deterministic/mutation fixtures without adding provider work", () => {
    for (const readiness of [
      "READY_DETERMINISTIC_FIXTURE",
      "READY_MUTATION_LIFECYCLE_FIXTURE",
    ] as const) {
      const row = assessBenchmarkHarnessFeasibility(
        plan({
          planKey: `ready:${readiness}`,
          ability: "trajectory_recall",
          readiness,
          canonicalOwner: "fixture owner",
        })
      );
      assert.equal(row.status, "READY_LOCAL_DETERMINISTIC");
      assert.equal(row.scheduledResearchEligible, true);
      assert.equal(row.providerCallsRequired, false);
      assert.equal(row.llmJudgeRequired, false);
      assert.equal(row.objectiveGroundTruthAvailable, true);
    }
  });

  it("stops persona update until a canonical mutable persona owner exists", () => {
    const row = assessBenchmarkHarnessFeasibility(
      plan({
        planKey: "trajectory_recall:persona_update",
        ability: "trajectory_recall",
        readiness: "HARNESS_EXTENSION_REQUIRED",
        canonicalOwner: "canonical mutable character-persona owner not established",
      })
    );
    assert.equal(row.status, "OWNER_UNRESOLVED");
    assert.equal(row.scheduledResearchEligible, false);
    assert.equal(row.providerCallsRequired, false);
    assert.match(row.blocker ?? "", /No canonical mutable character-persona owner/);
    assert.match(row.safeNextAction, /Do not manufacture a persona-update store/i);
  });

  it("does not mislabel user-facing persona continuity as deterministic retrieval quality", () => {
    const row = assessBenchmarkHarnessFeasibility(
      plan({
        planKey: "persona_continuity",
        ability: "persona_continuity",
        readiness: "HARNESS_EXTENSION_REQUIRED",
        canonicalOwner: "no deterministic response-behavior owner yet",
      })
    );
    assert.equal(row.status, "LLM_JUDGE_REQUIRED");
    assert.equal(row.scheduledResearchEligible, false);
    assert.equal(row.providerCallsRequired, true);
    assert.equal(row.llmJudgeRequired, true);
    assert.equal(row.objectiveGroundTruthAvailable, false);
    assert.match(row.interpretationBoundary, /do not establish user-facing persona continuity/i);
  });

  it("requires reviewed local gold before persona-conditioned insight can become deterministic", () => {
    const row = assessBenchmarkHarnessFeasibility(
      plan({
        planKey: "persona_conditioned_insight",
        ability: "persona_conditioned_insight",
        readiness: "HARNESS_EXTENSION_REQUIRED",
        canonicalOwner: "no deterministic persona-conditioned interpretation scorer",
      })
    );
    assert.equal(row.status, "LOCAL_GOLD_AUTHORING_REQUIRED");
    assert.equal(row.providerCallsRequired, false);
    assert.equal(row.llmJudgeRequired, false);
    assert.equal(row.objectiveGroundTruthAvailable, false);
    assert.match(row.safeNextAction, /manually authored synthetic persona premises/i);
    assert.match(row.interpretationBoundary, /would not by itself prove generated roleplay quality/i);
  });

  it("keeps NO_PORT plans out of further automation", () => {
    const row = assessBenchmarkHarnessFeasibility(
      plan({
        planKey: "trajectory_recall:existing_temporal_user_state",
        ability: "trajectory_recall",
        readiness: "NO_PORT_REQUIRED",
        canonicalOwner: "existing groups",
      })
    );
    assert.equal(row.status, "NO_ACTION");
    assert.equal(row.scheduledResearchEligible, false);
    assert.equal(row.providerCallsRequired, false);
    assert.equal(row.llmJudgeRequired, false);
  });

  it("renders provider/judge requirements without executing either", () => {
    const rows = [
      assessBenchmarkHarnessFeasibility(
        plan({
          planKey: "persona_continuity",
          ability: "persona_continuity",
          readiness: "HARNESS_EXTENSION_REQUIRED",
          canonicalOwner: "none",
        })
      ),
      assessBenchmarkHarnessFeasibility(
        plan({
          planKey: "trajectory_recall:commitment_lifecycle",
          ability: "trajectory_recall",
          readiness: "NO_PORT_REQUIRED",
          canonicalOwner: "existing durable relationship lifecycle proof",
        })
      ),
    ];
    const markdown = renderBenchmarkHarnessFeasibilityMarkdown(rows);
    assert.match(markdown, /Benchmark Harness Feasibility Gate/);
    assert.match(markdown, /LLM_JUDGE_REQUIRED/);
    assert.match(markdown, /NO_ACTION/);
    assert.match(markdown, /does not call providers\/judges/i);
  });
});
