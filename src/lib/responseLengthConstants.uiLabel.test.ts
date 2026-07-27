import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { findResponseLengthTier, TARGET_RESPONSE_TIERS } from "@/lib/responseLengthConstants";

describe("response length UI label — no min-guarantee copy", () => {
  it("uses soft aim wording without 최소/보장/2,700", () => {
    const label = findResponseLengthTier().label;
    assert.match(label, /목표 약 3,200자/);
    assert.match(label, /장면과 대화 맥락에 따라 자연스럽게 조절/);
    assert.doesNotMatch(label, /최소/);
    assert.doesNotMatch(label, /보장/);
    assert.doesNotMatch(label, /2,?700/);
    assert.equal(TARGET_RESPONSE_TIERS[0]!.label, label);
  });
});
