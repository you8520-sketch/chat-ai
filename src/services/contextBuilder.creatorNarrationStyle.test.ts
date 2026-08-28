import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import Module from "module";
import type { buildContext as BuildContextFn } from "@/services/contextBuilder";
import { OPENROUTER_QWEN_37_MAX_MODEL } from "@/lib/chatModels";
import type { CharacterChunk } from "@/types";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

let buildContext: typeof BuildContextFn;

before(async () => {
  ({ buildContext } = await import("@/services/contextBuilder"));
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

function sectionBody(built: ReturnType<typeof buildContext>, id: string): string {
  const section = (built.meta?.trackedSections ?? []).find((s) => s.id === id);
  assert.ok(section, `missing section ${id}`);
  return section!.text;
}

describe("creator narration style runtime injection", () => {
  it("empty style → no creator-style section (EMPTY_VALUE_ZERO_DIFF)", () => {
    const built = buildContext({
      charName: "Hero",
      chunks: [criticalChunk],
      userNickname: "User",
      shortTermHistory: [],
      nsfw: false,
      modelId: OPENROUTER_QWEN_37_MAX_MODEL,
      provider: "openrouter",
      currentUserMessage: "hello",
      creatorNarrationStyle: "",
    });
    const ids = (built.meta?.trackedSections ?? []).map((s) => s.id);
    assert.equal(ids.includes("creator-narration-style"), false);
    const proseCount = ids.filter((id) =>
      id === "prose-style-xml-bundle" || id === "rule-advanced-prose-nsfw"
    ).length;
    assert.equal(proseCount, 1);
  });

  it("nonempty style → section appears exactly once after common prose", () => {
    const note = "건조한 문장, 행동으로 감정 표현";
    const built = buildContext({
      charName: "Hero",
      chunks: [criticalChunk],
      userNickname: "User",
      shortTermHistory: [],
      nsfw: false,
      modelId: OPENROUTER_QWEN_37_MAX_MODEL,
      provider: "openrouter",
      currentUserMessage: "hello",
      creatorNarrationStyle: note,
    });
    const ids = (built.meta?.trackedSections ?? []).map((s) => s.id);
    const proseIdx = ids.findIndex(
      (id) => id === "prose-style-xml-bundle" || id === "rule-advanced-prose-nsfw"
    );
    const styleIdx = ids.indexOf("creator-narration-style");
    assert.ok(proseIdx >= 0);
    assert.ok(styleIdx > proseIdx);
    assert.equal(ids.filter((id) => id === "creator-narration-style").length, 1);
    const body = sectionBody(built, "creator-narration-style");
    assert.match(body, /건조한 문장/);
    assert.equal(body.split(note).length, 2);
    const styleSections = (built.meta?.trackedSections ?? []).filter(
      (s) => s.id === "creator-narration-style"
    );
    assert.equal(styleSections.length, 1);
  });
});
