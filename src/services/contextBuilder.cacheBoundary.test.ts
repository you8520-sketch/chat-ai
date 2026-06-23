import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildContext } from "./contextBuilder";
import { OPENROUTER_QWEN_37_MAX_MODEL } from "@/lib/chatModels";
import { estimateTokens } from "@/lib/tokenEstimate";
import { buildOpenRouterCachedSystemContent } from "@/lib/openRouterCache";
import type { CharacterChunk } from "@/types";

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

    assert.match(split!.characterSettingsBlock, /PROSE_STYLE|<PROSE_STYLE_POLICY>/);
    assert.match(split!.dynamicBlock, /유저노트 확장구간/);
    assert.doesNotMatch(split!.characterSettingsBlock, /유저노트 확장구간/);

    const blocks = buildOpenRouterCachedSystemContent(split!);
    assert.equal(blocks[0]?.cache_control?.type, "ephemeral");
    assert.equal(blocks[1]?.cache_control?.type, "ephemeral");
    assert.equal(blocks[2]?.cache_control, undefined);
    assert.match(blocks[1]!.text, /PROSE_STYLE|<PROSE_STYLE_POLICY>/);
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
    assert.ok(sectionOrder(ids, "turn-handoff-and-pacing") < sectionOrder(ids, "user-note-reference"));
    assert.ok(sectionOrder(ids, "user-note-reference") < sectionOrder(ids, "current-memory"));
    if (ids.includes("contextual-lore-rag")) {
      assert.ok(sectionOrder(ids, "current-memory") < sectionOrder(ids, "contextual-lore-rag"));
    }
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
    assert.ok(proseTokens > 5000, `expected prose+character cache block >5k tok, got ${proseTokens}`);
  });
});
