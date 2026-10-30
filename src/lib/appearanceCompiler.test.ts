import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  APPEARANCE_COMPILED_VERSION,
  DEEPSEEK_APPEARANCE_VARIATION_RULE,
  appearancePromptText,
  compiledTextPreservesRawFeatures,
  emptyAppearanceCompiled,
  extractAppearanceRawFromSetting,
  hashAppearanceRaw,
  parseAppearanceCompiledJson,
  replaceAppearanceInSetting,
  serializeAppearanceCompiledJson,
  clampAppearanceCompiledText,
  validateAppearanceCompiledJson,
} from "@/lib/appearanceCompiler";
import {
  characterSettingInputForRow,
  loadCharacterChunksForPrompt,
  type CharacterSettingRow,
} from "@/lib/characterChunks";
import { parseCharacterSetting, serializeCharacterChunks } from "@/utils/characterParser";
import { koreanChunksTranslationFingerprint } from "@/lib/promptTranslation";
import { renderAppearanceBlock } from "@/lib/officialSupply/appearance";
import type { OfficialAppearanceLock } from "@/lib/officialSupply/types";
import { buildContext } from "@/services/contextBuilder";
import { OPENROUTER_DEEPSEEK_V3_MODEL, OPENROUTER_DEEPSEEK_V4_PRO_MODEL, OPENROUTER_GEMINI_25_PRO_MODEL } from "@/lib/chatModels";

function loadOfficialAppearanceRaw(file: string): string {
  const parsed = JSON.parse(readFileSync(resolve(process.cwd(), file), "utf8")) as {
    appearance: OfficialAppearanceLock;
  };
  return renderAppearanceBlock(parsed.appearance);
}

function compiledJson(compiledText: string): string {
  return serializeAppearanceCompiledJson({
    ...emptyAppearanceCompiled(),
    compiled_text: compiledText,
  });
}

