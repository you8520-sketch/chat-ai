import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GENERATION_PROCESS_BEAT_FLOW_BLOCK,
  SCENE_FLOW_BLOCK,
} from "@/lib/generationProcessBeatFlow";

describe("SCENE_FLOW_BLOCK", () => {
  it("guides pacing without fixed beat checklist or one-fact-per-beat", () => {
    assert.equal(GENERATION_PROCESS_BEAT_FLOW_BLOCK, SCENE_FLOW_BLOCK);
    assert.match(SCENE_FLOW_BLOCK, /\[SCENE FLOW\]/);
    assert.match(SCENE_FLOW_BLOCK, /calm\/tension\/combat는 분량 수준을 의미하지 않는다/);
    assert.match(SCENE_FLOW_BLOCK, /짧게 요약하지 않고/);
    assert.doesNotMatch(SCENE_FLOW_BLOCK, /one fact per beat/i);
    assert.doesNotMatch(SCENE_FLOW_BLOCK, /\[GENERATION PROCESS — BEAT FLOW\]/);
    assert.doesNotMatch(SCENE_FLOW_BLOCK, /maxNar=/i);
    assert.doesNotMatch(SCENE_FLOW_BLOCK, /1→6 loops/i);
    assert.doesNotMatch(SCENE_FLOW_BLOCK, /고정된 비트 순서/);
  });
});
