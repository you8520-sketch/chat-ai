import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildChatImageGenerationPrompt,
  resolveChatImageGenerationPrice,
  resolveChatImageReferenceOrder,
  sanitizeChatImageGenerationOptions,
} from "./chatImageGeneration";

describe("chatImageGeneration", () => {
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

  it("uses a premium fixed price with a safe env override", () => {
    assert.equal(resolveChatImageGenerationPrice({} as NodeJS.ProcessEnv), 900);
    assert.equal(
      resolveChatImageGenerationPrice({ CHAT_IMAGE_GENERATION_POINTS: "750.1" } as NodeJS.ProcessEnv),
      751
    );
    assert.equal(
      resolveChatImageGenerationPrice({ CHAT_IMAGE_GENERATION_POINTS: "nope" } as NodeJS.ProcessEnv),
      900
    );
  });
});
