import Module from "module";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { buildContext } from "@/services/contextBuilder";
import { MUSE_SPARK_MODEL_ID } from "@/lib/museExampleDialogBoundaryPolicy";
import { MUSE_EXAMPLE_DIALOG_TRAP_PHRASES } from "@/lib/museExampleDialogBoundary";
import type { CharacterChunk } from "@/types";

const MUSE = MUSE_SPARK_MODEL_ID;
const DEEPSEEK = "deepseek/deepseek-v4-pro";
const GEMINI = "google/gemini-2.5-pro";

const CHAR_17_EXAMPLE_DIALOG = [
  "[말투 — GENERATION METADATA · NEVER NARRATE]",
  "Apply only when writing [A] quoted dialogue. Not in-world facts.",
  "",
  "style_notes (do not narrate — dialogue only):",
  '- formal honorific speech; hesitates under pressure;',
  '- “처음 뵙겠습니다. S급 수계 센티넬, 코드네임 플러드입니다.”,',
  '- “...생각보다 활발하시군요.”,',
  '- “그렇게 가까이 오시면... 조금 곤란합니다.”,',
  '- “낯선 사람을 상대하는 건 아직 익숙하지 않습니다.”,',
].join("\n");

const SPEECH_PROFILE_JSON = JSON.stringify({
  speech_tone: "formal",
  speech_formality: "formal",
  dialogue_examples: ["그렇게 가까이 오시면 조금 곤란합니다"],
  ending_anchors: ["습니다", "군요"],
});

function makeChunks(): CharacterChunk[] {
  return [
    {
      id: "17-chunk-0",
      characterId: "17",
      content: "[이름]\n서강우 (코드네임: 플러드)",
      category: "identity",
      importance: "CRITICAL",
      tokenCount: 12,
      keywords: ["이름", "서강우"],
    },
    {
      id: "17-chunk-personality",
      characterId: "17",
      content: "[성격]\n사회성이 서툰 엘리트. 긴장하면 손에 땀 남. 스킨십 꺼려함.",
      category: "personality",
      importance: "CRITICAL",
      tokenCount: 24,
      keywords: ["성격", "엘리트"],
    },
    {
      id: "17-chunk-speech",
      characterId: "17",
      content: `[말투]\n${CHAR_17_EXAMPLE_DIALOG}`,
      category: "speech",
      importance: "CRITICAL",
      tokenCount: 80,
      keywords: ["말투"],
    },
  ];
}

function baseInput() {
  return {
    charName: "서강우",
    chunks: makeChunks(),
    systemPrompt: "기본 정보\n이름: 서강우",
    world: "",
    exampleDialog: CHAR_17_EXAMPLE_DIALOG,
    speechProfileJson: SPEECH_PROFILE_JSON,
    speechPersonality: "formal, honorific, socially cautious",
    speechTraits: "hesitates; self-corrects; apologizes; indirect phrasing",
    characterPersonality: "사회성이 서툰 엘리트. 긴장하면 손에 땀 남.",
    userNickname: "user",
    userPersona: "",
    userNote: "",
    longTermMemory: "",
    archiveMemory: "",
    shortTermHistory: [],
    currentUserMessage: "hello",
    nsfw: false,
    gender: "male" as const,
    modelId: MUSE,
    userId: 1,
    provider: "openrouter" as const,
    targetResponseChars: 800,
    completedTurns: 0,
    userPersonaGender: "other" as const,
  };
}

const ENV_KEYS = [
  "MUSE_EXAMPLE_DIALOG_BOUNDARY_ENABLED",
  "MUSE_EXAMPLE_DIALOG_BOUNDARY_USER_IDS",
  "MUSE_EXAMPLE_DIALOG_BOUNDARY_MODEL_IDS",
] as const;

function saveEnv(): Record<string, string | undefined> {
  return Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
}

