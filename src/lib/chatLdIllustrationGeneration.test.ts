import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CHAT_LD_ILLUSTRATION_OUTPUT_SIZE,
  CHAT_LD_ILLUSTRATION_QUALITY,
  buildChatLdIllustrationPrompt,
  formatOpenAiImageUserError,
  resolveChatLdIllustrationPrice,
  sanitizeChatTurnForIllustrationPrompt,
  withIllustrationReferenceIndices,
} from "./chatLdIllustrationGeneration";

describe("chatLdIllustrationGeneration", () => {
  it("uses a medium-quality 800x1200 vertical output", () => {
    assert.equal(CHAT_LD_ILLUSTRATION_OUTPUT_SIZE, "800x1200");
    assert.equal(CHAT_LD_ILLUSTRATION_QUALITY, "medium");
  });

  it("charges 200P by default even when a four-person party cast is used", () => {
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
    assert.match(prompt, /Show exactly these two people/);
  });

  it("requires every TRPG party member to appear when a cast is provided", () => {
    const prompt = buildChatLdIllustrationPrompt({
      characterName: "태형",
      characterGender: "male",
      personaName: "렌",
      personaGender: "male",
      currentTurn: "네 사람이 폐허 입구에 선다.",
      cast: [
        { name: "렌", gender: "male", role: "player", referenceIndex: 1 },
        { name: "태형", gender: "male", role: "companion character", referenceIndex: 2 },
        { name: "유나", gender: "female", role: "companion character", referenceIndex: 3 },
        {
          name: "민호",
          gender: "male",
          role: "player",
          referenceIndex: null,
          appearanceNote: "짧은 흑발, 안경",
        },
      ],
    });
    assert.match(prompt, /Show ALL 4 listed people/);
    assert.match(prompt, /Count the people: 4/);
    assert.match(prompt, /Show exactly these 4 people/);
    assert.doesNotMatch(prompt, /Show exactly these two people/);
    assert.match(prompt, /1\. 렌 \(player\)/);
    assert.match(prompt, /2\. 태형 \(companion character\)/);
    assert.match(prompt, /3\. 유나 \(companion character\)/);
    assert.match(prompt, /4\. 민호 \(player\)/);
    assert.match(prompt, /No photo for 민호/);
    assert.match(prompt, /짧은 흑발, 안경/);
    assert.match(prompt, /confirmed FEMALE/);
    assert.match(prompt, /every listed face is clearly visible/);
    assert.match(prompt, /네 사람이 폐허 입구에 선다/);
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

  it("numbers only members who have a photo, in party order", () => {
    const indexed = withIllustrationReferenceIndices([
      { name: "렌", imageUrl: "/uploads/ren.webp" },
      { name: "태형", imageUrl: null },
      { name: "유나", imageUrl: "/uploads/yuna.webp" },
      { name: "민호", imageUrl: "  " },
    ]);
    assert.equal(indexed[0]?.referenceIndex, 1);
    assert.equal(indexed[1]?.referenceIndex, null);
    assert.equal(indexed[2]?.referenceIndex, 2);
    assert.equal(indexed[3]?.referenceIndex, null);
  });
});
