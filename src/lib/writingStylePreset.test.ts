import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DYNAMIC_PROSE_STYLING_BLOCK,
  KOREAN_WEBNOVEL_STYLE,
  KOREAN_WEBNOVEL_STYLE_BLOCK,
} from "@/lib/writingStylePreset";

describe("KOREAN WEBNOVEL STYLE", () => {
  it("includes 모드 A/B in single style block", () => {
    assert.match(KOREAN_WEBNOVEL_STYLE_BLOCK, /\[KOREAN WEBNOVEL STYLE\]/);
    assert.match(KOREAN_WEBNOVEL_STYLE, /모드 A \(일상·텐션\)/);
    assert.match(KOREAN_WEBNOVEL_STYLE, /모드 B \(19금 접촉\)/);
    assert.match(KOREAN_WEBNOVEL_STYLE, /슬로 모션/);
    assert.doesNotMatch(KOREAN_WEBNOVEL_STYLE, /불릿 타임/);
    assert.doesNotMatch(KOREAN_WEBNOVEL_STYLE, /\[DYNAMIC PROSE STYLING & SCENE EXPANSION\]/);
    assert.doesNotMatch(KOREAN_WEBNOVEL_STYLE, /Balance dialogue, action, emotion/);
  });

  it("deprecated DYNAMIC_PROSE_STYLING_BLOCK aliases unified block", () => {
    assert.equal(DYNAMIC_PROSE_STYLING_BLOCK, KOREAN_WEBNOVEL_STYLE_BLOCK);
  });

  it("keeps compact layout rules", () => {
    assert.match(KOREAN_WEBNOVEL_STYLE, /해체\(-다/);
    assert.match(KOREAN_WEBNOVEL_STYLE, /명사 단편 행/);
    assert.match(KOREAN_WEBNOVEL_STYLE, /말줄임 \.\.\./);
    assert.doesNotMatch(KOREAN_WEBNOVEL_STYLE, /^Ellipsis:/m);
  });
});
