import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CHAT_IMAGE_SCENE_BRIEF_DEFAULT_MODEL,
  CHAT_IMAGE_SCENE_BRIEF_FALLBACK_MODEL,
  extractUserSpokenDialogue,
  findVerbatimSceneDialogue,
  findVerbatimSceneExcerpt,
  isSceneActionText,
  resolveChatImageSceneBriefFallbackModel,
  resolveChatImageSceneBriefModel,
  stripChatTurnMarkup,
} from "./chatImageSceneBrief";

describe("chatImageSceneBrief model routing", () => {
  it("defaults to GPT-5.6 Luna and migrates stale Flash primary env", () => {
    assert.equal(CHAT_IMAGE_SCENE_BRIEF_DEFAULT_MODEL, "gpt-5.6-luna");
    assert.equal(
      resolveChatImageSceneBriefModel({} as NodeJS.ProcessEnv),
      "gpt-5.6-luna"
    );
    assert.equal(
      resolveChatImageSceneBriefModel({
        CHAT_IMAGE_SCENE_BRIEF_MODEL: "deepseek-v4-flash",
      } as NodeJS.ProcessEnv),
      "gpt-5.6-luna"
    );
    assert.equal(
      resolveChatImageSceneBriefModel({
        CHAT_IMAGE_SCENE_BRIEF_MODEL: "deepseek/deepseek-v4-flash",
      } as NodeJS.ProcessEnv),
      "gpt-5.6-luna"
    );
  });

  it("falls back to OpenRouter DeepSeek V4 Flash when cheaper inference fails", () => {
    assert.equal(
      CHAT_IMAGE_SCENE_BRIEF_FALLBACK_MODEL,
      "deepseek/deepseek-v4-flash-0731"
    );
    assert.equal(
      resolveChatImageSceneBriefFallbackModel({} as NodeJS.ProcessEnv),
      "deepseek/deepseek-v4-flash-0731"
    );
    assert.equal(
      resolveChatImageSceneBriefFallbackModel(
        {} as NodeJS.ProcessEnv,
        "gpt-5.6-luna"
      ),
      "deepseek/deepseek-v4-flash-0731"
    );
    assert.equal(
      resolveChatImageSceneBriefFallbackModel(
        {} as NodeJS.ProcessEnv,
        "deepseek-v4-flash"
      ),
      "deepseek/deepseek-v4-flash-0731"
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
});

describe("chatImageSceneBrief helpers", () => {
  it("keeps only contiguous verbatim dialogue from the source turn", () => {
    const source =
      '유저: 잠깐만. 캐릭터: 태현은 "야."라고 말했다. 이어 "거기 보지 마. 나 봐."라고 경고했다.';
    assert.equal(findVerbatimSceneExcerpt("야.", source), "야.");
    assert.equal(
      findVerbatimSceneExcerpt("거기 보지 마. 나 봐.", source),
      "거기 보지 마. 나 봐."
    );
    assert.equal(findVerbatimSceneExcerpt("나 좀 봐.", source), null);
  });

  it("does not treat asterisk action lines as dialogue", () => {
    assert.ok(isSceneActionText("*피어싱을 귀에 끼워준다*"));
    assert.ok(isSceneActionText("(작게 웃는다)"));
    assert.ok(!isSceneActionText("이거 예쁘잖아."));
    const source =
      '렌은 "*피어싱을 태형이의 곰돌이 후드의 귀에 끼워준다* 이거 태형이 눈이랑도 잘어울리잖아. 이뻐"라고 했다.';
    assert.equal(
      findVerbatimSceneDialogue(
        "*피어싱을 태형이의 곰돌이 후드의 귀에 끼워준다*",
        source
      ),
      null
    );
    assert.equal(
      findVerbatimSceneDialogue(
        "이거 태형이 눈이랑도 잘어울리잖아. 이뻐",
        source
      ),
      "이거 태형이 눈이랑도 잘어울리잖아. 이뻐"
    );
  });

  it("extracts spoken dialogue without dropping the source action itself", () => {
    assert.equal(
      extractUserSpokenDialogue(
        "*피어싱을 태형이의 곰돌이 후드의 귀에 끼워준다* 이거 태형이 눈이랑도 잘어울리잖아. 이뻐"
      ),
      "이거 태형이 눈이랑도 잘어울리잖아. 이뻐"
    );
    assert.equal(extractUserSpokenDialogue("*후드 귀를 만진다*"), "");
    assert.equal(extractUserSpokenDialogue("후드 내려볼래?"), "후드 내려볼래?");
  });

  it("strips STATUS and HTML markup", () => {
    assert.equal(
      stripChatTurnMarkup('<<<STATUS_VALUES{"a":1}>>> <em>안녕</em>'),
      "안녕"
    );
  });
});
