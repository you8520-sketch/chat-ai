import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { aggregateSuggestedRepliesDecisionQuality } from "./decisionQualityAggregate";
import { SUGGESTED_REPLIES_DECISION_QUALITY_CORPUS } from "./decisionQualityObservatory.fixtures";

describe("P3-A suggested replies decision-quality aggregate", () => {
  it("aggregates the frozen corpus without retaining raw model text", () => {
    const aggregate = aggregateSuggestedRepliesDecisionQuality(
      SUGGESTED_REPLIES_DECISION_QUALITY_CORPUS.map((fixture) => fixture.rawModelText)
    );

    const expectedIssueCounts = new Map<string, number>();
    for (const fixture of SUGGESTED_REPLIES_DECISION_QUALITY_CORPUS) {
      for (const issue of fixture.expectedIssues) {
        expectedIssueCounts.set(issue, (expectedIssueCounts.get(issue) ?? 0) + 1);
      }
    }

    assert.equal(
      aggregate.sampleCount,
      SUGGESTED_REPLIES_DECISION_QUALITY_CORPUS.length
    );
    assert.equal(
      aggregate.validCount,
      SUGGESTED_REPLIES_DECISION_QUALITY_CORPUS.filter(
        (fixture) => fixture.expectedValid
      ).length
    );
    assert.equal(
      aggregate.invalidCount,
      SUGGESTED_REPLIES_DECISION_QUALITY_CORPUS.filter(
        (fixture) => !fixture.expectedValid
      ).length
    );
    assert.equal(
      aggregate.multiIssueSampleCount,
      SUGGESTED_REPLIES_DECISION_QUALITY_CORPUS.filter(
        (fixture) => fixture.expectedIssues.length > 1
      ).length
    );

    assert.deepEqual(
      aggregate.issueCounts,
      [...expectedIssueCounts.entries()]
        .map(([issue, count]) => ({ issue, count }))
        .sort((a, b) => a.issue.localeCompare(b.issue))
    );

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
