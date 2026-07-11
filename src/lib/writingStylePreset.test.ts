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
    assert.match(KOREAN_WEBNOVEL_STYLE, /\[PROSE STYLE\]/);
    assert.match(KOREAN_WEBNOVEL_STYLE, /\[NARRATION REGISTER\]/);
    assert.match(KOREAN_WEBNOVEL_STYLE, /\[RHYTHM\]/);
    assert.match(KOREAN_WEBNOVEL_STYLE, /\[WEBNOVEL BREATH\]/);
    assert.match(KOREAN_WEBNOVEL_STYLE, /OUTPUT LAYOUT/);
    assert.match(KOREAN_WEBNOVEL_STYLE, /새 문단/);
    assert.doesNotMatch(KOREAN_WEBNOVEL_STYLE, /일상·대화/);
    assert.doesNotMatch(KOREAN_WEBNOVEL_STYLE, /모드 A/);
    assert.doesNotMatch(KOREAN_WEBNOVEL_STYLE, /모드 B/);
  });

  it("deprecated DYNAMIC_PROSE_STYLING_BLOCK aliases unified block", () => {
    assert.equal(DYNAMIC_PROSE_STYLING_BLOCK, KOREAN_WEBNOVEL_STYLE_BLOCK);
  });

  it("keeps compact layout rules", () => {
    assert.match(KOREAN_WEBNOVEL_STYLE, /해체\(-다/);
    assert.match(KOREAN_WEBNOVEL_STYLE, /명사 단편 행/);
    assert.match(KOREAN_WEBNOVEL_STYLE, /말줄임 \.\.\./);
  });
});
