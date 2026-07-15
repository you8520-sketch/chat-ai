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

describe("buildAdvancedProseNsfwGuidelines", () => {
  it("SFW mode uses unified block without NSFW section", () => {
    const block = buildAdvancedProseNsfwGuidelines({ nsfwEnabled: false });
    assert.match(block, /\[WEBNOVEL OUTPUT FORMAT\]/);
    assert.doesNotMatch(block, /ALWAYS starts a new paragraph/);
    assert.match(block, /=== 절대 금지 규칙 ===/);
    assert.match(block, /\[NO STAGE DIRECTIONS\]/);
    assert.doesNotMatch(block, /\[NO ABSTRACT SUMMARIES\]/);
    assert.doesNotMatch(block, /\[CROSS-TURN VARIATION\]/);
    assert.doesNotMatch(block, /\[NATURAL PROSE\]/);
    assert.doesNotMatch(block, /\[SHOW BEFORE TELL\]/);
    assert.doesNotMatch(block, /\[NO TEMPLATE WRITING\]/);
    assert.match(block, /\[NARRATION REGISTER\]/);
    assert.match(block, /\[GENERATION PROCESS — BEAT FLOW\]/);
    assert.match(block, /\[RHYTHM\]/);
    assert.match(block, /\[EMOTION\]/);
    assert.match(block, /\[WEBNOVEL BREATH\]/);
    assert.match(block, /\[DIALOGUE & NARRATION\]/);
    assert.match(block, /\[PROSE STYLE\]/);
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
    assert.match(block, /\[PROSE STYLE\]/);
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
    const base = buildAdvancedProseNsfwGuidelines({ nsfwEnabled: true });
    const p2 = applyDenseNarrationPlacementP2(base);
    assert.ok(p2.includes(DIALOGUE_NARRATION_P2_WITH_DENSE));
  });

  it("P1 placement adds dense rule under [PROSE STYLE] header", () => {
    const sample = `${PROSE_STYLE_SECTION}\nExtra line.`;
    const p1 = applyDenseNarrationPlacementP1(sample);
    assert.match(p1, /\[PROSE STYLE\]\n- Keep the same subject's immediate action/);
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
