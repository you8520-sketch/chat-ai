import Module from "module";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import type { buildContext as BuildContextFn } from "./contextBuilder";
import { OPENROUTER_QWEN_37_MAX_MODEL } from "@/lib/chatModels";
import { buildOpenRouterCachedSystemContent } from "@/lib/openRouterCache";
import type { CharacterChunk } from "@/types";

let buildContext: typeof BuildContextFn;

before(async () => {
  ({ buildContext } = await import("./contextBuilder"));
});

const criticalChunk: CharacterChunk = {
  id: "c-critical",
  characterId: "1",
  content: "[Identity]\nHero identity.",
  category: "identity",
  importance: "CRITICAL",
  tokenCount: 10,
  keywords: ["hero"],
};

function countOccurrences(text: string, needle: string): number {
  let count = 0;
  let idx = 0;
  while ((idx = text.indexOf(needle, idx)) !== -1) {
    count++;
    idx += needle.length;
  }
  return count;
}

describe("OpenRouter system prompt dedup", () => {
  it("systemPrompt matches API split join — each canonical rule once", () => {
    const built = buildContext({
      charName: "Hero",
      chunks: [criticalChunk],
      userNickname: "User",
      userPersona: "Test persona",
      shortTermHistory: [],
      currentUserMessage: "hello",
      nsfw: true,
      modelId: OPENROUTER_QWEN_37_MAX_MODEL,
      provider: "openrouter",
    });

    const split = built.openRouterSystemSplit;
    assert.ok(split);

    const fromSplit = [
      split!.systemRulesBlock,
      split!.characterSettingsBlock,
      split!.dynamicBlock,
    ]
      .map((part) => part.trim())
      .filter(Boolean)
      .join("\n\n");

    assert.equal(built.systemPrompt, fromSplit);

    assert.equal(countOccurrences(built.systemPrompt, "=== 설정 적용 우선순위 ==="), 1);
    assert.equal(countOccurrences(built.systemPrompt, "[IDENTITY_AND_RULES]"), 1);

    const apiBlocks = buildOpenRouterCachedSystemContent(split!);
    const apiText = apiBlocks.map((b) => b.text).join("\n\n");
    assert.equal(built.systemPrompt, apiText);
  });
});
