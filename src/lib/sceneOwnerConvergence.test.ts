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
  type NpcGroundingResult,
  type SceneDirective,
  type SceneMotionDecision,
  type SceneProgressionType,
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

function fixtureDirective(input: {
  motionDecision: SceneMotionDecision;
  progressionTypes?: SceneProgressionType[];
  npcGrounding?: Partial<NpcGroundingResult> &
    Pick<NpcGroundingResult, "existingNpcEligible" | "newNpcAllowed">;
}): SceneDirective {
  const npcGrounding: NpcGroundingResult = {
    existingNpcEligible: input.npcGrounding?.existingNpcEligible ?? false,
    newNpcAllowed: input.npcGrounding?.newNpcAllowed ?? false,
    eligibleActorNames: input.npcGrounding?.eligibleActorNames ?? [],
    sources: input.npcGrounding?.sources ?? ["none"],
  };
  return {
    mode: "interactive",
    recentStagnation: false,
    recommendedIntensity: 1,
    motionDecision: input.motionDecision,
    motionReasons: ["quiet_interaction"],
    progressionTypes: input.progressionTypes ?? [],
    avoid: [],
    userControl: "no_user_control",
    castFocus: {
      sceneCastMode: "single_primary",
      primaryCharacterName: PRIMARY,
      supportingCastBudget: 0,
      activeSpeakingCast: [PRIMARY, ...npcGrounding.eligibleActorNames],
    },
    npcGrounding,
  };
}

