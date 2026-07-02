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
import { OPENROUTER_QWEN_37_MAX_MODEL, GEMINI_CHAT_FLASH_25 } from "@/lib/chatModels";
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
    assert.ok(built.systemPrompt.includes("[SCENE CONTINUATION PRIORITY]"));
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
    const tail = buildCompactTerminalLengthAbsoluteTail(undefined);
    assert.ok(lastUser!.content.includes(tail), "OpenRouter continue gets 10b user-turn tail");
    assert.match(lastUser!.content, /단일 응답 최대 전개·미달 조기 종료 금지\.$/);
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
});

function countFullHandoffBlocks(prompt: string): number {
  return (prompt.match(/<TURN_HANDOFF_AND_PACING>/g) ?? []).length;
}
