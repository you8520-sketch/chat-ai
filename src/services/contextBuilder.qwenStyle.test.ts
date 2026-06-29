import Module from "module";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";

import { describe, it, before } from "node:test";

import type { buildContext as BuildContextFn } from "./contextBuilder";

import { OPENROUTER_KOREAN_PROSE_TOP_BLOCK } from "@/lib/openRouterProsePolicy";

import { KOREAN_WEBNOVEL_STYLE_BLOCK } from "@/lib/writingStylePreset";

import { buildNarrativeStyleLayer } from "@/lib/narrativeStyle";

import { buildTurnHandoffAndPacingBlock } from "@/lib/turnHandoffAndPacing";

import { OPENROUTER_QWEN_37_MAX_MODEL } from "@/lib/chatModels";

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



describe("buildContext — Qwen OpenRouter prose rules", () => {

  it("injects unified prose style XML bundle for Qwen3.7 Max", () => {

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



    assert.ok(built.systemPrompt.includes(OPENROUTER_KOREAN_PROSE_TOP_BLOCK));
    assert.ok(built.systemPrompt.includes("외국어 혼용 금지"));

    assert.ok(built.systemPrompt.includes("=== 설정 적용 우선순위 ==="));

    assert.ok(!built.systemPrompt.includes("<PROSE_STYLE_POLICY>"));
    assert.ok(built.systemPrompt.includes("[PROSE STYLE]"));

    assert.ok(built.systemPrompt.includes("[ADVANCED PROSE & NSFW GUIDELINES]"));
    assert.equal(
      (built.systemPrompt.match(/\[ADVANCED PROSE & NSFW GUIDELINES\]/g) ?? []).length,
      1
    );
    assert.equal(
      (built.systemPrompt.match(/\[PROSE STYLE\]/g) ?? []).length,
      1
    );
    assert.equal(
      (built.systemPrompt.match(/\[DIALOGUE & NARRATION\]/g) ?? []).length,
      1
    );

    assert.ok(built.systemPrompt.includes("[19+ INTIMACY]"));
    assert.ok(built.systemPrompt.includes("해부학적 명칭"));
    assert.ok(!built.systemPrompt.includes("Explicit Sensory Mode"));
    assert.ok(!built.systemPrompt.includes("=== 19+ 컨텍스트 ==="));
    assert.ok(!built.systemPrompt.includes("=== 19+ 플랫폼 컨텍스트 ==="));

    assert.ok(!built.systemPrompt.includes("<STYLE_REFERENCE>"));

    assert.ok(!built.systemPrompt.includes("[STYLE PRESET —"));

    const handoff = buildTurnHandoffAndPacingBlock();

    assert.ok(built.systemPrompt.includes(handoff));

    assert.equal(

      (() => {

        let n = 0;

        let i = 0;

        while ((i = built.systemPrompt.indexOf(handoff, i)) !== -1) {

          n++;

          i += handoff.length;

        }

        return n;

      })(),

      1

    );

    assert.ok(!built.systemPrompt.includes("SCENE_PROGRESSION_&_NARRATION_PARAGRAPH_FLOOR"));

    assert.ok(!built.systemPrompt.includes("[ANTI-RESOLUTION RULE]"));
    assert.ok(!built.systemPrompt.includes("[early_scene t="));
    assert.ok(!built.systemPrompt.match(/\[EARLY t=\d+\]/));

    const narrativeStyleSection = built.meta?.trackedSections?.find(
      (s) => s.id === "narrative-style"
    );
    // Format rules live in prose bundle — narrative-style is genre hints only when present
    assert.ok(!narrativeStyleSection || !narrativeStyleSection.text.includes("[PROSE STYLE]"));
    assert.ok(!buildNarrativeStyleLayer({ omitFormatRules: true }).includes(KOREAN_WEBNOVEL_STYLE_BLOCK));

  });

});

