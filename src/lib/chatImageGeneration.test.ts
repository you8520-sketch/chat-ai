import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CHAT_IMAGE_GENERATION_OUTPUT_HEIGHT,
  CHAT_IMAGE_GENERATION_OUTPUT_SIZE,
  CHAT_IMAGE_GENERATION_OUTPUT_WIDTH,
  CHAT_IMAGE_GENERATION_QUALITY,
  buildChatImageGenerationPrompt,
  resolveChatImageGenerationPrice,
  resolveChatImageReferenceOrder,
  sanitizeChatImageGenerationOptions,
} from "./chatImageGeneration";

describe("chatImageGeneration", () => {
  it("uses a 1024px-wide near-3:2 SD output", () => {
    assert.equal(CHAT_IMAGE_GENERATION_OUTPUT_WIDTH, 1024);
    assert.equal(CHAT_IMAGE_GENERATION_OUTPUT_HEIGHT, 683);
    assert.equal(CHAT_IMAGE_GENERATION_OUTPUT_SIZE, "1024x683");
    assert.equal(Math.round((CHAT_IMAGE_GENERATION_OUTPUT_WIDTH / CHAT_IMAGE_GENERATION_OUTPUT_HEIGHT) * 1000), 1499);
  });

  it("fixes every SD generation to medium quality", () => {
    assert.equal(CHAT_IMAGE_GENERATION_QUALITY, "medium");
  });

  it("fails closed to the fixed preset defaults", () => {
    assert.deepEqual(
      sanitizeChatImageGenerationOptions({
        placement: "wrong",
        topExpression: "unknown",
        bottomExpression: null,
        mood: "bad",
      }),
      {
        placement: "character_top",
        topExpression: "playful",
        bottomExpression: "calm",
        mood: "lovely",
      }
    );
  });

  it("orders server-owned references from the selected placement", () => {
    const order = resolveChatImageReferenceOrder({
      characterName: "캐릭터",
      characterImageUrl: "/uploads/character.webp",
      personaName: "페르소나",
      personaImageUrl: "/uploads/persona.webp#zoom=1.25",
      placement: "persona_top",
    });
    assert.equal(order.top.role, "user persona");
    assert.equal(order.top.imageUrl, "/uploads/persona.webp#zoom=1.25");
    assert.equal(order.bottom.role, "chat character");
  });

  it("keeps identity order and fixed-template constraints explicit", () => {
    const prompt = buildChatImageGenerationPrompt({
      characterName: "태형",
      characterGender: "male",
      personaName: "렌",
      personaGender: "male",
      placement: "character_top",
      topExpression: "playful",
      bottomExpression: "shy",
      mood: "anniversary",
    });
    assert.match(prompt, /Reference image 1 is the composition/);
    assert.match(prompt, /TOP person is 태형/);
    assert.match(prompt, /BOTTOM person is 렌/);
    assert.match(prompt, /Image 2 belongs ONLY to 태형/);
    assert.match(prompt, /Image 3 belongs ONLY to 렌/);
    assert.match(prompt, /Exactly two human characters/);
    assert.match(prompt, /Do not crop to faces only/);
    assert.match(prompt, /IDENTITY OWNERSHIP IS STRICT/);
    assert.match(prompt, /GENDER LOCK/);
    assert.match(prompt, /confirmed MALE/);
  });

  it("locks male subjects against long-hair or cute-style female body drift", () => {
    const prompt = buildChatImageGenerationPrompt({
      characterName: "Long-haired male character",
      characterGender: "male",
      personaName: "Male persona",
      personaGender: "male",
      placement: "character_top",
      topExpression: "shy",
      bottomExpression: "bright",
      mood: "lovely",
    });
    assert.match(prompt, /GENDER LOCK/);
    assert.match(prompt, /confirmed MALE/);
    assert.match(prompt, /Long hair.*must NOT be interpreted as female/);
    assert.match(prompt, /flat masculine chest/);
    assert.match(prompt, /Do not draw breasts, cleavage/);
  });

  it("uses the fixed 200P price even when a stale env override exists", () => {
    assert.equal(resolveChatImageGenerationPrice({} as NodeJS.ProcessEnv), 200);
    assert.equal(
      resolveChatImageGenerationPrice({ CHAT_IMAGE_GENERATION_POINTS: "399.1" } as NodeJS.ProcessEnv),
      200
    );
    assert.equal(
      resolveChatImageGenerationPrice({ CHAT_IMAGE_GENERATION_POINTS: "nope" } as NodeJS.ProcessEnv),
      200
    );
  });
});
