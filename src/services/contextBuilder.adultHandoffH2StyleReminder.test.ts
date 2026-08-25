import Module from "module";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import type { buildContext as BuildContextFn } from "./contextBuilder";
import { CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL } from "@/lib/chatModels";
import {
  DEEPSEEK_BOTTOM_REMINDER_STYLE_HANDOFF,
  DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY,
  DEEPSEEK_PARAGRAPH_CONSOLIDATION_CLAUSE,
  DEEPSEEK_PROGRESSIVE_SCENE_CLAUSE,
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

describe("buildContext — adult handoff DeepSeek H2 style reminder", () => {
  it("native DeepSeek receives full DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY", () => {
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
    assert.ok(lastUser.includes(DEEPSEEK_PARAGRAPH_CONSOLIDATION_CLAUSE));
    assert.ok(lastUser.includes("현재 사용자 입력"));
  });

  it("normal non-handoff DeepSeek receives full style reminder", () => {
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
    });
    const lastUser = built.history.at(-1)?.content ?? "";
    assert.ok(lastUser.includes(DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY.slice(0, 40)));
    assert.ok(lastUser.includes(DEEPSEEK_PARAGRAPH_CONSOLIDATION_CLAUSE));
  });

  it("adult handoff receives H2 reminder without consolidation clause", () => {
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
      useDeepSeekHandoffStyleReminder: true,
    });
    const lastUser = built.history.at(-1)?.content ?? "";
    assert.ok(lastUser.startsWith(DEEPSEEK_BOTTOM_REMINDER_STYLE_HANDOFF.slice(0, 40)));
    assert.equal(lastUser.includes(DEEPSEEK_PARAGRAPH_CONSOLIDATION_CLAUSE), false);
    assert.ok(lastUser.includes(DEEPSEEK_PROGRESSIVE_SCENE_CLAUSE));
    assert.ok(lastUser.includes("현재 사용자 입력"));
    assert.ok(lastUser.includes(USER_TAIL_LENGTH_OWNER_SENTENCE.slice(0, 40)));
  });

  it("adult handoff does not receive full reminder when H2 flag is set", () => {
    const built = buildContext({
      charName: "Test",
      chunks: [sampleChunk],
      userNickname: "User",
      shortTermHistory: [],
      currentUserMessage: "현재 사용자 입력",
      nsfw: true,
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      provider: "cheaperinference",
      preserveAdultHandoffRawHistory: true,
      useDeepSeekHandoffStyleReminder: true,
    });
    const lastUser = built.history.at(-1)?.content ?? "";
    assert.equal(
      lastUser.startsWith(DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY),
      false
    );
    assert.ok(lastUser.startsWith(DEEPSEEK_BOTTOM_REMINDER_STYLE_HANDOFF.slice(0, 40)));
  });

  it("T1/T2 raw history is unchanged under H2 handoff flag", () => {
    const history = [
      { role: "user" as const, content: "u1" },
      { role: "assistant" as const, content: t1Assistant },
      { role: "user" as const, content: "u2" },
      { role: "assistant" as const, content: t2Assistant },
    ];
    const built = buildContext({
      charName: "Test",
      chunks: [sampleChunk],
      userNickname: "User",
      shortTermHistory: history,
      currentUserMessage: "현재 사용자 입력",
      nsfw: true,
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      provider: "cheaperinference",
      preserveAdultHandoffRawHistory: true,
      useDeepSeekHandoffStyleReminder: true,
    });
    const prior = built.history.slice(0, -1);
    assert.deepEqual(prior, history);
  });
});
