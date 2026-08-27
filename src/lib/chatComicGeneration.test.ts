import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CHAT_COMIC_FOUR_PANEL_OUTPUT_SIZE,
  CHAT_COMIC_IMAGE_OUTPUT_SIZE,
  CHAT_COMIC_MAX_INPUT_CHARS,
  buildChatComicImagePrompt,
  resolveChatComicOutputSize,
  resolveChatComicPrice,
  sanitizeChatComicOptions,
} from "./chatComicGeneration";
import {
  buildDeterministicScenePlan,
  buildSceneSourceMessages,
  scenePlanHasRawChatLeak,
} from "./chatImageScenePlan";

const SAMPLE_PLAN = buildDeterministicScenePlan(
  buildSceneSourceMessages([
    { id: 1, role: "user", content: '*후드 귀를 만진다*\n"같이 갈래?"' },
    {
      id: 2,
      role: "assistant",
      content: '렌이 후드를 만지자 태형이 고개를 돌렸다. "그래."',
    },
  ]),
  3
);

describe("chatComicGeneration", () => {
  it("keeps long source guard and default mood", () => {
    assert.equal(CHAT_COMIC_MAX_INPUT_CHARS, 4_000);
    assert.deepEqual(sanitizeChatComicOptions({ mood: "wrong" }), {
      mood: "comic",
    });
  });

  it("uses 2/3 standard size and promoted 4-panel size", () => {
    assert.equal(CHAT_COMIC_IMAGE_OUTPUT_SIZE, "1008x1408");
    assert.equal(CHAT_COMIC_FOUR_PANEL_OUTPUT_SIZE, "864x1824");
    assert.equal(resolveChatComicOutputSize(2), "1008x1408");
    assert.equal(resolveChatComicOutputSize(3), "1008x1408");
    assert.equal(resolveChatComicOutputSize(4), "864x1824");
  });

  it("charges 230P regardless of panel count", () => {
    assert.equal(resolveChatComicPrice(2, {} as NodeJS.ProcessEnv), 230);
    assert.equal(resolveChatComicPrice(3, {} as NodeJS.ProcessEnv), 230);
    assert.equal(resolveChatComicPrice(4, {} as NodeJS.ProcessEnv), 230);
    assert.equal(
      resolveChatComicPrice(3, { CHAT_COMIC_GENERATION_POINTS: "229.1" } as NodeJS.ProcessEnv),
      230
    );
  });

  it("builds the image prompt from an approved Scene Plan and canonical identity", () => {
    const prompt = buildChatComicImagePrompt({
      characterName: "태형",
      characterGender: "male",
      personaName: "렌",
      personaGender: "male",
      mood: "lovely",
      plan: SAMPLE_PLAN,
    });
    assert.match(prompt, /APPROVED SCENE PLAN/);
    assert.match(prompt, /STRICT CLOSED TEXT WHITELIST/);
    assert.match(prompt, /IDENTITY OWNERSHIP IS STRICT/);
    assert.match(prompt, /Silent panels with no speech are valid/);
    assert.match(prompt, /GENDER LOCK/);
    assert.match(prompt, /LAYOUT AND FINISH ONLY/);
    assert.doesNotMatch(prompt, /Original prose context/);
    assert.doesNotMatch(prompt, /SOURCE PROSE/);
    assert.doesNotMatch(prompt, /Preserve each person's hair color, eye color/);
    assert.equal(scenePlanHasRawChatLeak(prompt), false);
  });

  it("allows a silent approved plan with no invented dialogue", () => {
    const silent = buildDeterministicScenePlan(
      buildSceneSourceMessages([
        { id: 1, role: "user", content: "*문을 연다*" },
        { id: 2, role: "assistant", content: "태형이 조용히 따라 나선다." },
      ]),
      2
    );
    const prompt = buildChatComicImagePrompt({
      characterName: "태형",
      characterGender: "male",
      personaName: "렌",
      personaGender: "male",
      plan: silent,
    });
    assert.match(prompt, /NO TEXT IS ALLOWED|No speech bubble/);
    assert.doesNotMatch(prompt, /최소 1개의 대사/);
  });
});
