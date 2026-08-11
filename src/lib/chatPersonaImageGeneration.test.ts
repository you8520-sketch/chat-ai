import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CHAT_PERSONA_IMAGE_API_OUTPUT_SIZE,
  CHAT_PERSONA_IMAGE_OUTPUT_HEIGHT,
  CHAT_PERSONA_IMAGE_OUTPUT_WIDTH,
  buildChatPersonaImagePrompt,
  extractPersonaAppearance,
  personaImageReadiness,
} from "./chatPersonaImageGeneration";

describe("chat persona image generation", () => {
  it("extracts visual traits without using unrelated biography", () => {
    const appearance = extractPersonaAppearance(
      "차분한 성격이다.\n외형: 긴 은발과 청록색 눈, 검은 코트를 입는다.\n왕국에서 자랐다."
    );
    assert.match(appearance, /긴 은발/);
    assert.doesNotMatch(appearance, /왕국/);
  });

  it("requires a selected persona and explicit appearance details", () => {
    assert.deepEqual(personaImageReadiness(null), {
      ready: false,
      missing: ["선택 페르소나"],
    });
    assert.equal(
      personaImageReadiness({ gender: "female", description: "명랑하고 용감하다." }).ready,
      false
    );
    assert.deepEqual(
      personaImageReadiness({ gender: "", description: "짧은 금발 머리" }).missing,
      ["페르소나 성별 설정"]
    );
    assert.equal(
      personaImageReadiness({ gender: "female", description: "금발에 녹색 눈을 가졌다." }).ready,
      true
    );
  });

  it("uses the character reference for style while locking persona identity", () => {
    const prompt = buildChatPersonaImagePrompt({
      personaName: "라온",
      gender: "male",
      appearance: "짧은 흑발, 회색 눈, 검은 후드",
      characterName: "하린",
    });
    assert.match(prompt, /ONLY the art-style reference/);
    assert.match(prompt, /Do not copy.*identity/);
    assert.match(prompt, /Saved gender setting: 남성/);
    assert.match(prompt, /GENDER LOCK/);
    assert.match(prompt, /confirmed MALE/);
    assert.match(prompt, /짧은 흑발/);
  });

  it("requests and delivers exact 3:5 dimensions", () => {
    assert.equal(CHAT_PERSONA_IMAGE_API_OUTPUT_SIZE, "840x1400");
    assert.equal(CHAT_PERSONA_IMAGE_OUTPUT_WIDTH, 840);
    assert.equal(CHAT_PERSONA_IMAGE_OUTPUT_HEIGHT, 1400);
    assert.equal(CHAT_PERSONA_IMAGE_OUTPUT_WIDTH / CHAT_PERSONA_IMAGE_OUTPUT_HEIGHT, 3 / 5);
  });
});
