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
  it("A: G11-P1 positive longform prose owns scene expansion (common)", () => {
    assert.match(IMMERSIVE_PROSE_BLOCK, /\[IMMERSIVE LONGFORM PROSE\]/);
    assert.match(IMMERSIVE_PROSE_BLOCK, /충분히 펼쳐진 소설 장면/);
    assert.doesNotMatch(IMMERSIVE_PROSE_BLOCK, /모든 움직임을 순서대로 기록하지 않는다/);
    assert.match(PROSE_STYLE_SECTION, /\[IMMERSIVE LONGFORM PROSE\]/);
    assert.doesNotMatch(PROSE_STYLE_SECTION, /\[IMMERSIVE PROSE\]/);
    assert.doesNotMatch(PROSE_STYLE_SECTION, /\[MOVEMENT & DETAIL\]/);
    assert.doesNotMatch(PROSE_STYLE_SECTION, /\[BODY AND PROP INVENTORY\]/);
    assert.match(NARRATIVE_DENSITY_BLOCK, /생략은 짧게 쓰라는 뜻이 아니다/);
  });

  it("B: positive prose does not reintroduce post-hoc gloss bans as negatives", () => {
    assert.doesNotMatch(IMMERSIVE_PROSE_BLOCK, /추상 판정·정답 해설/);
    assert.doesNotMatch(PROSE_STYLE_SECTION, /\[NO POST-HOC VERDICT\]/);
    assert.doesNotMatch(PROSE_STYLE_SECTION, /감정 이름·해석·결론 없이/);
    assert.match(IMMERSIVE_PROSE_BLOCK, /새로운 장면 가치/);
  });

  it("C: positive prose does not pack world-briefing bans", () => {
    assert.doesNotMatch(IMMERSIVE_PROSE_BLOCK, /브리핑으로 만들지 않는다/);
    assert.doesNotMatch(PROSE_STYLE_SECTION, /\[DIALOGUE NATURALNESS\]/);
    assert.match(IMMERSIVE_PROSE_BLOCK, /정본과 세계관은 인물의 경험/);
  });

  it("D: positive prose centers judgment/action/interior/sensation", () => {
    assert.match(IMMERSIVE_PROSE_BLOCK, /판단·행동·내면·감각·관계·환경/);
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
    assert.match(USER_TAIL_LENGTH_OWNER_SENTENCE, /3,200~4,200자/);
    assert.doesNotMatch(USER_TAIL_LENGTH_OWNER_SENTENCE, /TARGET_LENGTH/);
    assert.doesNotMatch(USER_TAIL_LENGTH_OWNER_SENTENCE, /MINIMUM_FLOOR/);
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
