import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CHAT_LD_ILLUSTRATION_OUTPUT_SIZE,
  CHAT_LD_ILLUSTRATION_QUALITY,
  buildChatLdIllustrationPrompt,
  resolveChatLdIllustrationPrice,
} from "./chatLdIllustrationGeneration";

describe("chatLdIllustrationGeneration", () => {
  it("uses a medium-quality 800x1200 vertical output", () => {
    assert.equal(CHAT_LD_ILLUSTRATION_OUTPUT_SIZE, "800x1200");
    assert.equal(CHAT_LD_ILLUSTRATION_QUALITY, "medium");
  });

  it("charges 200P by default", () => {
    assert.equal(resolveChatLdIllustrationPrice({} as NodeJS.ProcessEnv), 200);
  });

  it("uses the current turn and forbids comic text or identity mixing", () => {
    const prompt = buildChatLdIllustrationPrompt({
      characterName: "태형",
      personaName: "렌",
      currentTurn: "렌이 태형에게 깻잎을 먹여준다.",
    });
    assert.match(prompt, /렌이 태형에게 깻잎을 먹여준다/);
    assert.match(prompt, /identity and art-style reference/);
    assert.match(prompt, /Do not add extra people/);
    assert.match(prompt, /speech bubbles/);
    assert.match(prompt, /vertical 2:3/);
  });
});
