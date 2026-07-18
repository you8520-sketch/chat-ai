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
    assert.match(layout, /대사는 화자별 독립 문단/);
  });

  it("length freeze: TARGET / FLOOR / Terminal intact; DeepSeek length-only", () => {
    const length = buildLengthInstruction();
    assert.match(length, /TARGET_LENGTH: 3,200\+/);
    assert.match(length, /MINIMUM_FLOOR: 2,700\+/);
    const terminal = buildTerminalLengthOverrideBlock();
    assert.match(terminal, /TARGET_LENGTH 3,200\+/);
    assert.match(terminal, /단일 응답 최대 전개·미달 조기 종료 금지/);
    assert.match(DEEPSEEK_BOTTOM_REMINDER, /\[DEEPSEEK LENGTH — SINGLE CALL\]/);
    assert.match(DEEPSEEK_BOTTOM_REMINDER, /never imitate a short prior assistant reply/);
    assert.doesNotMatch(DEEPSEEK_BOTTOM_REMINDER, /\[IMMERSIVE PROSE\]/);
    assert.doesNotMatch(DEEPSEEK_BOTTOM_REMINDER, /중간 단계를 건너뛰지/);
  });

  it("keeps speech metadata invisible + no-godmodding; reaction variety absorbed", () => {
    assert.match(SPEECH_METADATA_INVISIBLE_RULE, /서사·지문에서 언급·설명하지 않는다/);
    assert.match(buildNoGodmoddingBlock("A", "B", "standard"), /NO GODMODDING/);
    assert.equal(REACTION_VARIETY_BLOCK, "");
  });
});
