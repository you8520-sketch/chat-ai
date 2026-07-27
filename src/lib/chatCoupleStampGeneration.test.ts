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
  it("uses webp preview, 16-aligned API size, and 1000x1000 medium output", () => {
    assert.equal(CHAT_COUPLE_STAMP_API_OUTPUT_SIZE, "1008x1008");
    assert.equal(CHAT_COUPLE_STAMP_API_OUTPUT_WIDTH % 16, 0);
    assert.equal(CHAT_COUPLE_STAMP_API_OUTPUT_HEIGHT % 16, 0);
    assert.equal(CHAT_COUPLE_STAMP_OUTPUT_WIDTH, 1000);
    assert.equal(CHAT_COUPLE_STAMP_OUTPUT_HEIGHT, 1000);
    assert.equal(CHAT_COUPLE_STAMP_QUALITY, "medium");
    assert.match(CHAT_COUPLE_STAMP_TEMPLATE_PREVIEW_URL, /sd-couple-stamps-4\.webp$/);
  });

  it("builds a single-badge prompt without motif or animal-ear pickers", () => {
    const prompt = buildChatCoupleStampPrompt({
      characterName: "태현",
      personaName: "렌",
      options: {
        height: "persona_taller",
        background: "blush_ribbon",
        border: "ribbon_bottom",
      },
    });
    assert.match(prompt, /ONE polished square circular couple profile icon/i);
    assert.match(prompt, /Do NOT create a 2-by-2 contact sheet/i);
    assert.match(prompt, /No animal ears/i);
    assert.match(prompt, /user persona visibly taller/i);
    assert.doesNotMatch(prompt, /BOTTOM RIGHT|TOP LEFT|motif/i);
    assert.match(prompt, /태현/);
    assert.match(prompt, /렌/);
  });

  it("sanitizes unknown option ids to defaults", () => {
    const options = sanitizeChatCoupleStampOptions({
      height: "giant",
      background: "x",
      border: "y",
    });
    assert.equal(options.height, "same");
    assert.equal(options.background, "default");
    assert.equal(options.border, "none");
    assert.equal(
      sanitizeChatCoupleStampOptions({ background: "motif_default" }).background,
      "default"
    );
  });

  it("uses the fixed 200P price", () => {
    assert.equal(resolveChatCoupleStampPrice(), 200);
  });
});
