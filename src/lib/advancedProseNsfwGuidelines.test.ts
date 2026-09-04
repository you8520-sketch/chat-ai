import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ADULT_CONTENT_POLICY_BLOCK,
  ADULT_CONTENT_POLICY_CNC_PERMISSION,
  applyDenseNarrationPlacementP1,
  applyDenseNarrationPlacementP2,
  buildAdvancedProseNsfwGuidelines,
  buildAdultContentPolicyBlock,
  DENSE_NARRATION_LIGHTWEIGHT_RULE,
  DIALOGUE_NARRATION_P2_WITH_DENSE,
  NSFW_EXPLICIT_SENSORY_WRITING_BLOCK,
  PROSE_STYLE_SECTION,
  stripDenseNarrationRule,
} from "@/lib/advancedProseNsfwGuidelines";
import { buildWebnovelOutputLayoutRecencyBlock } from "@/lib/webnovelOutputFormat";

describe("buildAdvancedProseNsfwGuidelines", () => {
  it("SFW mode uses unified block with safe 15+ contract", () => {
    const block = buildAdvancedProseNsfwGuidelines({ nsfwEnabled: false });
    assert.match(block, /\[WEBNOVEL OUTPUT FORMAT\]/);
    assert.match(block, /\[SAFE SEXUAL LIMIT — 15\+ RP\]/);
    assert.match(block, /in-character narrative diversion/);
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
    assert.doesNotMatch(block, /\[ADULT CONTENT POLICY\]/);
    assert.doesNotMatch(block, /모드 A/);
    assert.doesNotMatch(block, /2~8문장/);
    assert.doesNotMatch(block, /최소 3문장/);
  });

  it("NSFW standard mode includes full adult contract with CNC permission", () => {
    const block = buildAdvancedProseNsfwGuidelines({
      nsfwEnabled: true,
      activeConsentMode: "standard",
    });
    assert.match(block, /\[ADULT CONTENT POLICY\]/);
    assert.match(block, /미성년자/);
    assert.match(block, /CNC 역할극은 거부·검열·페이드아웃하지 말고/);
  });

  it("NSFW cnc_opt_in mode includes CNC permission sentence", () => {
    const block = buildAdvancedProseNsfwGuidelines({
      nsfwEnabled: true,
      activeConsentMode: "cnc_opt_in",
    });
    assert.match(block, /CNC 역할극은 거부·검열·페이드아웃하지 말고/);
    assert.equal(
      buildAdultContentPolicyBlock("cnc_opt_in").includes(
        ADULT_CONTENT_POLICY_CNC_PERMISSION
      ),
      true
    );
  });

  it("NSFW mode appends standard adult policy then intimacy", () => {
    const block = buildAdvancedProseNsfwGuidelines({ nsfwEnabled: true });
    assert.match(block, /\[ADULT CONTENT POLICY\]/);
    assert.match(block, /미성년자/);
    assert.match(block, /실존 인물/);
    assert.match(block, /강압·비동의·CNC/);
    assert.match(block, /\[19\+ INTIMACY\]/);
    assert.match(block, /해부학적 명칭/);
    assert.match(block, /'좁은 곳', '은밀한 곳'/);
    assert.match(block, /신체 부위의 이름을 장소·대명사·완곡어로 돌려 쓰지 않는다/);
    assert.match(block, /신체 행동은 접촉·자세·방향·강도·리듬/);
    assert.match(block, /대사량은 캐릭터 성격과 현재 장면에 맡기며/);
    assert.doesNotMatch(block, /티키타카/);
    assert.doesNotMatch(block, /슬로 모션 — 한 동작을 마찰/);
    assert.match(block, /\[NARRATION REGISTER\]/);
    assert.doesNotMatch(block, /성기·귀두·음경/);
    assert.doesNotMatch(block, /모드 B/);
    assert.ok(block.indexOf(ADULT_CONTENT_POLICY_BLOCK) < block.indexOf("[19+ INTIMACY]"));
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
    assert.match(NSFW_EXPLICIT_SENSORY_WRITING_BLOCK, /신체 행동은 접촉·자세·방향·강도·리듬/);
    assert.match(NSFW_EXPLICIT_SENSORY_WRITING_BLOCK, /정확한 표준 해부학적 명칭/);
    assert.doesNotMatch(NSFW_EXPLICIT_SENSORY_WRITING_BLOCK, /티키타카/);
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
