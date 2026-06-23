import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DYNAMIC_PROSE_STYLING_BLOCK,
  KOREAN_WEBNOVEL_STYLE,
} from "@/lib/writingStylePreset";

describe("KOREAN_WEBNOVEL_STYLE", () => {
  it("includes dynamic prose dual-engine styling", () => {
    assert.match(KOREAN_WEBNOVEL_STYLE, /\[DYNAMIC PROSE STYLING & SCENE EXPANSION\]/);
    assert.match(KOREAN_WEBNOVEL_STYLE, /일상 및 텐션 빌드업 구간 \(Mode A\)/);
    assert.match(KOREAN_WEBNOVEL_STYLE, /본격적인 19금 육체적 접촉 구간 \(Mode B\)/);
    assert.match(KOREAN_WEBNOVEL_STYLE, /긍정적 행동 지침/);
    assert.match(KOREAN_WEBNOVEL_STYLE, /입체적으로 증폭/);
    assert.match(KOREAN_WEBNOVEL_STYLE, /Bullet-time/);
    assert.doesNotMatch(KOREAN_WEBNOVEL_STYLE, /Balance dialogue, action, emotion/);
    assert.doesNotMatch(DYNAMIC_PROSE_STYLING_BLOCK, /금지/);
    assert.doesNotMatch(DYNAMIC_PROSE_STYLING_BLOCK, /배제/);
  });

  it("exports standalone dynamic styling block", () => {
    assert.match(DYNAMIC_PROSE_STYLING_BLOCK, /해부학적 명칭/);
    assert.match(DYNAMIC_PROSE_STYLING_BLOCK, /4단계로 팽창/);
  });

  it("keeps compact layout rules not covered by DYNAMIC PROSE", () => {
    assert.match(KOREAN_WEBNOVEL_STYLE, /해체\(-다/);
    assert.match(KOREAN_WEBNOVEL_STYLE, /noun-fragment lines/);
    assert.match(KOREAN_WEBNOVEL_STYLE, /Ellipsis:/);
    assert.doesNotMatch(KOREAN_WEBNOVEL_STYLE, /one complete utterance or thought/);
    assert.doesNotMatch(KOREAN_WEBNOVEL_STYLE, /2–8 connected narration/);
    assert.doesNotMatch(KOREAN_WEBNOVEL_STYLE, /Scene or time shift/);
    assert.doesNotMatch(KOREAN_WEBNOVEL_STYLE, /Writing principles:/);
  });
});
