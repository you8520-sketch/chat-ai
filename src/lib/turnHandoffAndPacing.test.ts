import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildTurnHandoffAndPacingBlock } from "@/lib/turnHandoffAndPacing";

describe("buildTurnHandoffAndPacingBlock", () => {
  it("is turn-end / handoff policy only — generalized handoff, no verb examples", () => {
    const block = buildTurnHandoffAndPacingBlock();
    assert.match(block, /<TURN_HANDOFF_AND_PACING>/);
    assert.match(block, /\[조기 종료 금지\]/);
    assert.match(block, /관찰자 붕괴 결말/);
    assert.match(block, /\[TURN HANDOFF\]/);
    assert.match(block, /Never end immediately after a seemingly complete moment/);
    assert.match(block, /Return the scene naturally to the user/);
    assert.doesNotMatch(block, /기다렸다/);
    assert.doesNotMatch(block, /바라보았다/);
    assert.doesNotMatch(block, /\[FORBIDDEN EARLY STOP\]/);
    assert.doesNotMatch(block, /TARGET_LENGTH:/);
    assert.doesNotMatch(block, /\[SCENE CONTINUATION PRIORITY\]/);
  });
});