function restoreEnv(snapshot: Record<string, string | undefined>): void {
  for (const key of ENV_KEYS) {
    const value = snapshot[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe("buildContext — Muse example-dialog boundary", () => {
  let envSnapshot: Record<string, string | undefined>;

  beforeEach(() => {
    envSnapshot = saveEnv();
    for (const key of ENV_KEYS) delete process.env[key];
  });

  afterEach(() => {
    restoreEnv(envSnapshot);
  });

  it("boundary OFF → system prompt contains raw example lines (byte stability)", () => {
    const built = buildContext(baseInput());
    const system = built.systemPrompt;
    for (const trap of MUSE_EXAMPLE_DIALOG_TRAP_PHRASES) {
      assert.ok(system.includes(trap), `expected raw example ${trap} when boundary OFF`);
    }
  });

  it("boundary ON + admin + Muse → trap phrases absent, style signals preserved, non-speech sections retained", () => {
    process.env.MUSE_EXAMPLE_DIALOG_BOUNDARY_ENABLED = "1";
    process.env.MUSE_EXAMPLE_DIALOG_BOUNDARY_USER_IDS = "1";
    process.env.MUSE_EXAMPLE_DIALOG_BOUNDARY_MODEL_IDS = MUSE;

    const built = buildContext(baseInput());
    const system = built.systemPrompt;
    for (const trap of MUSE_EXAMPLE_DIALOG_TRAP_PHRASES) {
      assert.ok(!system.includes(trap), `expected sanitized prompt to exclude ${trap}`);
    }
    assert.ok(system.includes("register:"));
    assert.ok(system.includes("honorificLevel:"));
    assert.ok(system.includes("formality:"));
    assert.ok(system.includes("hesitationPattern:"));
    assert.ok(system.includes("sentenceEndings:"));
    assert.ok(system.includes("[성격]"), "non-speech sections must be preserved");
    assert.ok(system.includes("사회성이 서툰 엘리트"), "personality content must be preserved");
    assert.ok(!system.includes("생각보다 활발"), "no leaked scene conditions");
    assert.ok(!system.includes("가까이 오시면"), "no leaked scene conditions");
    assert.ok(!system.includes("조금 곤란"), "no leaked scene conditions");
  });

  it("boundary ON + non-admin user → byte-stable legacy behavior", () => {
    process.env.MUSE_EXAMPLE_DIALOG_BOUNDARY_ENABLED = "1";
    process.env.MUSE_EXAMPLE_DIALOG_BOUNDARY_USER_IDS = "1";
    process.env.MUSE_EXAMPLE_DIALOG_BOUNDARY_MODEL_IDS = MUSE;

    const built = buildContext({ ...baseInput(), userId: 2 });
    const system = built.systemPrompt;
    for (const trap of MUSE_EXAMPLE_DIALOG_TRAP_PHRASES) {
      assert.ok(system.includes(trap), `expected raw example for non-admin user ${trap}`);
    }
  });

  it("boundary ON + admin + DeepSeek → unchanged DeepSeek behavior", () => {
    process.env.MUSE_EXAMPLE_DIALOG_BOUNDARY_ENABLED = "1";
    process.env.MUSE_EXAMPLE_DIALOG_BOUNDARY_USER_IDS = "1";
    process.env.MUSE_EXAMPLE_DIALOG_BOUNDARY_MODEL_IDS = MUSE;

    const built = buildContext({ ...baseInput(), modelId: DEEPSEEK });
    const system = built.systemPrompt;
    for (const trap of MUSE_EXAMPLE_DIALOG_TRAP_PHRASES) {
      assert.ok(system.includes(trap), `expected raw example for DeepSeek ${trap}`);
    }
  });

  it("boundary ON + admin + Gemini → unchanged Gemini behavior", () => {
    process.env.MUSE_EXAMPLE_DIALOG_BOUNDARY_ENABLED = "1";
    process.env.MUSE_EXAMPLE_DIALOG_BOUNDARY_USER_IDS = "1";
    process.env.MUSE_EXAMPLE_DIALOG_BOUNDARY_MODEL_IDS = MUSE;

    const built = buildContext({ ...baseInput(), modelId: GEMINI });
    const system = built.systemPrompt;
    for (const trap of MUSE_EXAMPLE_DIALOG_TRAP_PHRASES) {
      assert.ok(system.includes(trap), `expected raw example for Gemini ${trap}`);
    }
  });

  it("boundary ON + model allowlist mismatch → OFF", () => {
    process.env.MUSE_EXAMPLE_DIALOG_BOUNDARY_ENABLED = "1";
    process.env.MUSE_EXAMPLE_DIALOG_BOUNDARY_USER_IDS = "1";
    process.env.MUSE_EXAMPLE_DIALOG_BOUNDARY_MODEL_IDS = "other/model";

    const built = buildContext(baseInput());
    const system = built.systemPrompt;
    for (const trap of MUSE_EXAMPLE_DIALOG_TRAP_PHRASES) {
      assert.ok(system.includes(trap), `expected raw example when model mismatch ${trap}`);
    }
  });

  it("boundary ON does not increase total system prompt size", () => {
    process.env.MUSE_EXAMPLE_DIALOG_BOUNDARY_ENABLED = "1";
    process.env.MUSE_EXAMPLE_DIALOG_BOUNDARY_USER_IDS = "1";
    process.env.MUSE_EXAMPLE_DIALOG_BOUNDARY_MODEL_IDS = MUSE;

    const off = buildContext({ ...baseInput(), modelId: MUSE, userId: 2 });
    const on = buildContext({ ...baseInput(), modelId: MUSE, userId: 1 });
    assert.ok(
      on.systemPrompt.length <= off.systemPrompt.length,
      `boundary ON prompt (${on.systemPrompt.length} chars) must not exceed OFF prompt (${off.systemPrompt.length} chars)`
    );
    const onTokens = on.meta.estimatedInputTokens ?? 0;
    const offTokens = off.meta.estimatedInputTokens ?? 0;
    assert.ok(
      onTokens <= offTokens,
      `boundary ON tokens (${onTokens}) must not exceed OFF tokens (${offTokens})`
    );
  });
});
