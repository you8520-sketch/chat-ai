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
  CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  CHEAPER_INFERENCE_MUSE_SPARK_12_MODEL,
  CHEAPER_INFERENCE_QWEN_38_MAX_MODEL,
} from "@/lib/chatModels";
import {
  GEMINI31_QWEN_STYLE_CONTINUITY_BLOCK,
  MUSE_SOURCE_CONTINUITY_STYLE_MIRROR,
  OPUS_QWEN_FRAGMENT_SENTENCE,
} from "@/lib/adultHandoffSourceRouting";
import { MUSE_SOURCE_STYLE_FINGERPRINT_HEADER } from "@/lib/museSourceStyleFingerprint";
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

describe("buildContext — Muse source continuity on current-user recency", () => {
  it("places the generic Muse block once before the terminal user-tail", () => {
    const built = buildContext({
      charName: "Test",
      chunks: [sampleChunk],
      userNickname: "User",
      shortTermHistory: [],
      currentUserMessage: "이대로 더 해도 돼.",
      nsfw: true,
      modelId: CHEAPER_INFERENCE_MUSE_SPARK_12_MODEL,
      provider: "cheaperinference",
      adultHandoffSourceModelId: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
      adultHandoffTargetModelId: CHEAPER_INFERENCE_MUSE_SPARK_12_MODEL,
    });
    const lastUser = built.history[built.history.length - 1];
    assert.equal(lastUser?.role, "user");
    const user = lastUser!.content;
    assert.equal(user.split(MUSE_SOURCE_CONTINUITY_STYLE_MIRROR).length - 1, 1);
    assert.ok(user.includes(USER_TAIL_LENGTH_OWNER_SENTENCE));
    assert.ok(
      user.indexOf(MUSE_SOURCE_CONTINUITY_STYLE_MIRROR) <
        user.indexOf(USER_TAIL_LENGTH_OWNER_SENTENCE)
    );
    assert.ok(user.trimEnd().endsWith(USER_TAIL_LENGTH_OWNER_SENTENCE));
    assert.equal(built.systemPrompt.includes(MUSE_SOURCE_CONTINUITY_STYLE_MIRROR), false);
    assert.equal(built.systemPrompt.includes(OPUS_QWEN_FRAGMENT_SENTENCE), false);
  });

  it("uses the same generic block for Gemini 3.1 → Muse and keeps Qwen blocks off", () => {
    const built = buildContext({
      charName: "Test",
      chunks: [sampleChunk],
      userNickname: "User",
      shortTermHistory: [],
      currentUserMessage: "같은 위치에서 계속한다.",
      nsfw: true,
      modelId: CHEAPER_INFERENCE_MUSE_SPARK_12_MODEL,
      provider: "cheaperinference",
      adultHandoffSourceModelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      adultHandoffTargetModelId: CHEAPER_INFERENCE_MUSE_SPARK_12_MODEL,
    });
    const user = built.history.at(-1)?.content ?? "";
    assert.equal(user.split(MUSE_SOURCE_CONTINUITY_STYLE_MIRROR).length - 1, 1);
    assert.equal(user.includes(GEMINI31_QWEN_STYLE_CONTINUITY_BLOCK), false);
    assert.equal(built.systemPrompt.includes(GEMINI31_QWEN_STYLE_CONTINUITY_BLOCK), false);
  });

  it("does not inject Muse when the live target remains Qwen", () => {
    const built = buildContext({
      charName: "Test",
      chunks: [sampleChunk],
      userNickname: "User",
      shortTermHistory: [],
      currentUserMessage: "이대로 더 해도 돼.",
      nsfw: true,
      modelId: CHEAPER_INFERENCE_QWEN_38_MAX_MODEL,
      provider: "cheaperinference",
      adultHandoffSourceModelId: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
      adultHandoffTargetModelId: CHEAPER_INFERENCE_QWEN_38_MAX_MODEL,
    });
    const user = built.history.at(-1)?.content ?? "";
    assert.equal(user.includes(MUSE_SOURCE_CONTINUITY_STYLE_MIRROR), false);
    assert.equal(user.includes(MUSE_SOURCE_STYLE_FINGERPRINT_HEADER), false);
  });

  it("places the source fingerprint before Generic Mirror when last assistant is long", () => {
    const lastAssistant = Array.from({ length: 12 }, (_, i) => {
      let p = `문단 ${i}. 창밖 공기가 조금 달라졌다. `;
      while (p.length < 180) p += "이어지는 서술 문장이다. ";
      return p;
    }).join("\n\n");
    const built = buildContext({
      charName: "Test",
      chunks: [sampleChunk],
      userNickname: "User",
      shortTermHistory: [{ role: "assistant", content: lastAssistant }],
      currentUserMessage: "이대로 더 해도 돼.",
      nsfw: true,
      modelId: CHEAPER_INFERENCE_MUSE_SPARK_12_MODEL,
      provider: "cheaperinference",
      adultHandoffSourceModelId: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
      adultHandoffTargetModelId: CHEAPER_INFERENCE_MUSE_SPARK_12_MODEL,
    });
    const user = built.history.at(-1)?.content ?? "";
    assert.equal(user.split(MUSE_SOURCE_STYLE_FINGERPRINT_HEADER).length - 1, 1);
    assert.equal(user.split(MUSE_SOURCE_CONTINUITY_STYLE_MIRROR).length - 1, 1);
    assert.ok(
      user.indexOf(MUSE_SOURCE_STYLE_FINGERPRINT_HEADER) <
        user.indexOf(MUSE_SOURCE_CONTINUITY_STYLE_MIRROR)
    );
    assert.ok(user.trimEnd().endsWith(USER_TAIL_LENGTH_OWNER_SENTENCE));
    assert.equal(built.systemPrompt.includes(MUSE_SOURCE_STYLE_FINGERPRINT_HEADER), false);
  });
});
