import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildAutoContinueUserPersonaRules,
  buildNovelModeUserPersonaRules,
  buildSmartUserPersonaNarrationRules,
} from "@/lib/userPersonaNarrationRules";
import { buildContinueNarrativeCommand } from "@/lib/continueNarrative";

describe("buildSmartUserPersonaNarrationRules", () => {
  it("references agency rule in one line", () => {
    const rules = buildSmartUserPersonaNarrationRules("백하율", "가이드");
    assert.equal(rules, "[USER PERSONA NARRATION] [NO GODMODDING] 적용.");
    assert.doesNotMatch(rules, /awareness/);
    assert.doesNotMatch(rules, /FORBIDDEN/);
  });
});

describe("buildAutoContinueUserPersonaRules", () => {
  it("is deprecated empty — godmodding block covers auto-continue", () => {
    const rules = buildAutoContinueUserPersonaRules("백하율", "가이드");
    assert.equal(rules, "");
  });
});

describe("buildNovelModeUserPersonaRules", () => {
  it("allows full user persona co-narration", () => {
    const rules = buildNovelModeUserPersonaRules("백하율", "가이드");
    assert.match(rules, /대사, 행동, 속마음/);
    assert.match(rules, /웹소설/);
    assert.doesNotMatch(rules, /\[A\] = AI character/);
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

  it("references godmodding and handoff when novel mode off", () => {
    const cmd = buildContinueNarrativeCommand({
      personaName: "가이드",
      charName: "백하율",
    });
    assert.match(cmd, /\[NO GODMODDING\] 준수/);
    assert.match(cmd, /<TURN_HANDOFF_AND_PACING>/);
    assert.doesNotMatch(cmd, /AUTO-CONTINUE — USER PERSONA NARRATION RULES/);
    assert.doesNotMatch(cmd, /auto-continue expanded/);
  });
});
