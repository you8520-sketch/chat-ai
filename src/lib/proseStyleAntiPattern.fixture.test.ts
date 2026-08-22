import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  IMMERSIVE_PROSE_BLOCK,
  PROSE_STYLE_SECTION,
} from "@/lib/advancedProseNsfwGuidelines";
import { NARRATIVE_DENSITY_BLOCK, REACTION_VARIETY_BLOCK } from "@/lib/sceneExpansionPolicy";
import { buildWebnovelOutputLayoutRecencyBlock } from "@/lib/webnovelOutputFormat";
import {
  buildLengthInstruction,
  buildTerminalLengthOverrideBlock,
  USER_TAIL_LENGTH_OWNER_SENTENCE,
} from "@/lib/responseLength";
import { DEEPSEEK_BOTTOM_REMINDER } from "@/lib/deepseekPromptStructure";
import { SPEECH_METADATA_INVISIBLE_RULE } from "@/lib/speechMetadataPolicy";
import { buildNoGodmoddingBlock } from "@/lib/noGodmodding";

/**
 * Static fixtures for prose anti-patterns A–E and length freeze.
 * No live API.
 */
describe("prose style anti-pattern fixtures (static)", () => {
  it("A: IMMERSIVE PROSE owns micro-action / selective detail (common)", () => {
    assert.match(IMMERSIVE_PROSE_BLOCK, /\[IMMERSIVE PROSE\]/);
    assert.match(IMMERSIVE_PROSE_BLOCK, /모든 움직임을 순서대로 기록하지 않는다/);
    assert.match(IMMERSIVE_PROSE_BLOCK, /행동 목록, 신체 부위 목록, 소품 조작 목록/);
    assert.match(PROSE_STYLE_SECTION, /\[IMMERSIVE PROSE\]/);
    assert.doesNotMatch(PROSE_STYLE_SECTION, /\[MOVEMENT & DETAIL\]/);
    assert.doesNotMatch(PROSE_STYLE_SECTION, /\[BODY AND PROP INVENTORY\]/);
    assert.match(NARRATIVE_DENSITY_BLOCK, /생략은 짧게 쓰라는 뜻이 아니다/);
  });

  it("B: rejects post-hoc narrator gloss via IMMERSIVE PROSE", () => {
    assert.match(IMMERSIVE_PROSE_BLOCK, /뜻이었다/);
    assert.match(IMMERSIVE_PROSE_BLOCK, /표시였다/);
    assert.match(IMMERSIVE_PROSE_BLOCK, /이것은 ~가 아니었다/);
    assert.match(IMMERSIVE_PROSE_BLOCK, /추상 판정·정답 해설/);
    assert.match(
      IMMERSIVE_PROSE_BLOCK,
      /이미 충분히 드러난 생각·관계 해석·외형·능력·감각 효과·과거는 새 변화에 필요한 만큼만 짧게 참조하고/
    );
    assert.match(IMMERSIVE_PROSE_BLOCK, /새 반응·판단·행동·환경 변화로 이어간다/);
    assert.doesNotMatch(IMMERSIVE_PROSE_BLOCK, /\[CANON RECITAL/);
    assert.doesNotMatch(PROSE_STYLE_SECTION, /\[NO POST-HOC VERDICT\]/);
    assert.doesNotMatch(PROSE_STYLE_SECTION, /감정 이름·해석·결론 없이/);
  });

  it("C: rejects world-briefing dialogue packing", () => {
    assert.match(IMMERSIVE_PROSE_BLOCK, /브리핑으로 만들지 않는다/);
    assert.doesNotMatch(PROSE_STYLE_SECTION, /\[DIALOGUE NATURALNESS\]/);
  });

  it("D: allows direct emotion / inner experience", () => {
    assert.match(IMMERSIVE_PROSE_BLOCK, /생각·연상·기억·오해·감정·판단/);
    assert.match(IMMERSIVE_PROSE_BLOCK, /관찰만 나열하지 말고/);
    assert.doesNotMatch(PROSE_STYLE_SECTION, /\[EMOTION & INNER EXPERIENCE\]/);
  });

  it("E: relaxes fine-grained paragraph splits", () => {
    const layout = buildWebnovelOutputLayoutRecencyBlock();
    assert.match(layout, /한 문단 안에서 자연스럽게 연결/);
    assert.match(layout, /지문 한 문장이 완결됐다는 이유만으로/);
    assert.doesNotMatch(layout, /감정 방향, 내면과 외부의 초점/);
    assert.match(layout, /대사는 독립 문단으로 표시한다/);
  });

  it("length consolidation: system empty; user-tail owner; DeepSeek length-only reminder", () => {
    assert.equal(buildLengthInstruction(), "");
    assert.equal(buildTerminalLengthOverrideBlock(), "");
    assert.match(USER_TAIL_LENGTH_OWNER_SENTENCE, /3,200자 이상/);
    assert.doesNotMatch(USER_TAIL_LENGTH_OWNER_SENTENCE, /TARGET_LENGTH/);
    assert.doesNotMatch(USER_TAIL_LENGTH_OWNER_SENTENCE, /MINIMUM_FLOOR/);
    assert.match(DEEPSEEK_BOTTOM_REMINDER, /\[DEEPSEEK LENGTH — SINGLE CALL\]/);

    assert.match(DEEPSEEK_BOTTOM_REMINDER, /never imitate a short prior assistant reply/);
    assert.doesNotMatch(DEEPSEEK_BOTTOM_REMINDER, /\[IMMERSIVE PROSE\]/);
    assert.doesNotMatch(DEEPSEEK_BOTTOM_REMINDER, /중간 단계를 건너뛰지/);
  });

  it("keeps speech metadata invisible + collaborative user control; reaction variety absorbed", () => {
    assert.match(SPEECH_METADATA_INVISIBLE_RULE, /서사·지문에서 언급·설명하지 않는다/);
    const userControl = buildNoGodmoddingBlock("A", "B", "standard");
    assert.match(userControl, /USER CONTROL — COLLABORATIVE INTERACTIVE/);
    assert.match(userControl, /새로운 직접 대사/);
    assert.match(userControl, /동의·거절/);
    assert.match(userControl, /새로 시작한 의도적 행동이면 대신하지 않는다/);
    assert.doesNotMatch(userControl, /NO GODMODDING/);
    assert.equal(REACTION_VARIETY_BLOCK, "");
  });
});
