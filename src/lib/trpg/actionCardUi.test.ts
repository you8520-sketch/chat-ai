import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import fs from "node:fs";
import TrpgD20 from "@/app/trpg/TrpgD20";
import {
  isTrpgD20Face,
  resolveTrpgD20Tone,
  resolveTrpgSpeakerRail,
  trpgRollIsSuccess,
  trpgRollOutcomeLabel,
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
  });

  it("renders SVG faces 1, 2, 10, 19, 20 from the server value", () => {
    for (const value of [1, 2, 10, 19, 20] as const) {
      const tone = resolveTrpgD20Tone(value, value >= 10 ? "SUCCESS" : "FAILURE");
      const html = renderToStaticMarkup(createElement(TrpgD20, { value, tone, size: "desktop" }));
      assert.match(html, /<svg/);
      assert.doesNotMatch(html, /<img|png|webp|jpg/i);
      assert.match(html, new RegExp(`data-trpg-d20-value="${value}"`));
      assert.match(html, new RegExp(`>${value}<`));
      assert.equal(isTrpgD20Face(value), true);
    }
  });

  it("keeps success, fail, nat1, and nat20 visual states distinct", () => {
    const success = renderToStaticMarkup(
      createElement(TrpgD20, { value: 16, tone: "success", size: "desktop" })
    );
    const fail = renderToStaticMarkup(createElement(TrpgD20, { value: 2, tone: "fail", size: "desktop" }));
    const nat20 = renderToStaticMarkup(
      createElement(TrpgD20, { value: 20, tone: "nat20", size: "desktop" })
    );
    const nat1 = renderToStaticMarkup(createElement(TrpgD20, { value: 1, tone: "nat1", size: "desktop" }));
    assert.match(success, /data-trpg-d20-tone="success"/);
    assert.match(fail, /data-trpg-d20-tone="fail"/);
    assert.match(nat20, /data-trpg-d20-tone="nat20"/);
    assert.match(nat1, /data-trpg-d20-tone="nat1"/);
    assert.match(nat20, /#d4b45a|#f0d78c/);
    assert.match(nat1, /#8f3a40|#f0a8a8/);
  });

  it("does not add image assets or empty dice shells in the action card", () => {
    const d20 = fs.readFileSync("src/app/trpg/TrpgD20.tsx", "utf8");
    const room = fs.readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.doesNotMatch(d20, /\.png|\.webp|new Image|dice-1|dice-20/);
    assert.match(d20, /<svg/);
    assert.match(room, /accent=\{false\}/);
    assert.match(room, /dialogueAccent=\{false\}/);
    assert.match(room, /roll && tone && outcome/);
    assert.doesNotMatch(room, /DiceActionBody/);
    const actionBlocks = room.split("data-trpg-action-card");
    assert.equal((actionBlocks[1]?.match(/<TrpgNamedProse/g) ?? []).length, 1);
  });
});
