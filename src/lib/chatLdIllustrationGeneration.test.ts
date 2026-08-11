import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CHAT_LD_ILLUSTRATION_OUTPUT_SIZE,
  CHAT_LD_ILLUSTRATION_QUALITY,
  buildChatLdIllustrationPrompt,
  formatOpenAiImageUserError,
  resolveChatLdIllustrationPrice,
  sanitizeChatTurnForIllustrationPrompt,
} from "./chatLdIllustrationGeneration";

describe("chatLdIllustrationGeneration", () => {
  it("uses a medium-quality 800x1200 vertical output", () => {
    assert.equal(CHAT_LD_ILLUSTRATION_OUTPUT_SIZE, "800x1200");
    assert.equal(CHAT_LD_ILLUSTRATION_QUALITY, "medium");
  });

  it("charges 200P by default", () => {
    assert.equal(resolveChatLdIllustrationPrice({} as NodeJS.ProcessEnv), 200);
  });

  it("uses the selected-turn scene brief and forbids comic text or identity mixing", () => {
    const prompt = buildChatLdIllustrationPrompt({
      characterName: "태형",
      characterGender: "male",
      personaName: "렌",
      personaGender: "male",
      currentTurn: "Setting: 식당\nActions: 렌이 태형에게 깻잎을 먹여준다.",
    });
    assert.match(prompt, /렌이 태형에게 깻잎을 먹여준다/);
    assert.match(prompt, /SELECTED TURN SCENE BRIEF/);
    assert.match(prompt, /identity and art-style reference/);
    assert.match(prompt, /Do not add extra people/);
    assert.match(prompt, /Do not render speech bubbles/);
    assert.match(prompt, /vertical 2:3/);
    assert.match(prompt, /GENDER LOCK/);
    assert.match(prompt, /confirmed MALE/);
    assert.match(prompt, /wholesome conversation/);
  });

  it("softens self-harm-adjacent metaphors before sending the turn", () => {
    const cleaned = sanitizeChatTurnForIllustrationPrompt(
      '유저: 심장이 멎는 줄 알았고 죽을 것 같았어. 손목을 잡았다. <<<STATUS_VALUES\nfoo\n>>>'
    );
    assert.doesNotMatch(cleaned, /STATUS_VALUES/);
    assert.doesNotMatch(cleaned, /손목/);
    assert.doesNotMatch(cleaned, /죽을 것 같/);
    assert.doesNotMatch(cleaned, /심장이 멎/);
    assert.match(cleaned, /손/);
  });

  it("maps OpenAI self-harm safety rejections to a Korean retry hint", () => {
    const msg = formatOpenAiImageUserError(
      "Your request was rejected by the safety system. safety_violations=[self-harm]."
    );
    assert.match(msg, /안전 필터/);
    assert.match(msg, /순화/);
  });
});
