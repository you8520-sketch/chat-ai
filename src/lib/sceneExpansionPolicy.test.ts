import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { NARRATIVE_DENSITY_BLOCK } from "@/lib/sceneExpansionPolicy";
import { buildLengthInstruction } from "@/lib/responseLength";
import { buildWebnovelOutputLayoutRecencyBlock } from "@/lib/webnovelOutputFormat";
import { buildNovelModeUserPersonaRules } from "@/lib/userPersonaNarrationRules";

describe("scene continuity vs paragraph layout — disambiguated prose rules", () => {
  it("NARRATIVE DENSITY includes merged moment-to-moment flow (Step 7.5) without forcing one paragraph", () => {
    assert.match(NARRATIVE_DENSITY_BLOCK, /\[NARRATIVE DENSITY\]/);
    assert.match(NARRATIVE_DENSITY_BLOCK, /중간 단계를 건너뛰지/);
    assert.match(NARRATIVE_DENSITY_BLOCK, /OUTPUT LAYOUT/);
    assert.doesNotMatch(NARRATIVE_DENSITY_BLOCK, /신체 접촉/);
  });

  it("LENGTH CONTROL keeps scene expansion; paragraph layout lives in OUTPUT LAYOUT only", () => {
    const block = buildLengthInstruction();
    const layout = buildWebnovelOutputLayoutRecencyBlock();
    assert.doesNotMatch(block, /\[GENERATION PROCESS — BEAT FLOW\] SoT/);
    assert.doesNotMatch(block, /지문과 "…" 대사를 한 문단·한 줄에 병합하지 마라/);
    assert.match(layout, /Never append dialogue to the end of a narration line/);
    assert.match(block, /기계적 교대/);
    assert.doesNotMatch(block, /따라붙게 한다/);
  });

  it("novel mode continuous refers to scene progression only", () => {
    const rules = buildNovelModeUserPersonaRules("Hero", "User");
    assert.match(rules, /scene progression continuous/i);
    assert.match(rules, /uninterrupted scene flow only/i);
    assert.match(rules, /never means merging narration and spoken dialogue into one paragraph/i);
    assert.match(rules, /changed focus/i);
    assert.doesNotMatch(rules, /continuous scene narration/i);
  });
});
