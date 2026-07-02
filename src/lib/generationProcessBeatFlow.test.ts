import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GENERATION_PROCESS_BEAT_FLOW_BLOCK } from "@/lib/generationProcessBeatFlow";

describe("GENERATION_PROCESS_BEAT_FLOW_BLOCK", () => {
  it("guides pacing without fixed alternation or maxNar caps", () => {
    assert.match(GENERATION_PROCESS_BEAT_FLOW_BLOCK, /\[GENERATION PROCESS — BEAT FLOW\]/);
    assert.match(GENERATION_PROCESS_BEAT_FLOW_BLOCK, /no fixed nar↔dlg alternation/i);
    assert.doesNotMatch(GENERATION_PROCESS_BEAT_FLOW_BLOCK, /alternation;/i);
    assert.doesNotMatch(GENERATION_PROCESS_BEAT_FLOW_BLOCK, /maxNar=/i);
    assert.doesNotMatch(GENERATION_PROCESS_BEAT_FLOW_BLOCK, /1→6 loops/i);
    assert.doesNotMatch(GENERATION_PROCESS_BEAT_FLOW_BLOCK, /never stack narration-only blocks/i);
  });
});
