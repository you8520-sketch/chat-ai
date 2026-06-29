import Module from "module";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OPENROUTER_QWEN_37_MAX_MODEL, OPENROUTER_DEEPSEEK_V4_PRO_MODEL } from "@/lib/chatModels";
import type { CharacterChunk } from "@/types";

const ENGLISH_SETTING_KOREAN_OUTPUT_RULE =
  "[LANGUAGE RULE] Regardless of the language of the character's settings, prompt, or lorebook, you MUST generate all responses, narratives, and dialogue entirely in Korean (Natural Korean Webnovel Style).";

const sampleChunk: CharacterChunk = {
  id: "c-chunk-0",
  characterId: "1",
  content: "[Identity]\nTest character.",
  category: "identity",
  importance: "CRITICAL",
  tokenCount: 10,
  keywords: ["test"],
};

describe("buildContext — English character settings", () => {
  it("injects Korean output language rule when useEnglishCharacterPrompt is true", async () => {
    const { buildContext } = await import("./contextBuilder");
    const built = buildContext({
      charName: "Test",
      chunks: [sampleChunk],
      userNickname: "User",
      shortTermHistory: [],
      currentUserMessage: "hello",
      nsfw: false,
      useEnglishCharacterPrompt: true,
    });
    assert.ok(built.systemPrompt.includes(ENGLISH_SETTING_KOREAN_OUTPUT_RULE));
  });

  it("omits English-setting language rule for Korean-only prompts", async () => {
    const { buildContext } = await import("./contextBuilder");
    const built = buildContext({
      charName: "Test",
      chunks: [sampleChunk],
      userNickname: "User",
      shortTermHistory: [],
      currentUserMessage: "hello",
      nsfw: false,
      useEnglishCharacterPrompt: false,
    });
    assert.ok(!built.systemPrompt.includes(ENGLISH_SETTING_KOREAN_OUTPUT_RULE));
  });

  it("injects bilingual dialogue blocks when creator sets [BILINGUAL: zh+ko]", async () => {
    const { buildContext } = await import("./contextBuilder");
    const built = buildContext({
      charName: "Test",
      chunks: [sampleChunk],
      userNickname: "User",
      shortTermHistory: [],
      currentUserMessage: "hello",
      nsfw: false,
      provider: "openrouter",
      systemPrompt: "[BILINGUAL DIALOGUE: zh+ko] 北京出身.",
    });
    assert.equal(built.meta.bilingualDialogue, true);
    assert.ok(built.systemPrompt.includes("[BILINGUAL DIALOGUE — creator setting override]"));
    assert.ok(built.systemPrompt.includes("中文"));
    assert.ok(built.systemPrompt.includes("OUTPUT LANG — BILINGUAL DIALOGUE"));
    assert.ok(built.systemPrompt.includes("외국어 혼용 금지"));
    assert.ok(built.systemPrompt.includes("[NO MIXED-SCRIPT WORDS]"));
    assert.ok(built.systemPrompt.includes("[NO META WRITING]"));
    assert.ok(!built.systemPrompt.includes("100% Korean in narration"));
    assert.ok(!built.systemPrompt.includes("No English stem + Korean inflection"));
    assert.ok(!built.systemPrompt.includes("[NO FOREIGN LANGUAGE MIXING]"));
  });

  it("injects unified OUTPUT LANG and foreign-mixing rule for OpenRouter Korean-only", async () => {
    const { buildContext } = await import("./contextBuilder");
    const built = buildContext({
      charName: "Test",
      chunks: [sampleChunk],
      userNickname: "User",
      shortTermHistory: [],
      currentUserMessage: "hello",
      nsfw: false,
      provider: "openrouter",
    });
    assert.ok(built.systemPrompt.includes("[OUTPUT LANG]"));
    assert.ok(built.systemPrompt.includes("한국어 웹소설 문체"));
    assert.ok(!built.systemPrompt.includes("100% Korean"));
    assert.ok(!built.systemPrompt.includes("[LANG · CRITICAL]"));
    assert.ok(!built.systemPrompt.includes("No English stem + Korean inflection"));
    assert.ok(!built.systemPrompt.includes("[NO KONGLISH HYBRID]"));
    assert.ok(!built.systemPrompt.includes("[NO HANJA SUBSTITUTION]"));
    assert.ok(!built.systemPrompt.includes("[NO FOREIGN LANGUAGE MIXING]"));
    assert.ok(built.systemPrompt.includes("외국어 혼용 금지"));
    assert.ok(built.systemPrompt.includes("[NO MIXED-SCRIPT WORDS]"));
    assert.ok(built.systemPrompt.includes("[NO META WRITING]"));
  });

  it("injects foreign-mixing rule for all OpenRouter models (Qwen and DeepSeek)", async () => {
    const { buildContext } = await import("./contextBuilder");
    for (const modelId of [OPENROUTER_QWEN_37_MAX_MODEL, OPENROUTER_DEEPSEEK_V4_PRO_MODEL]) {
      const built = buildContext({
        charName: "Test",
        chunks: [sampleChunk],
        userNickname: "User",
        shortTermHistory: [],
        currentUserMessage: "hello",
        nsfw: false,
        provider: "openrouter",
        modelId,
      });
      assert.ok(
        built.systemPrompt.includes("외국어 혼용 금지"),
        `expected foreign-mixing rule inline for ${modelId}`
      );
    }
  });

  it("omits OpenRouter foreign-mixing rule for Gemini provider", async () => {
    const { buildContext } = await import("./contextBuilder");
    const built = buildContext({
      charName: "Test",
      chunks: [sampleChunk],
      userNickname: "User",
      shortTermHistory: [],
      currentUserMessage: "hello",
      nsfw: false,
      provider: "gemini",
    });
    assert.ok(!built.systemPrompt.includes("[NO FOREIGN LANGUAGE MIXING]"));
  });
});
