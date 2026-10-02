import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  findResponseLengthTier,
  findResponseLengthTierForCanary,
  RESPONSE_LENGTH_UI_LABEL_V2,
  TARGET_RESPONSE_TIERS,
} from "@/lib/responseLengthConstants";

describe("response length UI label — 3200+ soft target, no upper cap", () => {
  it("uses a floor target without a point estimate, range, or min-guarantee", () => {
    const label = findResponseLengthTier().label;
    assert.match(label, /목표 3,200자 이상/);
    assert.match(label, /장면과 요청에 따라 더 길어질 수 있음/);
    assert.doesNotMatch(label, /약 3,200/);
    assert.doesNotMatch(label, /3,000/);
    assert.doesNotMatch(label, /최소/);
    assert.doesNotMatch(label, /보장/);
    assert.doesNotMatch(label, /2,?700/);
    assert.doesNotMatch(label, /[~～]/);
    assert.equal(TARGET_RESPONSE_TIERS[0]!.label, label);
    assert.equal(findResponseLengthTierForCanary(true).label, label);
    assert.equal(RESPONSE_LENGTH_UI_LABEL_V2, label);
  });
});
