import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { aggregateSuggestedRepliesDecisionQuality } from "./decisionQualityAggregate";
import { SUGGESTED_REPLIES_DECISION_QUALITY_CORPUS } from "./decisionQualityObservatory.fixtures";

describe("P3-A suggested replies decision-quality aggregate", () => {
  it("aggregates the frozen corpus without retaining raw model text", () => {
    const aggregate = aggregateSuggestedRepliesDecisionQuality(
      SUGGESTED_REPLIES_DECISION_QUALITY_CORPUS.map((fixture) => fixture.rawModelText)
    );

    assert.equal(aggregate.sampleCount, 10);
    assert.equal(aggregate.validCount, 1);
    assert.equal(aggregate.invalidCount, 9);
    assert.equal(aggregate.multiIssueSampleCount, 4);

    assert.deepEqual(aggregate.issueCounts, [
      { issue: "duplicate_kind", count: 2 },
      { issue: "duplicate_text", count: 2 },
      { issue: "malformed_json", count: 1 },
      { issue: "missing_items", count: 1 },
      { issue: "missing_kind", count: 4 },
      { issue: "missing_text", count: 1 },
      { issue: "text_out_of_bounds", count: 2 },
      { issue: "unknown_kind", count: 2 },
      { issue: "wrong_item_count", count: 2 },
    ]);

    assert.equal(JSON.stringify(aggregate).includes("rawModelText"), false);
    assert.equal(JSON.stringify(aggregate).includes("같은 반응"), false);
  });

  it("returns a stable empty aggregate for no samples", () => {
    assert.deepEqual(aggregateSuggestedRepliesDecisionQuality([]), {
      sampleCount: 0,
      validCount: 0,
      invalidCount: 0,
      multiIssueSampleCount: 0,
      issueCounts: [],
    });
  });
});
