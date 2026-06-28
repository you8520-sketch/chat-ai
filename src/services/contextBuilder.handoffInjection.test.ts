import Module from "module";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import type { buildContext as BuildContextFn } from "./contextBuilder";
import { buildTurnHandoffAndPacingBlock } from "@/lib/turnHandoffAndPacing";
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

function countFullHandoffBlocks(prompt: string): number {
  const handoff = buildTurnHandoffAndPacingBlock();
  let fullBlocks = 0;
  let idx = 0;
  while ((idx = prompt.indexOf(handoff, idx)) !== -1) {
    fullBlocks++;
    idx += handoff.length;
  }
  return fullBlocks;
}

function listCrossRefSections(
  built: ReturnType<typeof buildContext>
): { id: string; refs: number }[] {
  const handoff = buildTurnHandoffAndPacingBlock();
  return (built.meta?.trackedSections ?? [])
    .map((s) => {
      const inSection = (s.text.match(/<TURN_HANDOFF_AND_PACING>/g) ?? []).length;
      const fullInSection = s.text.includes(handoff) ? 1 : 0;
      return { id: s.id, refs: inSection - fullInSection };
    })
    .filter((s) => s.refs > 0);
}

describe("buildContext — TURN_HANDOFF_AND_PACING injection", () => {
  it("OpenRouter: exactly one full handoff block (cross-refs elsewhere OK)", () => {
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

    assert.equal(countFullHandoffBlocks(built.systemPrompt), 1);
    assert.equal(
      (built.systemPrompt.match(/<\/TURN_HANDOFF_AND_PACING>/g) ?? []).length,
      1
    );
    assert.ok(!built.systemPrompt.includes("SCENE_PROGRESSION_&_NARRATION_PARAGRAPH_FLOOR"));
    assert.ok(!built.systemPrompt.includes("[ANTI-RESOLUTION RULE]\nDo NOT resolve"));
  });

  it("Gemini: exactly one full handoff block", () => {
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
    assert.equal(countFullHandoffBlocks(built.systemPrompt), 1);
  });

  it("auto-continue / co-narration / novel: still one full block", () => {
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
      assert.equal(
        countFullHandoffBlocks(built.systemPrompt),
        1,
        `${label}: expected one full handoff block`
      );
    }
  });

  it("documents cross-reference sections (not duplicate blocks)", () => {
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
    const crossRefs = listCrossRefSections(built);
    assert.ok(crossRefs.length > 0, "expected pointer cross-refs in other sections");
    assert.ok(
      crossRefs.every((s) => s.id !== "turn-handoff-and-pacing"),
      "canonical block section should not count as cross-ref only"
    );
  });
});
