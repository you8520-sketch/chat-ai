import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CHAT_COMIC_IMAGE_OUTPUT_SIZE,
  CHAT_COMIC_MAX_INPUT_CHARS,
  buildChatComicImagePrompt,
  buildChatComicPlannerPrompt,
  resolveChatComicPlannerModel,
  resolveChatComicPrice,
  sanitizeChatComicOptions,
  sanitizeChatComicPlan,
} from "./chatComicGeneration";

describe("chatComicGeneration", () => {
  it("accepts only 2-4 panels and caps source text at 800 characters", () => {
    const source = "가".repeat(CHAT_COMIC_MAX_INPUT_CHARS + 30);
    assert.deepEqual(sanitizeChatComicOptions({ panelCount: 7, mood: "wrong", sourceText: source }), {
      panelCount: 4,
      mood: "comic",
      sourceText: "가".repeat(CHAT_COMIC_MAX_INPUT_CHARS),
    });
  });

  it("uses the near-1000x1400 portrait output size accepted by OpenAI", () => {
    assert.equal(CHAT_COMIC_IMAGE_OUTPUT_SIZE, "1008x1408");
  });

  it("uses an OpenAI-direct planner and ignores the old OpenRouter setting", () => {
    assert.equal(resolveChatComicPlannerModel({} as NodeJS.ProcessEnv), "gpt-4o-mini");
    assert.equal(
      resolveChatComicPlannerModel({
        OPENAI_COMIC_PLANNER_MODEL: "gpt-4.1-mini",
        OPENROUTER_COMIC_PLANNER_MODEL: "google/gemini-2.5-flash-lite",
      } as NodeJS.ProcessEnv),
      "gpt-4.1-mini"
    );
    assert.equal(
      resolveChatComicPlannerModel({
        OPENROUTER_COMIC_PLANNER_MODEL: "google/gemini-2.5-flash-lite",
      } as NodeJS.ProcessEnv),
      "gpt-4o-mini"
    );
  });

  it("uses low-cost fixed pricing per panel count with env overrides", () => {
    assert.equal(resolveChatComicPrice(2, {} as NodeJS.ProcessEnv), 250);
    assert.equal(resolveChatComicPrice(3, {} as NodeJS.ProcessEnv), 300);
    assert.equal(resolveChatComicPrice(4, {} as NodeJS.ProcessEnv), 350);
    assert.equal(
      resolveChatComicPrice(4, { CHAT_COMIC_4_POINTS: "399.1" } as NodeJS.ProcessEnv),
      400
    );
  });

  it("requires the planner to make the exact requested number of panels", () => {
    const plan = sanitizeChatComicPlan(
      {
        title: "깻잎 한입",
        panels: [
          {
            scene: "태형이 렌의 어깨에 기대 징징거린다.",
            characterExpression: "억울하고 삐친 표정",
            personaExpression: "차분한 표정",
            dialogue: [{ speaker: "character", text: "대장님, 내 깻잎도 떼어줘!" }],
          },
          {
            scene: "렌이 깻잎과 밥을 떠서 먹여준다.",
            characterExpression: "놀라서 굳은 표정",
            personaExpression: "무심하게 다정한 표정",
            dialogue: [{ speaker: "persona", text: "진정하고 깻잎이나 먹어." }],
          },
        ],
      },
      2
    );
    assert.equal(plan.panels.length, 2);
    assert.equal(plan.panels[0]?.dialogue[0]?.text, "대장님, 내 깻잎도 떼어줘!");
    assert.equal(plan.panels[1]?.dialogue[0]?.speaker, "persona");
    assert.throws(() => sanitizeChatComicPlan({ title: "x", panels: [{}] }, 2));
  });

  it("asks the cheap planner to preserve quoted Korean dialogue and speech style", () => {
    const prompt = buildChatComicPlannerPrompt({
      characterName: "태형",
      personaName: "렌",
      panelCount: 4,
      mood: "comic",
      sourceText: "태형이 깻잎을 떼어달라고 징징거렸다.",
    });
    assert.match(prompt, /exactly 4 horizontal comic panels/);
    assert.match(prompt, /Preserve quoted wording and each character's speech style/);
    assert.match(prompt, /The chat character is 태형; the user persona is 렌/);
    assert.match(prompt, /SOURCE PROSE/);
  });

  it("keeps exact dialogue, correct speakers, and visible page boundaries in the image prompt", () => {
    const prompt = buildChatComicImagePrompt({
      characterName: "태형",
      personaName: "렌",
      panelCount: 2,
      mood: "lovely",
      sourceText: "태형이 조르고 렌이 한입 먹여준다.",
      plan: {
        title: "깻잎 한입",
        panels: [
          {
            panel: 1,
            scene: "식당에서 태형이 렌에게 기대어 조른다.",
            characterExpression: "삐친 표정",
            personaExpression: "차분한 표정",
            dialogue: [{ speaker: "character", text: "대장님, 내 것도 먹여줘!" }],
          },
          {
            panel: 2,
            scene: "렌이 태형에게 한입 먹여준다.",
            characterExpression: "행복한 표정",
            personaExpression: "부끄러운 표정",
            dialogue: [{ speaker: "persona", text: "진정하고 한입 먹어." }],
          },
        ],
      },
    });
    assert.match(prompt, /Render every Korean dialogue and caption EXACTLY/);
    assert.match(prompt, /태형: “대장님, 내 것도 먹여줘!”/);
    assert.match(prompt, /렌: “진정하고 한입 먹어.”/);
    assert.match(prompt, /Never swap or blend them/);
    assert.match(prompt, /Do not crop off speech bubbles or the last panel/);
  });
});
