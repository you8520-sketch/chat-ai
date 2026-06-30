import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MOMENT_TO_MOMENT_WRITING_BLOCK } from "@/lib/sceneExpansionPolicy";
import { buildLengthInstruction } from "@/lib/responseLength";
import { buildNovelModeUserPersonaRules } from "@/lib/userPersonaNarrationRules";

describe("scene continuity vs paragraph layout — disambiguated prose rules", () => {
  it("MOMENT-TO-MOMENT targets scene flow, not paragraph merging", () => {
    assert.match(MOMENT_TO_MOMENT_WRITING_BLOCK, /\[MOMENT-TO-MOMENT WRITING\]/);
    assert.match(MOMENT_TO_MOMENT_WRITING_BLOCK, /서사 진행/);
    assert.match(MOMENT_TO_MOMENT_WRITING_BLOCK, /한 줄·한 문단에 붙여 쓰라는 뜻이 아니다/);
    assert.doesNotMatch(MOMENT_TO_MOMENT_WRITING_BLOCK, /^끊김 없이 이어 쓴다\.$/m);
  });

  it("LENGTH CONTROL dialogue expansion is scene-context, not inline attachment", () => {
    const block = buildLengthInstruction();
    assert.match(block, /각 대사 전·후에 행동·반응·감각·분위기를 서사적으로 전개한다/);
    assert.match(block, /한 문단에 병합하라는 뜻이 아니다/);
    assert.doesNotMatch(block, /따라붙게 한다/);
  });

  it("novel mode continuous refers to scene progression only", () => {
    const rules = buildNovelModeUserPersonaRules("Hero", "User");
    assert.match(rules, /scene progression continuous/i);
    assert.match(rules, /uninterrupted scene flow only/i);
    assert.match(rules, /never means merging narration and spoken dialogue into one paragraph/i);
    assert.doesNotMatch(rules, /continuous scene narration/i);
  });
});
