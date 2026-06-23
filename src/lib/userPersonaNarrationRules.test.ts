import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildAutoContinueUserPersonaRules,
  buildNovelModeUserPersonaRules,
  buildSmartUserPersonaNarrationRules,
} from "@/lib/userPersonaNarrationRules";
import { buildContinueNarrativeCommand } from "@/lib/continueNarrative";

describe("buildSmartUserPersonaNarrationRules", () => {
  it("references agency rule boundary without duplicating forbidden lists", () => {
    const rules = buildSmartUserPersonaNarrationRules("백하율", "가이드");
    assert.match(rules, /\[USER PERSONA NARRATION\]/);
    assert.match(rules, /\[NO GODMODDING\]/);
    assert.match(rules, /awareness용/);
    assert.match(rules, /조종 권한 아님/);
    assert.doesNotMatch(rules, /FORBIDDEN — Never write/);
    assert.doesNotMatch(rules, /never \[B\] emotions/);
  });
});

describe("buildAutoContinueUserPersonaRules", () => {
  it("emphasizes AI-led narrative and expanded unconscious reactions", () => {
    const rules = buildAutoContinueUserPersonaRules("백하율", "가이드");
    assert.match(rules, /\[NO GODMODDING\]/);
    assert.match(rules, /Lead the scene through \[A\]/);
    assert.match(rules, /auto-continue expanded/);
    assert.match(rules, /do NOT treat \[B\] as a silent prop/);
    assert.doesNotMatch(rules, /physiological\/sensory cues only/);
  });
});

describe("buildNovelModeUserPersonaRules", () => {
  it("allows full user persona co-narration", () => {
    const rules = buildNovelModeUserPersonaRules("백하율", "가이드");
    assert.match(rules, /\[A\] = AI character · \[B\] = user's persona character/);
    assert.match(rules, /대사, 행동, 속마음/);
    assert.match(rules, /웹소설/);
  });
});

describe("buildContinueNarrativeCommand", () => {
  it("uses novel mode rules when enabled", () => {
    const cmd = buildContinueNarrativeCommand({
      personaName: "가이드",
      charName: "백하율",
      novelModeEnabled: true,
    });
    assert.match(cmd, /NOVEL MODE — USER PERSONA NARRATION RULES/);
    assert.doesNotMatch(cmd, /AUTO-CONTINUE — USER PERSONA NARRATION RULES/);
  });

  it("references boundary in auto-continue when novel mode off", () => {
    const cmd = buildContinueNarrativeCommand({
      personaName: "가이드",
      charName: "백하율",
    });
    assert.match(cmd, /AUTO-CONTINUE — USER PERSONA NARRATION RULES/);
    assert.match(cmd, /auto-continue expanded/);
    assert.doesNotMatch(cmd, /USER DIALOGUE — ABSOLUTE BAN/);
  });
});
