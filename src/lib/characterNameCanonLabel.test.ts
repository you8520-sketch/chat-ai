/**
 * Name-label contract: a newline canon name must not be replaced by the display name.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  loadCharacterChunksForPromptReadOnly,
  loadCharacterChunksReadOnly,
} from "@/lib/characterChunks";
import type { CharacterSettingRow } from "@/lib/characterChunks";
import { hashKoreanChunks } from "@/lib/promptTranslation";
import {
  extractRoleplayNameFromSettingText,
  resolveRelationshipMetaNames,
  resolveRoleplayCharacterName,
  settingTextCarriesExplicitNameBody,
} from "@/lib/relationshipMetaCharacterName";
import { buildContext } from "@/services/contextBuilder";
import { parseCharacterSetting } from "@/utils/characterParser";
import type { CharacterChunk } from "@/types";
import type { CurrentTurnAuthoringDelegation } from "@/lib/currentTurnUserAuthoringDelegation";

const LIKE_CARD = [
  "이름",
  "조태형 (코드네임: 라이크)",
  "",
  "직업",
  "S급 음압 센티넬",
  "",
  "[조아인(코드네임 Aether/에테르)]",
  "- **ID**: 36/M",
  "- **Status**: S급 가이드 / ACB 응급 가이드 지휘관",
].join("\n");

const NORMAL: CurrentTurnAuthoringDelegation = {
  active: true,
  allowDialogue: true,
  allowMajorActions: true,
  allowInnerPov: false,
  allowIrreversibleFate: false,
  allowAiCastIrreversibleExpansion: false,
  source: "chat_setting",
  duration: "persistent",
};

function nameSections(chunks: CharacterChunk[]): string[] {
  return chunks
    .map((chunk) => chunk.content.trim())
    .filter((content) => content.startsWith("[이름]"));
}

function parseNamed(systemPrompt: string, characterName: string, gender: "male" | "female" | "other" = "male") {
  return parseCharacterSetting({
    characterId: "name-canon",
    systemPrompt,
    world: "",
    exampleDialog: "",
    characterName,
    gender,
  });
}

describe("roleplay name extractor — newline canon label", () => {
  it("reads a newline name field and keeps the real name before the codename parenthesis", () => {
    assert.equal(
      extractRoleplayNameFromSettingText("이름\n조태형 (코드네임: 라이크)"),
      "조태형"
    );
    assert.equal(
      extractRoleplayNameFromSettingText("# 이름\n한지우 (코드네임: 레이븐)"),
      "한지우"
    );
  });

  it("keeps the existing one-line and bracket name forms", () => {
    assert.equal(
      extractRoleplayNameFromSettingText("이름: 서강우 (코드네임: 플러드)"),
      "서강우"
    );
    assert.equal(
      extractRoleplayNameFromSettingText("[이름]\n서강우 (코드네임: 플러드)"),
      "서강우"
    );
    assert.equal(extractRoleplayNameFromSettingText("[Name] Leon"), "Leon");
  });

  it("does not treat a sentence or a codename label as the real name", () => {
    assert.equal(extractRoleplayNameFromSettingText("이름은 중요하지 않다.\n그는 웃었다."), null);
    assert.equal(extractRoleplayNameFromSettingText("그의 이름\n조태형"), null);
    assert.equal(extractRoleplayNameFromSettingText("코드네임\n라이크\n\n별명\n태형"), null);
  });
});

describe("incomplete name fields keep the display-name fallback", () => {
  const incompleteCards = [
    "이름\n직업\n고위 센티넬",
    "이름\n[성격]\n긍정적",
    "Name\nAge\n25",
    "이름",
    "이름\n",
    "이름\n\n직업\n고위 센티넬",
    "이름:\n직업\n고위 센티넬",
  ];

  for (const card of incompleteCards) {
    it(`does not promote the next heading for ${JSON.stringify(card)}`, () => {
      const chunks = parseNamed(card, "라이크", "male");
      assert.equal(extractRoleplayNameFromSettingText(card), null);
      assert.equal(settingTextCarriesExplicitNameBody(card), false);
      assert.equal(
        resolveRoleplayCharacterName({ displayName: "라이크", systemPrompt: card, chunks }).roleplayName,
        "라이크"
      );
      assert.equal(
        resolveRelationshipMetaNames({
          displayName: "라이크",
          systemPrompt: card,
          chunks,
          userName: "렌",
        }).charName,
        "라이크"
      );
      assert.deepEqual(nameSections(chunks), ["[이름]\n라이크"]);
    });
  }

  it("keeps a real newline name when an earlier name label has no value", () => {
    const card = "이름\n직업\n\n본명\n조태형 (코드네임: 라이크)";
    assert.equal(extractRoleplayNameFromSettingText(card), "조태형");
    assert.equal(settingTextCarriesExplicitNameBody(card), true);
    assert.equal(nameSections(parseNamed(card, "라이크")).some((section) => section === "[이름]\n라이크"), false);
  });

  it("keeps a Latin newline name and a same-line bracket name", () => {
    assert.equal(extractRoleplayNameFromSettingText("Name\nLeon"), "Leon");
    assert.equal(extractRoleplayNameFromSettingText("Name\nLeon\nPersonality\ncalm"), "Leon");
    assert.equal(extractRoleplayNameFromSettingText("Name\nLeon (codename: Raven)"), "Leon");
    assert.equal(extractRoleplayNameFromSettingText("[Name] Leon\nAge\n25"), "Leon");
  });

  it("still reads the Like card as one explicit canon name", () => {
    assert.equal(extractRoleplayNameFromSettingText(LIKE_CARD), "조태형");
    assert.equal(settingTextCarriesExplicitNameBody(LIKE_CARD), true);
    assert.equal(
      resolveRoleplayCharacterName({ displayName: "라이크", systemPrompt: LIKE_CARD }).roleplayName,
      "조태형"
    );
    assert.equal(
      resolveRelationshipMetaNames({
        displayName: "라이크",
        systemPrompt: LIKE_CARD,
        userName: "렌",
      }).charName,
      "조태형"
    );
  });
});

describe("character name chunk — display name is not a second real name", () => {
  it("keeps the Like newline canon and does not emit the codename as [이름]", () => {
    const chunks = parseNamed(LIKE_CARD, "라이크", "male");
    const names = nameSections(chunks);
    assert.deepEqual(names, ["[이름]\n조태형 (코드네임: 라이크)"]);
    assert.equal(names.some((section) => section === "[이름]\n라이크"), false);
    const joined = chunks.map((chunk) => chunk.content).join("\n");
    assert.match(joined, /성별: 남성/);
    assert.match(joined, /36\/M/);
    assert.match(joined, /응급 가이드 지휘관/);
  });

  it("keeps one-line colon names through the extracted name prefix", () => {
    const chunks = parseNamed("이름: 서강우 (코드네임: 플러드)\n\n성격\n차분하다.", "플러드");
    const names = nameSections(chunks);
    assert.ok(names.some((section) => section.startsWith("[이름]\n서강우")));
    assert.equal(names.some((section) => section === "[이름]\n플러드"), false);
  });

  it("keeps alias and codename text without using them as the real name", () => {
    const chunks = parseNamed(
      ["이름", "한지우 (코드네임: 레이븐)", "", "별명", "지우", "", "코드네임", "레이븐"].join("\n"),
      "레이븐"
    );
    const names = nameSections(chunks);
    assert.equal(names.some((section) => section === "[이름]\n레이븐"), false);
    assert.ok(names.some((section) => section.includes("한지우 (코드네임: 레이븐)")));
    const joined = chunks.map((chunk) => chunk.content).join("\n");
    assert.match(joined, /별명/);
    assert.match(joined, /지우/);
    assert.match(joined, /레이븐/);
  });

  it("falls back to the display name only when no real name is defined", () => {
    const chunks = parseNamed("코드네임\n라이크\n\n성격\n조용하다.", "라이크");
    assert.deepEqual(nameSections(chunks), ["[이름]\n라이크"]);
    assert.equal(extractRoleplayNameFromSettingText("코드네임\n라이크\n\n성격\n조용하다."), null);
  });

  it("does not invent a second name when the display name and the real name match", () => {
    const chunks = parseNamed("이름\n권태현\n\n성격\n과묵하다.", "권태현");
    assert.deepEqual(nameSections(chunks), ["[이름]\n권태현"]);
  });

  it("consumes a fresh parse when stored chunks still carry the old display-name label", () => {
    const stale: CharacterChunk[] = [
      {
        id: "18-chunk-0",
        characterId: "18",
        content: "[이름]\n라이크",
        category: "identity",
        importance: "CRITICAL",
        tokenCount: 4,
        keywords: [],
      },
    ];
    const row: CharacterSettingRow = {
      id: 18,
      name: "라이크",
      gender: "male",
      system_prompt: LIKE_CARD,
      world: "",
      example_dialog: "",
      setting_chunks: JSON.stringify(stale),
      creator_compiled_description_json: null,
    };
    const fresh = loadCharacterChunksReadOnly(row);
    const loaded = loadCharacterChunksForPromptReadOnly(row, "렌", "렌");
    assert.notEqual(hashKoreanChunks(stale), hashKoreanChunks(fresh));
    assert.equal(loaded.usedEnglish, false);
    assert.deepEqual(nameSections(loaded.chunks), ["[이름]\n조태형 (코드네임: 라이크)"]);
    assert.equal(
      loaded.chunks.some((chunk) => chunk.content.trim() === "[이름]\n라이크"),
      false
    );
  });
});

describe("name canon assembly is the same for main, auto, and regenerate", () => {
  const chunks = parseNamed(LIKE_CARD, "라이크", "male");

  function core(kind: "interactive" | "auto" | "regenerate"): string {
    const built = buildContext({
      charName: "라이크",
      contentKind: "character",
      chunks,
      systemPrompt: LIKE_CARD,
      world: "",
      exampleDialog: "",
      userNickname: "렌",
      userPersona: "",
      userNote: "",
      longTermMemory: "",
      shortTermHistory: [],
      currentUserMessage: kind === "auto" ? "[SYSTEM DIRECTIVE: CONTINUE THE NARRATIVE]" : "사이렌이 울렸어.",
      currentTurnAuthoringDelegation: NORMAL,
      nsfw: false,
      gender: "male",
      modelId: "deepseek-v4.1-flash",
      provider: "openrouter",
      personaDisplayName: "렌",
      userPersonaGender: "male",
      targetResponseChars: 3200,
      completedTurns: 1,
      isContinue: kind === "auto",
      regenerate: kind === "regenerate",
    });
    const section = built.meta.trackedSections?.find((item) => item.id === "character-core-identity");
    assert.ok(section);
    return section.text;
  }

  it("puts one canonical name line in the core identity for every runtime mode", () => {
    const interactive = core("interactive");
    const auto = core("auto");
    const regenerate = core("regenerate");
    assert.equal(interactive, auto);
    assert.equal(interactive, regenerate);
    assert.match(interactive, /\[이름\]\n조태형 \(코드네임: 라이크\)/);
    assert.equal(interactive.includes("[이름]\n라이크"), false);
    assert.match(interactive, /36\/M/);
    assert.match(interactive, /성별: 남성/);
  });
});
