import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildAutoContinueAgencyExpansion,
  buildCompactNoGodmoddingStandardBlock,
  buildLengthPressureUserAgencyGuard,
  buildNoGodmoddingBlock,
  buildUserAgencySensoryFeedbackRule,
} from "@/lib/noGodmodding";
import { buildCoreMasterPrompt } from "@/lib/corePrompt";

describe("buildCompactNoGodmoddingStandardBlock", () => {
  it("forbids voluntary [B] content without examples or turn-end tail", () => {
    const block = buildCompactNoGodmoddingStandardBlock();
    assert.match(block, /\[NO GODMODDING\]/);
    assert.match(block, /의도적 대사·행동·감정·판단/);
    assert.match(block, /생리적·반사적 반응만/);
    assert.doesNotMatch(block, /✅/);
    assert.doesNotMatch(block, /❌/);
    assert.doesNotMatch(block, /Play only \[A\]/);
    assert.doesNotMatch(block, /<TURN_HANDOFF_AND_PACING>/);
  });
});

describe("buildAutoContinueAgencyExpansion (deprecated shim)", () => {
  it("returns standard block", () => {
    const block = buildAutoContinueAgencyExpansion();
    assert.equal(block, buildCompactNoGodmoddingStandardBlock());
  });
});

describe("buildUserAgencySensoryFeedbackRule (legacy shim)", () => {
  it("returns compact block", () => {
    const block = buildUserAgencySensoryFeedbackRule("체향", "유저");
    assert.equal(block, buildCompactNoGodmoddingStandardBlock());
  });
});

describe("buildLengthPressureUserAgencyGuard", () => {
  it("references main rule without duplicating forbidden/allowed lists", () => {
    const block = buildLengthPressureUserAgencyGuard("체향", "유저");
    assert.match(block, /\[LENGTH PRESSURE — USER AGENCY GUARD\]/);
    assert.match(block, /\[NO GODMODDING\]/);
    assert.match(block, /의도적 행동/);
    assert.match(block, /생리적·반사적 반응만/);
    assert.doesNotMatch(block, /FORBIDDEN — Never write these/);
  });
});

describe("buildNoGodmoddingBlock", () => {
  it("uses compact block in standard mode", () => {
    const block = buildNoGodmoddingBlock("체향", "유저", "standard");
    assert.match(block, /\[NO GODMODDING\]/);
    assert.match(block, /의도적 대사/);
    assert.doesNotMatch(block, /<TURN_HANDOFF_AND_PACING>/);
    assert.doesNotMatch(block, /반사적으로 물러나는/);
  });

  it("appends handoff hint in auto-continue mode only", () => {
    const block = buildNoGodmoddingBlock("체향", "유저", "autoContinue");
    assert.match(block, /자동진행 턴/);
    assert.match(block, /<TURN_HANDOFF_AND_PACING>/);
    assert.doesNotMatch(block, /반사적으로 물러나는/);
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

  it("assigns NPC/environment to AI role without duplicating agency rule body", () => {
    const core = buildCoreMasterPrompt(base);
    assert.match(core, /NPC·환경만 연기/);
    assert.match(core, /\[NO GODMODDING\]를 따른다/);
    assert.doesNotMatch(core, /항상 \[A\]만 연기/);
    assert.doesNotMatch(core, /FORBIDDEN — Never write these for \[B\]/);
  });

  it("uses novel-mode role line without embedding agency rule", () => {
    const novel = buildCoreMasterPrompt({ ...base, novelModeEnabled: true });
    assert.match(novel, /소설 모드 ON/);
    assert.doesNotMatch(novel, /FORBIDDEN — Never write these for \[B\]/);
  });

  it("keeps only ROLE INTEGRITY CONTINUITY in core", () => {
    const core = buildCoreMasterPrompt({ ...base, tailFormatActive: false });
    assert.match(core, /^ROLE —/m);
    assert.match(core, /^INTEGRITY — 캐릭터·관계·세계관을 유지한다\./m);
    assert.match(core, /^CONTINUITY — 같은 장면을 이어가며 반복하지 않는다\./m);
    assert.doesNotMatch(core, /^SPEECH —/m);
    assert.doesNotMatch(core, /^PROSE —/m);
  });
});