function extractScenePacingBlock(systemText: string): string {
  return systemText.match(/\[SCENE PACING\][\s\S]*?(?=\n\[|$)/)?.[0] ?? "";
}

/** Pre-fix lossy compact cue wording — must not reappear in final Standard prompt. */
const LEGACY_LOSSY_PROJECTION = /주변 인물·환경|주변 인물·환경의 짧은/;

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

describe("lossless canonical policy projection P1–P7", () => {
  it("P1 HOLD no-NPC — final [SCENE PACING] does not widen NPC permission", () => {
    const directive = fixtureDirective({
      motionDecision: "HOLD",
      progressionTypes: [],
      npcGrounding: {
        existingNpcEligible: false,
        newNpcAllowed: false,
        eligibleActorNames: [],
      },
    });
    const applied = wireStandardInteractive({
      system: `[CORE]\n${SCENE_FLOW_BLOCK}\n[IMMERSIVE PROSE]\nok`,
      user: "조용히 있다.",
      sceneDirective: directive,
    });
    const pacing = extractScenePacingBlock(applied.systemText);
    assert.match(pacing, /전개 필요: 없음 \(현재 비트 유지\)/);
    assert.match(pacing, /기존 NPC 행동: 없음/);
    assert.match(pacing, /새 인물 도입: 없음/);
    assert.doesNotMatch(pacing, LEGACY_LOSSY_PROJECTION);
  });

  it("P2 MICRO_MOTION no-NPC — final prompt does not imply NPC/new actor permission", () => {
    const directive = fixtureDirective({
      motionDecision: "MICRO_MOTION",
      progressionTypes: ["relationship"],
      npcGrounding: {
        existingNpcEligible: false,
        newNpcAllowed: false,
        eligibleActorNames: [],
      },
    });
    const applied = wireStandardInteractive({
      system: `[CORE]\n${SCENE_FLOW_BLOCK}`,
      user: "손끝만 살짝 움직인다.",
      sceneDirective: directive,
    });
    const pacing = extractScenePacingBlock(applied.systemText);
    assert.match(pacing, /새 인물·별도 사건은 만들지 않는다/);
    assert.match(pacing, /기존 NPC 행동: 없음/);
    assert.match(pacing, /새 인물 도입: 없음/);
    assert.doesNotMatch(pacing, LEGACY_LOSSY_PROJECTION);
  });

  it("P3 SCENE_ADVANCE relationship-only — compact cue does not widen to unrelated sources", () => {
    const directive = fixtureDirective({
      motionDecision: "SCENE_ADVANCE",
      progressionTypes: ["relationship"],
      npcGrounding: {
        existingNpcEligible: false,
        newNpcAllowed: false,
        eligibleActorNames: [],
      },
    });
    const applied = wireStandardInteractive({
      system: `[CORE]\n${SCENE_FLOW_BLOCK}`,
      user: "시선을 맞춘다.",
      sceneDirective: directive,
    });
    const pacing = extractScenePacingBlock(applied.systemText);
    assert.match(pacing, /허용된 변화: 관계 변화/);
    assert.doesNotMatch(pacing, /허용된 변화:.*단서/);
    assert.doesNotMatch(pacing, /허용된 변화:.*세계 반응/);
    assert.doesNotMatch(pacing, /허용된 변화:.*NPC 행동/);
    assert.doesNotMatch(pacing, /허용된 변화:.*이전 선택의 결과/);
  });

  it("P4 SCENE_ADVANCE npc_action grounded — existing actor action preserved in final prompt", () => {
    const directive = fixtureDirective({
      motionDecision: "SCENE_ADVANCE",
      progressionTypes: ["npc_action", "relationship"],
      npcGrounding: {
        existingNpcEligible: true,
        newNpcAllowed: false,
        eligibleActorNames: [SUPPORT],
        sources: ["user_named"],
      },
    });
    const applied = wireStandardInteractive({
      system: `[CORE]\n${SCENE_FLOW_BLOCK}`,
      user: `${SUPPORT}을 바라본다.`,
      sceneDirective: directive,
    });
    const pacing = extractScenePacingBlock(applied.systemText);
    assert.match(pacing, new RegExp(`기존 NPC \\(${SUPPORT}\\)의 행동만`));
    assert.match(pacing, /새 인물 도입: 없음/);
  });

  it("P5 remote contact — newNpcAllowed=false, no physical arrival permission in final prompt", () => {
    const directive = buildSceneDirective({
      mode: "interactive",
      contentKind: "character",
      primaryCharacterName: PRIMARY,
      knownSupportingCastNames: [SUPPORT],
      triggeredEventText: "무전으로 연락이 온다.",
      currentUserMessage: "수신한다.",
      chatId: 910,
      currentTurn: 2,
    });
    assert.equal(directive.npcGrounding.newNpcAllowed, false);
    const applied = wireStandardInteractive({
      system: `[CORE]\n${SCENE_FLOW_BLOCK}`,
      user: "수신한다.",
      sceneDirective: directive,
    });
    const pacing = extractScenePacingBlock(applied.systemText);
    assert.match(pacing, /새 인물 도입: 없음/);
    assert.doesNotMatch(pacing, /트리거·명시적 도착만/);
  });

  it("P6 ESCALATE newNpcAllowed=false — external pressure separated from new actor intro", () => {
    const directive = fixtureDirective({
      motionDecision: "ESCALATE",
      progressionTypes: ["world_reaction", "consequence"],
      npcGrounding: {
        existingNpcEligible: false,
        newNpcAllowed: false,
        eligibleActorNames: [],
      },
    });
    const applied = wireStandardInteractive({
      system: `[CORE]\n${SCENE_FLOW_BLOCK}`,
      user: "밖 소음에 귀를 기울인다.",
      sceneDirective: directive,
    });
    const pacing = extractScenePacingBlock(applied.systemText);
    assert.match(pacing, /전개 필요: ESCALATE/);
    assert.match(pacing, /새 인물 도입: 없음/);
    assert.doesNotMatch(pacing, LEGACY_LOSSY_PROJECTION);
  });

  it("P7 ESCALATE explicit arrival — new actor allowed only via trigger·arrival contract", () => {
    const directive = buildSceneDirective({
      mode: "interactive",
      contentKind: "character",
      primaryCharacterName: PRIMARY,
      knownSupportingCastNames: [SUPPORT],
      triggeredEventText: `${SUPPORT}이 문 앞에 도착했다.`,
      currentUserMessage: "문을 연다.",
      chatId: 911,
      currentTurn: 3,
    });
    assert.equal(directive.npcGrounding.newNpcAllowed, true);
    const applied = wireStandardInteractive({
      system: `[CORE]\n${SCENE_FLOW_BLOCK}`,
      user: "문을 연다.",
      sceneDirective: directive,
    });
    const pacing = extractScenePacingBlock(applied.systemText);
    assert.match(pacing, /새 인물 도입: 트리거·명시적 도착만/);
    assert.doesNotMatch(pacing, LEGACY_LOSSY_PROJECTION);
  });
});

describe("lossless policy projection owner checks O6–O10", () => {
  it("O6 HOLD final prompt preserves no-NPC contract", () => {
    const directive = fixtureDirective({
      motionDecision: "HOLD",
      progressionTypes: [],
      npcGrounding: {
        existingNpcEligible: false,
        newNpcAllowed: false,
        eligibleActorNames: [],
      },
    });
    const applied = wireStandardInteractive({
      system: `[CORE]\n${SCENE_FLOW_BLOCK}`,
      user: "가만히 있다.",
      sceneDirective: directive,
    });
    const pacing = extractScenePacingBlock(applied.systemText);
    assert.match(pacing, /기존 NPC 행동: 없음/);
    assert.match(pacing, /새 인물 도입: 없음/);
    assert.doesNotMatch(applied.systemText, LEGACY_LOSSY_PROJECTION);
  });

  it("O7 MICRO final prompt preserves no-NPC contract", () => {
    const directive = fixtureDirective({
      motionDecision: "MICRO_MOTION",
      progressionTypes: ["relationship"],
      npcGrounding: {
        existingNpcEligible: false,
        newNpcAllowed: false,
        eligibleActorNames: [],
      },
    });
    const applied = wireStandardInteractive({
      system: `[CORE]\n${SCENE_FLOW_BLOCK}`,
      user: "숨을 고른다.",
      sceneDirective: directive,
    });
    const pacing = extractScenePacingBlock(applied.systemText);
    assert.match(pacing, /기존 NPC 행동: 없음/);
    assert.match(pacing, /새 인물 도입: 없음/);
    assert.doesNotMatch(applied.systemText, LEGACY_LOSSY_PROJECTION);
  });

  it("O8 progression type does not widen in projection — relationship-only stays bounded", () => {
    const directive = fixtureDirective({
      motionDecision: "SCENE_ADVANCE",
      progressionTypes: ["relationship"],
      npcGrounding: {
        existingNpcEligible: false,
        newNpcAllowed: false,
        eligibleActorNames: [],
      },
    });
    const applied = wireStandardInteractive({
      system: `[CORE]\n${SCENE_FLOW_BLOCK}`,
      user: "눈을 맞춘다.",
      sceneDirective: directive,
    });
    const pacing = extractScenePacingBlock(applied.systemText);
    const allowedLine = pacing.match(/허용된 변화: .+/)?.[0] ?? "";
    assert.match(allowedLine, /관계 변화/);
    assert.doesNotMatch(allowedLine, /단서|세계 반응|NPC 행동|환경 변화|이전 선택/);
  });

  it("O9 newNpcAllowed=false preserved in final assembled Standard prompt", () => {
    const directive = fixtureDirective({
      motionDecision: "SCENE_ADVANCE",
      progressionTypes: ["environment"],
      npcGrounding: {
        existingNpcEligible: false,
        newNpcAllowed: false,
        eligibleActorNames: [],
      },
    });
    const applied = wireStandardInteractive({
      system: `[CORE]\n${SCENE_FLOW_BLOCK}`,
      user: "창문 쪽을 본다.",
      sceneDirective: directive,
    });
    const pacing = extractScenePacingBlock(applied.systemText);
    assert.match(pacing, /새 인물 도입: 없음/);
    assert.doesNotMatch(pacing, /트리거·명시적 도착만/);
  });

  it("O10 explicit-arrival=true preserved without widening other paths", () => {
    const withArrival = buildSceneDirective({
      mode: "interactive",
      contentKind: "character",
      primaryCharacterName: PRIMARY,
      knownSupportingCastNames: [SUPPORT],
      triggeredEventText: `${SUPPORT}이 복도에서 나타났다.`,
      currentUserMessage: "고개를 든다.",
      chatId: 912,
      currentTurn: 2,
    });
    assert.equal(withArrival.npcGrounding.newNpcAllowed, true);

    const withoutArrival = fixtureDirective({
      motionDecision: "ESCALATE",
      progressionTypes: ["world_reaction"],
      npcGrounding: {
        existingNpcEligible: false,
        newNpcAllowed: false,
        eligibleActorNames: [],
      },
    });

    const arrivalApplied = wireStandardInteractive({
      system: `[CORE]\n${SCENE_FLOW_BLOCK}`,
      user: "고개를 든다.",
      sceneDirective: withArrival,
    });
    const noArrivalApplied = wireStandardInteractive({
      system: `[CORE]\n${SCENE_FLOW_BLOCK}`,
      user: "밖을 본다.",
      sceneDirective: withoutArrival,
    });

    const arrivalPacing = extractScenePacingBlock(arrivalApplied.systemText);
    const noArrivalPacing = extractScenePacingBlock(noArrivalApplied.systemText);
    assert.match(arrivalPacing, /새 인물 도입: 트리거·명시적 도착만/);
    assert.match(noArrivalPacing, /새 인물 도입: 없음/);
    assert.doesNotMatch(noArrivalPacing, /트리거·명시적 도착만/);
  });
});
