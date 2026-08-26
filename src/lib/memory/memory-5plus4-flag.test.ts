import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isSummaryBarrierActive } from "./memory-feature";
import { newBatchEndForStart, resolveNextBatchRange } from "./memory-summary-range";
import { highestContiguousCompletedTurn } from "./memory-summary-integrity";
import { RAW_HISTORY_COMPLETE_EXCHANGES } from "./memory-constants";

describe("legacy 5+4 flag removed — single 5+4 policy", () => {
  it("writer is 5-turn and RAW is 4 regardless of MEMORY_5PLUS4_ENABLED", () => {
    const prev = process.env.MEMORY_5PLUS4_ENABLED;
    try {
      delete process.env.MEMORY_5PLUS4_ENABLED;
      process.env.MEMORY_FEATURE_ENABLED = "1";
      assert.equal(newBatchEndForStart(1), 5);
      assert.equal(newBatchEndForStart(7), 11);
      assert.equal(RAW_HISTORY_COMPLETE_EXCHANGES, 4);
      assert.equal(isSummaryBarrierActive(), true);

      process.env.MEMORY_5PLUS4_ENABLED = "false";
      assert.equal(newBatchEndForStart(1), 5);
      assert.deepEqual(resolveNextBatchRange(6, 11), { turnStart: 7, turnEnd: 11 });
    } finally {
      if (prev === undefined) delete process.env.MEMORY_5PLUS4_ENABLED;
      else process.env.MEMORY_5PLUS4_ENABLED = prev;
    }
  });

  it("mixed historical 6+5 spans stay readable", () => {
    const records = [
      { turnStart: 1, turnEnd: 6 },
      { turnStart: 7, turnEnd: 12 },
      { turnStart: 13, turnEnd: 17 },
      { turnStart: 18, turnEnd: 22 },
    ];
    assert.equal(highestContiguousCompletedTurn(records, 25), 22);
  });
});
