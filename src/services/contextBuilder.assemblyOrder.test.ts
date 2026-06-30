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
  OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
  OPENROUTER_QWEN_37_MAX_MODEL,
  GEMINI_CHAT_FLASH_25,
} from "@/lib/chatModels";
import type { CharacterChunk } from "@/types";
import { mergeUserNoteBodyFromEditor } from "@/lib/userNoteStatusWindow";

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
  assert.ok(idx >= 0, `missing section ${id} in [${ids.join(", ")}]`);
  return idx;
}

describe("buildContext — persona-before-prose assembly order", () => {
  it("OpenRouter: core identity precedes persona and prose; LTM then relationship then user-note RAG", () => {
    const built = buildContext({
      charName: "Hero",
      chunks: [criticalChunk, loreChunk],
      userNickname: "User",
      shortTermHistory: [],
      nsfw: true,
      longTermMemory: "They met yesterday.",
      memoryMeta: "Relationship: close friends.",
      userNote: mergeUserNoteBodyFromEditor(
        "x".repeat(500),
        "NPC 엘라라는 마법사다.\n\nreference tail for creator"
      ),
      modelId: OPENROUTER_QWEN_37_MAX_MODEL,
      provider: "openrouter",
      currentUserMessage: "hello 엘라라",
    });

    const ids = (built.meta?.trackedSections ?? []).map((s) => s.id);
    assert.ok(
      sectionOrder(ids, "character-knowledge-boundary") <
        sectionOrder(ids, "character-core-identity")
    );
    assert.ok(
      sectionOrder(ids, "character-core-identity") <
        sectionOrder(ids, "identity-and-rules")
    );
    assert.ok(
      sectionOrder(ids, "identity-and-rules") <
        sectionOrder(ids, "prose-style-xml-bundle")
    );
    assert.ok(
      sectionOrder(ids, "prose-style-xml-bundle") < sectionOrder(ids, "current-memory")
    );
    assert.ok(
      sectionOrder(ids, "current-memory") <
        sectionOrder(ids, "relationship-meta")
    );
    assert.ok(
      sectionOrder(ids, "relationship-meta") <
        sectionOrder(ids, "user-note-reference")
    );
    assert.ok(
      sectionOrder(ids, "turn-handoff-and-pacing") <
        sectionOrder(ids, "rule-output-layout-recency")
    );
    assert.ok(
      sectionOrder(ids, "rule-output-layout-recency") <
        sectionOrder(ids, "rule-terminal-length-override")
    );
    assert.ok(
      sectionOrder(ids, "current-memory") <
        sectionOrder(ids, "rule-terminal-length-override")
    );
    assert.ok(!ids.some((id) => id.startsWith("chunk-lore-")));

    const split = built.openRouterSystemSplit;
    assert.ok(split);
    assert.match(split!.characterSettingsBlock, /\[ADVANCED PROSE & NSFW GUIDELINES\]/);
    assert.match(split!.systemRulesBlock, /\[CHARACTER KNOWLEDGE BOUNDARY\]/);
    assert.match(built.systemPrompt, /\[CHARACTER CANON — Hero MAY KNOW/);
    assert.doesNotMatch(split!.characterSettingsBlock, /\[CORE IDENTITY\]/);
    assert.doesNotMatch(split!.systemRulesBlock, /<PROSE_STYLE_POLICY>/);

    assert.equal((built.systemPrompt.match(/\[OUTPUT LAYOUT\]/g) ?? []).length, 1);
    const layoutIdx = built.systemPrompt.indexOf("[OUTPUT LAYOUT]");
    const terminalIdx = built.systemPrompt.indexOf("TARGET_LENGTH 3,200+ · MINIMUM_FLOOR");
    assert.ok(layoutIdx >= 0 && terminalIdx > layoutIdx, "OUTPUT LAYOUT must precede terminal length tail");
    assert.doesNotMatch(split!.characterSettingsBlock, /NEVER append spoken dialogue/i);
    assert.doesNotMatch(split!.characterSettingsBlock, /ALWAYS starts a new paragraph/i);
  });

  it("DeepSeek: character core identity tracked before prose style", () => {
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
      sectionOrder(ids, "character-core-identity") <
        sectionOrder(ids, "prose-style-xml-bundle")
    );
    assert.ok(built.systemPrompt.includes("Hero identity."));
    assert.match(built.systemPrompt, /World lore detail\.|<WORLD_LORE>/i);
    assert.ok(!ids.includes("contextual-lore-rag"));
    assert.ok(!ids.includes("canonical-appearance-facts"));
    assert.match(built.systemPrompt, /WORLD_LORE|<world_lore>/i);
  });

  it("Gemini: core identity precedes advanced prose guidelines", () => {
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
      sectionOrder(ids, "character-core-identity") <
        sectionOrder(ids, "rule-advanced-prose-nsfw")
    );
    assert.match(built.systemPrompt, /\[ADVANCED PROSE & NSFW GUIDELINES\]/);
    assert.match(built.systemPrompt, /\[CHARACTER CANON — Hero MAY KNOW/);
  });
});
