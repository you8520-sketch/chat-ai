import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildTurnHandoffAndPacingBlock } from "@/lib/turnHandoffAndPacing";

describe("buildTurnHandoffAndPacingBlock", () => {
  it("is turn-end / handoff policy only — no length floors or blueprint", () => {
    const block = buildTurnHandoffAndPacingBlock();
    assert.match(block, /<TURN_HANDOFF_AND_PACING>/);
    assert.match(block, /\[WHEN YOU MAY END\]/);
    assert.match(block, /\[FORBIDDEN AT END\]/);
    assert.match(block, /기다리며/);
    assert.match(block, /per \[NO GODMODDING\]/);
    assert.doesNotMatch(block, /phase floor/);
    assert.doesNotMatch(block, /tier minimum/);
    assert.doesNotMatch(block, /\[SCENE EXPANSION BLUEPRINT\]/);
    assert.doesNotMatch(block, /\[NO INPUT ECHO\]/);
    assert.doesNotMatch(block, /\[LENGTH CONTROL & SCENE EXPANSION\]/);
    assert.doesNotMatch(block, /\[EXIT RULE — LENGTH SHORTFALL\]/);
    assert.doesNotMatch(block, /\[TIME DILATION — MICRO-PACING TECHNIQUE\]/);
  });
});
