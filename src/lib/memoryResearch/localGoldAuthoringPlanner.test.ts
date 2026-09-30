import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildLocalGoldAuthoringPacket,
  buildLocalGoldAuthoringPackets,
  renderLocalGoldAuthoringPacketsMarkdown,
} from "@/lib/memoryResearch/localGoldAuthoringPlanner";
import type { HarnessFeasibilityEvidence } from "@/lib/memoryResearch/benchmarkHarnessFeasibility";

function row(
  ability: HarnessFeasibilityEvidence["ability"],
  status: HarnessFeasibilityEvidence["status"]
): HarnessFeasibilityEvidence {
  return {
    planKey: `fixture:${ability}`,
    candidateKey: `candidate:${ability}`,
    ability,
    planReadiness: "HARNESS_EXTENSION_REQUIRED",
    status,
    scheduledResearchEligible: false,
    providerCallsRequired: status === "LLM_JUDGE_REQUIRED",
    llmJudgeRequired: status === "LLM_JUDGE_REQUIRED",
    objectiveGroundTruthAvailable: false,
    blocker: "fixture blocker",
    safeNextAction: "fixture next",
    interpretationBoundary: "fixture boundary",
  };
}

describe("Local Gold Authoring Planner", () => {
  it("creates a human-review packet only for persona-conditioned insight local-gold evidence", () => {
    const packet = buildLocalGoldAuthoringPacket(
      row("persona_conditioned_insight", "LOCAL_GOLD_AUTHORING_REQUIRED")
    );
    assert.equal(packet.status, "HUMAN_REVIEW_REQUIRED");
    assert.deepEqual(packet.proposedCaseIds, [
      "persona-grounded-insight-01",
      "unsupported-persona-inference-negative-01",
    ]);
    assert.ok(packet.authoringTemplate);
    assert.match(packet.authoringTemplate!.expectedSupportedInference, /BOTH/);
    assert.match(packet.authoringTemplate!.unsupportedInferenceNegative, /NOT entailed/);
    assert.ok(
      packet.authoringTemplate!.mechanicalChecks.some((check) =>
        /removing the relevant persona premise/i.test(check)
      )
    );
  });

  it("does not convert LLM-judge-required persona continuity into local semantic gold", () => {
    const packet = buildLocalGoldAuthoringPacket(
      row("persona_continuity", "LLM_JUDGE_REQUIRED")
    );
    assert.equal(packet.status, "NO_PACKET_REQUIRED");
    assert.equal(packet.authoringTemplate, null);
    assert.deepEqual(packet.proposedCaseIds, []);
  });

  it("does not emit packets for deterministic/no-action feasibility rows", () => {
    const packets = buildLocalGoldAuthoringPackets([
      row("trajectory_recall", "READY_LOCAL_DETERMINISTIC"),
      row("temporal_reasoning", "NO_ACTION"),
      row("persona_conditioned_insight", "LOCAL_GOLD_AUTHORING_REQUIRED"),
    ]);
    assert.equal(packets.length, 1);
    assert.equal(packets[0]!.ability, "persona_conditioned_insight");
  });

  it("requires explicit unsupported-inference and owner-safety review", () => {
    const packet = buildLocalGoldAuthoringPacket(
      row("persona_conditioned_insight", "LOCAL_GOLD_AUTHORING_REQUIRED")
    );
    assert.ok(
      packet.reviewerChecklist.some((item) =>
        /unsupported inference/i.test(item)
      )
    );
    assert.ok(
      packet.reviewerChecklist.some((item) =>
        /new canonical insight-memory owner/i.test(item)
      )
    );
    assert.ok(packet.forbidden.includes("new insight memory store"));
    assert.ok(packet.forbidden.includes("provider calls"));
  });

  it("renders only human-review guidance and never claims automatic gold acceptance", () => {
    const packet = buildLocalGoldAuthoringPacket(
      row("persona_conditioned_insight", "LOCAL_GOLD_AUTHORING_REQUIRED")
    );
    const markdown = renderLocalGoldAuthoringPacketsMarkdown([packet]);
    assert.match(markdown, /Local Gold Authoring Planner/);
    assert.match(markdown, /HUMAN_REVIEW_REQUIRED/);
    assert.match(markdown, /does not write semantic gold/i);
    assert.doesNotMatch(markdown, /auto(?:matic)?(?:ally)? approved/i);
  });
});
