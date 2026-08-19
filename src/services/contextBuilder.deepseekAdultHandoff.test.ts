import Module from "module";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import type { buildContext as BuildContextFn } from "./contextBuilder";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
  CHEAPER_INFERENCE_QWEN_38_MAX_MODEL,
  OPENROUTER_MUSE_SPARK_11_MODEL,
} from "@/lib/chatModels";
import {
  DEEPSEEK_HANDOFF_SCENE_COMPLETION,
  HANDOFF_SOURCE_CONTINUITY_STYLE_MIRROR,
  countPromptOccurrences,
} from "@/lib/deepseekAdultHandoff";
import { USER_TAIL_LENGTH_OWNER_SENTENCE } from "@/lib/responseLength";
import type { CharacterChunk } from "@/types";

let buildContext: typeof BuildContextFn;

before(async () => {
  ({ buildContext } = await import("./contextBuilder"));
});

const sampleChunk: CharacterChunk = {
  id: "c-chunk-0",
  characterId: "1",
  content: "[Identity]\nTest character.",
  category: "identity",
  importance: "CRITICAL",
  tokenCount: 10,
  keywords: ["test"],
};

function lastUser(built: ReturnType<typeof BuildContextFn>): string {
  const last = built.history[built.history.length - 1];
  assert.equal(last?.role, "user");
  return last!.content;
}

describe("buildContext — DeepSeek adult-handoff user blocks", () => {
  it("native DeepSeek adult-capable turn keeps both handoff blocks at 0", () => {
    const built = buildContext({
      charName: "Test",
      chunks: [sampleChunk],
      userNickname: "User",
      shortTermHistory: [
        { role: "user", content: "가까이 와." },
        { role: "assistant", content: "카스펜은 한 걸음 다가섰다." },
      ],
      currentUserMessage: "허리를 끌어안는다.",
      nsfw: true,
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      provider: "cheaperinference",
    });
    const user = lastUser(built);
    assert.equal(countPromptOccurrences(user, HANDOFF_SOURCE_CONTINUITY_STYLE_MIRROR), 0);
    assert.equal(countPromptOccurrences(user, DEEPSEEK_HANDOFF_SCENE_COMPLETION), 0);
    assert.equal(countPromptOccurrences(built.systemPrompt, DEEPSEEK_HANDOFF_SCENE_COMPLETION), 0);
    assert.equal(
      countPromptOccurrences(built.systemPrompt, HANDOFF_SOURCE_CONTINUITY_STYLE_MIRROR),
      0
    );
  });

  it("Experiment A handoff injects completion once, no style mirror, terminal last", () => {
    const built = buildContext({
      charName: "Test",
      chunks: [sampleChunk],
      userNickname: "User",
      shortTermHistory: [
        { role: "user", content: "가까이 와." },
        { role: "assistant", content: "카스펜은 한 걸음 다가섰다." },
      ],
      currentUserMessage: "허리를 더 세게 끌어안는다.",
      nsfw: true,
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      provider: "cheaperinference",
      deepSeekAdultHandoff: {
        applyStyleMirror: false,
        applySceneCompletion: true,
      },
    });
    const user = lastUser(built);
    assert.equal(countPromptOccurrences(user, HANDOFF_SOURCE_CONTINUITY_STYLE_MIRROR), 0);
    assert.equal(countPromptOccurrences(user, DEEPSEEK_HANDOFF_SCENE_COMPLETION), 1);
    assert.equal(countPromptOccurrences(built.systemPrompt, DEEPSEEK_HANDOFF_SCENE_COMPLETION), 0);
    assert.ok(user.includes("[CURRENT USER INPUT]"));
    assert.ok(
      user.indexOf("허리를 더 세게 끌어안는다.") <
        user.indexOf(DEEPSEEK_HANDOFF_SCENE_COMPLETION)
    );
    assert.ok(
      user.indexOf(DEEPSEEK_HANDOFF_SCENE_COMPLETION) <
        user.indexOf(USER_TAIL_LENGTH_OWNER_SENTENCE)
    );
    assert.ok(user.trimEnd().endsWith(USER_TAIL_LENGTH_OWNER_SENTENCE));
  });

  it("Qwen and Muse targets do not get DeepSeek blocks unless explicitly flagged", () => {
    for (const modelId of [
      CHEAPER_INFERENCE_QWEN_38_MAX_MODEL,
      OPENROUTER_MUSE_SPARK_11_MODEL,
      CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
    ]) {
      const built = buildContext({
        charName: "Test",
        chunks: [sampleChunk],
        userNickname: "User",
        shortTermHistory: [],
        currentUserMessage: "허리를 끌어안는다.",
        nsfw: true,
        modelId,
        provider: "cheaperinference",
      });
      const user = lastUser(built);
      assert.equal(
        countPromptOccurrences(user, DEEPSEEK_HANDOFF_SCENE_COMPLETION),
        0,
        modelId
      );
      assert.equal(
        countPromptOccurrences(user, HANDOFF_SOURCE_CONTINUITY_STYLE_MIRROR),
        0,
        modelId
      );
    }
  });
});
