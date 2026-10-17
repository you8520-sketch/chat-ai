/**
 * Argon NORMAL dialogue+action inner boundary.
 * The candidate replaces one sentence inside the existing coauthor owner.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
  CHEAPER_INFERENCE_GPT_61_SOL_MODEL,
  GEMINI_38_FLASH_MODEL,
  GEMINI_4_ARGON_MODEL,
  OPENROUTER_GEMINI_31_PRO_MODEL,
  OPENROUTER_GEMINI_38_FLASH_MODEL,
  OPENROUTER_GEMINI_4_ARGON_MODEL,
} from "@/lib/chatModels";
import {
  ARGON_DIALOGUE_ACTION_INNER_PROHIBITION,
  DIALOGUE_ACTION_IRREVERSIBLE_PROHIBITION,
  SHARED_DIALOGUE_ACTION_INNER_PROHIBITION,
  USER_COAUTHOR_OWNER_TITLE,
  buildNoGodmoddingBlock,
} from "@/lib/noGodmodding";
import { shouldInjectGemini31UserAgencySupplement } from "@/lib/gemini31UserAgencyAdapter";
import type { CurrentTurnAuthoringDelegation } from "@/lib/currentTurnUserAuthoringDelegation";
import { buildContext } from "@/services/contextBuilder";

const SAME_LINE = `${ARGON_DIALOGUE_ACTION_INNER_PROHIBITION} ${DIALOGUE_ACTION_IRREVERSIBLE_PROHIBITION}`;
const SHARED_LINE = `${SHARED_DIALOGUE_ACTION_INNER_PROHIBITION} ${DIALOGUE_ACTION_IRREVERSIBLE_PROHIBITION}`;

const normalDialogueActions: CurrentTurnAuthoringDelegation = {
  active: true,
  allowDialogue: true,
  allowMajorActions: true,
  allowInnerPov: false,
  allowIrreversibleFate: false,
  source: "chat_setting",
  duration: "persistent",
};

const allowInner: CurrentTurnAuthoringDelegation = {
  ...normalDialogueActions,
  allowInnerPov: true,
  source: "explicit_ooc",
};

function owner(modelId?: string | null, delegation: CurrentTurnAuthoringDelegation = normalDialogueActions) {
  return buildNoGodmoddingBlock("라이크", "렌", "currentTurnDelegated", {
    currentTurnDelegation: delegation,
    modelId,
  });
}

function noGodmoddingText(modelId?: string, delegation?: CurrentTurnAuthoringDelegation, isContinue = false) {
  const built = buildContext({
    charName: "테스트_AI_캐릭터",
    chunks: [],
    userNickname: "테스트_유저_캐릭터",
    userPersona: "이름/호칭: 테스트_유저_캐릭터",
    shortTermHistory: [],
    currentUserMessage: "문을 연다.",
    currentTurnAuthoringDelegation: delegation,
    nsfw: false,
    provider: "openrouter",
    isContinue,
    novelModeEnabled: false,
    userImpersonation: false,
    personaDisplayName: "테스트_유저_캐릭터",
    completedTurns: 2,
    modelId,
  });
  const section = built.meta.trackedSections?.find((row) => row.id === "no-godmodding");
  return {
    section: section?.text ?? "",
    system: built.systemPrompt,
  };
}

describe("Argon dialogue+action inner prohibition", () => {
  it("replaces only the first sentence for exact Argon ids", () => {
    for (const modelId of [GEMINI_4_ARGON_MODEL, OPENROUTER_GEMINI_4_ARGON_MODEL, "  Google/Gemini-4-Argon  "]) {
      const block = owner(modelId);
      assert.equal(block.split(USER_COAUTHOR_OWNER_TITLE).length - 1, 1, modelId);
      assert.equal(block.split(ARGON_DIALOGUE_ACTION_INNER_PROHIBITION).length - 1, 1, modelId);
      assert.equal(block.includes(SHARED_DIALOGUE_ACTION_INNER_PROHIBITION), false, modelId);
      assert.equal(block.includes(SAME_LINE), true, modelId);
      assert.equal(block.includes("직접 대사와 외부에서 관찰 가능한 중요한 행동"), true, modelId);
    }
  });

  it("keeps the shared sentence for other models, omitted ids, and lookalikes", () => {
    const ids = [
      undefined,
      "",
      "   ",
      GEMINI_38_FLASH_MODEL,
      OPENROUTER_GEMINI_38_FLASH_MODEL,
      CHEAPER_INFERENCE_GPT_61_SOL_MODEL,
      CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
      OPENROUTER_GEMINI_31_PRO_MODEL,
      "gemini-4-argon-preview",
      "google/gemini-4-argon-exp",
      "x-gemini-4-argon",
      "google/gemini-4-argon/extra",
      "not-google/gemini-4-argon",
    ];
    const shared = owner(undefined);
    for (const modelId of ids) {
      const block = owner(modelId);
      assert.equal(block, shared, String(modelId));
      assert.equal(block.includes(SHARED_LINE), true, String(modelId));
      assert.equal(block.includes(ARGON_DIALOGUE_ACTION_INNER_PROHIBITION), false, String(modelId));
    }
  });

  it("does not apply the candidate to ALLOW, inner OOC, narrower branches, or auto progression", () => {
    const allow = owner(OPENROUTER_GEMINI_4_ARGON_MODEL, allowInner);
    assert.equal(allow.includes(ARGON_DIALOGUE_ACTION_INNER_PROHIBITION), false);
    assert.equal(allow.includes("감정·생각·속마음·내면 독백"), true);
    assert.equal(allow, owner(GEMINI_38_FLASH_MODEL, allowInner));

    const fate = owner(OPENROUTER_GEMINI_4_ARGON_MODEL, {
      ...normalDialogueActions,
      allowIrreversibleFate: true,
    });
    assert.equal(fate.includes(ARGON_DIALOGUE_ACTION_INNER_PROHIBITION), false);
    assert.equal(fate, owner(undefined, { ...normalDialogueActions, allowIrreversibleFate: true }));

    const dialogueOnly = owner(OPENROUTER_GEMINI_4_ARGON_MODEL, {
      ...normalDialogueActions,
      allowMajorActions: false,
    });
    assert.equal(dialogueOnly.includes("직접 대사를 페르소나 말투·성격에 맞게"), true);
    assert.equal(dialogueOnly.includes(ARGON_DIALOGUE_ACTION_INNER_PROHIBITION), false);

    const limited = buildNoGodmoddingBlock("라이크", "렌", "currentTurnDelegated", {
      currentTurnDelegation: {
        active: false,
        allowDialogue: false,
        allowMajorActions: false,
        allowInnerPov: false,
        source: "chat_setting",
        duration: "persistent",
      },
      modelId: OPENROUTER_GEMINI_4_ARGON_MODEL,
    });
    assert.equal(limited.includes("현재 [B] 집필 권한은 제한 상태다"), true);
    assert.equal(limited.includes(ARGON_DIALOGUE_ACTION_INNER_PROHIBITION), false);

    const auto = buildNoGodmoddingBlock("라이크", "렌", "autoContinue", {
      modelId: OPENROUTER_GEMINI_4_ARGON_MODEL,
    });
    assert.equal(auto, buildNoGodmoddingBlock("라이크", "렌", "autoContinue"));
    assert.equal(auto.includes(ARGON_DIALOGUE_ACTION_INNER_PROHIBITION), false);

    const coNarration = buildNoGodmoddingBlock("라이크", "렌", "coNarration", {
      modelId: OPENROUTER_GEMINI_4_ARGON_MODEL,
    });
    assert.equal(coNarration, buildNoGodmoddingBlock("라이크", "렌", "coNarration"));
  });

  it("keeps the Gemini 3.1 supplement off Argon and off delegated mode", () => {
    assert.equal(
      shouldInjectGemini31UserAgencySupplement({
        modelId: OPENROUTER_GEMINI_4_ARGON_MODEL,
        godmoddingMode: "currentTurnDelegated",
      }),
      false
    );
    assert.equal(
      shouldInjectGemini31UserAgencySupplement({
        modelId: GEMINI_4_ARGON_MODEL,
        godmoddingMode: "standard",
      }),
      false
    );
    assert.equal(
      shouldInjectGemini31UserAgencySupplement({
        modelId: OPENROUTER_GEMINI_31_PRO_MODEL,
        godmoddingMode: "standard",
      }),
      true
    );
  });

  it("threads the final request model through buildContext once", () => {
    const argon = noGodmoddingText(OPENROUTER_GEMINI_4_ARGON_MODEL, normalDialogueActions);
    const canonical = noGodmoddingText(GEMINI_4_ARGON_MODEL, normalDialogueActions);
    const gemini38 = noGodmoddingText(OPENROUTER_GEMINI_38_FLASH_MODEL, normalDialogueActions);
    const sol = noGodmoddingText(CHEAPER_INFERENCE_GPT_61_SOL_MODEL, normalDialogueActions);
    const opus = noGodmoddingText(CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL, normalDialogueActions);
    const omitted = noGodmoddingText(undefined, normalDialogueActions);
    assert.equal(canonical.section, argon.section);
    assert.equal(
      argon.section.split(ARGON_DIALOGUE_ACTION_INNER_PROHIBITION).join(SHARED_DIALOGUE_ACTION_INNER_PROHIBITION),
      gemini38.section
    );
    assert.equal(sol.section, gemini38.section);
    assert.equal(opus.section, gemini38.section);
    assert.equal(omitted.section, gemini38.section);
    assert.equal(argon.system.split(ARGON_DIALOGUE_ACTION_INNER_PROHIBITION).length - 1, 1);
    assert.equal(gemini38.system.includes(ARGON_DIALOGUE_ACTION_INNER_PROHIBITION), false);
    assert.equal(argon.section.split(USER_COAUTHOR_OWNER_TITLE).length - 1, 1);

    const allowArgon = noGodmoddingText(OPENROUTER_GEMINI_4_ARGON_MODEL, allowInner);
    const allowGemini = noGodmoddingText(OPENROUTER_GEMINI_38_FLASH_MODEL, allowInner);
    assert.equal(allowArgon.section, allowGemini.section);
    assert.equal(allowArgon.section.includes(ARGON_DIALOGUE_ACTION_INNER_PROHIBITION), false);

    const autoArgon = noGodmoddingText(OPENROUTER_GEMINI_4_ARGON_MODEL, normalDialogueActions, true);
    const autoGemini = noGodmoddingText(OPENROUTER_GEMINI_38_FLASH_MODEL, normalDialogueActions, true);
    assert.equal(autoArgon.section, autoGemini.section);
    assert.equal(autoArgon.section.includes(ARGON_DIALOGUE_ACTION_INNER_PROHIBITION), false);
  });
});
