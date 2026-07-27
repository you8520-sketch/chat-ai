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
  it("uses the nearest valid 3:2 size to a 1000px-wide SD output", () => {
    assert.equal(CHAT_IMAGE_GENERATION_OUTPUT_WIDTH, 1008);
    assert.equal(CHAT_IMAGE_GENERATION_OUTPUT_HEIGHT, 672);
    assert.equal(CHAT_IMAGE_GENERATION_OUTPUT_SIZE, "1008x672");
    assert.equal(CHAT_IMAGE_GENERATION_OUTPUT_WIDTH % 16, 0);
    assert.equal(CHAT_IMAGE_GENERATION_OUTPUT_HEIGHT % 16, 0);
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
      personaName: "렌",
      placement: "character_top",
      topExpression: "playful",
      bottomExpression: "shy",
      mood: "anniversary",
    });
    assert.match(prompt, /Reference image 1 is the composition/);
    assert.match(prompt, /Reference image 2 is the identity reference for the TOP person, 태형/);
    assert.match(prompt, /Reference image 3 is the identity reference for the BOTTOM person, 렌/);
    assert.match(prompt, /Exactly two human characters/);
    assert.match(prompt, /Do not crop to faces only/);
    assert.match(prompt, /Do not blend the two identities/);
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
