import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { BaselineSnapshot } from "@/lib/memoryResearch/baselineTrend";
import {
  buildPersistentMemoryGapReport,
  renderPersistentMemoryGapMarkdown,
} from "@/lib/memoryResearch/persistentGapRadar";

const METRICS = {
  candidateRecallAtK: { value: 1, status: "MEASURED", eligibleCases: 1, totalCases: 1 },
  finalRecallAt8: { value: 1, status: "MEASURED", eligibleCases: 1, totalCases: 1 },
  precision: { value: 1, status: "MEASURED", eligibleCases: 1, totalCases: 1 },
  falseInjectionRate: { value: 0, status: "MEASURED", eligibleCases: 1, totalCases: 1 },
  falseMemoryRate: { value: 0, status: "MEASURED", eligibleCases: 1, totalCases: 1 },
  irrelevantInjectionRate: { value: 0, status: "MEASURED", eligibleCases: 1, totalCases: 1 },
  staleStateRecallRate: { value: 0, status: "MEASURED", eligibleCases: 1, totalCases: 1 },
  relationshipRoleConsistency: { value: 1, status: "MEASURED", eligibleCases: 1, totalCases: 1 },
  distinctiveUtteranceRecall: { value: 1, status: "MEASURED", eligibleCases: 1, totalCases: 1 },
  correctionSupersessionAccuracy: { value: 1, status: "MEASURED", eligibleCases: 1, totalCases: 1 },
} as const;

function snapshot(
  fingerprint: string,
  finalHitByCase: Record<string, boolean>
): BaselineSnapshot {
  return {
    benchmarkFingerprint: fingerprint,
    cases: Object.keys(finalHitByCase).length,
    evaluatedTurns: 10,
    promptTokensPerTurn: 100,
    invariantViolationCount: 0,
    metrics: { ...METRICS },
    finalHitByCase,
  };
}

describe("Persistent Memory Gap Radar", () => {
  it("promotes only a positive case that misses for 3 consecutive comparable cycles", () => {
    const caseId = "semantic-paraphrase-KNOWN_GAP_BASELINE_REPRO-01";
    const current = snapshot("fp-a", { [caseId]: false, "t300-01": true });
    const report = buildPersistentMemoryGapReport(
      current,
      [
        { cycleKey: "weekly-1", baseline: snapshot("fp-a", { [caseId]: false, "t300-01": true }) },
        { cycleKey: "weekly-2", baseline: snapshot("fp-a", { [caseId]: false, "t300-01": true }) },
      ],
      3
    );

    assert.equal(report.status, "PERSISTENT_GAPS");
    assert.equal(report.persistentGaps.length, 1);
    const gap = report.persistentGaps[0]!;
    assert.equal(gap.caseId, caseId);
    assert.equal(gap.consecutiveComparableFailures, 3);
    assert.equal(gap.documentedKnownGap, true);
    assert.deepEqual(gap.capabilityGroups, ["TEMPORAL_REASONING"]);
    assert.deepEqual(gap.ownerHints, ["semantic_retrieval", "embedding_index"]);
    assert.match(gap.nextAction, /semantic-retrieval\/embedding experiment lane/);
  });

  it("keeps a one-off/current miss transient instead of opening a research gap", () => {
    const current = snapshot("fp-a", { "t300-01": false });
    const report = buildPersistentMemoryGapReport(
      current,
      [
        { cycleKey: "weekly-1", baseline: snapshot("fp-a", { "t300-01": true }) },
        { cycleKey: "weekly-2", baseline: snapshot("fp-a", { "t300-01": false }) },
      ],
      3
    );

    assert.equal(report.status, "CLEAR");
    assert.deepEqual(report.persistentGaps, []);
    assert.deepEqual(report.transientOrUnconfirmedFailures, ["t300-01"]);
  });

  it("resets persistence at a benchmark fingerprint change", () => {
    const caseId = "semantic-paraphrase-KNOWN_GAP_BASELINE_REPRO-01";
    const current = snapshot("fp-new", { [caseId]: false });
    const report = buildPersistentMemoryGapReport(
      current,
      [
        { cycleKey: "weekly-old", baseline: snapshot("fp-old", { [caseId]: false }) },
        { cycleKey: "weekly-new-1", baseline: snapshot("fp-new", { [caseId]: false }) },
      ],
      3
    );

    assert.equal(report.status, "INSUFFICIENT_HISTORY");
    assert.equal(report.comparableCyclesAvailable, 2);
    assert.deepEqual(report.persistentGaps, []);
  });

  it("does not bridge across a cycle with no measured baseline", () => {
    const current = snapshot("fp-a", { "distinctive-utterance-01": false });
    const report = buildPersistentMemoryGapReport(
      current,
      [
        { cycleKey: "weekly-1", baseline: snapshot("fp-a", { "distinctive-utterance-01": false }) },
        { cycleKey: "weekly-missing", baseline: null },
        { cycleKey: "weekly-2", baseline: snapshot("fp-a", { "distinctive-utterance-01": false }) },
      ],
      3
    );

    assert.equal(report.comparableCyclesAvailable, 2);
    assert.equal(report.status, "INSUFFICIENT_HISTORY");
    assert.deepEqual(report.persistentGaps, []);
  });

  it("flags an unexpected persistent positive miss as BUGFIX investigation, not auto-patch", () => {
    const caseId = "t300-01";
    const current = snapshot("fp-a", { [caseId]: false });
    const history = [
      { cycleKey: "weekly-1", baseline: snapshot("fp-a", { [caseId]: false }) },
      { cycleKey: "weekly-2", baseline: snapshot("fp-a", { [caseId]: false }) },
    ];
    const report = buildPersistentMemoryGapReport(current, history, 3);
    const gap = report.persistentGaps[0]!;

    assert.equal(gap.documentedKnownGap, false);
    assert.match(gap.nextAction, /BUGFIX investigation/);
    assert.match(gap.nextAction, /STOP before patching/);
  });

  it("requires enough same-fingerprint history even when current known gaps exist", () => {
    const caseId = "item-ownership-01";
    const report = buildPersistentMemoryGapReport(
      snapshot("fp-a", { [caseId]: false }),
      [{ cycleKey: "weekly-1", baseline: snapshot("fp-a", { [caseId]: false }) }],
      3
    );
    assert.equal(report.status, "INSUFFICIENT_HISTORY");
    assert.deepEqual(report.persistentGaps, []);
    assert.deepEqual(report.transientOrUnconfirmedFailures, [caseId]);
  });

  it("renders evidence without claiming automatic implementation", () => {
    const caseId = "distinctive-utterance-01";
    const report = buildPersistentMemoryGapReport(
      snapshot("fp-a", { [caseId]: false }),
      [
        { cycleKey: "weekly-1", baseline: snapshot("fp-a", { [caseId]: false }) },
        { cycleKey: "weekly-2", baseline: snapshot("fp-a", { [caseId]: false }) },
      ]
    );
    const markdown = renderPersistentMemoryGapMarkdown(report);
    assert.match(markdown, /Persistent Memory Gap Radar/);
    assert.match(markdown, /PERSISTENT_GAPS/);
    assert.match(markdown, /semantic_retrieval, embedding_index/);
    assert.doesNotMatch(markdown, /auto[- ]?patch|auto[- ]?merge/i);
  });
});
