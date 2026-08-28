import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import {
  isTrpgD20Face,
  resolveTrpgD20Tone,
  resolveTrpgSpeakerRail,
  trpgActionCardCompactName,
  trpgD20ViewModel,
  trpgRollIsSuccess,
  trpgRollOutcomeLabel,
  trpgRollResultNumberClass,
  trpgRollResultOutcomeClass,
} from "./actionCardUi";

describe("TRPG action card rails and d20 visual", () => {
  it("does not put a speaker rail on named action cards", () => {
    assert.equal(resolveTrpgSpeakerRail(false, true), false);
    assert.equal(resolveTrpgSpeakerRail(true, true), true);
    assert.equal(resolveTrpgSpeakerRail(undefined, true), true);
    assert.equal(resolveTrpgSpeakerRail(undefined, false), false);
  });

  it("maps success and failure tiers for the outcome label", () => {
    assert.equal(trpgRollIsSuccess("SUCCESS"), true);
    assert.equal(trpgRollIsSuccess("FAILURE"), false);
    assert.equal(trpgRollOutcomeLabel("SUCCESS"), "성공");
    assert.equal(trpgRollOutcomeLabel("FAILURE"), "실패");
    assert.equal(trpgRollOutcomeLabel("CRITICAL_SUCCESS"), "성공");
    assert.equal(trpgRollOutcomeLabel("CRITICAL_FAILURE"), "실패");
  });

  it("uses face 1/20 for stronger tones and server d20 1–20 only", () => {
    assert.equal(resolveTrpgD20Tone(1, "FAILURE"), "nat1");
    assert.equal(resolveTrpgD20Tone(20, "SUCCESS"), "nat20");
    assert.equal(resolveTrpgD20Tone(16, "SUCCESS"), "success");
    assert.equal(resolveTrpgD20Tone(2, "FAILURE"), "fail");
    assert.equal(isTrpgD20Face(1), true);
    assert.equal(isTrpgD20Face(20), true);
    assert.equal(isTrpgD20Face(0), false);
    assert.equal(isTrpgD20Face(21), false);
    for (const value of [1, 2, 10, 19, 20] as const) {
      const tone = resolveTrpgD20Tone(value, value >= 10 ? "SUCCESS" : "FAILURE");
      const view = trpgD20ViewModel(value, tone);
      assert.equal(view.face, value);
      assert.equal(view.faceText, String(value));
      assert.equal(isTrpgD20Face(value), true);
    }
    assert.equal(trpgD20ViewModel(1, "nat1").faceText, "1");
    assert.equal(trpgD20ViewModel(20, "nat20").faceText, "20");
  });

  it("keeps success, fail, nat1, and nat20 visual states distinct", () => {
    const visual = fs.readFileSync("src/lib/trpg/diceVisual.ts", "utf8");
    assert.match(visual, /#e8c56a/);
    assert.match(visual, /#8a2430/);
    assert.equal(trpgD20ViewModel(16, "success").tone, "success");
    assert.equal(trpgD20ViewModel(2, "fail").tone, "fail");
    assert.equal(trpgD20ViewModel(20, "nat20").tone, "nat20");
    assert.equal(trpgD20ViewModel(1, "nat1").tone, "nat1");
  });

  it("does not add image assets or empty dice shells in the action card", () => {
    const room = fs.readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    const lane = fs.readFileSync("src/app/trpg/TrpgRollResultLane.tsx", "utf8");
    assert.match(room, /accent=\{false\}/);
    assert.match(room, /dialogueAccent=\{false\}/);
    assert.match(room, /TrpgRollResultLane/);
    assert.doesNotMatch(room, /<TrpgD20/);
    assert.doesNotMatch(fs.existsSync("src/app/trpg/TrpgD20.tsx") ? "exists" : "", /exists/);
    assert.match(lane, /sm:hidden/);
    assert.match(lane, /w-\[72px\]/);
    assert.match(lane, /h-\[72px\]/);
    assert.match(lane, /text-\[34px\]/);
    assert.match(lane, /text-\[12px\]/);
    assert.doesNotMatch(room, /DiceActionBody/);
    assert.equal(
      (room.match(/text=\{sanitizeTrpgActionDisplayText\(parsed\.prose \|\| action\.body\)\}/g) ?? [])
        .length,
      1
    );
    assert.doesNotMatch(room, /function DiceStrip\([\s\S]*parsed\.prose/);
    assert.equal(trpgActionCardCompactName("강이현", "ai_character"), "강이현 AI");
    assert.equal(trpgActionCardCompactName("권태현", "human"), "권태현");
    assert.match(trpgRollResultNumberClass("success"), /emerald/);
    assert.match(trpgRollResultNumberClass("fail"), /rose/);
    assert.match(trpgRollResultOutcomeClass("success"), /emerald/);
    assert.match(trpgRollResultOutcomeClass("fail"), /rose/);
  });
});
