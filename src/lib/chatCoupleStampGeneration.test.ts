import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CHAT_COUPLE_STAMP_API_OUTPUT_SIZE,
  CHAT_COUPLE_STAMP_OUTPUT_HEIGHT,
  CHAT_COUPLE_STAMP_OUTPUT_WIDTH,
  CHAT_COUPLE_STAMP_QUALITY,
  buildChatCoupleStampPrompt,
  resolveChatCoupleStampPrice,
} from "./chatCoupleStampGeneration";

describe("chatCoupleStampGeneration", () => {
  it("requests the nearest supported square and saves an exact 800x800 result", () => {
    assert.equal(CHAT_COUPLE_STAMP_API_OUTPUT_SIZE, "816x816");
    assert.equal(CHAT_COUPLE_STAMP_OUTPUT_WIDTH, 800);
    assert.equal(CHAT_COUPLE_STAMP_OUTPUT_HEIGHT, 800);
    assert.equal(CHAT_COUPLE_STAMP_QUALITY, "medium");
  });

  it("keeps the four profile motifs distinct instead of putting cat ears everywhere", () => {
    const prompt = buildChatCoupleStampPrompt({
      characterName: "태현",
      personaName: "렌",
    });
    assert.match(prompt, /exactly four equal circular couple profile icons/i);
    assert.match(prompt, /only badge with cat ears or cat-paw gloves/i);
    assert.match(prompt, /No animal ears, animal hood or paw gloves/i);
    assert.match(prompt, /bunny-ear hoodies/i);
    assert.match(prompt, /No animal ears, animal hood, paw gloves or plush animals/i);
    assert.match(prompt, /태현/);
    assert.match(prompt, /렌/);
  });

  it("uses the fixed 220P price", () => {
    assert.equal(resolveChatCoupleStampPrice(), 220);
  });
});
