import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildTurnHandoffAndPacingBlock } from "@/lib/turnHandoffAndPacing";

describe("buildTurnHandoffAndPacingBlock", () => {
  it("is turn-end / handoff policy only — no scene expansion blueprint or agency lists", () => {
    const block = buildTurnHandoffAndPacingBlock();
    assert.match(block, /<TURN_HANDOFF_AND_PACING>/);
    assert.match(block, /\[조기 종료 금지\]/);
    assert.match(block, /관찰자 붕괴 결말/);
    assert.doesNotMatch(block, /\[FORBIDDEN EARLY STOP\]/);
    assert.doesNotMatch(block, /Do not end after only one reaction/);
    assert.doesNotMatch(block, /Tidy or "natural"/);
    assert.doesNotMatch(block, /Pausing at \[A\] waiting/);
    assert.doesNotMatch(block, /Handoff only after/);
    assert.doesNotMatch(block, /Handoff ONLY/);
    assert.doesNotMatch(block, /TARGET_LENGTH:/);
    assert.doesNotMatch(block, /\[SCENE CONTINUATION PRIORITY\]/);
    assert.doesNotMatch(block, /\[AUTO-CONTINUE\]/);
    assert.doesNotMatch(block, /\[EXIT RULE — LENGTH SHORTFALL\]/);
    assert.doesNotMatch(block, /\[TIME DILATION — MICRO-PACING TECHNIQUE\]/);
  });
});
