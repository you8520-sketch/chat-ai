import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  COMMON_PROSE_BLOCK,
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
  it("A: COMMON PROSE owns micro-action / selective detail", () => {
    assert.match(COMMON_PROSE_BLOCK, /\[COMMON PROSE\]/);
    assert.match(COMMON_PROSE_BLOCK, /작은 행동·미세한 반응은/);
    assert.match(COMMON_PROSE_BLOCK, /평범한 동작은 줄인다/);
    assert.doesNotMatch(COMMON_PROSE_BLOCK, /손·손가락·시선 같은 신체 앵커/);
    assert.match(PROSE_STYLE_SECTION, /\[COMMON PROSE\]/);
    assert.doesNotMatch(PROSE_STYLE_SECTION, /\[MOVEMENT & DETAIL\]/);
    assert.doesNotMatch(PROSE_STYLE_SECTION, /\[BODY AND PROP INVENTORY\]/);
    assert.match(NARRATIVE_DENSITY_BLOCK, /생략은 짧게 쓰라는 뜻이 아니다/);
  });

  it("B: rejects post-hoc narrator gloss via COMMON PROSE", () => {
    assert.match(
      COMMON_PROSE_BLOCK,
      /이미 드러난 의미는 해설·결론으로 되짚기보다 다음 반응·행동·환경·관계 변화로 이어간다/
    );
    assert.doesNotMatch(COMMON_PROSE_BLOCK, /"~라는 뜻이었다"식으로 재해설하지 않는다/);
    assert.doesNotMatch(COMMON_PROSE_BLOCK, /\[CANON RECITAL/);
    assert.doesNotMatch(PROSE_STYLE_SECTION, /\[NO POST-HOC VERDICT\]/);
    assert.doesNotMatch(PROSE_STYLE_SECTION, /감정 이름·해석·결론 없이/);
  });

  it("C: rejects world-briefing dialogue packing", () => {
    assert.match(COMMON_PROSE_BLOCK, /대사는 설정 설명 없이/);
    assert.doesNotMatch(PROSE_STYLE_SECTION, /\[DIALOGUE NATURALNESS\]/);
  });

  it("D: allows inner experience that changes judgment/action", () => {
    assert.match(COMMON_PROSE_BLOCK, /내면은 현재 판단·행동·선택을 바꾸는 만큼 쓴다/);
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
    assert.match(userControl, /새로운 직접 대사, 중요한 선택·동의·거절/);
    assert.doesNotMatch(userControl, /NO GODMODDING/);
    assert.equal(REACTION_VARIETY_BLOCK, "");
  });
});
