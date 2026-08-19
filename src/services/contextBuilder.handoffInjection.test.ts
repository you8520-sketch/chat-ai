import Module from "module";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import type { buildContext as BuildContextFn } from "./contextBuilder";
import { buildCompactTerminalLengthAbsoluteTail } from "@/lib/responseLength";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  OPENROUTER_QWEN_37_MAX_MODEL,
  GEMINI_CHAT_FLASH_25,
} from "@/lib/chatModels";
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

describe("buildContext — turn handoff shell removed Step 7", () => {
  it("OpenRouter: no TURN_HANDOFF_AND_PACING wrapper in system prompt", () => {
    const built = buildContext({
      charName: "Test",
      chunks: [sampleChunk],
      userNickname: "User",
      shortTermHistory: [],
      currentUserMessage: "hello",
      nsfw: true,
      modelId: OPENROUTER_QWEN_37_MAX_MODEL,
      provider: "openrouter",
    });

    assert.equal(countFullHandoffBlocks(built.systemPrompt), 0);
    assert.ok(!built.systemPrompt.includes("<TURN_HANDOFF_AND_PACING>"));
    assert.ok(!built.systemPrompt.includes("[SCENE CONTINUATION PRIORITY]"));
    assert.doesNotMatch(built.systemPrompt, /3,200~4,200자|4200/);
    const lastUser = built.history[built.history.length - 1];
    assert.equal(lastUser?.role, "user");
    assert.match(lastUser!.content, /3,200자 이상을 기본 목표로/);
    assert.doesNotMatch(lastUser!.content, /3,200~4,200자|4200/);
    assert.ok(!built.systemPrompt.includes("SCENE_PROGRESSION_&_NARRATION_PARAGRAPH_FLOOR"));
    assert.ok(!built.systemPrompt.includes("[ANTI-RESOLUTION RULE]\nDo NOT resolve"));
  });

  it("Gemini: no handoff wrapper", () => {
    const built = buildContext({
      charName: "Test",
      chunks: [sampleChunk],
      userNickname: "User",
      shortTermHistory: [],
      currentUserMessage: "hello",
      nsfw: false,
      modelId: GEMINI_CHAT_FLASH_25,
      provider: "gemini",
    });
    assert.ok(!built.systemPrompt.includes("<TURN_HANDOFF_AND_PACING>"));
  });

  it("auto-continue / co-narration / novel: still no handoff wrapper", () => {
    for (const [label, extra] of [
      ["auto-continue", { isContinue: true, nsfw: true }],
      ["co-narration", { impersonationOn: true, nsfw: false }],
      ["novel", { novelModeEnabled: true, nsfw: false }],
    ] as const) {
      const built = buildContext({
        charName: "Test",
        chunks: [sampleChunk],
        userNickname: "User",
        shortTermHistory: [],
        currentUserMessage: "hello",
        modelId: OPENROUTER_QWEN_37_MAX_MODEL,
        provider: "openrouter",
        ...extra,
      });
      assert.ok(
        !built.systemPrompt.includes("<TURN_HANDOFF_AND_PACING>"),
        `${label}: handoff wrapper must be absent`
      );
    }
  });

  it("OpenRouter auto-continue: user-bottom compact length tail (10b)", () => {
    const built = buildContext({
      charName: "Test",
      chunks: [sampleChunk],
      userNickname: "User",
      shortTermHistory: [],
      currentUserMessage: "[SYSTEM DIRECTIVE: CONTINUE THE NARRATIVE]",
      nsfw: true,
      isContinue: true,
      modelId: OPENROUTER_QWEN_37_MAX_MODEL,
      provider: "openrouter",
    });
    const lastUser = built.history[built.history.length - 1];
    assert.equal(lastUser?.role, "user");
    // Length owned by user-turn tail; layout precedes length owner sentence.
    assert.match(lastUser!.content, /지문과 "…" 대사 사이 빈 줄/);
    assert.doesNotMatch(lastUser!.content, /TARGET_LENGTH|MINIMUM_FLOOR|미달 조기 종료/);
    assert.equal(buildCompactTerminalLengthAbsoluteTail(undefined), "");
  });

  it("no turn-handoff-and-pacing tracked section", () => {
    const built = buildContext({
      charName: "Test",
      chunks: [sampleChunk],
      userNickname: "User",
      shortTermHistory: [],
      currentUserMessage: "hello",
      nsfw: true,
      modelId: OPENROUTER_QWEN_37_MAX_MODEL,
      provider: "openrouter",
    });
    const ids = (built.meta?.trackedSections ?? []).map((s) => s.id);
    assert.ok(!ids.includes("turn-handoff-and-pacing"));
    assert.ok(!ids.includes("auto-continue-handoff-hint"));
  });

  it("hard-caps already-selected adult handoff RAW instead of replaying it unbounded", () => {
    const longAssistant = "장면의 위치와 미완료 행동을 이어 간다. ".repeat(260);
    const shortTermHistory = Array.from({ length: 5 }, (_, index) => [
      { role: "user" as const, content: `완전한 user 왕복 ${index}` },
      { role: "assistant" as const, content: longAssistant },
    ]).flat();
    const built = buildContext({
      charName: "Test",
      chunks: [sampleChunk],
      userNickname: "User",
      shortTermHistory,
      currentUserMessage: "현재 입력",
      nsfw: true,
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      provider: "cheaperinference",
      preserveAdultHandoffRawHistory: true,
    });
    const priorHistory = built.history.slice(0, -1);
    assert.ok(priorHistory.length < shortTermHistory.length);
    assert.ok(priorHistory.length >= 8);
    assert.equal(priorHistory.length % 2, 0);
    assert.ok(built.history.filter((message) => message.role === "assistant").length <= 4);
    assert.match(built.history.at(-1)?.content ?? "", /현재 입력/);
  });
});

function countFullHandoffBlocks(prompt: string): number {
  return (prompt.match(/<TURN_HANDOFF_AND_PACING>/g) ?? []).length;
}
