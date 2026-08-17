import Module from "module";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
  stripDeepSeekAdultHandoffUserBlocks,
} from "@/lib/deepseekAdultHandoff";
import {
  STYLE_TRACK_S1_T1_RAW_PATH,
  STYLE_TRACK_S1_T2_USER,
  styleTrackS1BuildInput,
} from "@/lib/deepseekStyleTrackS1Fixture";
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

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

describe("buildContext — Style Track S1 user blocks", () => {
  it("native DeepSeek turn keeps Mirror and Completion at 0", () => {
    const built = buildContext({
      charName: "Test",
      chunks: [sampleChunk],
      userNickname: "User",
      shortTermHistory: [
        { role: "user", content: "로비에서 인사한다." },
        { role: "assistant", content: "조태형은 짧게 손을 들었다." },
      ],
      currentUserMessage: "같이 갈래?",
      nsfw: false,
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      provider: "cheaperinference",
    });
    const user = lastUser(built);
    assert.equal(countPromptOccurrences(user, HANDOFF_SOURCE_CONTINUITY_STYLE_MIRROR), 0);
    assert.equal(countPromptOccurrences(user, DEEPSEEK_HANDOFF_SCENE_COMPLETION), 0);
    assert.equal(
      countPromptOccurrences(built.systemPrompt, HANDOFF_SOURCE_CONTINUITY_STYLE_MIRROR),
      0
    );
    assert.equal(
      countPromptOccurrences(built.systemPrompt, DEEPSEEK_HANDOFF_SCENE_COMPLETION),
      0
    );
  });

  it("Style Track challenger injects Mirror once, Completion 0, terminal last", () => {
    const built = buildContext({
      charName: "Test",
      chunks: [sampleChunk],
      userNickname: "User",
      shortTermHistory: [
        { role: "user", content: "로비에서 인사한다." },
        { role: "assistant", content: "조태형은 짧게 손을 들었다." },
      ],
      currentUserMessage: STYLE_TRACK_S1_T2_USER,
      nsfw: false,
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      provider: "cheaperinference",
      deepSeekAdultHandoff: {
        applyStyleMirror: true,
        applySceneCompletion: false,
      },
    });
    const user = lastUser(built);
    assert.equal(countPromptOccurrences(user, HANDOFF_SOURCE_CONTINUITY_STYLE_MIRROR), 1);
    assert.equal(countPromptOccurrences(user, DEEPSEEK_HANDOFF_SCENE_COMPLETION), 0);
    assert.equal(
      countPromptOccurrences(built.systemPrompt, HANDOFF_SOURCE_CONTINUITY_STYLE_MIRROR),
      0
    );
    assert.ok(user.includes("[CURRENT USER INPUT]"));
    assert.ok(
      user.indexOf(STYLE_TRACK_S1_T2_USER) <
        user.indexOf(HANDOFF_SOURCE_CONTINUITY_STYLE_MIRROR)
    );
    assert.ok(
      user.indexOf(HANDOFF_SOURCE_CONTINUITY_STYLE_MIRROR) <
        user.indexOf(USER_TAIL_LENGTH_OWNER_SENTENCE)
    );
    assert.ok(user.trimEnd().endsWith(USER_TAIL_LENGTH_OWNER_SENTENCE));
  });

  it("Qwen / Muse / Gemini targets do not get DeepSeek blocks unless explicitly flagged", () => {
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
        currentUserMessage: STYLE_TRACK_S1_T2_USER,
        nsfw: false,
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

  it("Gemini 3.7 frozen fixture baseline vs challenger differ only by Mirror", () => {
    const rawPath = join(
      dirname(fileURLToPath(import.meta.url)),
      "../..",
      STYLE_TRACK_S1_T1_RAW_PATH
    );
    const lastAssistantRaw = readFileSync(rawPath, "utf8");
    const baseline = buildContext(
      styleTrackS1BuildInput({ lastAssistantRaw, arm: "baseline" })
    );
    const challenger = buildContext(
      styleTrackS1BuildInput({ lastAssistantRaw, arm: "challenger" })
    );
    const baselineUser = lastUser(baseline);
    const challengerUser = lastUser(challenger);
    assert.equal(sha256(baseline.systemPrompt), sha256(challenger.systemPrompt));
    const baselineHistory = JSON.stringify(baseline.history.slice(0, -1));
    const challengerHistory = JSON.stringify(challenger.history.slice(0, -1));
    assert.equal(sha256(baselineHistory), sha256(challengerHistory));
    assert.equal(countPromptOccurrences(baselineUser, HANDOFF_SOURCE_CONTINUITY_STYLE_MIRROR), 0);
    assert.equal(countPromptOccurrences(challengerUser, HANDOFF_SOURCE_CONTINUITY_STYLE_MIRROR), 1);
    assert.equal(countPromptOccurrences(baselineUser, DEEPSEEK_HANDOFF_SCENE_COMPLETION), 0);
    assert.equal(countPromptOccurrences(challengerUser, DEEPSEEK_HANDOFF_SCENE_COMPLETION), 0);
    assert.equal(
      stripDeepSeekAdultHandoffUserBlocks(challengerUser),
      stripDeepSeekAdultHandoffUserBlocks(baselineUser)
    );
    assert.notEqual(sha256(baselineUser), sha256(challengerUser));
    assert.ok(challengerUser.trimEnd().endsWith(USER_TAIL_LENGTH_OWNER_SENTENCE));
    assert.ok(baselineUser.trimEnd().endsWith(USER_TAIL_LENGTH_OWNER_SENTENCE));
  });
});
