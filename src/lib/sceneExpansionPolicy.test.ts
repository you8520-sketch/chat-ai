import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  NARRATIVE_DENSITY_BLOCK,
  REACTION_VARIETY_BLOCK,
  NO_GENERIC_REACTIONS_BLOCK,
} from "@/lib/sceneExpansionPolicy";
import { buildLengthInstruction } from "@/lib/responseLength";
import { buildWebnovelOutputLayoutRecencyBlock } from "@/lib/webnovelOutputFormat";
import { buildNovelModeUserPersonaRules } from "@/lib/userPersonaNarrationRules";
import { IMMERSIVE_PROSE_BLOCK } from "@/lib/advancedProseNsfwGuidelines";

describe("scene continuity vs paragraph layout — disambiguated prose rules", () => {
  it("NARRATIVE DENSITY is a short length pointer; style lives in IMMERSIVE PROSE", () => {
    assert.match(NARRATIVE_DENSITY_BLOCK, /\[NARRATIVE DENSITY\]/);
    assert.match(NARRATIVE_DENSITY_BLOCK, /모든 중간 동작을 기록하지 않는다/);
    assert.match(NARRATIVE_DENSITY_BLOCK, /생략은 짧게 쓰라는 뜻이 아니다/);
    assert.doesNotMatch(NARRATIVE_DENSITY_BLOCK, /중간 단계를 건너뛰지/);
    assert.doesNotMatch(NARRATIVE_DENSITY_BLOCK, /신체 접촉/);
    assert.match(IMMERSIVE_PROSE_BLOCK, /\[IMMERSIVE PROSE\]/);
  });

  it("REACTION VARIETY absorbed into IMMERSIVE PROSE (not re-injected)", () => {
    assert.equal(NO_GENERIC_REACTIONS_BLOCK, REACTION_VARIETY_BLOCK);
    assert.equal(REACTION_VARIETY_BLOCK, "");
    assert.doesNotMatch(buildLengthInstruction(), /\[REACTION VARIETY\]/);
  });

  it("LENGTH CONTROL keeps scene expansion; paragraph layout lives in OUTPUT LAYOUT only", () => {
    const block = buildLengthInstruction();
    const layout = buildWebnovelOutputLayoutRecencyBlock();
    assert.doesNotMatch(block, /\[GENERATION PROCESS — BEAT FLOW\]/);
    assert.doesNotMatch(block, /지문과 "…" 대사를 한 문단·한 줄에 병합하지 마라/);
    assert.match(layout, /Never append dialogue to the end of a narration line/);
    assert.match(layout, /지문 한 문장이 완결됐다는 이유만으로/);
    assert.match(block, /기계적 교대/);
    assert.doesNotMatch(block, /따라붙게 한다/);
  });

  it("novel mode continuous refers to scene progression only", () => {
    const rules = buildNovelModeUserPersonaRules("Hero", "User");
    assert.match(rules, /scene progression continuous/i);
    assert.match(rules, /uninterrupted scene flow only/i);
    assert.match(rules, /never means merging narration and spoken dialogue into one paragraph/i);
    assert.match(rules, /OUTPUT LAYOUT/);
    assert.doesNotMatch(rules, /continuous scene narration/i);
  });
});
