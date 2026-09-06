/**
 * P1 — Narration-dominant dialogue economy / ONE canonical common owner.
 *
 * Deterministic contract tests on the FINAL ASSEMBLED PROMPT owner, not on
 * model output regex. API=0.
 *
 * Owner contract (§15):
 *   GENERIC_COMMON_DIALOGUE_OWNER_COUNT=1
 *   LUNA_COMMON_DIALOGUE_OWNER_COUNT=1 (same common owner, no model duplicate)
 *   DIALOGUE_LAYOUT_OWNER_COUNT=1 (layout unchanged, no share semantics)
 *   LENGTH_OWNER_COUNT=1 (terminal, absolute end)
 *   ROLE_BINDING_OWNER_COUNT=1 (P0 #873 preserved)
 */
import Module from "module";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const originalLoad = (Module as unknown as { _load: typeof Module._load })._load;
(Module as unknown as { _load: typeof Module._load })._load = function (
  request: string,
  parent: NodeModule,
  isMain: boolean
) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
} as typeof Module._load;

import { buildContext } from "@/services/contextBuilder";
import { estimateTokens } from "@/lib/tokenEstimate";
import {
  IMMERSIVE_PROSE_BLOCK,
  PROSE_STYLE_SECTION,
  buildAdvancedProseNsfwGuidelines,
} from "@/lib/advancedProseNsfwGuidelines";
import { resolveProseStyleSection } from "@/lib/proseStyleResolver";
import {
  DIALOGUE_NARRATION_STRUCTURE_RULE,
  OUTPUT_LAYOUT_SEMANTIC_CORE,
} from "@/lib/webnovelOutputFormat";
import { USER_TAIL_LENGTH_OWNER_SENTENCE } from "@/lib/responseLength";
import { COLLABORATIVE_INTERACTIVE_OWNER_BLOCK } from "@/lib/noGodmodding";
import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
  MAIN_RP_MODEL_IDS,
} from "@/lib/chatModels";

const DIALOGUE_ECONOMY_MARKER = "하나의 충분한 발화로 묶는다";
const DIALOGUE_ECONOMY_MARKER_RE = /하나의 충분한 발화로 묶는다/;

/** Canonical 4 Main RP models — from the single source of truth. */
const PRODUCTION_SELECTABLE_MODELS: readonly string[] = MAIN_RP_MODEL_IDS;

function forceProdEnv() {
  for (const k of [
    "SHARED_NOVEL_PROSE_V2_ENABLED",
    "SHARED_NOVEL_PROSE_V2_USER_IDS",
    "PROSE_VNEXT_ENABLED",
    "PROSE_VNEXT_ROLLOUT_ENABLED",
    "PROSE_VNEXT_ROLLOUT_MODEL_IDS",
    "MUSE_M1_ENABLED",
    "MUSE_M1_ROLLOUT_ENABLED",
    "MUSE_M1_ROLLOUT_MODEL_IDS",
  ]) {
    delete process.env[k];
  }
}

const MINIMAL_INPUT = {
  charName: "태형",
  contentKind: "character" as const,
  chunks: [],
  userNickname: "렌",
  userPersona: "PERSONA_FIXTURE",
  userNote: "",
  longTermMemory: "LTM_FIXTURE",
  archiveMemory: null,
  shortTermHistory: [
    { role: "assistant" as const, content: "태형이 고개를 끄덕였다." },
    { role: "user" as const, content: "응, 여기서 조금 쉬자." },
  ],
  currentUserMessage: "응, 여기서 조금 쉬자.",
  nsfw: false,
  gender: "male" as const,
  userId: 1,
  chatId: 1,
  targetResponseChars: 3200,
  completedTurns: 1,
  provider: "cheaperinference" as const,
  personaDisplayName: "렌",
  userPersonaGender: null,
};

function countOccurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

