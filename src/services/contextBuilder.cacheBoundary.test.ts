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
import { estimateTokens } from "@/lib/tokenEstimate";
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

const loreChunk: CharacterChunk = {
  id: "c-lore",
  characterId: "1",
  content: "World lore detail.",
  category: "world",
  importance: "CONTEXTUAL",
  tokenCount: 8,
  keywords: ["world"],
};

function sectionOrder(ids: string[], id: string): number {
  const idx = ids.indexOf(id);
  assert.ok(idx >= 0, `missing section ${id}`);
  return idx;
}

describe("OpenRouter cache boundaries", () => {
  it("keeps [1.4] Prose in cacheCharacter block, user-note RAG in dynamic only", () => {
    const built = buildContext({
      charName: "Hero",
      chunks: [criticalChunk, loreChunk],
      userNickname: "User",
      shortTermHistory: [],
      currentUserMessage: "hello 엘라라",
      nsfw: true,
      longTermMemory: "They met yesterday.",
      userNote: `${"x".repeat(1001)}\nNPC 엘라라는 마법사다.\n\nreference tail for creator`,
      contextualLore: "[RAG] matched lore snippet",
      modelId: OPENROUTER_QWEN_37_MAX_MODEL,
      provider: "openrouter",
    });

    const split = built.openRouterSystemSplit;
    assert.ok(split);

    assert.match(split!.characterSettingsBlock, /\[ADVANCED PROSE & NSFW GUIDELINES\]/);
    assert.match(split!.dynamicBlock, /유저노트 확장구간/);
    assert.doesNotMatch(split!.characterSettingsBlock, /유저노트 확장구간/);

    const blocks = buildOpenRouterCachedSystemContent(split!);
    assert.equal(blocks[0]?.cache_control?.type, "ephemeral");
    assert.equal(blocks[1]?.cache_control?.type, "ephemeral");
    assert.equal(blocks[2]?.cache_control, undefined);
    assert.match(blocks[1]!.text, /\[ADVANCED PROSE & NSFW GUIDELINES\]/);
    assert.match(blocks[2]!.text, /유저노트 확장구간/);
  });

  it("orders prose before volatile user-note RAG and memory in assembly", () => {
    const built = buildContext({
      charName: "Hero",
      chunks: [criticalChunk, loreChunk],
      userNickname: "User",
      shortTermHistory: [],
      currentUserMessage: "hello 엘라라",
      nsfw: true,
      longTermMemory: "They met yesterday.",
      userNote: `${"x".repeat(1001)}\nNPC 엘라라는 마법사다.\n\nreference tail for creator`,
      contextualLore: "[RAG] matched lore snippet",
      modelId: OPENROUTER_QWEN_37_MAX_MODEL,
      provider: "openrouter",
    });

    const ids = (built.meta?.trackedSections ?? []).map((s) => s.id);
    assert.ok(sectionOrder(ids, "prose-style-xml-bundle") < sectionOrder(ids, "user-note-reference"));
    assert.ok(sectionOrder(ids, "user-note-reference") < sectionOrder(ids, "current-memory"));
    assert.ok(sectionOrder(ids, "current-memory") < sectionOrder(ids, "contextual-lore-rag"));
  });

  it("characterSettingsBlock includes substantial prose policy tokens", () => {
    const built = buildContext({
      charName: "Hero",
      chunks: [criticalChunk, loreChunk],
      userNickname: "User",
      shortTermHistory: [],
      currentUserMessage: "hi",
      nsfw: true,
      modelId: OPENROUTER_QWEN_37_MAX_MODEL,
      provider: "openrouter",
    });

    const proseTokens = estimateTokens(built.openRouterSystemSplit!.characterSettingsBlock);
    assert.ok(proseTokens > 700, `expected prose+character cache block >700 tok, got ${proseTokens}`);
    assert.match(built.openRouterSystemSplit!.characterSettingsBlock, /\[ADVANCED PROSE & NSFW GUIDELINES\]/);
  });
});
