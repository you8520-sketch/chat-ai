/**
 * Standard full vs compact SceneDirective representation audit.
 * Zero provider calls — permission parity, token delta, offline ARM C/F/D.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyProductionServerControlsToMessages,
  countPacingOwners,
  renderCompactScenePacingCue,
} from "@/lib/scenePacingController";
import {
  buildSceneDirective,
  renderSceneDirectiveForPrompt,
  renderSceneExecutionContract,
  renderSceneMotionBody,
  type NpcGroundingResult,
  type SceneDirective,
  type SceneMotionDecision,
  type SceneProgressionType,
} from "@/lib/sceneDirective";
import { SCENE_FLOW_BLOCK } from "@/lib/generationProcessBeatFlow";
import { estimateTokens } from "@/lib/tokenEstimate";
import { buildCompactNoGodmoddingStandardBlock } from "@/lib/noGodmodding";

const PRIMARY = "테스트주인공";
const SUPPORT = "테스트조연";

function fixtureDirective(input: {
  motionDecision: SceneMotionDecision;
  progressionTypes?: SceneProgressionType[];
  npcGrounding?: Partial<NpcGroundingResult> &
    Pick<NpcGroundingResult, "existingNpcEligible" | "newNpcAllowed">;
  recentStagnation?: boolean;
  recommendedIntensity?: SceneDirective["recommendedIntensity"];
}): SceneDirective {
  const npcGrounding: NpcGroundingResult = {
    existingNpcEligible: input.npcGrounding?.existingNpcEligible ?? false,
    newNpcAllowed: input.npcGrounding?.newNpcAllowed ?? false,
    eligibleActorNames: input.npcGrounding?.eligibleActorNames ?? [],
    sources: input.npcGrounding?.sources ?? ["none"],
  };
  return {
    mode: "interactive",
    recentStagnation: input.recentStagnation ?? false,
    recommendedIntensity: input.recommendedIntensity ?? 1,
    motionDecision: input.motionDecision,
    motionReasons: ["quiet_interaction"],
    progressionTypes: input.progressionTypes ?? [],
    avoid: ["괜찮냐는 반복", "유저 의도 작성"],
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

function extractExecutionContract(text: string): string {
  const lines = text.split("\n");
  const idx = lines.findIndex((line) => line.startsWith("전개 필요:"));
  if (idx < 0) return "";
  const out: string[] = [];
  for (let i = idx; i < lines.length; i++) {
    const line = lines[i];
    if (
      out.length > 0 &&
      (line.startsWith("전개 방향:") ||
        line.startsWith("피할 것:") ||
        line.startsWith("다음 장면 힌트:"))
    ) {
      break;
    }
    if (
      line.startsWith("전개 필요:") ||
      line.startsWith("허용된 변화:") ||
      line.startsWith("기존 NPC 행동:") ||
      line.startsWith("새 인물 도입:")
    ) {
      out.push(line);
    } else if (out.length > 0) {
      break;
    }
  }
  return out.join("\n");
}

function contractProjectsNpcAction(d: SceneDirective): boolean {
  return (
    d.progressionTypes.includes("npc_action") && d.npcGrounding.existingNpcEligible
  );
}

function assertPermissionParity(d: SceneDirective, label: string) {
  const compact = renderCompactScenePacingCue(d);
  const full = renderSceneDirectiveForPrompt(d);
  const contract = renderSceneExecutionContract({
    motionDecision: d.motionDecision,
    progressionTypes: d.progressionTypes,
    npcGrounding: d.npcGrounding,
  });
  const body = renderSceneMotionBody(d.motionDecision);

  assert.ok(compact.includes(body), `${label}: compact motion body`);
  assert.ok(full.includes(body), `${label}: full motion body`);
  assert.equal(extractExecutionContract(compact), contract, `${label}: compact contract`);
  assert.equal(extractExecutionContract(full), contract, `${label}: full contract`);

  if (d.motionDecision === "HOLD") {
    assert.match(contract, /전개 필요: 없음/);
    assert.match(contract, /기존 NPC 행동: 없음/);
    assert.match(contract, /새 인물 도입: 없음/);
  } else {
    for (const type of d.progressionTypes) {
      const labels: Record<SceneProgressionType, string> = {
        relationship: "관계 변화",
        daily_life: "생활 변수",
        lore_clue: "단서",
        npc_action: "NPC 행동",
        world_reaction: "세계 반응",
        tactical_planning: "작전/조사",
        consequence: "이전 선택의 결과",
        comedy: "개그/오해",
        environment: "환경 변화",
      };
      assert.match(contract, new RegExp(labels[type].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    if (contractProjectsNpcAction(d)) {
      assert.match(contract, /기존 NPC \(.+\)의 행동만/);
      for (const name of d.npcGrounding.eligibleActorNames) {
        assert.match(contract, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      }
    } else {
      assert.match(contract, /기존 NPC 행동: 없음/);
    }
    if (d.npcGrounding.newNpcAllowed) {
      assert.match(contract, /새 인물 도입: 트리거·명시적 도착만/);
    } else {
      assert.match(contract, /새 인물 도입: 없음/);
    }
  }
}

function renderArmC(d: SceneDirective): string {
  return renderCompactScenePacingCue(d);
}

function renderArmF(d: SceneDirective): string {
  return renderSceneDirectiveForPrompt(d);
}

function renderArmD(d: SceneDirective): string {
  return `${renderArmF(d)}\n\n${renderArmC(d)}`;
}

function tokenDelta(full: string, compact: string) {
  return {
    fullChars: full.length,
    compactChars: compact.length,
    deltaChars: full.length - compact.length,
    fullTokens: estimateTokens(full),
    compactTokens: estimateTokens(compact),
    deltaTokens: estimateTokens(full) - estimateTokens(compact),
  };
}

describe("standard representation audit — F1-F10 permission parity", () => {
  it("F1 HOLD no NPC", () => {
    assertPermissionParity(
      fixtureDirective({
        motionDecision: "HOLD",
        progressionTypes: [],
        npcGrounding: { existingNpcEligible: false, newNpcAllowed: false },
      }),
      "F1"
    );
  });

  it("F2 MICRO relationship", () => {
    assertPermissionParity(
      fixtureDirective({
        motionDecision: "MICRO_MOTION",
        progressionTypes: ["relationship"],
        npcGrounding: { existingNpcEligible: false, newNpcAllowed: false },
      }),
      "F2"
    );
  });

  it("F3 ADVANCE relationship only", () => {
    assertPermissionParity(
      fixtureDirective({
        motionDecision: "SCENE_ADVANCE",
        progressionTypes: ["relationship"],
        npcGrounding: { existingNpcEligible: false, newNpcAllowed: false },
      }),
      "F3"
    );
  });

  it("F4 ADVANCE environment only", () => {
    assertPermissionParity(
      fixtureDirective({
        motionDecision: "SCENE_ADVANCE",
        progressionTypes: ["environment"],
        npcGrounding: { existingNpcEligible: false, newNpcAllowed: false },
      }),
      "F4"
    );
  });

  it("F5 existing grounded NPC", () => {
    assertPermissionParity(
      fixtureDirective({
        motionDecision: "SCENE_ADVANCE",
        progressionTypes: ["npc_action", "relationship"],
        npcGrounding: {
          existingNpcEligible: true,
          newNpcAllowed: false,
          eligibleActorNames: [SUPPORT],
          sources: ["user_named"],
        },
      }),
      "F5"
    );
  });

  it("F6 known but off-scene NPC", () => {
    const d = buildSceneDirective({
      mode: "interactive",
      contentKind: "character",
      primaryCharacterName: PRIMARY,
      knownSupportingCastNames: [SUPPORT],
      recentMessages: [{ role: "assistant", content: `${SUPPORT}은 이미 퇴장했다.` }],
      currentUserMessage: `${PRIMARY}을 바라본다.`,
      chatId: 1001,
      currentTurn: 4,
    });
    assert.equal(d.npcGrounding.existingNpcEligible, false);
    assertPermissionParity(d, "F6");
  });

  it("F7 remote contact", () => {
    const d = buildSceneDirective({
      mode: "interactive",
      contentKind: "character",
      primaryCharacterName: PRIMARY,
      knownSupportingCastNames: [SUPPORT],
      triggeredEventText: "무전으로 연락이 온다.",
      currentUserMessage: "수신한다.",
      chatId: 1002,
      currentTurn: 2,
    });
    assert.equal(d.npcGrounding.newNpcAllowed, false);
    assertPermissionParity(d, "F7");
  });

  it("F8 explicit actor arrival", () => {
    const d = buildSceneDirective({
      mode: "interactive",
      contentKind: "character",
      primaryCharacterName: PRIMARY,
      knownSupportingCastNames: [SUPPORT],
      triggeredEventText: `${SUPPORT}이 문 앞에 도착했다.`,
      currentUserMessage: "문을 연다.",
      chatId: 1003,
      currentTurn: 3,
    });
    assert.equal(d.npcGrounding.newNpcAllowed, true);
    assertPermissionParity(d, "F8");
  });

  it("F9 ESCALATE without new actor", () => {
    assertPermissionParity(
      fixtureDirective({
        motionDecision: "ESCALATE",
        progressionTypes: ["world_reaction", "consequence"],
        npcGrounding: { existingNpcEligible: false, newNpcAllowed: false },
      }),
      "F9"
    );
  });

  it("F10 ESCALATE with explicit arrival", () => {
    const d = buildSceneDirective({
      mode: "interactive",
      contentKind: "character",
      primaryCharacterName: PRIMARY,
      knownSupportingCastNames: [SUPPORT],
      triggeredEventText: `${SUPPORT}이 복도에서 나타났다.`,
      currentUserMessage: "고개를 든다.",
      chatId: 1004,
      currentTurn: 2,
    });
    assert.equal(d.npcGrounding.newNpcAllowed, true);
    assertPermissionParity(d, "F10");
  });
});

describe("standard representation audit — token delta (raw)", () => {
  const cases: Array<{ label: string; directive: SceneDirective }> = [
    {
      label: "HOLD",
      directive: fixtureDirective({
        motionDecision: "HOLD",
        npcGrounding: { existingNpcEligible: false, newNpcAllowed: false },
      }),
    },
    {
      label: "MICRO",
      directive: fixtureDirective({
        motionDecision: "MICRO_MOTION",
        progressionTypes: ["relationship"],
        npcGrounding: { existingNpcEligible: false, newNpcAllowed: false },
      }),
    },
    {
      label: "ADVANCE",
      directive: fixtureDirective({
        motionDecision: "SCENE_ADVANCE",
        progressionTypes: ["relationship"],
        npcGrounding: { existingNpcEligible: false, newNpcAllowed: false },
      }),
    },
    {
      label: "ESCALATE",
      directive: fixtureDirective({
        motionDecision: "ESCALATE",
        progressionTypes: ["world_reaction"],
        npcGrounding: { existingNpcEligible: false, newNpcAllowed: false },
      }),
    },
    {
      label: "NPC_GROUNDED",
      directive: fixtureDirective({
        motionDecision: "SCENE_ADVANCE",
        progressionTypes: ["npc_action"],
        npcGrounding: {
          existingNpcEligible: true,
          newNpcAllowed: false,
          eligibleActorNames: [SUPPORT],
        },
      }),
    },
  ];

  for (const { label, directive } of cases) {
    it(`token delta — ${label}`, () => {
      const delta = tokenDelta(renderArmF(directive), renderArmC(directive));
      assert.ok(delta.deltaChars > 0, `${label}: full is larger than compact`);
      assert.ok(delta.deltaTokens > 0, `${label}: positive token delta`);
    });
  }

  it("average token delta across motion cases", () => {
    const deltas = cases.map(({ directive }) =>
      tokenDelta(renderArmF(directive), renderArmC(directive)).deltaTokens
    );
    const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    assert.ok(avg > 50, "average full-minus-compact token delta recorded");
  });
});

describe("standard representation audit — offline ARM C/F/D", () => {
  const quietRomance = buildSceneDirective({
    mode: "interactive",
    contentKind: "character",
    primaryCharacterName: PRIMARY,
    recentMessages: [
      { role: "assistant", content: "휴게실 조명이 낮게 켜져 있었다." },
      { role: "user", content: "옆에 앉는다." },
    ],
    currentUserMessage: "조금만 더 이대로.",
    chatId: 1101,
    currentTurn: 3,
  });

  it("ARM C compact-only is strict subset of permission contract vs ARM F", () => {
    const c = renderArmC(quietRomance);
    const f = renderArmF(quietRomance);
    assert.equal(extractExecutionContract(c), extractExecutionContract(f));
    assert.doesNotMatch(c, /\[PRIVATE SCENE ENGINE RULE\]/);
    assert.match(f, /\[PRIVATE SCENE ENGINE RULE\]/);
  });

  it("ARM D duplicate — both blocks present (diagnostic only)", () => {
    const d = renderArmD(quietRomance);
    assert.match(d, /\[PRIVATE SCENE ENGINE RULE\]/);
    assert.match(d, /\[SCENE PACING\]/);
    assert.equal((d.match(/\[SCENE PACING\]/g) ?? []).length, 1);
    assert.ok(d.length > renderArmF(quietRomance).length);
  });

  it("ARM F full-only fields do not alter execution contract text", () => {
    const f = renderArmF(quietRomance);
    assert.match(f, /정체 감지:/);
    assert.match(f, /권장 강도:/);
    assert.match(f, /피할 것:/);
    assert.match(f, /유저 조종:/);
    assert.doesNotMatch(renderArmC(quietRomance), /정체 감지:|권장 강도:|피할 것:|유저 조종:/);
  });
});

describe("standard representation audit — final prompt owner inventory (standard wire)", () => {
  it("standard interactive — motion owners and user agency separation", () => {
    const applied = applyProductionServerControlsToMessages({
      messages: [
        {
          role: "system",
          content: `[CORE]\n${buildCompactNoGodmoddingStandardBlock()}\n${SCENE_FLOW_BLOCK}\n[IMMERSIVE PROSE]\nok`,
        },
        { role: "user", content: "조용히 손을 겹친다." },
      ],
      mode: "interactive",
      contentKind: "character",
      primaryCharacterName: PRIMARY,
      currentUserMessage: "조용히 손을 겹친다.",
    });
    const system = applied.messages.find((m) => m.role === "system")?.content ?? "";
    const owners = countPacingOwners(system);
    assert.equal(owners.scene_pacing, 1);
    assert.equal(owners.scene_flow, 0);
    assert.doesNotMatch(system, /\[PRIVATE SCENE ENGINE RULE\]/);
    assert.doesNotMatch(system, /\[이번 턴 장면 지시 - 비공개\]/);
    assert.match(system, /\[USER CONTROL — COLLABORATIVE INTERACTIVE\]/);
    assert.equal(
      (system.match(/\[USER CONTROL — COLLABORATIVE INTERACTIVE\]/g) ?? []).length,
      1
    );
  });

  it("auto progression wire — full block path, no duplicate compact cue", () => {
    const block = renderSceneDirectiveForPrompt(
      buildSceneDirective({
        mode: "auto_progression",
        contentKind: "character",
        primaryCharacterName: PRIMARY,
        currentUserMessage: "계속 진행",
        chatId: 1102,
        currentTurn: 2,
      })
    );
    const applied = applyProductionServerControlsToMessages({
      messages: [
        { role: "system", content: `[CORE]\n${SCENE_FLOW_BLOCK}\n${block}` },
        { role: "user", content: "계속 진행" },
      ],
      mode: "auto_progression",
      contentKind: "character",
      primaryCharacterName: PRIMARY,
      currentUserMessage: "계속 진행",
      skipMotionCue: true,
    });
    const system = applied.messages.find((m) => m.role === "system")?.content ?? "";
    const owners = countPacingOwners(system);
    assert.equal(owners.scene_pacing, 0);
    assert.match(system, /\[PRIVATE SCENE ENGINE RULE\]/);
  });
});

describe("standard representation audit — full-only field presence", () => {
  it("full-only lines are absent from compact and user agency is other owner", () => {
    const d = buildSceneDirective({
      mode: "interactive",
      contentKind: "character",
      primaryCharacterName: PRIMARY,
      currentUserMessage: "시선을 맞춘다.",
      chatId: 1103,
      currentTurn: 2,
    });
    const compact = renderArmC(d);
    const full = renderArmF(d);
    const userAgencyOwner = buildCompactNoGodmoddingStandardBlock();

    assert.match(full, /모드: 일반 RP/);
    assert.match(full, /유저 조종:/);
    assert.doesNotMatch(compact, /모드:|유저 조종:/);
    assert.match(userAgencyOwner, /\[B\]의 새로운 직접 대사/);
    assert.doesNotMatch(compact, /\[B\]의 새로운 직접 대사/);

    if (d.nextBeatHint && d.motionDecision !== "HOLD") {
      assert.match(full, /다음 장면 힌트:/);
      assert.doesNotMatch(compact, /다음 장면 힌트:/);
    }
    if (d.castFocus.sceneCastMode === "single_primary") {
      assert.match(full, /직접 발화 중심:/);
      assert.doesNotMatch(compact, /직접 발화 중심:/);
    }
  });
});
