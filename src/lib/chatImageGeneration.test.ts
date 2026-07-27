import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CHAT_COMIC_MAX_INPUT_CHARS,
  buildChatComicImagePrompt,
  buildChatImageGenerationPrompt,
  normalizeChatComicPlan,
  resolveChatComicGenerationPrice,
  resolveChatImageGenerationPrice,
  resolveChatImageReferenceOrder,
  sanitizeChatComicMood,
  sanitizeChatComicPanelCount,
  sanitizeChatImageGenerationOptions,
} from "./chatImageGeneration";

describe("chatImageGeneration", () => {
  it("fails closed to the fixed SD preset defaults", () => {
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

  it("orders server-owned SD references from the selected placement", () => {
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

  it("keeps SD identity order and fixed-template constraints explicit", () => {
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

  it("uses the budget 350P SD price with a safe env override", () => {
    assert.equal(resolveChatImageGenerationPrice({} as NodeJS.ProcessEnv), 350);
    assert.equal(
      resolveChatImageGenerationPrice({ CHAT_IMAGE_GENERATION_POINTS: "399.1" } as NodeJS.ProcessEnv),
      400
    );
    assert.equal(
      resolveChatImageGenerationPrice({ CHAT_IMAGE_GENERATION_POINTS: "nope" } as NodeJS.ProcessEnv),
      350
    );
  });

  it("sanitizes comic panel count and mood", () => {
    assert.equal(sanitizeChatComicPanelCount(2), 2);
    assert.equal(sanitizeChatComicPanelCount("3"), 3);
    assert.equal(sanitizeChatComicPanelCount(99), 4);
    assert.equal(sanitizeChatComicMood("lovely"), "lovely");
    assert.equal(sanitizeChatComicMood("wrong"), "comic");
    assert.equal(CHAT_COMIC_MAX_INPUT_CHARS, 500);
  });

  it("prices budget comics at 250P / 300P / 350P", () => {
    assert.equal(resolveChatComicGenerationPrice(2), 250);
    assert.equal(resolveChatComicGenerationPrice(3), 300);
    assert.equal(resolveChatComicGenerationPrice(4), 350);
  });

  it("normalizes exactly the requested number of comic panels", () => {
    const plan = normalizeChatComicPlan(
      {
        title: "깻잎 한입",
        panels: [
          {
            scene: "태형이 렌에게 깻잎을 먹여 달라고 조른다.",
            dialogue: [
              { speaker: "character", text: "대장님, 내 깻잎도 떼어줘!" },
              { speaker: "character", text: "제일 크고 양념 잘 밴 걸로!" },
              { speaker: "character", text: "세 번째 대사는 제거" },
            ],
          },
          {
            scene: "렌이 깻잎을 얹은 숟가락을 내민다.",
            dialogue: [{ speaker: "persona", text: "진정하고 깻잎이나 먹어." }],
          },
          {
            scene: "태형이 행복하게 밥을 오물거린다.",
            dialogue: [],
          },
          {
            scene: "태형이 렌을 껴안고 승리를 선언한다.",
            dialogue: [{ speaker: "character", text: "내가 완전히 압승이야!" }],
          },
        ],
      },
      4
    );
    assert.equal(plan.panels.length, 4);
    assert.equal(plan.panels[0]?.dialogue.length, 2);
    assert.equal(plan.panels[1]?.dialogue[0]?.speaker, "persona");
  });

  it("builds a comic prompt that treats the example as style-only and preserves final Korean copy", () => {
    const plan = normalizeChatComicPlan(
      {
        title: "깻잎 먹여주기",
        panels: [
          {
            scene: "태형이 렌의 어깨에 기대어 깻잎을 요구한다.",
            dialogue: [{ speaker: "character", text: "대장님, 내 깻잎도 떼어줘!" }],
            characterExpression: "억울하게 삐죽거림",
            personaExpression: "차분함",
          },
          {
            scene: "렌이 태형에게 직접 한입 먹여준다.",
            dialogue: [{ speaker: "persona", text: "진정하고 깻잎이나 먹어." }],
          },
          {
            scene: "태형이 뺨을 부풀리고 감격한다.",
            dialogue: [{ speaker: "character", text: "아... 대장님... 진짜..." }],
          },
          {
            scene: "태형이 렌을 껴안고 자랑한다.",
            dialogue: [{ speaker: "character", text: "내가 완전히 압승이야!" }],
          },
        ],
      },
      4
    );
    const prompt = buildChatComicImagePrompt({
      characterName: "태형",
      personaName: "렌",
      panelCount: 4,
      mood: "comic",
      plan,
    });
    assert.match(prompt, /exactly 4 wide horizontal panels stacked vertically/);
    assert.match(prompt, /Reference image 1 is ONLY a layout/);
    assert.match(prompt, /Never copy its old dialogue/);
    assert.match(prompt, /The Korean dialogue below is FINAL COPY/);
    assert.match(prompt, /Do not paraphrase, translate, invent, omit or duplicate dialogue/);
    assert.match(prompt, /대장님, 내 깻잎도 떼어줘!/);
    assert.match(prompt, /Reference image 2 is the identity reference for the chat character, 태형/);
    assert.match(prompt, /Reference image 3 is the identity reference for the user persona, 렌/);
  });
});
