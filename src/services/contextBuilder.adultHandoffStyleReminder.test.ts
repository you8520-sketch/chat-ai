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
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
} from "@/lib/chatModels";
import {
  DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY,
} from "@/lib/deepseekPromptStructure";
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

const t1Assistant = "T1 persisted visible assistant exemplar text.";
const t2Assistant = "T2 persisted visible assistant exemplar text.";

describe("buildContext — adult handoff DeepSeek style reminder (H1)", () => {
  it("native DeepSeek still receives DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY", () => {
    const built = buildContext({
      charName: "Test",
      chunks: [sampleChunk],
      userNickname: "User",
      shortTermHistory: [],
      currentUserMessage: "현재 사용자 입력",
      nsfw: true,
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      provider: "cheaperinference",
    });
    const lastUser = built.history.at(-1)?.content ?? "";
    assert.ok(lastUser.startsWith(DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY.slice(0, 40)));
    assert.ok(lastUser.includes("현재 사용자 입력"));
  });

  it("normal non-handoff DeepSeek still receives the style reminder", () => {
    const built = buildContext({
      charName: "Test",
      chunks: [sampleChunk],
      userNickname: "User",
      shortTermHistory: [
        { role: "user", content: "u1" },
        { role: "assistant", content: t1Assistant },
      ],
      currentUserMessage: "현재 사용자 입력",
      nsfw: true,
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      provider: "cheaperinference",
      preserveAdultHandoffRawHistory: false,
      suppressDeepSeekStyleReminderForAdultHandoff: false,
    });
    const lastUser = built.history.at(-1)?.content ?? "";
    assert.ok(lastUser.includes(DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY.slice(0, 40)));
  });

  it("adult handoff DeepSeek does NOT receive the style reminder when suppressed", () => {
    const built = buildContext({
      charName: "Test",
      chunks: [sampleChunk],
      userNickname: "User",
      shortTermHistory: [
        { role: "user", content: "u1" },
        { role: "assistant", content: t1Assistant },
        { role: "user", content: "u2" },
        { role: "assistant", content: t2Assistant },
      ],
      currentUserMessage: "현재 사용자 입력",
      nsfw: true,
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      provider: "cheaperinference",
      preserveAdultHandoffRawHistory: true,
      suppressDeepSeekStyleReminderForAdultHandoff: true,
    });
    const lastUser = built.history.at(-1)?.content ?? "";
    assert.equal(lastUser.includes(DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY), false);
    assert.ok(lastUser.includes("현재 사용자 입력"));
    assert.ok(lastUser.includes(USER_TAIL_LENGTH_OWNER_SENTENCE.slice(0, 40)));
  });

  it("preserves T1/T2 assistant history bytes when suppressing handoff reminder", () => {
    const built = buildContext({
      charName: "Test",
      chunks: [sampleChunk],
      userNickname: "User",
      shortTermHistory: [
        { role: "user", content: "u1" },
        { role: "assistant", content: t1Assistant },
        { role: "user", content: "u2" },
        { role: "assistant", content: t2Assistant },
      ],
      currentUserMessage: "현재 사용자 입력",
      nsfw: true,
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      provider: "cheaperinference",
      preserveAdultHandoffRawHistory: true,
      suppressDeepSeekStyleReminderForAdultHandoff: true,
    });
    const assistants = built.history.filter((m) => m.role === "assistant").map((m) => m.content);
    assert.equal(assistants[0], t1Assistant);
    assert.equal(assistants[1], t2Assistant);
  });

  it("Gemini primary path is unchanged by the suppress flag (not DeepSeek XML mode)", () => {
    const built = buildContext({
      charName: "Test",
      chunks: [sampleChunk],
      userNickname: "User",
      shortTermHistory: [],
      currentUserMessage: "hello",
      nsfw: true,
      modelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      provider: "cheaperinference",
      suppressDeepSeekStyleReminderForAdultHandoff: true,
    });
    const lastUser = built.history.at(-1)?.content ?? "";
    assert.equal(lastUser.includes(DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY), false);
    assert.ok(lastUser.includes("hello"));
  });
});
