import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildAutoContinueAgencyExpansion,
  buildCompactNoGodmoddingStandardBlock,
  buildNoGodmoddingBlock,
  buildUserAgencySensoryFeedbackRule,
  NO_FALSE_SHARED_MEMORY_RULE,
} from "@/lib/noGodmodding";
import { buildCoreMasterPrompt } from "@/lib/corePrompt";

const userCharacterName = "테스트_유저_캐릭터";
const aiCharacterName = "테스트_AI_캐릭터";

describe("buildCompactNoGodmoddingStandardBlock", () => {
  it("forbids voluntary [B] content without output-length rules", () => {
    const block = buildCompactNoGodmoddingStandardBlock();

    assert.match(block, /\[NO GODMODDING\]/);
    assert.match(block, /의도적 행동, 대사, 생각, 결정, 감정 결론을 대신 쓰지 않는다/);
    assert.match(block, /짧은 비자발 반응/);
    assert.match(block, /\[INTERACTIVE USER CONTROL\]/);
    assert.match(block, /분량을 채우기 위해 유저를 움직이지 않는다/);
    assert.doesNotMatch(block, /TARGET_LENGTH/);
    assert.doesNotMatch(block, /MINIMUM_FLOOR/);
    assert.doesNotMatch(block, /<TURN_HANDOFF_AND_PACING>/);
    assert.doesNotMatch(block, /\[NO FALSE SHARED MEMORY\]/);
  });
});

describe("buildAutoContinueAgencyExpansion", () => {
  it("returns auto progression user-control block", () => {
    assert.equal(
      buildAutoContinueAgencyExpansion(),
      buildNoGodmoddingBlock("", "", "autoContinue")
    );
  });
});

describe("buildUserAgencySensoryFeedbackRule (legacy shim)", () => {
  it("returns compact block", () => {
    assert.equal(
      buildUserAgencySensoryFeedbackRule(aiCharacterName, userCharacterName),
      buildCompactNoGodmoddingStandardBlock()
    );
  });
});

describe("buildNoGodmoddingBlock", () => {
  it("uses compact block in standard mode", () => {
    const block = buildNoGodmoddingBlock(aiCharacterName, userCharacterName, "standard");

    assert.match(block, /\[NO GODMODDING\]/);
    assert.match(block, /의도적 행동/);
    assert.doesNotMatch(block, /TARGET_LENGTH/);
  });

  it("autoContinue uses AUTO PROGRESSION user control with AI_CAST", () => {
    const block = buildNoGodmoddingBlock(aiCharacterName, userCharacterName, "autoContinue");
    assert.match(block, /\[USER CONTROL — AUTO PROGRESSION\]/);
    assert.match(block, /\[AI_CAST\]/);
    assert.match(block, /\[NO FALSE SHARED MEMORY\]/);
    assert.notEqual(block, buildCompactNoGodmoddingStandardBlock());
  });

  it("novel/explicit_full path stays isolated", () => {
    const block = buildNoGodmoddingBlock(aiCharacterName, userCharacterName, "novel");

    assert.match(block, /\[USER CONTROL MODE - NOVEL \/ EXPLICIT FULL\]/);
    assert.match(block, /\[NO FALSE SHARED MEMORY\]/);
    assert.equal(block.includes(NO_FALSE_SHARED_MEMORY_RULE), true);
    assert.doesNotMatch(block, /\[USER CONTROL — AUTO PROGRESSION\]/);
  });

  it("coNarration merges user-control + 유저 대사 + possession", () => {
    const block = buildNoGodmoddingBlock(aiCharacterName, userCharacterName, "coNarration");
    assert.match(block, /\[USER CONTROL MODE - LIMITED CO-NARRATION\]/);
    assert.match(block, /7\. 유저 대사: co-narration/);
    assert.match(block, /\[possession_mode\]/);
    assert.match(block, /\[NO FALSE SHARED MEMORY\]/);
  });
});

describe("core master prompt", () => {
  const base = {
    charName: aiCharacterName,
    userName: userCharacterName,
    charGender: "female" as const,
    userGender: "male" as const,
    nsfwEnabled: true,
    impersonationOn: false,
    novelModeEnabled: false,
    completedTurns: 5,
    hasMindReading: false,
    allowsBeard: false,
    allowsBodyHair: true,
  };

  it("keeps agency detail outside core master prompt", () => {
    const core = buildCoreMasterPrompt(base);

    assert.match(core, /\[NO GODMODDING\]를 따른다/);
    assert.doesNotMatch(core, /\[NO FALSE SHARED MEMORY\]/);
  });

  it("uses auto-progression AI_CAST role without novel mode", () => {
    const auto = buildCoreMasterPrompt({ ...base, autoProgressionEnabled: true });

    assert.match(auto, /\[AI_CAST\]/);
    assert.doesNotMatch(auto, /소설 모드 ON/);
    assert.doesNotMatch(auto, /\[NO FALSE SHARED MEMORY\]/);
  });

  it("keeps dormant novel-mode role isolated", () => {
    const novel = buildCoreMasterPrompt({ ...base, novelModeEnabled: true });

    assert.match(novel, /소설 모드 ON/);
    assert.doesNotMatch(novel, /\[NO FALSE SHARED MEMORY\]/);
  });
});
