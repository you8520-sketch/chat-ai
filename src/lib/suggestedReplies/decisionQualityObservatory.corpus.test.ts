import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  observeSuggestedRepliesDecisionQuality,
  type SuggestedRepliesDecisionQualityIssue,
} from "./decisionQualityObservatory";
import { SUGGESTED_REPLIES_DECISION_QUALITY_CORPUS } from "./decisionQualityObservatory.fixtures";

function sorted(issues: SuggestedRepliesDecisionQualityIssue[]): SuggestedRepliesDecisionQualityIssue[] {
  return [...issues].sort();
}

describe("P3-A suggested replies offline decision-quality corpus", () => {
  for (const fixture of SUGGESTED_REPLIES_DECISION_QUALITY_CORPUS) {
    it(`${fixture.id}: ${fixture.label}`, () => {
      const observation = observeSuggestedRepliesDecisionQuality(fixture.rawModelText);
      assert.equal(observation.contractValid, fixture.expectedValid);
      assert.deepEqual(sorted(observation.issues), sorted(fixture.expectedIssues));
    });
  }

  it("keeps fixture ids unique and includes both valid and invalid controls", () => {
    const ids = SUGGESTED_REPLIES_DECISION_QUALITY_CORPUS.map((fixture) => fixture.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(SUGGESTED_REPLIES_DECISION_QUALITY_CORPUS.some((fixture) => fixture.expectedValid));
    assert.ok(SUGGESTED_REPLIES_DECISION_QUALITY_CORPUS.some((fixture) => !fixture.expectedValid));
  });
});
