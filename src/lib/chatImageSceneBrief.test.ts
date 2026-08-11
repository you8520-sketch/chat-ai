import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CHAT_IMAGE_SCENE_BRIEF_DEFAULT_MODEL,
  CHAT_IMAGE_SCENE_BRIEF_FALLBACK_MODEL,
  buildChatImageSceneBriefPrompt,
  findVerbatimSceneExcerpt,
  formatSceneBriefAsComicSource,
  formatSceneBriefAsEditableSummary,
  formatSceneBriefAsIllustrationTurn,
  resolveChatImageSceneBriefFallbackModel,
  resolveChatImageSceneBriefModel,
  sanitizeChatImageSceneBrief,
} from "./chatImageSceneBrief";

describe("chatImageSceneBrief", () => {
  it("defaults to DeepSeek V4 Flash on cheaper inference", () => {
    assert.equal(CHAT_IMAGE_SCENE_BRIEF_DEFAULT_MODEL, "deepseek-v4-flash");
    assert.equal(
      resolveChatImageSceneBriefModel({} as NodeJS.ProcessEnv),
      "deepseek-v4-flash"
    );
    assert.equal(
      resolveChatImageSceneBriefModel({
        CHAT_IMAGE_SCENE_BRIEF_MODEL: "deepseek/deepseek-v4-flash",
      } as NodeJS.ProcessEnv),
      "deepseek/deepseek-v4-flash"
    );
  });

  it("falls back to OpenRouter DeepSeek V4 Flash when cheaper inference fails", () => {
    assert.equal(
      CHAT_IMAGE_SCENE_BRIEF_FALLBACK_MODEL,
      "deepseek/deepseek-v4-flash"
    );
    assert.equal(
      resolveChatImageSceneBriefFallbackModel(
        {} as NodeJS.ProcessEnv,
        "deepseek-v4-flash"
      ),
      "deepseek/deepseek-v4-flash"
    );
    assert.equal(
      resolveChatImageSceneBriefFallbackModel(
        { CHAT_IMAGE_SCENE_BRIEF_FALLBACK_MODEL: "openai/gpt-4o-mini" } as NodeJS.ProcessEnv,
        "deepseek-v4-flash"
      ),
      "openai/gpt-4o-mini"
    );
    assert.equal(
      resolveChatImageSceneBriefFallbackModel(
        {} as NodeJS.ProcessEnv,
        "deepseek/deepseek-v4-flash"
      ),
      null
    );
  });

  it("keeps only contiguous verbatim dialogue from the source turn", () => {
    const source =
      '유저: 잠깐만. 캐릭터: 태현은 "야."라고 말했다. 이어 "거기 보지 마. 나 봐."라고 경고했다. 행인이 "불고기 셋이요"라고 외쳤다.';
    assert.equal(findVerbatimSceneExcerpt("야.", source), "야.");
    assert.equal(
      findVerbatimSceneExcerpt("거기 보지 마. 나 봐.", source),
      "거기 보지 마. 나 봐."
    );
    assert.equal(findVerbatimSceneExcerpt("나 좀 봐.", source), null);

    const brief = sanitizeChatImageSceneBrief(
      {
        setting: "번화가 골목",
        atmosphere: "긴장",
        actions: "태현이 앞을 막는다",
        keyDialogue: [
          { speaker: "character", text: "야." },
          { speaker: "character", text: "나 좀 봐." },
          { speaker: "persona", text: "잠깐만." },
          { speaker: "other", text: "불고기 셋이요" },
          { speaker: "character", text: "거기 보지 마. 나 봐." },
        ],
      },
      source
    );

    assert.deepEqual(brief.keyDialogue, [
      { speaker: "character", text: "야." },
      { speaker: "persona", text: "잠깐만." },
      { speaker: "other", text: "불고기 셋이요" },
      { speaker: "character", text: "거기 보지 마. 나 봐." },
    ]);
  });

  it("backfills a second verbatim line when the model returns only one", () => {
    const source =
      '태형은 "자, 식후땡으로는 역시 낮잠이 최고지."라고 말했다. 렌은 "정말 여기서 자려고?"라고 받았다.';
    const brief = sanitizeChatImageSceneBrief(
      {
        setting: "공원",
        atmosphere: "평화",
        actions: "태형이 재킷을 깐다",
        keyDialogue: [
          { speaker: "character", text: "자, 식후땡으로는 역시 낮잠이 최고지." },
        ],
      },
      source
    );
    assert.equal(brief.keyDialogue.length, 2);
    assert.equal(brief.keyDialogue[1]?.text, "정말 여기서 자려고?");
  });

  it("asks the model for closed-book verbatim dialogue", () => {
    const prompt = buildChatImageSceneBriefPrompt({
      characterName: "태현",
      personaName: "렌",
      sourceTurn: '태현은 "야."라고 했다.',
    });
    assert.match(prompt, /CLOSED-BOOK/);
    assert.match(prompt, /exact contiguous substring/);
    assert.match(prompt, /Do not invent dialogue/);
    assert.match(prompt, /SOURCE TURN/);
  });

  it("formats comic source with quoted verbatim lines for the planner lock", () => {
    const source = formatSceneBriefAsComicSource(
      {
        setting: "식당",
        atmosphere: "장난스러운",
        actions: "태형이 조르고 렌이 먹여준다",
        keyDialogue: [
          { speaker: "character", text: "대장님, 내 깻잎도 떼어줘!" },
          { speaker: "persona", text: "진정하고 깻잎이나 먹어." },
        ],
      },
      { characterName: "태형", personaName: "렌" }
    );
    assert.match(source, /식당/);
    assert.match(source, /태형: "대장님, 내 깻잎도 떼어줘!"/);
    assert.match(source, /렌: "진정하고 깻잎이나 먹어\."/);
  });

  it("formats illustration turns around setting and verbatim key lines", () => {
    const turn = formatSceneBriefAsIllustrationTurn(
      {
        setting: "옥상",
        atmosphere: "달달",
        actions: "둘이 나란히 선다",
        keyDialogue: [{ speaker: "character", text: "나 봐." }],
      },
      { characterName: "태현", personaName: "렌" }
    );
    assert.match(turn, /Setting: 옥상/);
    assert.match(turn, /태현: “나 봐\.”/);
    assert.match(turn, /acting\/emotion only/);
  });

  it("formats an editable Korean summary with verbatim dialogue", () => {
    const summary = formatSceneBriefAsEditableSummary(
      {
        setting: "식당",
        atmosphere: "장난스러운",
        actions: "태형이 조르고 렌이 먹여준다",
        keyDialogue: [
          { speaker: "character", text: "대장님, 내 깻잎도 떼어줘!" },
          { speaker: "persona", text: "진정하고 깻잎이나 먹어." },
        ],
      },
      { characterName: "태형", personaName: "렌" }
    );
    assert.match(summary, /배경: 식당/);
    assert.match(summary, /상황: 태형이 조르고 렌이 먹여준다/);
    assert.match(summary, /태형의 대사: "대장님, 내 깻잎도 떼어줘!"/);
    assert.match(summary, /렌의 대사: "진정하고 깻잎이나 먹어\."/);
  });
});
