import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEEPSEEK_APPEARANCE_VARIATION_RULE,
  appearancePromptText,
  extractAppearanceRawFromSetting,
  hashAppearanceRaw,
  replaceAppearanceInSetting,
  clampAppearanceCompiledText,
  validateAppearanceCompiledJson,
} from "@/lib/appearanceCompiler";
import { buildContext } from "@/services/contextBuilder";
import { OPENROUTER_DEEPSEEK_V3_MODEL, OPENROUTER_DEEPSEEK_V4_PRO_MODEL, OPENROUTER_GEMINI_25_PRO_MODEL } from "@/lib/chatModels";

function baseContext(modelId: string) {
  return buildContext({
    charName: "하린",
    chunks: [{
      id: "c1",
      characterId: "1",
      content: "[외형]\n옅고 차분한 로즈 베이지빛 입술, 이마가 은은히 비치는 짧은 머리",
      category: "abilities",
      importance: "CRITICAL",
      tokenCount: 20,
      keywords: ["외형"],
    }],
    userNickname: "유저",
    shortTermHistory: [],
    currentUserMessage: "안녕",
    nsfw: false,
    modelId,
    provider: "openrouter",
  });
}

describe("appearanceCompiler", () => {
  it("extracts appearance_raw without requiring creator brackets", () => {
    assert.equal(extractAppearanceRawFromSetting("외형: MLBB 립스틱, 시스루 뱅\n성격: 차분함"), "MLBB 립스틱, 시스루 뱅");
  });

  it("uses compiled appearance only, falling back to raw", () => {
    const compiled = JSON.stringify({ body: "", hair: "가벼운 앞머리", eyes: "", face: "", lips_makeup: "차분한 로즈 베이지빛 입술", clothing: "", impression: "", compiled_text: "차분한 로즈 베이지빛 입술, 가벼운 앞머리" });
    assert.equal(appearancePromptText({ raw: "MLBB 립스틱, 시스루 뱅", compiledJson: compiled }), "차분한 로즈 베이지빛 입술, 가벼운 앞머리");
    assert.equal(appearancePromptText({ raw: "MLBB 립스틱", compiledJson: "" }), "MLBB 립스틱");
  });


  it("allows short specialist terms to compile into longer natural descriptions", () => {
    const compiled = validateAppearanceCompiledJson({
      body: "",
      hair: "",
      eyes: "",
      face: "",
      lips_makeup: "본래 혈색처럼 자연스러운 차분한 로즈 베이지빛 입술",
      clothing: "",
      impression: "",
      compiled_text: "본래 혈색처럼 자연스러운 차분한 로즈 베이지빛 입술",
    }, "MLBB 립스틱");

    assert.equal(compiled?.compiled_text, "본래 혈색처럼 자연스러운 차분한 로즈 베이지빛 입술");
    assert.notEqual(compiled?.compiled_text, "MLBB 립스틱");
  });

  it("clamps only overly verbose compiled text, not normal expansions", () => {
    const normal = "본래 혈색처럼 자연스러운 차분한 로즈 베이지빛 입술";
    assert.equal(clampAppearanceCompiledText(normal, "MLBB 립스틱"), normal);

    const verbose = "장황한 외형 설명 ".repeat(40);
    const clamped = clampAppearanceCompiledText(verbose, "MLBB 립스틱");
    assert.ok(clamped.length <= 120);
    assert.ok(clamped.length < verbose.length);
  });

  it("validates structured JSON and rejects missing keys", () => {
    assert.equal(validateAppearanceCompiledJson({ compiled_text: "샤넬 향수" }), null);
    const parsed = validateAppearanceCompiledJson({ body: "", hair: "", eyes: "", face: "", lips_makeup: "", clothing: "", impression: "샤넬 향수", compiled_text: "샤넬 향수" });
    assert.equal(parsed?.compiled_text, "샤넬 향수");
  });

  it("replaces raw appearance block and prevents raw+compiled double injection", () => {
    const out = replaceAppearanceInSetting("[외형]\nMLBB 립스틱, 시스루 뱅\n[성격]\n차분함", "차분한 로즈 베이지빛 입술, 가벼운 앞머리");
    assert.match(out, /차분한 로즈 베이지빛 입술/);
    assert.doesNotMatch(out, /MLBB 립스틱/);
  });

  it("hash changes only when normalized raw changes", () => {
    assert.equal(hashAppearanceRaw(" MLBB   립스틱 "), hashAppearanceRaw("MLBB 립스틱"));
    assert.notEqual(hashAppearanceRaw("MLBB 립스틱"), hashAppearanceRaw("시스루 뱅"));
  });

  it("inserts the one-line rule only for DeepSeek appearance blocks", () => {
    assert.match(baseContext(OPENROUTER_DEEPSEEK_V4_PRO_MODEL).systemPrompt, new RegExp(DEEPSEEK_APPEARANCE_VARIATION_RULE));
    assert.match(baseContext(OPENROUTER_DEEPSEEK_V3_MODEL).systemPrompt, new RegExp(DEEPSEEK_APPEARANCE_VARIATION_RULE));
    assert.doesNotMatch(baseContext(OPENROUTER_GEMINI_25_PRO_MODEL).systemPrompt, new RegExp(DEEPSEEK_APPEARANCE_VARIATION_RULE));
  });


  it("snapshots final prompt injection for compiled/raw and model-specific rule", () => {
    const compiledSystem = baseContext(OPENROUTER_DEEPSEEK_V4_PRO_MODEL).systemPrompt;
    assert.equal((compiledSystem.match(/옅고 차분한 로즈 베이지빛 입술/g) ?? []).length, 1);
    assert.equal((compiledSystem.match(new RegExp(DEEPSEEK_APPEARANCE_VARIATION_RULE, "g")) ?? []).length, 1);

    const rawOnly = buildContext({
      charName: "하린",
      chunks: [{
        id: "c1",
        characterId: "1",
        content: "[외형]\nMLBB 립스틱",
        category: "abilities",
        importance: "CRITICAL",
        tokenCount: 10,
        keywords: ["외형"],
      }],
      userNickname: "유저",
      shortTermHistory: [],
      currentUserMessage: "안녕",
      nsfw: false,
      modelId: OPENROUTER_GEMINI_25_PRO_MODEL,
      provider: "openrouter",
    }).systemPrompt;
    assert.equal((rawOnly.match(/MLBB 립스틱/g) ?? []).length, 1);
    assert.equal((rawOnly.match(new RegExp(DEEPSEEK_APPEARANCE_VARIATION_RULE, "g")) ?? []).length, 0);
  });

  it("handles empty and very long appearance safely", () => {
    assert.equal(extractAppearanceRawFromSetting("성격: 없음"), "");
    const long = `외형: ${"긴외형 ".repeat(1000)}`;
    assert.ok(extractAppearanceRawFromSetting(long).length <= 3000);
  });
});
