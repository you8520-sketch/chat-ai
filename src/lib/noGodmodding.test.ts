import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildAutoContinueAgencyExpansion,
  buildCompactNoGodmoddingStandardBlock,
  buildNoGodmoddingBlock,
  buildUserAgencySensoryFeedbackRule,
  COLLABORATIVE_INTERACTIVE_OWNER_TITLE,
  NO_FALSE_SHARED_MEMORY_RULE,
  resolveNoGodmoddingMode,
} from "@/lib/noGodmodding";
import { AUTO_PROGRESSION_BLOCK_TITLE } from "@/lib/autoProgressionRules";
import { buildCoreMasterPrompt } from "@/lib/corePrompt";

const userCharacterName = "테스트_유저_캐릭터";
const aiCharacterName = "테스트_AI_캐릭터";

describe("buildCompactNoGodmoddingStandardBlock", () => {
  it("injects single collaborative interactive owner", () => {
    const block = buildCompactNoGodmoddingStandardBlock();

    assert.match(block, new RegExp(COLLABORATIVE_INTERACTIVE_OWNER_TITLE.replace(/[[\]]/g, "\\$&")));
    assert.match(block, /USER_PERSONA, creator\/scenario canon/);
    assert.match(block, /새로운 직접 대사/);
    assert.match(block, /공동 서술할 수 있다/);
    assert.match(block, /능동적으로 수행한다/);
    assert.doesNotMatch(block, /\[INTERACTIVE USER CONTROL\]/);
    assert.doesNotMatch(block, /\[NO GODMODDING\]/);
    assert.doesNotMatch(block, /TARGET_LENGTH/);
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
  it("returns collaborative block", () => {
    assert.equal(
      buildUserAgencySensoryFeedbackRule(aiCharacterName, userCharacterName),
      buildCompactNoGodmoddingStandardBlock()
    );
  });
});

describe("buildNoGodmoddingBlock", () => {
  it("uses collaborative block in standard mode", () => {
    const block = buildNoGodmoddingBlock(aiCharacterName, userCharacterName, "standard");
    assert.match(block, /COLLABORATIVE INTERACTIVE/);
    assert.doesNotMatch(block, /TARGET_LENGTH/);
  });

  it("autoContinue uses AI-focal co-narration owner once", () => {
    const block = buildNoGodmoddingBlock(aiCharacterName, userCharacterName, "autoContinue");
    assert.match(block, new RegExp(AUTO_PROGRESSION_BLOCK_TITLE.replace(/[[\]]/g, "\\$&")));
    assert.match(block, /\[AI_CAST\]/);
    assert.match(block, /대사를 공동 서술할 수 있다/);
    assert.match(block, /1인칭·내면 시점으로 전환하지 않는다/);
    assert.doesNotMatch(block, /\[USER CONTROL MODE - NOVEL \/ EXPLICIT FULL\]/);
    assert.notEqual(block, buildCompactNoGodmoddingStandardBlock());
  });

  it("legacy novel mode is removed from NoGodmoddingMode union", () => {
    assert.equal(
      resolveNoGodmoddingMode({ novelModeEnabled: true }),
      "autoContinue"
    );
    assert.doesNotMatch(
      buildNoGodmoddingBlock(aiCharacterName, userCharacterName, "autoContinue"),
      /NOVEL \/ EXPLICIT FULL/
    );
  });

  it("coNarration merges user-control + 유저 대사 + possession", () => {
    const block = buildNoGodmoddingBlock(aiCharacterName, userCharacterName, "coNarration");
    assert.match(block, /\[USER CONTROL MODE - LIMITED CO-NARRATION\]/);
    assert.match(block, /7\. 유저 대사: co-narration/);
    assert.match(block, /\[possession_mode\]/);
    assert.match(block, /\[NO FALSE SHARED MEMORY\]/);
    assert.equal(block.includes(NO_FALSE_SHARED_MEMORY_RULE), true);
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
    assert.match(core, /COLLABORATIVE INTERACTIVE/);
    assert.doesNotMatch(core, /\[NO FALSE SHARED MEMORY\]/);
  });

  it("uses auto-progression AI_CAST role without novel mode", () => {
    const auto = buildCoreMasterPrompt({ ...base, autoProgressionEnabled: true });
    assert.match(auto, /\[AI_CAST\]/);
    assert.doesNotMatch(auto, /소설 모드 ON/);
  });

  it("legacy novelModeEnabled maps to auto-progression ROLE", () => {
    const novel = buildCoreMasterPrompt({ ...base, novelModeEnabled: true });
    assert.match(novel, /\[AI_CAST\]/);
    assert.doesNotMatch(novel, /소설 모드 ON/);
  });
});
