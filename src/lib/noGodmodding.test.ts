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

describe("buildCompactNoGodmoddingStandardBlock", () => {
  it("forbids voluntary [B] content without output-length rules", () => {
    const block = buildCompactNoGodmoddingStandardBlock();

    assert.match(block, /\[NO GODMODDING\]/);
    assert.match(block, /의도적 행동, 대사, 생각, 결정, 감정 결론을 대신 쓰지 않는다/);
    assert.match(block, /짧은 비자발 반응/);
    assert.doesNotMatch(block, /TARGET_LENGTH/);
    assert.doesNotMatch(block, /MINIMUM_FLOOR/);
    assert.doesNotMatch(block, /<TURN_HANDOFF_AND_PACING>/);
  });
});

describe("buildAutoContinueAgencyExpansion (deprecated shim)", () => {
  it("returns standard block", () => {
    assert.equal(buildAutoContinueAgencyExpansion(), buildCompactNoGodmoddingStandardBlock());
  });
});

describe("buildUserAgencySensoryFeedbackRule (legacy shim)", () => {
  it("returns compact block", () => {
    assert.equal(buildUserAgencySensoryFeedbackRule("체향", "유저"), buildCompactNoGodmoddingStandardBlock());
  });
});

describe("buildNoGodmoddingBlock", () => {
  it("uses compact block in standard mode", () => {
    const block = buildNoGodmoddingBlock("체향", "유저", "standard");

    assert.match(block, /\[NO GODMODDING\]/);
    assert.match(block, /의도적 행동/);
    assert.doesNotMatch(block, /TARGET_LENGTH/);
  });

  it("auto-continue uses same compact block as standard", () => {
    assert.equal(
      buildNoGodmoddingBlock("체향", "유저", "autoContinue"),
      buildCompactNoGodmoddingStandardBlock()
    );
  });

  it("auto progression contains No False Shared Memory rule", () => {
    const block = buildNoGodmoddingBlock("체향", "유저", "novel");

    assert.match(block, /\[USER CONTROL MODE - AUTO PROGRESSION\]/);
    assert.match(block, /\[NO FALSE SHARED MEMORY\]/);
    assert.match(block, /전에 말했잖아/);
    assert.match(block, /불확실하면 질문, 관찰, 추측, 새 발견으로 처리한다/);
    assert.match(block, /저 문장, 달리는 늑대처럼 보여/);
    assert.equal(block.includes(NO_FALSE_SHARED_MEMORY_RULE), true);
  });
});

describe("core master prompt", () => {
  const base = {
    charName: "체향",
    userName: "유저",
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

  it("uses novel-mode role line without embedding agency rule", () => {
    const novel = buildCoreMasterPrompt({ ...base, novelModeEnabled: true });

    assert.match(novel, /소설 모드 ON/);
    assert.doesNotMatch(novel, /\[NO FALSE SHARED MEMORY\]/);
  });
});
