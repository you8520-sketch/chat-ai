import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CHAT_COMIC_FOUR_PANEL_OUTPUT_SIZE,
  CHAT_COMIC_IMAGE_OUTPUT_SIZE,
  CHAT_COMIC_MAX_INPUT_CHARS,
  CHAT_COMIC_MIN_TEXT_BOXES,
  buildChatComicImagePrompt,
  buildChatComicPlannerPrompt,
  countComicTextBoxes,
  extractComicCaptionCandidates,
  extractQuotedComicDialogue,
  extractUnquotedComicNarration,
  resolveChatComicPlannerModel,
  resolveChatComicOutputSize,
  resolveChatComicPrice,
  sanitizeChatComicOptions,
  sanitizeChatComicPlan,
} from "./chatComicGeneration";

describe("chatComicGeneration", () => {
  it("keeps long source text intact and leaves panel selection to the planner", () => {
    const source = "가".repeat(CHAT_COMIC_MAX_INPUT_CHARS + 30);
    assert.deepEqual(sanitizeChatComicOptions({ mood: "wrong", sourceText: source }), {
      mood: "comic",
      sourceText: source,
    });
  });

  it("uses the standard comic output size for both 2 and 3 panels", () => {
    assert.equal(CHAT_COMIC_IMAGE_OUTPUT_SIZE, "1008x1408");
    assert.equal(CHAT_COMIC_FOUR_PANEL_OUTPUT_SIZE, "864x1824");
    assert.equal(resolveChatComicOutputSize(2), "1008x1408");
    assert.equal(resolveChatComicOutputSize(3), "1008x1408");
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

  it("charges 230P regardless of the automatically selected panel count", () => {
    assert.equal(resolveChatComicPrice(2, {} as NodeJS.ProcessEnv), 230);
    assert.equal(resolveChatComicPrice(3, {} as NodeJS.ProcessEnv), 230);
    assert.equal(
      resolveChatComicPrice(3, { CHAT_COMIC_GENERATION_POINTS: "229.1" } as NodeJS.ProcessEnv),
      230
    );
  });

  it("uses the planner-selected 2-3 panel count", () => {
    const sourceText =
      '태형이 "대장님, 내 깻잎도 떼어줘!"라고 말했다. 렌은 "진정하고 깻잎이나 먹어."라고 답했다. 식당 안의 공기가 순간 얼어붙었다. 태형이 살짝 웃었다.';
    const plan = sanitizeChatComicPlan(
      {
        title: "깻잎 한입",
        panelCount: 3,
        panels: [
          {
            scene: "태형이 렌의 어깨에 기대 징징거린다.",
            characterExpression: "억울하고 삐친 표정",
            personaExpression: "차분한 표정",
            dialogue: [{ speaker: "character", text: "대장님, 내 깻잎도 떼어줘!" }],
          },
          {
            scene: "렌이 한숨을 쉬며 젓가락을 든다.",
            characterExpression: "기대하는 표정",
            personaExpression: "어이없는 표정",
            dialogue: [],
          },
          {
            scene: "렌이 깻잎과 밥을 떠서 먹여준다.",
            characterExpression: "놀라서 굳은 표정",
            personaExpression: "무심하게 다정한 표정",
            dialogue: [{ speaker: "persona", text: "진정하고 깻잎이나 먹어." }],
          },
        ],
      },
      sourceText
    );
    assert.equal(plan.panelCount, 3);
    assert.equal(plan.panels.length, 3);
    assert.equal(plan.panels[0]?.dialogue[0]?.text, "대장님, 내 깻잎도 떼어줘!");
    assert.equal(plan.panels[2]?.dialogue[0]?.speaker, "persona");
    assert.ok(countComicTextBoxes(plan.panels) >= CHAT_COMIC_MIN_TEXT_BOXES);
    assert.throws(() => sanitizeChatComicPlan({ title: "x", panels: [{}] }, sourceText));
    assert.throws(() =>
      sanitizeChatComicPlan(
        { title: "x", panelCount: 3, panels: [{}, {}] },
        sourceText
      )
    );
    assert.throws(() =>
      sanitizeChatComicPlan(
        {
          title: "x",
          panelCount: 4,
          panels: [
            { scene: "a", dialogue: [] },
            { scene: "b", dialogue: [] },
            { scene: "c", dialogue: [] },
            { scene: "d", dialogue: [] },
          ],
        },
        sourceText
      )
    );
  });

  it("removes invented text but keeps verbatim unquoted narration", () => {
    const sourceText =
      '식당 안의 공기가 순간 얼어붙었다. 태현은 "야."라고 말했다. 이어 "거기 보지 마. 나 봐."라고 경고했다. 마지막에는 “딱 한 걸음만 와.”라고 했다.';
    assert.deepEqual(extractQuotedComicDialogue(sourceText), [
      "야.",
      "거기 보지 마. 나 봐.",
      "딱 한 걸음만 와.",
    ]);
    assert.deepEqual(
      extractUnquotedComicNarration(sourceText),
      [
        "식당 안의 공기가 순간 얼어붙었다. 태현은",
        "라고 말했다. 이어",
        "라고 경고했다. 마지막에는",
        "라고 했다.",
      ]
    );

    const plan = sanitizeChatComicPlan(
      {
        title: "경계",
        panelCount: 3,
        panels: [
          {
            scene: "태현이 앞을 막는다.",
            dialogue: [
              { speaker: "character", text: "야." },
              { speaker: "persona", text: "…알겠어." },
            ],
            caption: "식당 안의 공기가 순간 얼어붙었다.",
          },
          {
            scene: "태현이 렌을 바라본다.",
            dialogue: [
              { speaker: "character", text: "나 봐." },
              { speaker: "persona", text: "이게 무슨 상황이야!" },
            ],
            caption: "긴장감 속에서 유머가 터진다.",
          },
          {
            scene: "태현이 한 걸음 다가선다.",
            dialogue: [{ speaker: "character", text: "딱 한 걸음만 와." }],
          },
        ],
      },
      sourceText
    );

    assert.deepEqual(plan.panels[0]?.dialogue, [{ speaker: "character", text: "야." }]);
    assert.deepEqual(plan.panels[1]?.dialogue, [{ speaker: "character", text: "나 봐." }]);
    assert.equal(plan.panels[0]?.caption, "식당 안의 공기가 순간 얼어붙었다.");
    assert.notEqual(plan.panels[1]?.caption, "긴장감 속에서 유머가 터진다.");
  });

  it("backfills captions so sparse dialogue still reaches four text boxes", () => {
    const sourceText = [
      '유저: "후드 내려볼래?"',
      "캐릭터: 렌이 손을 뻗어 후드를 고쳐 준다. *판다 귀가 살짝 기울어진다.*",
      '그는 "이거 태형이 눈이랑도 잘어울리잖아. 이뻐."라고 말했다.',
      "태형이 살짝 붉어진다. (오늘도 또 져버리네.)",
      '태형은 "하하, 와... 나 진짜 오늘 여러 번 항복하게 만드네."라고 웃었다.',
    ].join("\n");

    assert.ok(
      extractComicCaptionCandidates(sourceText).some((line) =>
        line.includes("판다 귀가 살짝 기울어진다")
      )
    );

    const plan = sanitizeChatComicPlan(
      {
        title: "후드",
        panelCount: 3,
        panels: [
          {
            scene: "렌이 후드를 고쳐준다.",
            dialogue: [
              { speaker: "persona", text: "이거 태형이 눈이랑도 잘어울리잖아. 이뻐." },
            ],
          },
          {
            scene: "태형이 웃는다.",
            dialogue: [],
          },
          {
            scene: "태형이 항복한다.",
            dialogue: [
              {
                speaker: "character",
                text: "하하, 와... 나 진짜 오늘 여러 번 항복하게 만드네.",
              },
            ],
          },
        ],
      },
      sourceText
    );

    assert.ok(countComicTextBoxes(plan.panels) >= CHAT_COMIC_MIN_TEXT_BOXES);
    assert.ok(plan.panels.filter((panel) => panel.caption).length >= 2);
    assert.ok(
      plan.panels.some((panel) => panel.dialogue.some((line) => line.text.includes("후드")))
    );
  });

  it("asks the cheap planner to choose the smallest natural panel count", () => {
    const prompt = buildChatComicPlannerPrompt({
      characterName: "태형",
      characterGender: "male",
      personaName: "렌",
      personaGender: "male",
      mood: "comic",
      sourceText: "태형이 깻잎을 떼어달라고 징징거렸다.",
    });
    assert.match(prompt, /smallest natural panel count from 2 or 3/);
    assert.match(prompt, /Never stretch a short scene/);
    assert.match(prompt, /TEXT QUOTA \(mandatory\)/);
    assert.match(prompt, /MUST total at least 4/);
    assert.match(prompt, /Use only verbatim contiguous excerpts/);
    assert.match(prompt, /MUST use at least one of those quoted lines as a speech bubble/);
    assert.match(prompt, /Never invent, paraphrase, combine, complete, or add reaction dialogue/);
    assert.match(prompt, /The chat character is 태형 \(male\); the user persona is 렌 \(male\)/);
    assert.match(prompt, /Never change either person's gender/);
    assert.match(prompt, /SOURCE PROSE/);
  });

  it("backfills missing planner dialogue from quoted source lines", () => {
    const sourceText = '태현은 "야."라고 말했다. 공기가 싸늘하게 가라앉았다.';
    const plan = sanitizeChatComicPlan(
      {
        title: "무음",
        panelCount: 2,
        panels: [
          { scene: "태현이 앞을 막는다.", dialogue: [] },
          { scene: "렌이 뒤돌아본다.", dialogue: [] },
        ],
      },
      sourceText
    );
    assert.equal(plan.panels[0]?.dialogue[0]?.text, "야.");
    assert.throws(
      () =>
        sanitizeChatComicPlan(
          {
            title: "무음",
            panelCount: 3,
            panels: [
              { scene: "a", dialogue: [] },
              { scene: "b", dialogue: [] },
              { scene: "c", dialogue: [] },
            ],
          },
          "대사가 없는 지문만 있다."
        ),
      /최소 1개의 대사/
    );
  });

  it("keeps exact dialogue, correct speakers, and visible page boundaries in the image prompt", () => {
    const prompt = buildChatComicImagePrompt({
      characterName: "태형",
      characterGender: "male",
      personaName: "렌",
      personaGender: "male",
      mood: "lovely",
      sourceText: "태형이 조르고 렌이 한입 먹여준다.",
      plan: {
        title: "깻잎 한입",
        panelCount: 3,
        panels: [
          {
            panel: 1,
            scene: "식당에서 태형이 렌에게 기대어 조른다.",
            characterExpression: "삐친 표정",
            personaExpression: "차분한 표정",
            dialogue: [{ speaker: "character", text: "대장님, 내 것도 먹여줘!" }],
            caption: "태형이 조르고",
          },
          {
            panel: 2,
            scene: "렌이 젓가락을 들어 깻잎을 집는다.",
            characterExpression: "기대하는 표정",
            personaExpression: "어이없는 표정",
            dialogue: [],
          },
          {
            panel: 3,
            scene: "렌이 태형에게 한입 먹여준다.",
            characterExpression: "행복한 표정",
            personaExpression: "부끄러운 표정",
            dialogue: [{ speaker: "persona", text: "진정하고 한입 먹어." }],
          },
        ],
      },
    });
    assert.match(prompt, /STRICT CLOSED TEXT WHITELIST/);
    assert.match(prompt, /Never invent reaction dialogue/);
    assert.match(prompt, /태형: “대장님, 내 것도 먹여줘!”/);
    assert.match(prompt, /렌: “진정하고 한입 먹어.”/);
    assert.match(prompt, /Exact rectangular narration box: “태형이 조르고”/);
    assert.match(prompt, /Never swap or blend them/);
    assert.match(prompt, /Render approved narration only in a tail-less rectangular narration box/);
    assert.match(prompt, /Do not crop off speech bubbles or the last panel/);
    assert.match(prompt, /GENDER LOCK/);
    assert.match(prompt, /confirmed MALE/);
    assert.match(prompt, /LAYOUT AND FINISH ONLY/);
    assert.match(prompt, /pink-haired feminine sample figure/);
  });
});