describe("P1 — canonical common dialogue-economy owner", () => {
  it("RC-A fixed: common prose owns dialogue share + same-speaker concentration exactly once", () => {
    const block = IMMERSIVE_PROSE_BLOCK;
    assert.equal(countOccurrences(block, DIALOGUE_ECONOMY_MARKER), 1);
    assert.equal(countOccurrences(PROSE_STYLE_SECTION, DIALOGUE_ECONOMY_MARKER), 1);
    const bundle = buildAdvancedProseNsfwGuidelines({ nsfwEnabled: false });
    assert.equal(countOccurrences(bundle, DIALOGUE_ECONOMY_MARKER), 1);
  });

  it("§9 — integrated into existing IMMERSIVE_PROSE_BLOCK (no new standalone block)", () => {
    assert.match(IMMERSIVE_PROSE_BLOCK, /\[IMMERSIVE PROSE\]/);
    assert.doesNotMatch(IMMERSIVE_PROSE_BLOCK, /\[DIALOGUE ECONOMY\]/);
    assert.ok(PROSE_STYLE_SECTION.includes(IMMERSIVE_PROSE_BLOCK));
  });

  it("§4 — positive form: no fixed ratio, no hard numeric dialogue limit", () => {
    for (const forbidden of [
      /80%|20%|8:2|8 : 2/,
      /대사.*(최대|많아야|절대).*[0-9]+/,
      /대사량.*[0-9]+/,
      /dialogue.*quota/i,
    ]) {
      assert.doesNotMatch(IMMERSIVE_PROSE_BLOCK, forbidden);
    }
    // Positive execution instruction, not prohibition-only.
    assert.match(IMMERSIVE_PROSE_BLOCK, /대사는 장면의 관계·판단·행동을 바꾸는 말에 집중하고/);
  });

  it("§11 — same-speaker consolidation is compact, not a giant monologue", () => {
    const block = IMMERSIVE_PROSE_BLOCK;
    // Consolidate into ONE SUFFICIENT utterance (충분한 — not giant), then move on.
    assert.match(block, /하나의 충분한 발화로 묶는다/);
    assert.match(block, /나머지는 행동·감각·심리·관찰·환경 변화가 전개한다/);
    assert.doesNotMatch(block, /긴 독백|장문 독백/);
    // The remainder is explicitly narration-owned — consolidation must not
    // become a long single speech block that fills the scene.
    assert.ok(
      block.indexOf("하나의 충분한 발화로 묶는다") < block.indexOf("나머지는 행동·감각·심리·관찰·환경 변화가 전개한다")
    );
  });

  it("§14 — scene matrix semantics present in the common owner", () => {
    const block = IMMERSIVE_PROSE_BLOCK;
    const scenes: Array<[string, RegExp]> = [
      ["A quiet dyad", /조용한 1:1/],
      ["B intimate dyad", /내면·관찰·행동과 결과가 중심/],
      ["C investigation", /조사/],
      ["D combat", /전투/],
      ["E ensemble banter", /다인 대화/],
      ["F argument", /논쟁/],
      ["G silent character", /침묵·본업·퇴장도 자연스럽다/],
      ["H talkative character", /다인 대화·논쟁·작전은 대화가 중심이라 자연스럽게 늘어난다/],
    ];
    for (const [name, pattern] of scenes) {
      assert.match(block, pattern, name);
    }
  });

  it("§15 — every production selectable model resolves to legacy common prose (no canary swap)", () => {
    forceProdEnv();
    for (const modelId of PRODUCTION_SELECTABLE_MODELS) {
      assert.equal(resolveProseStyleSection(1, modelId), undefined, modelId);
    }
  });

  it("§15 — final assembled system prompt carries the common owner once per model", () => {
    forceProdEnv();
    for (const modelId of PRODUCTION_SELECTABLE_MODELS) {
      const built = buildContext({ ...MINIMAL_INPUT, modelId });
      const system = built.systemPrompt ?? "";
      assert.equal(
        countOccurrences(system, DIALOGUE_ECONOMY_MARKER),
        1,
        `${modelId} must carry the common dialogue-economy owner exactly once`
      );
    }
  });
});

