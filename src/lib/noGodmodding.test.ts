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
  it("forbids voluntary [B] content and keeps ✅/❌ examples", () => {
    const block = buildCompactNoGodmoddingStandardBlock();
    assert.match(block, /\[NO GODMODDING\]/);
    assert.match(block, /never write \[B\]'s voluntary dialogue/);
    assert.match(block, /involuntary physiological reactions only/);
    assert.match(block, /손가락이 반사적으로 경직됐다/);
    assert.match(block, /두려움을 느꼈다/);
    assert.doesNotMatch(block, /\[USER AGENCY & SENSORY FEEDBACK RULE\]/);
    assert.doesNotMatch(block, /SFW:/);
    assert.doesNotMatch(block, /NSFW:/);
  });
});

describe("buildAutoContinueAgencyExpansion", () => {
  it("expands allowed unconscious motor reactions only in auto-continue mode", () => {
    const block = buildAutoContinueAgencyExpansion();
    assert.match(block, /Auto-continue ONLY/);
    assert.match(block, /반사적으로 물러나는 동작/);
    assert.match(block, /손을 뻗다 멈추는 동작/);
    assert.match(block, /Judgment: action with intent = FORBIDDEN/);
    assert.match(block, /body-first unconscious reaction = ALLOWED/i);
  });
});

describe("buildUserAgencySensoryFeedbackRule (legacy shim)", () => {
  it("returns compact block when not auto-continue expanded", () => {
    const block = buildUserAgencySensoryFeedbackRule("체향", "유저");
    assert.match(block, /\[NO GODMODDING\]/);
    assert.doesNotMatch(block, /Auto-continue ONLY/);
  });

  it("returns auto-continue expansion when expanded", () => {
    const block = buildUserAgencySensoryFeedbackRule("체향", "유저", {
      autoContinueExpanded: true,
    });
    assert.match(block, /Auto-continue ONLY/);
  });
});

describe("buildLengthPressureUserAgencyGuard", () => {
  it("references main rule without duplicating forbidden/allowed lists", () => {
    const block = buildLengthPressureUserAgencyGuard("체향", "유저");
    assert.match(block, /\[LENGTH PRESSURE — USER AGENCY GUARD\]/);
    assert.match(block, /\[NO GODMODDING\] in \[0a\]/);
    assert.match(block, /NEVER pad by inventing \[B\] dialogue/);
    assert.match(block, /Permitted \[B\] padding: involuntary physiological/);
    assert.match(block, /\[LENGTH CONTROL & SCENE EXPANSION\]/);
    assert.doesNotMatch(block, /FORBIDDEN — Never write these/);
    assert.doesNotMatch(block, /\[ABSOLUTE ANTI-GODMODDING/);
  });
});

describe("buildNoGodmoddingBlock", () => {
  it("uses compact block in standard mode", () => {
    const block = buildNoGodmoddingBlock("체향", "유저", "standard");
    assert.match(block, /\[NO GODMODDING\]/);
    assert.match(block, /voluntary dialogue, actions, decisions/);
    assert.match(block, /<TURN_HANDOFF_AND_PACING>/);
    assert.doesNotMatch(block, /Auto-continue ONLY/);
    assert.doesNotMatch(block, /\[USER AGENCY & SENSORY FEEDBACK RULE\]/);
  });

  it("appends auto-continue expansion in auto-continue mode only", () => {
    const block = buildNoGodmoddingBlock("체향", "유저", "autoContinue");
    assert.match(block, /Auto-continue ONLY/);
    assert.match(block, /반사적으로 물러나는 동작/);
    assert.match(block, /This turn is auto-continue/);
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

  it("references no godmodding without duplicating agency rule body", () => {
    const core = buildCoreMasterPrompt(base);
    assert.match(core, /Obey \[NO GODMODDING\]/);
    assert.doesNotMatch(core, /FORBIDDEN — Never write these for \[B\]/);
    assert.doesNotMatch(core, /\[LENGTH PRESSURE — USER AGENCY GUARD\]/);
  });

  it("uses novel-mode role line without embedding agency rule", () => {
    const novel = buildCoreMasterPrompt({ ...base, novelModeEnabled: true });
    assert.match(novel, /Novel mode ON/);
    assert.doesNotMatch(novel, /FORBIDDEN — Never write these for \[B\]/);
    assert.doesNotMatch(novel, /\[LENGTH PRESSURE — USER AGENCY GUARD\]/);
  });

  it("condenses format rules into FORMAT & RHYTHM cross-reference (OpenRouter path)", () => {
    const core = buildCoreMasterPrompt({ ...base, tailFormatActive: false });
    assert.match(core, /\[FORMAT & RHYTHM\]/);
    assert.match(core, /\[OUTPUT LANG\].*\[KOREAN_WEBNOVEL_STYLE\]/);
    assert.match(core, /NO cinematic fragment lines/);
    assert.doesNotMatch(core, /Narration in -다 style only/);
    assert.doesNotMatch(core, /match creator examples\/ending particles/);
    assert.doesNotMatch(core, /Show emotion via gesture\/gaze\/sense/);
    assert.doesNotMatch(core, /해요체\/하오체/);
    assert.doesNotMatch(core, /standalone fragment lines/);
    assert.doesNotMatch(core, /Narration outside quotes/);
  });

  it("references tail format directives when tailFormatActive (Gemini path)", () => {
    const core = buildCoreMasterPrompt({ ...base, tailFormatActive: true });
    assert.match(core, /dialogue\/format directives at prompt tail/);
    assert.match(core, /한국 웹소설 표준 포맷 및 호흡 통제/);
  });
});
