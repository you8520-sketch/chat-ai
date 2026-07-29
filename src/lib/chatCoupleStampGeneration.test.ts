import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CHAT_COUPLE_STAMP_API_OUTPUT_HEIGHT,
  CHAT_COUPLE_STAMP_API_OUTPUT_SIZE,
  CHAT_COUPLE_STAMP_API_OUTPUT_WIDTH,
  CHAT_COUPLE_STAMP_OUTPUT_HEIGHT,
  CHAT_COUPLE_STAMP_OUTPUT_WIDTH,
  CHAT_COUPLE_STAMP_PANELS,
  CHAT_COUPLE_STAMP_QUALITY,
  CHAT_COUPLE_STAMP_TEMPLATE_PREVIEW_URL,
  buildChatCoupleStampPrompt,
  resolveChatCoupleStampPrice,
  sanitizeChatCoupleStampOptions,
} from "./chatCoupleStampGeneration";

describe("chatCoupleStampGeneration", () => {
  it("uses webp preview, 16-aligned API size, and 1024x1024 medium output", () => {
    assert.equal(CHAT_COUPLE_STAMP_API_OUTPUT_SIZE, "1024x1024");
    assert.equal(CHAT_COUPLE_STAMP_API_OUTPUT_WIDTH % 16, 0);
    assert.equal(CHAT_COUPLE_STAMP_API_OUTPUT_HEIGHT % 16, 0);
    assert.equal(CHAT_COUPLE_STAMP_OUTPUT_WIDTH, 1024);
    assert.equal(CHAT_COUPLE_STAMP_OUTPUT_HEIGHT, 1024);
    assert.equal(CHAT_COUPLE_STAMP_QUALITY, "medium");
    assert.match(CHAT_COUPLE_STAMP_TEMPLATE_PREVIEW_URL, /sd-couple-stamps-4\.webp$/);
  });

  it("reproduces the fixed 2x2 sheet with all four template motifs", () => {
    const prompt = buildChatCoupleStampPrompt({
      characterName: "태현",
      personaName: "렌",
      options: {
        height: "persona_taller",
        background: "blush_ribbon",
        border: "ribbon_bottom",
      },
    });
    assert.match(prompt, /four circular badges arranged in a 2-by-2 grid/i);
    assert.doesNotMatch(prompt, /Do NOT create a 2-by-2/i);
    for (const panel of CHAT_COUPLE_STAMP_PANELS) {
      assert.ok(prompt.includes(panel.prompt), `missing panel: ${panel.id}`);
    }
    assert.match(prompt, /bold thick outlines/i);
    assert.match(prompt, /user persona visibly taller/i);
    assert.match(prompt, /태현/);
    assert.match(prompt, /렌/);
  });

  it("applies the chosen expression to each person in every badge", () => {
    const prompt = buildChatCoupleStampPrompt({
      characterName: "태현",
      personaName: "렌",
      options: { characterExpression: "sleepy", personaExpression: "shy" },
    });
    assert.match(prompt, /태현 expression in every badge: cute sleepy expression/);
    assert.match(prompt, /렌 expression in every badge: shy smile with a gentle blush/);
  });

  it("sanitizes unknown option ids to defaults", () => {
    const options = sanitizeChatCoupleStampOptions({
      height: "giant",
      background: "x",
      border: "y",
      characterExpression: "angry",
      personaExpression: "",
    });
    assert.equal(options.height, "same");
    assert.equal(options.background, "default");
    assert.equal(options.border, "none");
    assert.equal(options.characterExpression, "calm");
    assert.equal(options.personaExpression, "bright");
    assert.equal(
      sanitizeChatCoupleStampOptions({ background: "motif_default" }).background,
      "default"
    );
  });

  it("uses the fixed 240P price", () => {
    assert.equal(resolveChatCoupleStampPrice(), 240);
  });
});
