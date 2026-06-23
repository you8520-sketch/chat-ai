import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildContext } from "./contextBuilder";
import { ENGLISH_SETTING_KOREAN_OUTPUT_RULE } from "@/lib/promptTranslation";
import { OPENROUTER_QWEN_37_MAX_MODEL, OPENROUTER_DEEPSEEK_V4_PRO_MODEL } from "@/lib/chatModels";
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

describe("buildContext — English character settings", () => {
  it("injects Korean output language rule when useEnglishCharacterPrompt is true", () => {
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

  it("omits English-setting language rule for Korean-only prompts", () => {
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

  it("injects bilingual dialogue blocks when creator sets [BILINGUAL: zh+ko]", () => {
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
    assert.ok(built.systemPrompt.includes("[LANG · CRITICAL — BILINGUAL DIALOGUE EXCEPTION]"));
    assert.ok(built.systemPrompt.includes("[NO FOREIGN LANGUAGE MIXING]"));
  });

  it("injects LANG CRITICAL and foreign-mixing rule for OpenRouter Korean-only", () => {
    const built = buildContext({
      charName: "Test",
      chunks: [sampleChunk],
      userNickname: "User",
      shortTermHistory: [],
      currentUserMessage: "hello",
      nsfw: false,
      provider: "openrouter",
    });
    assert.ok(built.systemPrompt.includes("[LANG · CRITICAL]"));
    assert.ok(built.systemPrompt.includes("[NO FOREIGN LANGUAGE MIXING]"));
    assert.ok(!built.systemPrompt.includes("[NO KONGLISH HYBRID]"));
    assert.ok(!built.systemPrompt.includes("[NO HANJA SUBSTITUTION]"));
    assert.match(built.systemPrompt, /영어어간\+한국어어미 굴절/);
    assert.match(built.systemPrompt, /独占\/愛\/死/);
  });

  it("injects foreign-mixing rule for all OpenRouter models (Qwen and DeepSeek)", () => {
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
        built.systemPrompt.includes("[NO FOREIGN LANGUAGE MIXING]"),
        `expected foreign-mixing rule for ${modelId}`
      );
    }
  });

  it("omits OpenRouter foreign-mixing rule for Gemini provider", () => {
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
