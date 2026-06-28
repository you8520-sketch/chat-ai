import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyDenseNarrationPlacementP1,
  applyDenseNarrationPlacementP2,
  buildAdvancedProseNsfwGuidelines,
  DENSE_NARRATION_LIGHTWEIGHT_RULE,
  DIALOGUE_NARRATION_P2_WITH_DENSE,
  NSFW_EXPLICIT_SENSORY_WRITING_BLOCK,
  stripDenseNarrationRule,
} from "@/lib/advancedProseNsfwGuidelines";

describe("buildAdvancedProseNsfwGuidelines", () => {
  it("SFW mode uses unified dialogue/narration block without legacy sections", () => {
    const block = buildAdvancedProseNsfwGuidelines({ nsfwEnabled: false });
    assert.match(block, /=== 절대 금지 규칙 ===/);
    assert.match(block, /\[DIALOGUE & NARRATION\]/);
    assert.match(block, /\[KOREAN WEBNOVEL STYLE\]/);
    assert.doesNotMatch(block, /Explicit Sensory Mode/);
    assert.doesNotMatch(block, /INTIMATE\/NSFW/);
  });

  it("NSFW mode merges intimacy rules under two parts", () => {
    const block = buildAdvancedProseNsfwGuidelines({ nsfwEnabled: true });
    assert.match(block, /표현 규칙/);
    assert.match(block, /캐릭터 유지/);
    assert.match(block, /\[KOREAN WEBNOVEL STYLE\]/);
    assert.doesNotMatch(block, /직관·명확/);
    assert.doesNotMatch(block, /긴장감 \(19\+ OpenRouter\)/);
    assert.doesNotMatch(block, /see \[/i);
    assert.doesNotMatch(block, /\[WRITING STYLE: 19\+/);
    assert.doesNotMatch(block, /INTIMATE\/NSFW SCENE DYNAMICS/);
  });

  it("literary enhanced flag does not add tension subsection", () => {
    const block = buildAdvancedProseNsfwGuidelines({
      nsfwEnabled: true,
      literaryEnhanced: true,
    });
    assert.doesNotMatch(block, /긴장감 \(19\+ OpenRouter\)/);
  });

  it("exports NSFW intimacy section constant", () => {
    assert.match(NSFW_EXPLICIT_SENSORY_WRITING_BLOCK, /표현 규칙/);
    assert.match(NSFW_EXPLICIT_SENSORY_WRITING_BLOCK, /캐릭터 유지/);
  });

  it("P2 placement adds dense rule only under [DIALOGUE & NARRATION]", () => {
    const base = buildAdvancedProseNsfwGuidelines({ nsfwEnabled: true });
    const p2 = applyDenseNarrationPlacementP2(base);
    assert.ok(p2.includes(DIALOGUE_NARRATION_P2_WITH_DENSE));
  });

  it("P1 placement adds dense rule under [KOREAN WEBNOVEL STYLE] header", () => {
    const sample = `[KOREAN WEBNOVEL STYLE]\nNarration: 해체 only.`;
    const p1 = applyDenseNarrationPlacementP1(sample);
    assert.match(p1, /\[KOREAN WEBNOVEL STYLE\]\n- When writing narration, prefer/);
    assert.ok(p1.includes(DENSE_NARRATION_LIGHTWEIGHT_RULE));
  });

  it("stripDenseNarrationRule removes P2 bullet from dialogue block", () => {
    const withDense = applyDenseNarrationPlacementP2(
      buildAdvancedProseNsfwGuidelines({ nsfwEnabled: false })
    );
    const stripped = stripDenseNarrationRule(withDense);
    assert.ok(!stripped.includes(DENSE_NARRATION_LIGHTWEIGHT_RULE));
  });
});
