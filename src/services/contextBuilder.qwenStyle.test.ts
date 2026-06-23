import assert from "node:assert/strict";

import { describe, it } from "node:test";

import { buildContext } from "./contextBuilder";

import { OPENROUTER_KOREAN_PROSE_TOP_BLOCK } from "@/lib/openRouterProsePolicy";

import { KOREAN_WEBNOVEL_STYLE } from "@/lib/writingStylePreset";

import { buildNarrativeStyleLayer } from "@/lib/narrativeStyle";

import { buildTurnHandoffAndPacingBlock } from "@/lib/turnHandoffAndPacing";

import { OPENROUTER_QWEN_37_MAX_MODEL } from "@/lib/chatModels";

import type { CharacterChunk } from "@/types";



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
    assert.ok(built.systemPrompt.includes("[NO FOREIGN LANGUAGE MIXING]"));

    assert.ok(built.systemPrompt.includes("=== 설정 적용 우선순위 (필독) ==="));

    assert.ok(built.systemPrompt.includes("<PROSE_STYLE_POLICY>"));

    assert.ok(built.systemPrompt.includes(KOREAN_WEBNOVEL_STYLE));

    assert.ok(built.systemPrompt.includes("[ADVANCED PROSE & NSFW GUIDELINES]"));

    assert.ok(built.systemPrompt.includes("Explicit Sensory Mode"));
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
    assert.match(built.systemPrompt, /\[EARLY t=\d+\]/);



    const narrativeStyleSection = built.meta?.trackedSections?.find(

      (s) => s.id === "narrative-style"

    );

    assert.ok(narrativeStyleSection);

    assert.ok(!narrativeStyleSection.text.includes(KOREAN_WEBNOVEL_STYLE));

    assert.ok(!buildNarrativeStyleLayer({ omitFormatRules: true }).includes(KOREAN_WEBNOVEL_STYLE));

  });

});

