import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildChatOocRpContinuingUserPrompt,
  isChatOocRpContinuing,
} from "@/lib/chatOocPriority";
import { resolveChatRuntimeMode } from "@/lib/chatRuntimeMode";
import {
  buildRegenerateOocPriorityPrompt,
  oocOverridesRegenerateRpDirective,
} from "@/lib/continueNarrative";
import { resolveCurrentTurnUserAuthoringDelegation } from "@/lib/currentTurnUserAuthoringDelegation";
import {
  CURRENT_TURN_OOC_DELEGATION_OWNER_TITLE,
  resolveNoGodmoddingMode,
} from "@/lib/noGodmodding";
import { buildContext } from "@/services/contextBuilder";

const user = "테스트_유저_캐릭터";
const ai = "테스트_AI_캐릭터";
const RAW =
  "OOC: 내 대사도 페르소나에 맞춰서 써줘.\n*그를 바라본다.*";

function lastUserContent(built: ReturnType<typeof buildContext>): string {
  return built.history[built.history.length - 1]?.content ?? "";
}

function assertDelegatedDialogueOnly(built: ReturnType<typeof buildContext>) {
  const ownerSection = built.meta.trackedSections?.find((s) => s.id === "no-godmodding");
  assert.ok(ownerSection?.text.includes(CURRENT_TURN_OOC_DELEGATION_OWNER_TITLE));
  assert.match(ownerSection!.text, /직접 대사를 페르소나 말투/);
  assert.doesNotMatch(ownerSection!.text, /대사와 중요한 행동/);
  assert.doesNotMatch(built.systemPrompt, /\[USER CONTROL — COLLABORATIVE INTERACTIVE\]/);
  assert.equal(built.meta.runtimeMode, "current_turn_ooc_delegated");
  assert.match(lastUserContent(built), /CURRENT-TURN OOC DELEGATION/);
  assert.doesNotMatch(lastUserContent(built), /remain user-authored/);
}

describe("current-turn OOC delegation route-equivalent parity", () => {
  it("live CHAT OOC wrapper keeps RAW-resolved delegation in buildContext", () => {
    const rawDelegation = resolveCurrentTurnUserAuthoringDelegation({
      currentUserInput: RAW,
    });
    assert.equal(rawDelegation.active, true);
    assert.equal(rawDelegation.allowDialogue, true);
    assert.equal(rawDelegation.allowMajorActions, false);

    assert.equal(isChatOocRpContinuing(RAW), true);
    const transformed = buildChatOocRpContinuingUserPrompt(RAW);
    assert.match(transformed, /^\[SYSTEM: CHAT OOC/);
    assert.doesNotMatch(transformed, /^OOC:/);
    assert.equal(
      resolveCurrentTurnUserAuthoringDelegation({ currentUserInput: transformed }).active,
      false
    );

    const routeRuntimeMode = resolveChatRuntimeMode({
      currentTurnDelegationActive: rawDelegation.active,
    });
    assert.equal(routeRuntimeMode, "current_turn_ooc_delegated");
    assert.equal(
      resolveNoGodmoddingMode({ currentTurnDelegation: rawDelegation }),
      "currentTurnDelegated"
    );

    const built = buildContext({
      charName: ai,
      chunks: [],
      userNickname: user,
      userPersona: `이름/호칭: ${user}`,
      shortTermHistory: [],
      currentUserMessage: transformed,
      currentTurnAuthoringDelegation: rawDelegation,
      runtimeMode: routeRuntimeMode,
      nsfw: false,
      provider: "openrouter",
      isContinue: false,
      novelModeEnabled: false,
      userImpersonation: false,
      personaDisplayName: user,
      completedTurns: 2,
    });
    assert.equal(built.meta.runtimeMode, routeRuntimeMode);
    assertDelegatedDialogueOnly(built);
    assert.match(lastUserContent(built), /OOC: 내 대사도 페르소나에 맞춰서 써줘/);
  });

  it("regenerating the same delegated user turn keeps current-turn delegation", () => {
    const rawDelegation = resolveCurrentTurnUserAuthoringDelegation({
      currentUserInput: RAW,
    });
    assert.equal(oocOverridesRegenerateRpDirective(RAW), true);
    const transformed = buildRegenerateOocPriorityPrompt({
      userMessage: RAW,
      personaName: user,
      charName: ai,
    });
    assert.match(transformed, /^\[SYSTEM: REGENERATE — CHAT OOC/);
    assert.equal(
      resolveCurrentTurnUserAuthoringDelegation({ currentUserInput: transformed }).active,
      false
    );

    const routeRuntimeMode = resolveChatRuntimeMode({
      currentTurnDelegationActive: rawDelegation.active,
    });
    const built = buildContext({
      charName: ai,
      chunks: [],
      userNickname: user,
      userPersona: `이름/호칭: ${user}`,
      shortTermHistory: [],
      currentUserMessage: transformed,
      currentTurnAuthoringDelegation: rawDelegation,
      runtimeMode: routeRuntimeMode,
      nsfw: false,
      provider: "openrouter",
      isContinue: false,
      novelModeEnabled: false,
      userImpersonation: false,
      regenerate: true,
      personaDisplayName: user,
      completedTurns: 2,
    });
    assert.equal(routeRuntimeMode, "current_turn_ooc_delegated");
    assert.equal(built.meta.runtimeMode, "current_turn_ooc_delegated");
    assertDelegatedDialogueOnly(built);
  });

  it("next new manual turn does not persist delegation", () => {
    const built = buildContext({
      charName: ai,
      chunks: [],
      userNickname: user,
      userPersona: `이름/호칭: ${user}`,
      shortTermHistory: [],
      currentUserMessage: "평범한 수동 입력",
      nsfw: false,
      provider: "openrouter",
      isContinue: false,
      novelModeEnabled: false,
      userImpersonation: false,
      personaDisplayName: user,
      completedTurns: 3,
    });
    assert.equal(built.meta.runtimeMode, "interactive");
    assert.match(built.systemPrompt, /\[USER CONTROL — COLLABORATIVE INTERACTIVE\]/);
    assert.doesNotMatch(built.systemPrompt, /CURRENT-TURN OOC DELEGATION/);
  });
});
