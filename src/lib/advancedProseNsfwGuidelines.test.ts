import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyDenseNarrationPlacementP1,
  applyDenseNarrationPlacementP2,
  buildAdvancedProseNsfwGuidelines,
  DENSE_NARRATION_LIGHTWEIGHT_RULE,
  DIALOGUE_NARRATION_P2_WITH_DENSE,
  NSFW_EXPLICIT_SENSORY_WRITING_BLOCK,
  PROSE_STYLE_SECTION,
  stripDenseNarrationRule,
} from "@/lib/advancedProseNsfwGuidelines";
import { buildWebnovelOutputLayoutRecencyBlock } from "@/lib/webnovelOutputFormat";

describe("buildAdvancedProseNsfwGuidelines", () => {
  it("SFW mode uses unified block without NSFW section", () => {
    const block = buildAdvancedProseNsfwGuidelines({ nsfwEnabled: false });
    assert.match(block, /\[WEBNOVEL OUTPUT FORMAT\]/);
    assert.doesNotMatch(block, /ALWAYS starts a new paragraph/);
    assert.doesNotMatch(block, /\[NO ABSTRACT SUMMARIES\]/);
    assert.doesNotMatch(block, /\[CROSS-TURN VARIATION\]/);
    assert.doesNotMatch(block, /\[NATURAL PROSE\]/);
    assert.doesNotMatch(block, /\[SHOW BEFORE TELL\]/);
    assert.doesNotMatch(block, /\[NO TEMPLATE WRITING\]/);
    assert.match(block, /\[NARRATION REGISTER\]/);
    assert.match(block, /\[SCENE FLOW\]/);
    assert.match(block, /\[RHYTHM\]/);
    assert.match(block, /\[IMMERSIVE PROSE\]/);
    assert.match(block, /생각·연상·기억·오해·감정·판단/);
    assert.match(block, /뜻이었다/);
    assert.match(block, /브리핑으로 만들지 않는다/);
    assert.match(block, /\[WEBNOVEL BREATH\]/);
    assert.doesNotMatch(block, /\[EMOTION & INNER EXPERIENCE\]/);
    assert.doesNotMatch(block, /\[NO POST-HOC VERDICT\]/);
    assert.doesNotMatch(block, /\[DIALOGUE NATURALNESS\]/);
    assert.doesNotMatch(block, /\[MOVEMENT & DETAIL\]/);
    assert.doesNotMatch(block, /\[BODY AND PROP INVENTORY\]/);
    assert.doesNotMatch(block, /\[GENERATION PROCESS — BEAT FLOW\]/);
    assert.doesNotMatch(block, /one fact per beat/i);
    assert.doesNotMatch(block, /감정 이름·해석·결론 없이/);
    assert.doesNotMatch(block, /\[DIALOGUE & NARRATION\]/);
    assert.doesNotMatch(block, /\[ADVANCED PROSE & NSFW GUIDELINES\]/);
    assert.doesNotMatch(block, /\[PROSE STYLE\]/);
    assert.doesNotMatch(block, /\[19\+ INTIMACY\]/);
    assert.doesNotMatch(block, /모드 A/);
    assert.doesNotMatch(block, /2~8문장/);
    assert.doesNotMatch(block, /최소 3문장/);
  });

  it("NSFW mode appends intimacy section only", () => {
    const block = buildAdvancedProseNsfwGuidelines({ nsfwEnabled: true });
    assert.match(block, /\[19\+ INTIMACY\]/);
    assert.match(block, /해부학적 명칭/);
    assert.match(block, /기계적 피스톤/);
    assert.doesNotMatch(block, /슬로 모션 — 한 동작을 마찰/);
    assert.match(block, /\[NARRATION REGISTER\]/);
    assert.doesNotMatch(block, /성기·귀두·음경/);
    assert.doesNotMatch(block, /모드 B/);
  });

  it("literary enhanced flag does not add extra subsection", () => {
    const block = buildAdvancedProseNsfwGuidelines({
      nsfwEnabled: true,
      literaryEnhanced: true,
    });
    assert.equal(
      block,
      buildAdvancedProseNsfwGuidelines({ nsfwEnabled: true, literaryEnhanced: false })
    );
  });

  it("exports NSFW intimacy section constant", () => {
    assert.match(NSFW_EXPLICIT_SENSORY_WRITING_BLOCK, /\[19\+ INTIMACY\]/);
    assert.match(NSFW_EXPLICIT_SENSORY_WRITING_BLOCK, /해부학적 명칭/);
  });

  it("P2 placement adds dense rule only under [DIALOGUE & NARRATION]", () => {
    const base = buildWebnovelOutputLayoutRecencyBlock();
    const p2 = applyDenseNarrationPlacementP2(base);
    assert.ok(p2.includes(DIALOGUE_NARRATION_P2_WITH_DENSE));
  });

  it("P1 placement adds dense rule under [NARRATION REGISTER]", () => {
    const sample = `${PROSE_STYLE_SECTION}\nExtra line.`;
    const p1 = applyDenseNarrationPlacementP1(sample);
    assert.match(p1, /\[NARRATION REGISTER\]\n- Keep a continuous scene beat's action/);
    assert.ok(p1.includes(DENSE_NARRATION_LIGHTWEIGHT_RULE));
  });

  it("stripDenseNarrationRule removes P2 bullet from dialogue block", () => {
    const withDense = applyDenseNarrationPlacementP2(buildWebnovelOutputLayoutRecencyBlock());
    const stripped = stripDenseNarrationRule(withDense);
    assert.ok(!stripped.includes(DENSE_NARRATION_LIGHTWEIGHT_RULE));
  });
});
