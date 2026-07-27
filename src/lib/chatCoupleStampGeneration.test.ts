import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CHAT_COUPLE_STAMP_API_OUTPUT_HEIGHT,
  CHAT_COUPLE_STAMP_API_OUTPUT_SIZE,
  CHAT_COUPLE_STAMP_API_OUTPUT_WIDTH,
  CHAT_COUPLE_STAMP_OUTPUT_HEIGHT,
  CHAT_COUPLE_STAMP_OUTPUT_WIDTH,
  CHAT_COUPLE_STAMP_QUALITY,
  CHAT_COUPLE_STAMP_TEMPLATE_PREVIEW_URL,
  buildChatCoupleStampPrompt,
  resolveChatCoupleStampPrice,
  sanitizeChatCoupleStampOptions,
} from "./chatCoupleStampGeneration";

describe("chatCoupleStampGeneration", () => {
  it("requests a 16-aligned square and saves an exact 1000x1000 medium result", () => {
    assert.equal(CHAT_COUPLE_STAMP_API_OUTPUT_SIZE, "1008x1008");
    assert.equal(CHAT_COUPLE_STAMP_API_OUTPUT_WIDTH % 16, 0);
    assert.equal(CHAT_COUPLE_STAMP_API_OUTPUT_HEIGHT % 16, 0);
    assert.equal(CHAT_COUPLE_STAMP_OUTPUT_WIDTH, 1000);
    assert.equal(CHAT_COUPLE_STAMP_OUTPUT_HEIGHT, 1000);
    assert.equal(CHAT_COUPLE_STAMP_QUALITY, "medium");
    assert.match(CHAT_COUPLE_STAMP_TEMPLATE_PREVIEW_URL, /sd-couple-stamps-4\.png$/);
  });

  it("builds a single-badge prompt for the selected motif with height options", () => {
    const prompt = buildChatCoupleStampPrompt({
      characterName: "태현",
      personaName: "렌",
      options: {
        motif: "cheek_closeup",
        height: "persona_taller",
        background: "blush_ribbon",
        border: "ribbon_bottom",
        animalEars: "none",
      },
    });
    assert.match(prompt, /ONE polished square circular couple profile icon/i);
    assert.match(prompt, /Do NOT create a 2-by-2 contact sheet/i);
    assert.match(prompt, /BOTTOM RIGHT/i);
    assert.match(prompt, /extreme close-up/i);
    assert.match(prompt, /user persona visibly taller/i);
    assert.match(prompt, /No animal ears of any kind/i);
    assert.match(prompt, /태현/);
    assert.match(prompt, /렌/);
  });

  it("sanitizes unknown option ids to defaults", () => {
    const options = sanitizeChatCoupleStampOptions({
      motif: "nope",
      height: "giant",
      background: "x",
      border: "y",
      animalEars: "z",
    });
    assert.equal(options.motif, "cat_paws");
    assert.equal(options.height, "same");
    assert.equal(options.background, "motif_default");
    assert.equal(options.border, "none");
    assert.equal(options.animalEars, "motif_default");
  });

  it("uses the fixed 220P price", () => {
    assert.equal(resolveChatCoupleStampPrice(), 220);
  });
});
