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
    assert.match(block, /내면 해설·설명형 감각 금지/);
    assert.match(block, /나열식 문장 금지/);
    assert.match(block, /동일 감각어 반복 금지/);
    assert.match(block, /\[DIALOGUE & NARRATION\]/);
    assert.match(block, /하나의 발화는 하나의 인용문으로 유지할 것/);
    assert.match(block, /대사 사이 지문은 최소 3문장/);
    assert.doesNotMatch(block, /prefer developing an action, observation, or sensory event/);
    assert.doesNotMatch(block, /\[DIALOGUE & NARRATION STRUCTURE\]/);
    assert.doesNotMatch(block, /감각·관계·대사 비율\(50\/30\/20\)/);
    assert.doesNotMatch(block, /클리셰 비유 금지/);
    assert.doesNotMatch(block, /\[NO DIALOGUE FRAGMENTATION\]/);
    assert.doesNotMatch(block, /\[NARRATION DENSITY — DIALOGUE SCENES\]/);
    assert.doesNotMatch(block, /\[Sensory layering guide\]/);
    assert.doesNotMatch(block, /\[PRIORITY CLARIFICATION — NSFW\]/);
    assert.doesNotMatch(block, /=== Prose craft \(all scenes\) ===/);
    assert.doesNotMatch(block, /Explicit Sensory Mode/);
    assert.doesNotMatch(block, /퇴폐적 관능/);
    assert.doesNotMatch(block, /2-8문장\(50자 이상\)/);
  });

  it("NSFW mode restores explicit sensory craft merged with webnovel pacing", () => {
    const block = buildAdvancedProseNsfwGuidelines({ nsfwEnabled: true });
    assert.match(block, /Explicit Sensory Mode/);
    assert.match(block, /INTIMATE\/NSFW SCENE DYNAMICS/);
    assert.match(block, /Directness over Euphemism/);
    assert.match(block, /Strict Anti-OOC/);
    assert.match(block, /티키타카/);
    assert.match(block, /\[DIALOGUE & NARRATION\]/);
    assert.match(block, /\[KOREAN_WEBNOVEL_STYLE\]/);
    assert.doesNotMatch(block, /50\/30\/20/);
    assert.doesNotMatch(block, /한 문단 안에: \[미묘한 행동 변화\]/);
    assert.doesNotMatch(block, /\[PRIORITY CLARIFICATION — NSFW\]/);
    assert.doesNotMatch(block, /\[NARRATION DENSITY — DIALOGUE SCENES\]/);
    assert.doesNotMatch(block, /=== 19\+/);
    assert.doesNotMatch(block, /Adult verified/);
    assert.doesNotMatch(block, /uncensored/i);
  });

  it("OpenRouter literary enhanced adds tension without silence spam", () => {
    const block = buildAdvancedProseNsfwGuidelines({
      nsfwEnabled: true,
      literaryEnhanced: true,
    });
    assert.match(block, /Literary tension \(19\+ · OpenRouter/);
    assert.match(block, /기싸움·권력 격돌/);
    assert.doesNotMatch(block, /Power struggles/);
    assert.doesNotMatch(block, /19\+ 컨텍스트/);
    assert.doesNotMatch(block, /19\+ 플랫폼/);
    assert.doesNotMatch(block, /Adult verified/);
  });

  it("exports standalone NSFW block with anatomy and anti-OOC rules", () => {
    assert.match(NSFW_EXPLICIT_SENSORY_WRITING_BLOCK, /성기|귀두|음경/);
    assert.match(NSFW_EXPLICIT_SENSORY_WRITING_BLOCK, /\[CORE RP\] §3 \[SPEECH\]/);
    assert.match(
      NSFW_EXPLICIT_SENSORY_WRITING_BLOCK,
      /\[KOREAN_WEBNOVEL_STYLE\]·\[DIALOGUE & NARRATION\]/
    );
    assert.doesNotMatch(NSFW_EXPLICIT_SENSORY_WRITING_BLOCK, /Adult verified/);
    assert.doesNotMatch(NSFW_EXPLICIT_SENSORY_WRITING_BLOCK, /censorship disclaimers/);
    assert.match(NSFW_EXPLICIT_SENSORY_WRITING_BLOCK, /해부학적 명칭/);
    assert.match(NSFW_EXPLICIT_SENSORY_WRITING_BLOCK, /2\. 감각·의도 결합/);
    assert.match(NSFW_EXPLICIT_SENSORY_WRITING_BLOCK, /\[DYNAMIC PROSE STYLING\] Mode B/);
    assert.doesNotMatch(NSFW_EXPLICIT_SENSORY_WRITING_BLOCK, /복합 감정선/);
    assert.doesNotMatch(NSFW_EXPLICIT_SENSORY_WRITING_BLOCK, /Sensory & Intent Integration/);
    assert.doesNotMatch(NSFW_EXPLICIT_SENSORY_WRITING_BLOCK, /\[NARRATION DENSITY — DIALOGUE SCENES\]/);
  });

  it("P2 placement adds dense rule only under [DIALOGUE & NARRATION]", () => {
    const base = buildAdvancedProseNsfwGuidelines({ nsfwEnabled: true });
    const p2 = applyDenseNarrationPlacementP2(base);
    assert.ok(p2.includes(DIALOGUE_NARRATION_P2_WITH_DENSE));
    assert.doesNotMatch(p2, /Writing principles:\n- When writing narration, prefer/);
  });

  it("P1 placement adds dense rule under KOREAN_WEBNOVEL_STYLE header", () => {
    const sample = `[KOREAN_WEBNOVEL_STYLE]\nNarration body: 해체 only.`;
    const p1 = applyDenseNarrationPlacementP1(sample);
    assert.match(p1, /\[KOREAN_WEBNOVEL_STYLE\]\n- When writing narration, prefer/);
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
