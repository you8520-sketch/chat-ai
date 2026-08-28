import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CharacterCreateDraft } from "@/lib/characterCreateDraft";
import {
  buildCreatorNarrationStyleBlock,
  effectivePromptAuthoringCharCount,
  NARRATION_STYLE_INSTRUCTIONS_LIMIT,
  normalizeNarrationStyleInstructions,
  substantiveAiLearningCharCount,
  validateNarrationStyleInstructions,
} from "./creatorNarrationStyle";

function draftNarrationStyleInstructions(draft: CharacterCreateDraft): string {
  return draft.form.narration_style_instructions ?? "";
}

describe("creatorNarrationStyle", () => {
  it("empty accepted and produces no block", () => {
    assert.equal(normalizeNarrationStyleInstructions(""), "");
    assert.equal(normalizeNarrationStyleInstructions("   "), "");
    assert.equal(buildCreatorNarrationStyleBlock(""), "");
    assert.equal(buildCreatorNarrationStyleBlock("   "), "");
  });

  it("300 accepted and 301 rejected", () => {
    const ok = "가".repeat(300);
    const over = "가".repeat(301);
    assert.equal(validateNarrationStyleInstructions(ok), null);
    assert.equal(validateNarrationStyleInstructions(over)?.includes("300"), true);
  });

  it("nonempty style block appears once with hierarchy wrapper", () => {
    const block = buildCreatorNarrationStyleBlock("3인칭 제한 시점");
    assert.match(block, /refinement only/i);
    assert.match(block, /Platform prose/i);
    assert.match(block, /3인칭 제한 시점/);
    assert.equal(block.split("3인칭 제한 시점").length, 2);
  });

  it("old local draft without field loads as empty", () => {
    const legacy = {
      savedAt: Date.now(),
      form: {
        name: "Legacy",
        tagline: "",
        description: "",
        greeting: "",
        system_prompt: "",
        world: "",
        speech_personality: "",
        speech_traits: "",
        speech_examples: "",
        speech_forbidden: "",
        status_window_prompt: "",
        genres: [],
        tags: [],
        nsfw: false,
        emoji: "",
        hue: 0,
        audience: "all",
        gender: "",
        visibility: "private",
        comments_enabled: true,
        creator_comment: "",
      },
      assets: [],
      selectedWorldRef: "",
      selectedLorebookId: "",
    } as CharacterCreateDraft;
    assert.equal(draftNarrationStyleInstructions(legacy), "");
  });

  it("new local draft preserves narration_style_instructions", () => {
    const draft = {
      savedAt: Date.now(),
      form: {
        name: "Draft",
        tagline: "",
        description: "",
        greeting: "",
        system_prompt: "",
        world: "",
        speech_personality: "",
        speech_traits: "",
        speech_examples: "",
        speech_forbidden: "",
        status_window_prompt: "",
        genres: [],
        tags: [],
        nsfw: false,
        emoji: "",
        hue: 0,
        audience: "all",
        gender: "",
        visibility: "private",
        comments_enabled: true,
        creator_comment: "",
        narration_style_instructions: "짧은 문장 위주",
      },
      assets: [],
      selectedWorldRef: "",
      selectedLorebookId: "",
    } as CharacterCreateDraft;
    assert.equal(draftNarrationStyleInstructions(draft), "짧은 문장 위주");
  });

  it("narration style counts toward max budget only", () => {
    const substantive = substantiveAiLearningCharCount({
      contentKind: "character",
      world: "w".repeat(1000),
      systemPrompt: "s".repeat(600),
      speechInput: {
        speech_personality: "p".repeat(100),
        speech_traits: "",
        speech_examples: "",
        speech_forbidden: "",
        speech_contextual_registers: [],
      },
    });
    assert.equal(substantive, 1700);
    assert.equal(
      effectivePromptAuthoringCharCount(substantive, "가".repeat(50)),
      1750
    );
    assert.equal(NARRATION_STYLE_INSTRUCTIONS_LIMIT, 300);
  });
});
