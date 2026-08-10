import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isRollingSummaryInFlight,
  processRollingSummaryBatch,
} from "./memory-rolling-summary";

describe("rolling summary single-flight coalesce", () => {
  it("exports in-flight probe", () => {
    assert.equal(typeof isRollingSummaryInFlight, "function");
    assert.equal(typeof processRollingSummaryBatch, "function");
    assert.equal(isRollingSummaryInFlight(-1), false);
  });
});
