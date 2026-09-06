import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildContext } from "@/services/contextBuilder";
import type { ContextBuildInput, CharacterChunk } from "@/types";
import {
  DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY,
  DEEPSEEK_LENGTH_SINGLE_CALL_BLOCK,
} from "@/lib/deepseekPromptStructure";
import {
  PROSE_STYLE_SECTION,
  IMMERSIVE_PROSE_BLOCK,
} from "@/lib/advancedProseNsfwGuidelines";
import { COLLABORATIVE_INTERACTIVE_OWNER_TITLE } from "@/lib/noGodmodding";
import { USER_TAIL_LENGTH_OWNER_SENTENCE } from "@/lib/responseLength";
import { SPEECH_METADATA_INVISIBLE_RULE } from "@/lib/speechMetadataPolicy";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
} from "@/lib/chatModels";

function count(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

function speechChunk(title: string, body: string): CharacterChunk {
  return {
    id: `speech-${title}`,
    characterId: "p2",
    content: `[${title}]\n${body}`,
    category: "speech",
    importance: "CRITICAL",
    tokenCount: body.length,
    keywords: [title],
  };
}

function identityChunk(body: string): CharacterChunk {
  return {
    id: "identity",
    characterId: "p2",
    content: `[Identity]\n${body}`,
    category: "identity",
    importance: "CRITICAL",
    tokenCount: body.length,
    keywords: [],
  };
}

function buildInput(chunks: CharacterChunk[], opts: Partial<ContextBuildInput> = {}): ContextBuildInput {
  return {
    charName: "P2 Character",
    contentKind: "character",
    chunks,
    userNickname: "P2 User",
    personaDisplayName: "P2 User",
    userPersona: "P2_USER_PERSONA\n낯선 관계에서는 존댓말.",
    shortTermHistory: [],
    currentUserMessage: "안녕.",
    nsfw: false,
    gender: "other",
    userPersonaGender: "other",
    modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
    provider: "openrouter",
    userId: 1,
    chatId: 2,
    targetResponseChars: 3200,
    completedTurns: 2,
    ...opts,
  };
}

function buildDeepSeek(chunks: CharacterChunk[], opts: Partial<ContextBuildInput> = {}) {
  return buildContext(buildInput(chunks, opts));
}

const CASUAL_BANMAL_CHUNKS = [
  identityChunk("P2 Character is relaxed."),
  speechChunk("말투", "친근한 반말. 유저에게는 반말을 쓴다."),
  speechChunk("호칭", "유저를 '너'라고 부른다."),
];

const POLITE_STANDARD_CHUNKS = [
  identityChunk("P2 Character is reserved."),
  speechChunk("말투", "해요체 존댓말. 유저에게는 해요체를 쓴다."),
];

const FORMAL_MILITARY_CHUNKS = [
  identityChunk("P2 Character is a soldier."),
  speechChunk("말투", "군대식 다나까체. 유저에게는 격식체를 쓴다."),
  speechChunk("호칭", "유저를 성으로 부른다."),
];

const RELATIONSHIP_REGISTER_CHUNKS = [
  identityChunk("P2 Character."),
  speechChunk("말투", "낯선 상대에게는 존댓말, 친밀한 상대에게는 반말."),
];

describe("P2 — DeepSeek native Korean / register quality fixtures", () => {
  it("A — casual banmal: DeepSeek prompt does not force generic 존댓말", () => {
    const built = buildDeepSeek(CASUAL_BANMAL_CHUNKS);
    const sys = built.systemPrompt;
    assert.ok(sys.includes("반말"), "banmal speech chunk must be present");
    assert.doesNotMatch(sys, /대사 register 현대 존댓말/);
    assert.doesNotMatch(sys, /모든 대사를 존댓말/);
    // The character's own banmal register is not flattened to a generic honorific.
    assert.doesNotMatch(sys, /강제.*존댓말|무조건.*존댓말/);
  });

  it("B — polite standard: 해요체 존댓말 character keeps its own register owner", () => {
    const built = buildDeepSeek(POLITE_STANDARD_CHUNKS);
    const sys = built.systemPrompt;
    assert.ok(sys.includes("해요체"), "해요체 speech chunk must be present");
    assert.ok(sys.includes(SPEECH_METADATA_INVISIBLE_RULE.split("\n")[0] ?? ""), "speech metadata owner present");
  });

  it("C — formal/military: keeps formal register but narration not forced honorific", () => {
    const built = buildDeepSeek(FORMAL_MILITARY_CHUNKS);
    const sys = built.systemPrompt;
    assert.ok(sys.includes("다나까체") || sys.includes("격식체"), "formal speech present");
    // Narration register stays -다체 (not honorific).
    assert.ok(sys.includes("지문·서술은 해체"), "narration -다체 owner present");
  });

  it("D — relationship-dependent register: current relationship metadata present and no generic flattening", () => {
    const built = buildDeepSeek(RELATIONSHIP_REGISTER_CHUNKS);
    const sys = built.systemPrompt;
    assert.ok(sys.includes("존댓말") && sys.includes("반말"), "relationship register chunk present");
    assert.doesNotMatch(sys, /대사 register 현대 존댓말/);
  });

  it("E — address term: character-specified 호칭 not overridden by generic title", () => {
    const built = buildDeepSeek(CASUAL_BANMAL_CHUNKS);
    const sys = built.systemPrompt;
    assert.ok(sys.includes("'너'") || sys.includes("너"), "character address term present");
    assert.doesNotMatch(sys, /선생님 같은 격식 호칭/);
  });

  it("F — no address term: prompt does not demand a generic title", () => {
    const built = buildDeepSeek([identityChunk("P2 Character.")]);
    const sys = built.systemPrompt;
    // No instruction forcing "선생님/가이드님/당신" style generic titles.
    assert.doesNotMatch(sys, /선생님/);
    assert.doesNotMatch(sys, /당신/);
  });

  it("G — narration/dialogue split: -다체 narration vs character dialogue register owners separated", () => {
    const built = buildDeepSeek(POLITE_STANDARD_CHUNKS);
    const sys = built.systemPrompt;
    assert.ok(sys.includes("[NARRATION REGISTER]"), "narration register section");
    assert.match(sys, /지문·서술은 해체\(-다/);
    // Dialogue register is delegated to speech metadata / example dialog.
    assert.match(sys, /대사 register·존댓말은 \[SPEECH METADATA\]/);
  });

  it("H — dialogue economy preserved (P1 common prose still present)", () => {
    const built = buildDeepSeek(POLITE_STANDARD_CHUNKS);
    const sys = built.systemPrompt;
    assert.equal(count(sys, "같은 화자의 이어지는"), 1);
    assert.ok(sys.includes(IMMERSIVE_PROSE_BLOCK.split("\n")[0] ?? ""), "IMMERSIVE PROSE present");
  });

  it("I — role binding preserved (P0 common owner still present)", () => {
    const built = buildDeepSeek(POLITE_STANDARD_CHUNKS);
    const sys = built.systemPrompt;
    assert.equal(count(sys, COLLABORATIVE_INTERACTIVE_OWNER_TITLE), 1);
    assert.ok(sys.includes("확정된 행동의 주체·대상·방향은 이번 응답의 기준으로 유지한다"));
  });

  it("J — length owner exactly once at absolute end", () => {
    const built = buildDeepSeek(POLITE_STANDARD_CHUNKS);
    const tail = built.history[built.history.length - 1]?.content ?? "";
    assert.equal(count(tail, USER_TAIL_LENGTH_OWNER_SENTENCE), 1);
    assert.ok(tail.trimEnd().endsWith(USER_TAIL_LENGTH_OWNER_SENTENCE));
  });
});

describe("P2 — DeepSeek final prompt contract", () => {
  it("DeepSeek final assembled prompt has exactly-one common/dialogue/role/style/length owners", () => {
    const built = buildDeepSeek(POLITE_STANDARD_CHUNKS);
    const sys = built.systemPrompt;
    const tail = built.history[built.history.length - 1]?.content ?? "";
    const full = `${sys}\n\n${tail}`;

    assert.equal(count(sys, "[NARRATION REGISTER]"), 1);
    assert.equal(count(sys, "[IMMERSIVE PROSE]"), 1);
    assert.equal(count(sys, "같은 화자의 이어지는"), 1);
    assert.equal(count(sys, "확정된 행동의 주체·대상·방향은 이번 응답의 기준으로 유지한다"), 1);
    assert.equal(count(sys, COLLABORATIVE_INTERACTIVE_OWNER_TITLE), 1);
    assert.equal(count(sys, "[SPEECH METADATA — INVISIBLE INSTRUCTIONS]"), 1);
    assert.equal(count(full, DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY), 1);
    assert.equal(count(full, DEEPSEEK_LENGTH_SINGLE_CALL_BLOCK), 0);
    assert.equal(count(tail, USER_TAIL_LENGTH_OWNER_SENTENCE), 1);
    assert.ok(tail.trimEnd().endsWith(USER_TAIL_LENGTH_OWNER_SENTENCE));
    // No second-language repair owner.
    assert.equal(count(full, "[SPEECH LOCK REWRITE]"), 0);
    assert.equal(count(full, "[NARRATION LEXICON REWRITE]"), 0);
  });

  it("register conflict count is zero (no forced generic honorific, no legacy genre register)", () => {
    const built = buildDeepSeek(CASUAL_BANMAL_CHUNKS);
    const sys = built.systemPrompt;
    assert.equal(count(sys, "대사 register 현대 존댓말"), 0);
    assert.equal(count(sys, "현대 존댓말"), 0);
    assert.doesNotMatch(sys, /하오·이오·소이다/);
  });
});

describe("P2 — active-4 regression (common owner unchanged for non-DeepSeek)", () => {
  const ACTIVE_4: Array<[string, string, string]> = [
    ["deepseek", "openrouter", CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL],
    ["opus5", "openrouter", CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL],
    ["gemini31", "openrouter", CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL],
    ["gemini37", "openrouter", CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL],
  ];

  it("all four receive the same common Korean prose / dialogue economy / role binding", () => {
    for (const [label, provider, modelId] of ACTIVE_4) {
      const built = buildContext(
        buildInput(POLITE_STANDARD_CHUNKS, { modelId, provider })
      );
      const sys = built.systemPrompt;
      assert.equal(count(sys, "[NARRATION REGISTER]"), 1, `${label} NARRATION REGISTER`);
      assert.equal(count(sys, "[IMMERSIVE PROSE]"), 1, `${label} IMMERSIVE PROSE`);
      assert.equal(count(sys, "같은 화자의 이어지는"), 1, `${label} dialogue economy`);
      assert.equal(count(sys, COLLABORATIVE_INTERACTIVE_OWNER_TITLE), 1, `${label} role binding`);
      assert.equal(count(sys, "[SPEECH METADATA — INVISIBLE INSTRUCTIONS]"), 1, `${label} speech metadata`);
    }
  });

  it("DeepSeek is the only active model with the style reminder", () => {
    for (const [label, provider, modelId] of ACTIVE_4) {
      const built = buildContext(buildInput(POLITE_STANDARD_CHUNKS, { modelId, provider }));
      const tail = built.history[built.history.length - 1]?.content ?? "";
      const expected = label === "deepseek" ? 1 : 0;
      assert.equal(count(tail, "[System Reminder:"), expected, `${label} style reminder count`);
    }
  });
});