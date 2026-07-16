import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ROLLING_SUMMARY_INTERVAL } from "@/lib/hybridMemory";
import {
  computeSummarizedTurnCountFromRecords,
  pruneStaleMemoryRecords,
} from "@/lib/memory/memory-reconcile";
import {
  shouldTriggerRollingSummary,
  turnsUntilNextSummary,
} from "@/lib/memory/memory-rolling-summary";
import type { MemoryRecordView } from "@/lib/memory/memory-turn-summary";

function record(turnStart: number, turnEnd: number): MemoryRecordView {
  return {
    id: turnStart,
    turnStart,
    turnEnd,
    turnRangeLabel: `${turnStart}~${turnEnd}턴`,
    summary: "요약",
    summaryKind: "narrative",
    userEdited: false,
    charCount: 2,
    assistantMessageId: null,
  };
}

describe("shouldTriggerRollingSummary deferred seal", () => {
  it("does not seal [1~6] at turn 6 completion", () => {
    assert.equal(shouldTriggerRollingSummary(6, 0), false);
  });

  it("seals [1~6] after turn 7 completion", () => {
    assert.equal(shouldTriggerRollingSummary(7, 0), true);
  });

  it("seals [7~12] after turn 13 when first batch done", () => {
    assert.equal(shouldTriggerRollingSummary(12, 6), false);
    assert.equal(shouldTriggerRollingSummary(13, 6), true);
  });
});

describe("turnsUntilNextSummary deferred seal", () => {
  it("counts turns until seal at 7 for first batch", () => {
    assert.equal(turnsUntilNextSummary(0, 0), 7);
    assert.equal(turnsUntilNextSummary(6, 0), 1);
    assert.equal(turnsUntilNextSummary(7, 0), 0);
  });

  it("counts turns until next batch seal", () => {
    assert.equal(turnsUntilNextSummary(6, 6), 7);
    assert.equal(turnsUntilNextSummary(12, 6), 1);
    assert.equal(turnsUntilNextSummary(13, 6), 0);
  });
});

describe("computeSummarizedTurnCountFromRecords", () => {
  it("uses only contiguous complete batches from turn 1", () => {
    const summarized = computeSummarizedTurnCountFromRecords(
      [record(1, 6), record(7, 12)],
      13
    );
    assert.equal(summarized, 12);
  });

  it("returns 0 when first batch missing even if later exists", () => {
    assert.equal(computeSummarizedTurnCountFromRecords([record(7, 12)], 13), 0);
  });

  it("returns 0 when no complete batch fits", () => {
    assert.equal(computeSummarizedTurnCountFromRecords([record(1, 6)], 5), 0);
  });
});

describe("pruneStaleMemoryRecords", () => {
  it("is exported for turn-delete reconcile", () => {
    assert.equal(typeof pruneStaleMemoryRecords, "function");
    assert.equal(ROLLING_SUMMARY_INTERVAL, 6);
  });
});
