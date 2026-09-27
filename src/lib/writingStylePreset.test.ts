import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DYNAMIC_PROSE_STYLING_BLOCK,
  KOREAN_WEBNOVEL_STYLE,
  KOREAN_WEBNOVEL_STYLE_BLOCK,
} from "@/lib/writingStylePreset";
import { PROSE_STYLE_SECTION } from "@/lib/advancedProseNsfwGuidelines";

describe("KOREAN WEBNOVEL STYLE (deprecated alias)", () => {
  it("aliases PROSE_STYLE_SECTION", () => {
    assert.equal(KOREAN_WEBNOVEL_STYLE_BLOCK, PROSE_STYLE_SECTION);
    assert.match(KOREAN_WEBNOVEL_STYLE, /\[COMMON PROSE\]/);
    assert.match(KOREAN_WEBNOVEL_STYLE, /\[SCENE FLOW\]/);
    assert.doesNotMatch(KOREAN_WEBNOVEL_STYLE, /\[PROSE STYLE\]/);
    assert.doesNotMatch(KOREAN_WEBNOVEL_STYLE, /OUTPUT LAYOUT/);
    assert.doesNotMatch(KOREAN_WEBNOVEL_STYLE, /일상·대화/);
    assert.doesNotMatch(KOREAN_WEBNOVEL_STYLE, /모드 A/);
    assert.doesNotMatch(KOREAN_WEBNOVEL_STYLE, /모드 B/);
  });

  it("deprecated DYNAMIC_PROSE_STYLING_BLOCK aliases unified block", () => {
    assert.equal(DYNAMIC_PROSE_STYLING_BLOCK, KOREAN_WEBNOVEL_STYLE_BLOCK);
  });

  it("keeps compact narration rules", () => {
    assert.match(KOREAN_WEBNOVEL_STYLE, /해체\(-다/);
    assert.match(KOREAN_WEBNOVEL_STYLE, /자연스러운 한국어 완결문/);
    assert.match(KOREAN_WEBNOVEL_STYLE, /파편문·말줄임은/);
  });
});