function appearanceRow(input: {
  name: string;
  raw: string;
  compiledText: string;
}): CharacterSettingRow {
  const compiledJsonText = compiledJson(input.compiledText);
  return {
    id: 1,
    name: input.name,
    gender: "male",
    system_prompt: `[외형]\n${input.compiledText}`,
    world: "",
    example_dialog: "",
    appearance_raw: input.raw,
    appearance_compiled: compiledJsonText,
    appearance_compiled_source_hash: hashAppearanceRaw(input.raw),
    appearance_compiled_version: APPEARANCE_COMPILED_VERSION,
  };
}

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
    const raw = "MLBB 립스틱, 시스루 뱅";
    const compiled = JSON.stringify({ body: "", hair: "가벼운 앞머리", eyes: "", face: "", lips_makeup: "차분한 로즈 베이지빛 입술", clothing: "", impression: "", compiled_text: "차분한 로즈 베이지빛 입술, 가벼운 앞머리" });
    assert.equal(appearancePromptText({
      raw,
      compiledJson: compiled,
      compiledSourceHash: hashAppearanceRaw(raw),
      compiledVersion: APPEARANCE_COMPILED_VERSION,
    }), "차분한 로즈 베이지빛 입술, 가벼운 앞머리");
    assert.equal(appearancePromptText({ raw: "MLBB 립스틱", compiledJson: "" }), "MLBB 립스틱");
    assert.equal(appearancePromptText({ raw, compiledJson: compiled }), raw);
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

  it("does not re-clamp stored compiled_text when parsing without RAW", () => {
    const compiledText =
      "188cm의 넓은 어깨와 단단한 허리를 가진 남성. 창백한 피부에 짙은 흑회색 울프컷, 옆머리는 짧고 윗머리는 거칠게 넘겼다. 길고 깊은 회청색 눈은 차갑고, 왼쪽 턱 아래 가는 흉터가 있다. 흑철 갑옷 위에 검은 늑대 모피 코트를 걸치고, 가문 인장 반지와 방벽 열쇠, 낡은 가죽 장갑을 지녔다.";
    assert.ok(compiledText.length > 120);
    const parsed = parseAppearanceCompiledJson(
      JSON.stringify({
        body: "188cm",
        hair: "흑회색 울프컷",
        eyes: "회청색",
        face: "흉터",
        lips_makeup: "",
        clothing: "흑철 갑옷, 늑대 모피, 반지, 열쇠",
        impression: "",
        compiled_text: compiledText,
      })
    );
    assert.equal(parsed?.compiled_text, compiledText);
    assert.match(parsed?.compiled_text ?? "", /모피/);
    assert.match(parsed?.compiled_text ?? "", /반지/);
    assert.match(parsed?.compiled_text ?? "", /열쇠/);
  });

  it("still clamps verbose compiled_text only when RAW length is known", () => {
    const verbose = "장황한 외형 설명 ".repeat(40);
    const atCompile = validateAppearanceCompiledJson({
      body: "",
      hair: "",
      eyes: "",
      face: "",
      lips_makeup: "",
      clothing: "",
      impression: "",
      compiled_text: verbose,
    }, "MLBB 립스틱");
    assert.ok((atCompile?.compiled_text.length ?? 0) <= 120);

    const stored = validateAppearanceCompiledJson({
      body: "",
      hair: "",
      eyes: "",
      face: "",
      lips_makeup: "",
      clothing: "",
      impression: "",
      compiled_text: verbose,
    });
    assert.equal(stored?.compiled_text, verbose.trim());
  });

  it("falls back to RAW when compiled_text drops Wolfgang frostbite features", () => {
    const raw = [
      "키/체형: 188cm, 어깨가 넓고 허리가 단단한 체형",
      "특징: 왼쪽 턱 아래에 가늘게 남은 흉터, 왼손 약지는 동상 후유증으로 감각이 둔하다",
      "기본 의상: 흑철 판금 갑옷 위에 검은 늑대 모피 코트를 걸친다. 가문의 인장이 박힌 흑철 지휘관 반지, 방벽 열쇠 꾸러미",
    ].join("\n");
    const compiled = JSON.stringify({
      body: "188cm",
      hair: "흑회색 울프컷",
      eyes: "회청색",
      face: "왼쪽 턱 아래 가는 흉터",
      lips_makeup: "",
      clothing: "흑철 갑옷, 늑대 모피, 반지, 열쇠",
      impression: "전투 시 망설임 없는 기사",
      compiled_text:
        "188cm의 창백한 피부를 가진 남성. 짙은 흑회색 울프컷, 회청색의 차가운 눈매. 균형 잡힌 얼굴에 왼쪽 턱 아래 흉터. 흑철 갑옷과 늑대 모피 코트를 입고, 가문 반지와 열쇠, 장갑을 지님.",
    });
    assert.equal(compiledTextPreservesRawFeatures(raw, JSON.parse(compiled).compiled_text), false);
    const resolved = appearancePromptText({
      raw,
      compiledJson: compiled,
      compiledSourceHash: hashAppearanceRaw(raw),
      compiledVersion: APPEARANCE_COMPILED_VERSION,
    });
    assert.equal(resolved, raw);
    assert.match(resolved, /약지/);
    assert.match(resolved, /동상/);
    assert.doesNotMatch(resolved, /기사/);
  });

  it("keeps compiled_text only when every 특징 item is present as-is", () => {
    const raw = "특징: 왼쪽 턱 아래에 가늘게 남은 흉터, 왼손 약지는 동상 후유증으로 감각이 둔하다";
    const compiledText =
      "왼쪽 턱 아래에 가늘게 남은 흉터, 왼손 약지는 동상 후유증으로 감각이 둔하다. 188cm, 회청색 눈.";
    const compiled = JSON.stringify({
      body: "188cm",
      hair: "",
      eyes: "회청색",
      face: "흉터",
      lips_makeup: "",
      clothing: "",
      impression: "",
      compiled_text: compiledText,
    });
    assert.equal(compiledTextPreservesRawFeatures(raw, compiledText), true);
    assert.equal(
      appearancePromptText({
        raw,
        compiledJson: compiled,
        compiledSourceHash: hashAppearanceRaw(raw),
        compiledVersion: APPEARANCE_COMPILED_VERSION,
      }),
      compiledText
    );
  });

  it("does not treat overlapping words as preserved 특징 items", () => {
    const raw = "특징: 왼손 약지는 동상 후유증으로 감각이 둔하다";
    const compiledText = "왼손에 은빛 반지를 끼고 있다";
    assert.equal(compiledTextPreservesRawFeatures(raw, compiledText), false);
    const resolved = appearancePromptText({
      raw,
      compiledJson: compiledJson(compiledText),
      compiledSourceHash: hashAppearanceRaw(raw),
      compiledVersion: APPEARANCE_COMPILED_VERSION,
    });
    assert.equal(resolved, raw);
    assert.match(resolved, /약지/);
    assert.match(resolved, /동상/);
    assert.doesNotMatch(resolved, /은빛 반지/);
  });

  it("does not RAW-fallback brand rewrites that have no 특징 line", () => {
    const raw = "MLBB 립스틱, 시스루 뱅";
    const compiledText = "차분한 로즈 베이지빛 입술, 가벼운 앞머리";
    const compiled = JSON.stringify({
      body: "",
      hair: "가벼운 앞머리",
      eyes: "",
      face: "",
      lips_makeup: "차분한 로즈 베이지빛 입술",
      clothing: "",
      impression: "",
      compiled_text: compiledText,
    });
    assert.equal(compiledTextPreservesRawFeatures(raw, compiledText), true);
    assert.equal(
      appearancePromptText({
        raw,
        compiledJson: compiled,
        compiledSourceHash: hashAppearanceRaw(raw),
        compiledVersion: APPEARANCE_COMPILED_VERSION,
      }),
      compiledText
    );
  });

  it("injects frostbite RAW once in the final RP prompt when compiled dropped it", () => {
    const raw = "특징: 왼손 약지는 동상 후유증으로 감각이 둔하다\n기본 의상: 흑철 갑옷";
    const compiled = JSON.stringify({
      body: "",
      hair: "",
      eyes: "",
      face: "",
      lips_makeup: "",
      clothing: "흑철 갑옷",
      impression: "",
      compiled_text: "흑철 갑옷을 입은 남성",
    });
    const appearance = appearancePromptText({
      raw,
      compiledJson: compiled,
      compiledSourceHash: hashAppearanceRaw(raw),
      compiledVersion: APPEARANCE_COMPILED_VERSION,
    });
    const prompt = buildContext({
      charName: "볼프강",
      chunks: [{
        id: "c1",
        characterId: "1",
        content: `[외형]\n${appearance}`,
        category: "abilities",
        importance: "CRITICAL",
        tokenCount: 20,
        keywords: ["외형"],
      }],
      userNickname: "렌",
      shortTermHistory: [],
      currentUserMessage: "안녕",
      nsfw: false,
      modelId: OPENROUTER_GEMINI_25_PRO_MODEL,
      provider: "openrouter",
    }).systemPrompt;
    assert.equal((prompt.match(/약지/g) ?? []).length, 1);
    assert.equal((prompt.match(/동상/g) ?? []).length, 1);
    assert.equal((prompt.match(/흑철 갑옷/g) ?? []).length, 1);
  });

  it("preserves Wolfgang frostbite, fur, ring, and keys from the approved lock", () => {
    const raw = loadOfficialAppearanceRaw(
      "src/lib/officialSupply/pilot/fixtures/pilot-rf-02-approved-c91ba66a.source.json"
    );
    const compiledText =
      "188cm의 창백한 피부를 가진 남성. 짙은 흑회색 울프컷, 회청색의 차가운 눈매. 균형 잡힌 얼굴에 왼쪽 턱 아래 흉터. 흑철 갑옷과 늑대 모피 코트를 입고, 가문 반지와 열쇠, 장갑을 지님.";
    const resolved = appearancePromptText({
      raw,
      compiledJson: compiledJson(compiledText),
      compiledSourceHash: hashAppearanceRaw(raw),
      compiledVersion: APPEARANCE_COMPILED_VERSION,
    });
    assert.equal(resolved, raw);
    assert.match(resolved, /약지/);
    assert.match(resolved, /동상/);
    assert.match(resolved, /모피/);
    assert.match(resolved, /반지/);
    assert.match(resolved, /열쇠/);
  });

  it("preserves Lucian monocle, ink, and watch from the official lock", () => {
    const raw = loadOfficialAppearanceRaw("src/lib/officialSupply/pilot/characters/pilot-rf-03.json");
    const compiledText =
      "184cm 유연한 체격. 금장식 모노클과 회중시계를 착용. 오른손 검지에 잉크 자국이 있다.";
    const resolved = appearancePromptText({
      raw,
      compiledJson: compiledJson(compiledText),
      compiledSourceHash: hashAppearanceRaw(raw),
      compiledVersion: APPEARANCE_COMPILED_VERSION,
    });
    assert.equal(resolved, raw);
    assert.match(resolved, /모노클/);
    assert.match(resolved, /잉크/);
    assert.match(resolved, /회중시계/);
  });

  it("preserves Caelum veins, veil, and medicine pouch from the official lock", () => {
    const raw = loadOfficialAppearanceRaw("src/lib/officialSupply/pilot/characters/pilot-rf-01.json");
    const compiledText = "182cm. 푸른 혈관, 반투명 베일, 작은 허리 주머니.";
    const resolved = appearancePromptText({
      raw,
      compiledJson: compiledJson(compiledText),
      compiledSourceHash: hashAppearanceRaw(raw),
      compiledVersion: APPEARANCE_COMPILED_VERSION,
    });
    assert.equal(resolved, raw);
    assert.match(resolved, /혈관/);
    assert.match(resolved, /베일/);
    assert.match(resolved, /약병/);
    assert.match(resolved, /주머니/);
  });

  it("uses Korean RAW and treats English appearance cache as stale on loadCharacterChunksForPrompt", () => {
    const raw = loadOfficialAppearanceRaw(
      "src/lib/officialSupply/pilot/fixtures/pilot-rf-02-approved-c91ba66a.source.json"
    );
    const compiledText = "왼손에 은빛 반지를 끼고 있다";
    const row = appearanceRow({ name: "볼프강", raw, compiledText });
    const fresh = parseCharacterSetting(characterSettingInputForRow(row));
    const compiledKorean = parseCharacterSetting({
      ...characterSettingInputForRow(row),
      systemPrompt: `[외형]\n${compiledText}`,
    });
    row.setting_chunks = serializeCharacterChunks(fresh);
    row.setting_chunks_en = JSON.stringify(
      fresh.map((chunk) => ({ ...chunk, content: chunk.content.replace(/약지|동상/g, "ring") }))
    );
    row.prompt_translation_hash = koreanChunksTranslationFingerprint(compiledKorean);

    const loaded = loadCharacterChunksForPrompt(row, "렌", "렌");
    const joined = loaded.chunks.map((chunk) => chunk.content).join("\n");
    assert.equal(loaded.usedEnglish, false);
    assert.match(joined, /약지/);
    assert.match(joined, /동상/);
    assert.match(joined, /모피/);
    assert.match(joined, /반지/);
    assert.match(joined, /열쇠/);
    assert.equal((joined.match(/\[외형\]/g) ?? []).length, 1);
    assert.doesNotMatch(joined, /은빛 반지/);
  });
});
