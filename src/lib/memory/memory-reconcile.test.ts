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

function record(
  turnStart: number,
  turnEnd: number,
  inactive = false
): MemoryRecordView {
  return {
    id: turnStart,
    turnStart,
    turnEnd,
    turnRangeLabel: `${turnStart}~${turnEnd}턴`,
    summary: "요약",
    summaryKind: "main_canon",
    scopes: { main_canon: "요약" },
    branchId: null,
    branchStatus: null,
    promotedBy: null,
    promotedAt: null,
    inactive,
    userEdited: false,
    charCount: 2,
    assistantMessageId: null,
  };
}

describe("shouldTriggerRollingSummary seal at batch end", () => {
  it("seals [1~6] when turn 6 completes", () => {
    assert.equal(shouldTriggerRollingSummary(6, 0), true);
  });

  it("does not seal before turn 6", () => {
    assert.equal(shouldTriggerRollingSummary(5, 0), false);
  });

  it("seals [7~12] when turn 12 completes (first batch done)", () => {
    assert.equal(shouldTriggerRollingSummary(11, 6), false);
    assert.equal(shouldTriggerRollingSummary(12, 6), true);
  });
});

describe("turnsUntilNextSummary seal at batch end", () => {
  it("counts turns until seal at 6 for first batch", () => {
    assert.equal(turnsUntilNextSummary(0, 0), 6);
    assert.equal(turnsUntilNextSummary(5, 0), 1);
    assert.equal(turnsUntilNextSummary(6, 0), 0);
  });

  it("counts turns until next batch seal", () => {
    assert.equal(turnsUntilNextSummary(6, 6), 6);
    assert.equal(turnsUntilNextSummary(11, 6), 1);
    assert.equal(turnsUntilNextSummary(12, 6), 0);
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

  it("ignores soft-deleted (inactive) batches for contiguous coverage", () => {
    assert.equal(
      computeSummarizedTurnCountFromRecords([record(1, 6, true)], 7),
      0
    );
    assert.equal(
      computeSummarizedTurnCountFromRecords(
        [record(1, 6, true), record(7, 12, false)],
        13
      ),
      0
    );
  });
});

describe("pruneStaleMemoryRecords", () => {
  it("is exported for turn-delete reconcile", () => {
    assert.equal(typeof pruneStaleMemoryRecords, "function");
    assert.equal(ROLLING_SUMMARY_INTERVAL, 6);
  });
});
