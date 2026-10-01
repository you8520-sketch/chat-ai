import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildPersistentGapInvestigationPackets,
  renderPersistentGapInvestigationPacketsMarkdown,
} from "@/lib/memoryResearch/persistentGapInvestigation";
import type {
  PersistentGapEvidence,
  PersistentMemoryGapReport,
} from "@/lib/memoryResearch/persistentGapRadar";
import {
  LIVE_EXPERIMENT_RECIPES,
} from "@/lib/memoryResearch/liveExperimentRecipes";

function gap(
  caseId: string,
  ownerHints: readonly string[],
  documentedKnownGap = false
): PersistentGapEvidence {
  return {
    caseId,
    consecutiveComparableFailures: 3,
    oldestComparableFailureCycleKey: "weekly-1",
    capabilityGroups: ["DYNAMIC_STATE_TRACKING"],
    documentedKnownGap,
    ownerHints,
    nextAction: "fixture",
  };
}

function report(gaps: PersistentGapEvidence[]): PersistentMemoryGapReport {
  return {
    status: "PERSISTENT_GAPS",
    benchmarkFingerprint: "fp-a",
    requiredConsecutiveFailures: 3,
    comparableCyclesAvailable: 3,
    currentFailedPositiveCases: gaps.map((row) => row.caseId),
    persistentGaps: gaps,
    transientOrUnconfirmedFailures: [],
    note: "fixture",
  };
}

describe("Persistent Gap Investigation Packets", () => {
  it("does not duplicate a gap already owned by a reviewed live recipe", () => {
    const packets = buildPersistentGapInvestigationPackets(
      report([
        gap(
          "semantic-paraphrase-KNOWN_GAP_BASELINE_REPRO-01",
          ["semantic_retrieval", "embedding_index"],
          true
        ),
      ]),
      LIVE_EXPERIMENT_RECIPES
    );
    assert.deepEqual(packets, []);
  });

  it("creates a bounded BUGFIX investigation packet for an owner-known persistent gap with no recipe", () => {
    const packets = buildPersistentGapInvestigationPackets(
      report([gap("item-ownership-01", ["relationship_durable", "episodic_selection"])]),
      []
    );
    assert.equal(packets.length, 1);
    const packet = packets[0]!;
    assert.equal(packet.status, "BUGFIX_INVESTIGATION_READY");
    assert.deepEqual(packet.ownerHints, ["relationship_durable", "episodic_selection"]);
    assert.match(packet.deterministicReproduction, /item-ownership-01/);
    assert.match(packet.deterministicReproduction, /3 consecutive comparable failures/);
    assert.ok(packet.investigationSteps.some((row) => /current-main execution path/i.test(row)));
    assert.ok(packet.regressionGate.some((row) => /RED on pre-fix current main/i.test(row)));
    assert.ok(packet.stopConditions.some((row) => /different canonical owner/i.test(row)));
    assert.match(packet.nextAction, /do not auto-create a recipe or implementation PR/i);
  });

  it("creates owner-routing evidence only when the canonical owner is still unknown", () => {
    const packets = buildPersistentGapInvestigationPackets(
      report([gap("t300-01", [])]),
      []
    );
    assert.equal(packets.length, 1);
    const packet = packets[0]!;
    assert.equal(packet.status, "OWNER_ROUTING_REQUIRED");
    assert.deepEqual(packet.ownerHints, []);
    assert.match(packet.nextAction, /STOP before implementation/i);
    assert.ok(packet.stopConditions.some((row) => /No canonical owner can be proven/i.test(row)));
  });

  it("does nothing until the persistent-gap gate is actually open", () => {
    const notPersistent: PersistentMemoryGapReport = {
      ...report([]),
      status: "INSUFFICIENT_HISTORY",
      comparableCyclesAvailable: 2,
    };
    assert.deepEqual(
      buildPersistentGapInvestigationPackets(notPersistent, []),
      []
    );
  });

  it("renders investigation evidence without claiming a patch, recipe, or candidate was created", () => {
    const packets = buildPersistentGapInvestigationPackets(
      report([gap("item-ownership-01", ["relationship_durable"])]),
      []
    );
    const markdown = renderPersistentGapInvestigationPacketsMarkdown(packets);
    assert.match(markdown, /Persistent Gap Investigation Packets/);
    assert.match(markdown, /BUGFIX_INVESTIGATION_READY/);
    assert.match(markdown, /Regression gate:/);
    assert.match(markdown, /STOP:/);
    assert.match(markdown, /never create a candidate, live recipe, implementation branch, or production patch/i);
    assert.doesNotMatch(markdown, /patch created|recipe created|candidate created/i);
  });
});
