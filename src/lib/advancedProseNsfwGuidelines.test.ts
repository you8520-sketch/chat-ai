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
    assert.match(block, /\[COMMON PROSE\]/);
    assert.match(block, /\[SCENE FLOW\]/);
    for (const retired of [/\[NARRATION REGISTER\]/, /\[RHYTHM\]/, /\[SENSATION\]/, /\[IMMERSIVE PROSE\]/, /\[WEBNOVEL BREATH\]/]) {
      assert.doesNotMatch(block, retired);
    }
    assert.match(block, /해체\(-다\/-했다\)/);
    assert.match(block, /장면에서 실제로 달라지는 행동·대사·거리·환경 반응/);
    assert.match(block, /같은 역할의 신체 부위·제스처·감각 채널이 반복되면 다른 장면 정보로 초점을 옮긴다/);
    assert.match(block, /비유는 움직임·감각·공간을 더 정확히 보이게 할 때만 쓴다/);
    assert.match(block, /같은 정서를 다른 몸짓으로 되풀이하기보다 다음 반응·행동·환경·관계 변화로 나아가며/);
    assert.doesNotMatch(block, /표정·시선·호흡·습관·접촉·거리·행동·선택/);
    assert.doesNotMatch(block, /중요한 순간과 전환엔 짧은 정적/);
    assert.match(block, /설정 설명 없이/);
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
    assert.match(block, /표준 해부학 명칭으로 직접 쓰고/);
    assert.match(block, /비유·장소어·대명사 대신/);
    assert.match(block, /접촉·자세·방향·강도·리듬의 변화가 감각·신체 반응·심리로/);
    assert.match(block, /성격·말투·관계 단계와 현재 분위기를 그대로 잇는다/);
    // Dialogue economy is owned by [COMMON PROSE], not the adult style block.
    assert.doesNotMatch(block, /대사량은/);
    assert.doesNotMatch(block, /티키타카/);
    assert.doesNotMatch(block, /슬로 모션 — 한 동작을 마찰/);
    assert.match(block, /\[COMMON PROSE\]/);
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
    assert.match(NSFW_EXPLICIT_SENSORY_WRITING_BLOCK, /접촉·자세·방향·강도·리듬의 변화/);
    assert.match(NSFW_EXPLICIT_SENSORY_WRITING_BLOCK, /표준 해부학 명칭/);
    assert.match(NSFW_EXPLICIT_SENSORY_WRITING_BLOCK, /시선·호흡·거리·접촉 전후의 반응·망설임·주도권 변화/);
    assert.doesNotMatch(NSFW_EXPLICIT_SENSORY_WRITING_BLOCK, /티키타카/);
  });

  it("P2 placement adds dense rule only under [DIALOGUE & NARRATION]", () => {
    const base = buildWebnovelOutputLayoutRecencyBlock();
    const p2 = applyDenseNarrationPlacementP2(base);
    assert.ok(p2.includes(DIALOGUE_NARRATION_P2_WITH_DENSE));
  });

  it("P1 placement adds dense rule under [COMMON PROSE]", () => {
    const sample = `${PROSE_STYLE_SECTION}\nExtra line.`;
    const p1 = applyDenseNarrationPlacementP1(sample);
    assert.match(p1, /\[COMMON PROSE\]\n- Keep a continuous scene beat's action/);
    assert.ok(p1.includes(DENSE_NARRATION_LIGHTWEIGHT_RULE));
  });

  it("stripDenseNarrationRule removes P2 bullet from dialogue block", () => {
    const withDense = applyDenseNarrationPlacementP2(buildWebnovelOutputLayoutRecencyBlock());
    const stripped = stripDenseNarrationRule(withDense);
    assert.ok(!stripped.includes(DENSE_NARRATION_LIGHTWEIGHT_RULE));
  });
});
