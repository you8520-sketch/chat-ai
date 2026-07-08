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
      sceneDirectiveBlock: "[이번 턴 장면 지시 - 비공개]\n모드: 일반 RP\n전개 방향: 관계 변화",
      episodicMemoryBlock: "[EPISODIC MEMORY - RETRIEVED FACTS]\n- [T4] 사용자는 커피를 좋아한다.",
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
        sectionOrder(ids, "episodic-memory-retrieved-facts")
    );
    assert.ok(
      sectionOrder(ids, "episodic-memory-retrieved-facts") <
        sectionOrder(ids, "relationship-meta")
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
      sectionOrder(ids, "user-note-reference") < sectionOrder(ids, "scene-directive")
    );
    assert.ok(
      sectionOrder(ids, "scene-directive") < sectionOrder(ids, "rule-length-control")
    );
    assert.ok(
      sectionOrder(ids, "rule-length-control") <
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
    assert.match(built.systemPrompt, /\[EPISODIC MEMORY - RETRIEVED FACTS\]/);
    assert.match(built.systemPrompt, /\[이번 턴 장면 지시 - 비공개\]/);
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

  it("preserves output length control markers and order during prompt cleanup", () => {
    const built = buildContext({
      charName: "Hero",
      chunks: [criticalChunk],
      userNickname: "User",
      shortTermHistory: [],
      currentUserMessage: "hello",
      nsfw: false,
      modelId: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
      provider: "openrouter",
      targetResponseChars: 3200,
    });

    const ids = (built.meta.trackedSections ?? []).map((s) => s.id);
    assert.ok(
      sectionOrder(ids, "rule-length-control") <
        sectionOrder(ids, "rule-output-layout-recency")
    );
    assert.ok(
      sectionOrder(ids, "rule-output-layout-recency") <
        sectionOrder(ids, "rule-terminal-length-override")
    );
    assert.equal((built.systemPrompt.match(/\[LENGTH CONTROL & SCENE EXPANSION\]/g) ?? []).length, 1);
    assert.equal((built.systemPrompt.match(/TARGET_LENGTH:/g) ?? []).length, 1);
    assert.equal((built.systemPrompt.match(/MINIMUM_FLOOR:/g) ?? []).length, 1);
    assert.equal((built.systemPrompt.match(/\[OUTPUT LAYOUT\]/g) ?? []).length, 1);
    assert.ok(
      built.systemPrompt.trimEnd().endsWith(
        (built.meta.trackedSections ?? []).find((s) => s.id === "rule-terminal-length-override")?.text.trim() ?? ""
      )
    );
  });

  it("omits episodic memory section when block is empty", () => {
    const built = buildContext({
      charName: "Hero",
      chunks: [criticalChunk],
      userNickname: "User",
      shortTermHistory: [],
      currentUserMessage: "hello",
      nsfw: false,
      episodicMemoryBlock: "",
    });

    assert.doesNotMatch(built.systemPrompt, /\[EPISODIC MEMORY - RETRIEVED FACTS\]/);
    assert.ok(
      !(built.meta.trackedSections ?? []).some((s) => s.id === "episodic-memory-retrieved-facts")
    );
  });

  it("injects triggered scenario events without raw trigger metadata", () => {
    const built = buildContext({
      charName: "Hero",
      chunks: [criticalChunk],
      userNickname: "User",
      shortTermHistory: [],
      currentUserMessage: "hello",
      nsfw: false,
      modelId: OPENROUTER_QWEN_37_MAX_MODEL,
      provider: "openrouter",
      triggeredScenarioEventsBlock: [
        "[TRIGGERED SCENARIO EVENTS]",
        "These events have just been triggered by backend scenario logic.",
        "Use only the revealed event text.",
        "",
        "* 봉인된 문장이 마침내 빛나기 시작한다.",
      ].join("\n"),
    });

    const ids = (built.meta.trackedSections ?? []).map((s) => s.id);
    assert.ok(ids.includes("triggered-scenario-events"));
    assert.match(built.systemPrompt, /봉인된 문장이 마침내 빛나기 시작한다\./);
    assert.doesNotMatch(built.systemPrompt, /d_day_zero/);
    assert.doesNotMatch(built.systemPrompt, /deadline_arrived/);
    assert.doesNotMatch(built.systemPrompt, /d_day\s*<=\s*0/);
  });

  it("uses speech_control only in the private speech section", () => {
    const built = buildContext({
      charName: "Hero",
      chunks: [criticalChunk],
      userNickname: "User",
      shortTermHistory: [],
      currentUserMessage: "hello",
      nsfw: false,
      modelId: OPENROUTER_QWEN_37_MAX_MODEL,
      provider: "openrouter",
      privateSpeechControlBlock: [
        "[PRIVATE SPEECH CONTROL - NOT STORY CONTENT]",
        "Use these speech/register controls silently.",
        "- 평소에는 다나까체, 단둘이 있을 때는 해요체를 사용한다.",
      ].join("\n"),
    });

    const privateSection = (built.meta.trackedSections ?? []).find(
      (section) => section.id === "private-speech-control"
    );
    const canonSection = (built.meta.trackedSections ?? []).find(
      (section) => section.id === "character-core-identity"
    );

    assert.ok(privateSection);
    assert.match(privateSection!.text, /PRIVATE SPEECH CONTROL/);
    assert.match(privateSection!.text, /해요체|다나까체/);
    assert.ok(canonSection);
    assert.doesNotMatch(canonSection!.text, /해요체|다나까체/);
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
