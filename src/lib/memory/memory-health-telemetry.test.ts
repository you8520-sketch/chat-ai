import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildMemoryHealthTelemetry } from "./memory-health-telemetry";

describe("memory health telemetry", () => {
  it("emits compact 5+4 fields without prose", () => {
    const payload = buildMemoryHealthTelemetry({
      completedPlayableTurns: 9,
      summarizedThrough: 5,
      realRawCompleteExchanges: 4,
      openingInRaw: true,
      bridgeInRaw: false,
      episodicCandidateCount: 3,
      episodicInjectedCount: 2,
      episodicDuplicateBlockedCount: 1,
      episodicBudgetBlockedCount: 0,
      statusExtractCallCount: 0,
    });
    assert.equal(payload.memory_policy, "summary5_raw4");
    assert.equal(payload.next_pending_summary_range, "6~10");
    assert.equal(payload.real_raw_complete_exchanges, 4);
    assert.equal(payload.opening_in_raw, true);
    const json = JSON.stringify(payload);
    assert.doesNotMatch(json, /유저:|캐릭터:|안녕/);
  });
});
