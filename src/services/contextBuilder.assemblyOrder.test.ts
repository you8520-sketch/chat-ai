import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildContext } from "./contextBuilder";
import {
  OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
  OPENROUTER_QWEN_37_MAX_MODEL,
  GEMINI_CHAT_FLASH_25,
} from "@/lib/chatModels";
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
  assert.ok(idx >= 0, `missing section ${id} in [${ids.join(", ")}]`);
  return idx;
}

describe("buildContext — persona-before-prose assembly order", () => {
  it("OpenRouter: CRITICAL and Lore precede prose style and memory", () => {
    const built = buildContext({
      charName: "Hero",
      chunks: [criticalChunk, loreChunk],
      userNickname: "User",
      shortTermHistory: [],
      nsfw: true,
      longTermMemory: "They met yesterday.",
      userNote: `${"x".repeat(1001)}\nNPC 엘라라는 마법사다.\n\nreference tail for creator`,
      modelId: OPENROUTER_QWEN_37_MAX_MODEL,
      provider: "openrouter",
      currentUserMessage: "hello 엘라라",
    });

    const ids = (built.meta?.trackedSections ?? []).map((s) => s.id);
    assert.ok(
      sectionOrder(ids, "chunk-critical-c-critical") <
        sectionOrder(ids, "chunk-lore-c-lore")
    );
    assert.ok(
      sectionOrder(ids, "chunk-lore-c-lore") < sectionOrder(ids, "prose-style-xml-bundle")
    );
    assert.ok(
      sectionOrder(ids, "prose-style-xml-bundle") <
        sectionOrder(ids, "turn-handoff-and-pacing")
    );
    assert.ok(
      sectionOrder(ids, "turn-handoff-and-pacing") < sectionOrder(ids, "current-memory")
    );
    assert.ok(
      sectionOrder(ids, "user-note-reference") < sectionOrder(ids, "current-memory")
    );

    const split = built.openRouterSystemSplit;
    assert.ok(split);
    assert.match(split!.characterSettingsBlock, /<PROSE_STYLE_POLICY>\n/);
    assert.doesNotMatch(split!.systemRulesBlock, /<PROSE_STYLE_POLICY>\n/);
  });

  it("DeepSeek: character sections tracked before prose style", () => {
    const built = buildContext({
      charName: "Hero",
      chunks: [criticalChunk, loreChunk],
      userNickname: "User",
      shortTermHistory: [],
      currentUserMessage: "hello",
      nsfw: false,
      modelId: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
      provider: "openrouter",
    });

    const ids = (built.meta?.trackedSections ?? []).map((s) => s.id);
    assert.ok(
      sectionOrder(ids, "chunk-critical-c-critical") <
        sectionOrder(ids, "prose-style-xml-bundle")
    );
    assert.ok(built.systemPrompt.includes("<PERSONA>"));
    assert.ok(built.systemPrompt.includes("Hero identity."));
  });

  it("Gemini: character chunks precede advanced prose guidelines", () => {
    const built = buildContext({
      charName: "Hero",
      chunks: [criticalChunk, loreChunk],
      userNickname: "User",
      shortTermHistory: [],
      currentUserMessage: "hello",
      nsfw: true,
      modelId: GEMINI_CHAT_FLASH_25,
      provider: "gemini",
    });

    const ids = (built.meta?.trackedSections ?? []).map((s) => s.id);
    assert.ok(
      sectionOrder(ids, "chunk-critical-c-critical") <
        sectionOrder(ids, "rule-advanced-prose-nsfw")
    );
    assert.match(built.systemPrompt, /\[ADVANCED PROSE & NSFW GUIDELINES\]/);
  });
});