describe("P1 — canonical 4 length owner (no retired terminal contract)", () => {
  it("§12/§16 — every canonical model ends its user tail with the generic length owner", () => {
    forceProdEnv();
    for (const modelId of PRODUCTION_SELECTABLE_MODELS) {
      const built = buildContext({ ...MINIMAL_INPUT, modelId });
      const system = built.systemPrompt ?? "";
      // Common prose (system) carries the dialogue-economy owner exactly once.
      assert.equal(countOccurrences(system, DIALOGUE_ECONOMY_MARKER), 1, modelId);
      const lastUser = String(built.history[built.history.length - 1]?.content ?? "");
      // User tail carries the generic length owner once, absolute end, no dialogue economy.
      assert.equal(countOccurrences(lastUser, DIALOGUE_ECONOMY_MARKER), 0, modelId);
      assert.equal(countOccurrences(lastUser, "3,200자 이상"), 1, modelId);
      assert.ok(lastUser.trimEnd().endsWith(USER_TAIL_LENGTH_OWNER_SENTENCE), modelId);
      assert.ok(lastUser.indexOf("3,200자 이상") > lastUser.indexOf("레이아웃:"), modelId);
    }
  });
});

describe("P1 — protected invariants", () => {
  it("§17 — dialogue layout owner stays format-only (no share/concentration semantics)", () => {
    assert.equal(countOccurrences(DIALOGUE_NARRATION_STRUCTURE_RULE, "대사는 독립 문단으로 표시한다"), 1);
    assert.doesNotMatch(DIALOGUE_NARRATION_STRUCTURE_RULE, DIALOGUE_ECONOMY_MARKER_RE);
    assert.doesNotMatch(DIALOGUE_NARRATION_STRUCTURE_RULE, /장면의 관계·판단·행동/);
    assert.doesNotMatch(OUTPUT_LAYOUT_SEMANTIC_CORE, DIALOGUE_ECONOMY_MARKER_RE);
  });

  it("§21 — length owner count=1, position=absolute_end for all canonical models", () => {
    // Generic terminal owner unchanged.
    assert.match(USER_TAIL_LENGTH_OWNER_SENTENCE, /3,200자 이상/);
    assert.doesNotMatch(USER_TAIL_LENGTH_OWNER_SENTENCE, DIALOGUE_ECONOMY_MARKER_RE);
    forceProdEnv();
    for (const modelId of PRODUCTION_SELECTABLE_MODELS) {
      const built = buildContext({ ...MINIMAL_INPUT, modelId });
      const lastUser = String(built.history[built.history.length - 1]?.content ?? "");
      assert.ok(lastUser.trimEnd().endsWith(USER_TAIL_LENGTH_OWNER_SENTENCE), modelId);
      assert.ok(lastUser.indexOf("3,200자 이상") > lastUser.indexOf("레이아웃:"), modelId);
    }
  });

  it("§22 — P0 role-binding owner count=1 in the final interactive prompt", () => {
    assert.equal(countOccurrences(COLLABORATIVE_INTERACTIVE_OWNER_BLOCK, "주체·대상·방향"), 1);
    forceProdEnv();
    for (const modelId of PRODUCTION_SELECTABLE_MODELS) {
      const built = buildContext({ ...MINIMAL_INPUT, modelId });
      const system = built.systemPrompt ?? "";
      assert.equal(countOccurrences(system, "주체·대상·방향"), 1, modelId);
    }
  });

  it("§20 — token budget: common prose growth is bounded", () => {
    const commonTokens = estimateTokens(IMMERSIVE_PROSE_BLOCK);
    // The common block must stay well under a 3,000-token ceiling (29K P3 headroom).
    assert.ok(commonTokens < 3000, `common prose tokens ${commonTokens}`);
  });
});