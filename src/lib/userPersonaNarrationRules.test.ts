import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildAutoContinueUserPersonaRules,
  buildNovelModeUserPersonaRules,
  buildSmartUserPersonaNarrationRules,
} from "@/lib/userPersonaNarrationRules";
import { buildContinueNarrativeCommand } from "@/lib/continueNarrative";

const userCharacterName = "테스트_유저_캐릭터";
const aiCharacterName = "테스트_AI_캐릭터";

describe("buildSmartUserPersonaNarrationRules", () => {
  it("is deprecated empty — godmodding block covers standard turns", () => {
    const rules = buildSmartUserPersonaNarrationRules(aiCharacterName, userCharacterName);
    assert.equal(rules, "");
  });
});

describe("buildAutoContinueUserPersonaRules", () => {
  it("is deprecated empty — godmodding block covers auto-continue", () => {
    const rules = buildAutoContinueUserPersonaRules(aiCharacterName, userCharacterName);
    assert.equal(rules, "");
  });
});

describe("buildNovelModeUserPersonaRules", () => {
  it("allows full user persona co-narration (dormant explicit_full path)", () => {
    const rules = buildNovelModeUserPersonaRules(aiCharacterName, userCharacterName);
    assert.match(rules, /대사, 행동, 속마음/);
    assert.match(rules, /scene progression continuous/i);
    assert.match(rules, /never means merging narration and spoken dialogue into one paragraph/i);
    assert.doesNotMatch(rules, /웹소설/);
  });
});

describe("buildContinueNarrativeCommand", () => {
  it("never injects novel mode rules even if novelModeEnabled flag is passed", () => {
    const cmd = buildContinueNarrativeCommand({
      personaName: userCharacterName,
      charName: aiCharacterName,
      novelModeEnabled: true,
    });
    assert.doesNotMatch(cmd, /NOVEL MODE — USER PERSONA NARRATION RULES/);
    assert.match(cmd, /AUTO PROGRESSION — AI-CENTERED/);
    assert.match(cmd, /\[AI_CAST\]/);
  });

  it("short-refs auto progression without embedding full novel body", () => {
    const cmd = buildContinueNarrativeCommand({
      personaName: userCharacterName,
      charName: aiCharacterName,
    });
    assert.match(cmd, /\[SYSTEM DIRECTIVE: CONTINUE THE NARRATIVE\]/);
    assert.match(cmd, /Do not narrate \[B\]'s inner thoughts/);
    assert.doesNotMatch(cmd, /<TURN_HANDOFF_AND_PACING>/);
    assert.doesNotMatch(cmd, /AUTO-CONTINUE — USER PERSONA NARRATION RULES/);
  });
});
