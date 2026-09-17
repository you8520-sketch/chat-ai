/**
 * Owner convergence audit — motion canonical owner + dialogue budget separation.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyProductionServerControlsToMessages,
  countPacingOwners,
  countTerminalDialogueBudgetOwners,
  mapSceneMotionDecisionToPacingLevel,
  resolveScenePacingDecision,
} from "@/lib/scenePacingController";
import {
  buildSceneDirective,
  renderSceneDirectiveForPrompt,
} from "@/lib/sceneDirective";
import { SCENE_FLOW_BLOCK } from "@/lib/generationProcessBeatFlow";
import { USER_TAIL_LENGTH_OWNER_SENTENCE } from "@/lib/responseLength";

const PRIMARY = "테스트주인공";
const SUPPORT = "테스트조연";

function wireStandardInteractive(input: {
  system: string;
  user: string;
  sceneDirective?: ReturnType<typeof buildSceneDirective>;
  skipMotionCue?: boolean;
}) {
  const directive =
    input.sceneDirective ??
    buildSceneDirective({
      mode: "interactive",
      contentKind: "character",
      primaryCharacterName: PRIMARY,
      currentUserMessage: input.user,
    });
  const applied = applyProductionServerControlsToMessages({
    messages: [
      { role: "system", content: input.system },
      { role: "user", content: input.user },
    ],
    mode: "interactive",
    contentKind: "character",
    primaryCharacterName: PRIMARY,
    currentUserMessage: input.user,
    canonicalSceneDirective: directive,
    skipMotionCue: input.skipMotionCue ?? false,
  });
  const systemText =
    applied.messages.find((m) => m.role === "system")?.content ?? "";
  return { ...applied, systemText };
}

describe("scene owner convergence audit", () => {
  it("O1 standard interactive — single motion cue owner ([SCENE PACING], not SceneDirective block)", () => {
    const system = `[CORE]\n${SCENE_FLOW_BLOCK}\n[IMMERSIVE PROSE]\nok`;
    const applied = wireStandardInteractive({
      system,
      user: "조용히 손을 겹친다.",
    });
    const owners = countPacingOwners(applied.systemText);
    assert.equal(owners.scene_pacing, 1);
    assert.equal(owners.scene_flow, 0);
    assert.equal(owners.pacing_sot_count, 1);
    assert.doesNotMatch(applied.systemText, /\[PRIVATE SCENE ENGINE RULE\]/);
  });

  it("O1 auto/sim — skipMotionCue: no duplicate [SCENE PACING] when SceneDirective owns motion", () => {
    const directive = buildSceneDirective({
      mode: "auto_progression",
      contentKind: "character",
      primaryCharacterName: PRIMARY,
      currentUserMessage: "계속 진행",
      chatId: 901,
      currentTurn: 3,
    });
    const block = renderSceneDirectiveForPrompt(directive);
    assert.match(block, /\[PRIVATE SCENE ENGINE RULE\]/);

    const applied = wireStandardInteractive({
      system: `[CORE]\n${SCENE_FLOW_BLOCK}\n${block}`,
      user: "계속 진행",
      sceneDirective: directive,
      skipMotionCue: true,
    });
    const owners = countPacingOwners(applied.systemText);
    assert.equal(owners.scene_pacing, 0);
    assert.match(applied.systemText, /\[PRIVATE SCENE ENGINE RULE\]/);
    assert.equal(applied.replacedSceneFlow, false);
  });

  it("O2 NPC grounding — pacing npcActionEligible follows SceneDirective entity evidence", () => {
    const departed = buildSceneDirective({
      mode: "interactive",
      contentKind: "character",
      primaryCharacterName: PRIMARY,
      knownSupportingCastNames: [SUPPORT],
      recentMessages: [
        { role: "assistant", content: `${SUPPORT}은 이미 퇴장했다.` },
      ],
      currentUserMessage: `${PRIMARY}을 바라본다.`,
      chatId: 902,
      currentTurn: 4,
    });
    const pacing = resolveScenePacingDecision({
      canonicalSceneDirective: departed,
      primaryCharacterName: PRIMARY,
      knownSupportingCastNames: [SUPPORT],
    });
    assert.equal(departed.npcGrounding.existingNpcEligible, false);
    assert.equal(pacing.npcActionEligible, false);

    const grounded = buildSceneDirective({
      mode: "interactive",
      contentKind: "character",
      primaryCharacterName: PRIMARY,
      knownSupportingCastNames: [SUPPORT],
      currentUserMessage: `${SUPPORT}에게 말을 건다.`,
      chatId: 903,
      currentTurn: 4,
    });
    const pacingGrounded = resolveScenePacingDecision({
      canonicalSceneDirective: grounded,
      primaryCharacterName: PRIMARY,
      knownSupportingCastNames: [SUPPORT],
      currentUserMessage: `${SUPPORT}에게 말을 건다.`,
    });
    assert.equal(grounded.npcGrounding.existingNpcEligible, true);
    assert.equal(pacingGrounded.npcActionEligible, true);
  });

  it("O3 stagnation — single analyzeStagnation source via SceneDirective", () => {
    const stagnant = buildSceneDirective({
      mode: "interactive",
      contentKind: "character",
      primaryCharacterName: PRIMARY,
      recentMessages: [
        { role: "assistant", content: "괜찮아. 말하지 않아도 돼." },
        { role: "user", content: "응." },
        { role: "assistant", content: "정말 괜찮아. 미안해." },
        { role: "user", content: "..." },
      ],
      currentUserMessage: "응.",
      chatId: 904,
      currentTurn: 6,
    });
    const pacing = resolveScenePacingDecision({ canonicalSceneDirective: stagnant });
    assert.equal(stagnant.recentStagnation, true);
    assert.equal(pacing.recentStagnation, true);
  });

  it("O4 dialogue budget preserved after motion delegation — standard dyad cap 4", () => {
    const userTail = `조용히 손을 겹친다.\n${USER_TAIL_LENGTH_OWNER_SENTENCE}`;
    const applied = wireStandardInteractive({
      system: `[CORE]\n${SCENE_FLOW_BLOCK}`,
      user: userTail,
    });
    assert.ok(applied.terminalDialogueBudgetAppended);
    assert.equal(applied.dialogueBudget?.maxBlocks, 4);
    const budgetOwners = countTerminalDialogueBudgetOwners(
      applied.messages.find((m) => m.role === "user")?.content ?? ""
    );
    assert.equal(budgetOwners.terminal_dialogue_budget_owner, 1);
  });

  it("O5 response length owner unchanged — length sentence remains on user turn", () => {
    const userTail = `입력\n${USER_TAIL_LENGTH_OWNER_SENTENCE}`;
    const applied = wireStandardInteractive({
      system: `[CORE]\n${SCENE_FLOW_BLOCK}`,
      user: userTail,
    });
    const user = applied.messages.find((m) => m.role === "user")?.content ?? "";
    assert.match(user, /3,200자 이상을 기본 목표로/);
  });

  it("mapSceneMotionDecisionToPacingLevel — canonical mapping table", () => {
    assert.equal(mapSceneMotionDecisionToPacingLevel("HOLD"), "HOLD");
    assert.equal(mapSceneMotionDecisionToPacingLevel("MICRO_MOTION"), "AMBIENT");
    assert.equal(mapSceneMotionDecisionToPacingLevel("SCENE_ADVANCE"), "LOCAL");
    assert.equal(mapSceneMotionDecisionToPacingLevel("ESCALATE"), "EXTERNAL");
  });

  it("S7 lexical 경비 alone — npcActionEligible false in pacing (follows SceneDirective)", () => {
    const d = buildSceneDirective({
      mode: "interactive",
      contentKind: "character",
      primaryCharacterName: PRIMARY,
      recentMessages: [
        { role: "assistant", content: "복도 끝에 경비가 서 있다." },
      ],
      currentUserMessage: "앞으로 간다.",
      chatId: 907,
      currentTurn: 2,
    });
    const pacing = resolveScenePacingDecision({ canonicalSceneDirective: d });
    assert.equal(d.npcGrounding.existingNpcEligible, false);
    assert.equal(pacing.npcActionEligible, false);
  });

  it("S12 dialogue-heavy negotiation — HIGH demand preserves elevated budget", () => {
    const applied = applyProductionServerControlsToMessages({
      messages: [
        { role: "system", content: `[CORE]\n${SCENE_FLOW_BLOCK}` },
        {
          role: "user",
          content: "무전으로 보고해. 응답하라.",
        },
      ],
      mode: "interactive",
      contentKind: "character",
      primaryCharacterName: PRIMARY,
      currentUserMessage: "무전으로 보고해. 응답하라.",
      recentMessages: [{ role: "assistant", content: "작전 회의 중이다." }],
    });
    assert.ok((applied.dialogueBudget?.maxBlocks ?? 0) >= 5);
  });
});
