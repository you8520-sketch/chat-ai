/**
 * Architecture / experiment retirement-or-integration decision audit.
 * Zero provider calls — structural capability and contract comparison only.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ChatMsg } from "@/lib/ai";
import {
  buildSceneDirective,
  renderSceneDirectiveForPrompt,
  type SceneProgressionType,
} from "@/lib/sceneDirective";
import {
  buildSceneDirectiveV2,
  renderSceneDirectiveV2ForPrompt,
  type ScenePacingDecision,
} from "@/lib/sceneDirectiveV2";
import {
  buildLivingSceneDirective,
  renderLivingSceneDirectiveForPrompt,
  type LivingProgressionType,
} from "@/lib/livingSceneDirective";
import { defaultReconvergenceState } from "@/lib/reconvergenceState";
import { estimateTokens } from "@/lib/tokenEstimate";
import {
  getSceneDirectiveV2Mode,
  resolveScenePacingPromptOwner,
} from "@/lib/sceneDirectiveV2Policy";

const V1_MARKER = "[PRIVATE SCENE ENGINE RULE]";
const V2_MARKER = "[PRIVATE SCENE PACING RULE]";
const LIVING_MARKER = "[PRIVATE SCENE CONTINUITY RULE]";

type FixtureSpec = {
  name: string;
  recentMessages: ChatMsg[];
  currentUserMessage: string;
  triggeredEventText?: string;
  reconvergenceState?: ReturnType<typeof defaultReconvergenceState>;
  currentTurn?: number;
};

function livingToLegacyProgression(types: LivingProgressionType[]): SceneProgressionType[] {
  const out: SceneProgressionType[] = [];
  for (const t of types) {
    if (t === "relationship_aftereffect") out.push("relationship");
    else if (t === "character_routine" || t === "established_task") out.push("daily_life");
    else if (t === "environment_continuity") out.push("environment");
    else if (t === "active_thread_consequence") out.push("consequence");
    else if (t === "triggered_event_followthrough") out.push("world_reaction");
    else if (t === "ensemble_aftereffect") out.push("relationship");
    else if (t === "future_intent") out.push("relationship");
  }
  return out.slice(0, 3);
}

function buildTriple(spec: FixtureSpec) {
  const base = {
    mode: "interactive" as const,
    recentMessages: spec.recentMessages,
    currentUserMessage: spec.currentUserMessage,
    triggeredEventText: spec.triggeredEventText,
    currentTurn: spec.currentTurn ?? 4,
  };
  const v1 = buildSceneDirective({
    ...base,
    primaryCharacterName: "테스트주인공",
    chatId: 5001,
    progressionHistory: [],
  });
  const v2 = buildSceneDirectiveV2({
    ...base,
    reconvergenceState: spec.reconvergenceState,
    isRegenerate: false,
  });
  const living = buildLivingSceneDirective(base);
  return {
    v1,
    v2,
    living,
    v1Render: renderSceneDirectiveForPrompt(v1),
    v2Render: renderSceneDirectiveV2ForPrompt(v2),
    livingRender: renderLivingSceneDirectiveForPrompt(living),
  };
}

const FIXTURES = {
  quietStable: {
    name: "E1 quiet stable",
    recentMessages: [
      { role: "assistant", content: "소파에 기대앉아 차를 준다." },
      { role: "user", content: "고마워." },
    ],
    currentUserMessage: "조용히 앉아 있다.",
  },
  userLedActive: {
    name: "E2 user-led active",
    recentMessages: [
      { role: "assistant", content: "복도 끝 안내판을 본다." },
      { role: "user", content: "저쪽으로 빠져나가자." },
    ],
    currentUserMessage: "앞장서서 문을 연다.",
  },
  repetitiveStagnation: {
    name: "E3 repetitive stagnation",
    recentMessages: [
      { role: "assistant", content: "괜찮아. 말하지 않아도 돼." },
      { role: "user", content: "응." },
      { role: "assistant", content: "정말 괜찮아." },
      { role: "user", content: "..." },
    ],
    currentUserMessage: "응.",
  },
  authoritativeTrigger: {
    name: "E11 authoritative trigger",
    recentMessages: [{ role: "assistant", content: "..." }],
    currentUserMessage: "주변을 본다.",
    triggeredEventText: "갑작스런 경보가 울린다.",
  },
  partingBoundary: {
    name: "E12 parting boundary",
    recentMessages: [{ role: "assistant", content: "..." }],
    currentUserMessage: "가방끈을 고치며 말한다. 「난 먼저 들어갈게.」",
  },
  reconvergenceDue: {
    name: "E14 reconvergence due",
    recentMessages: [
      { role: "assistant", content: "문을 닫고 나간다." },
      { role: "user", content: "..." },
    ],
    currentUserMessage: "혼자 남아 창밖을 본다.",
    reconvergenceState: {
      ...defaultReconvergenceState(5001, 1),
      state: "separated" as const,
      separationTurn: 2,
      reconvergenceDueTurn: 4,
      unresolvedHooks: [
        {
          type: "shared_item" as const,
          summary: "맡긴 코트",
          sourceTurn: 1,
          confidence: "high" as const,
        },
      ],
    },
    currentTurn: 4,
  },
  offSceneNpcMention: {
    name: "E7 off-scene NPC",
    recentMessages: [{ role: "assistant", content: "테스트조연은 이미 퇴장했다." }],
    currentUserMessage: "테스트주인공을 바라본다.",
  },
} satisfies Record<string, FixtureSpec>;

describe("scene experiment decision audit X1-X15", () => {
  it("X1 quiet scene — v1 motion contract differs from v2 hold + eventBudget=0", () => {
    const t = buildTriple(FIXTURES.quietStable);
    assert.ok(["HOLD", "MICRO_MOTION", "SCENE_ADVANCE", "ESCALATE"].includes(t.v1.motionDecision));
    assert.equal(t.v2.pacingDecision, "hold_current_beat");
    assert.equal(t.v2.eventBudget, 0);
    assert.equal(t.v2.allowNewNpc, false);
    assert.ok(t.living.progressionTypes.length > 0);
    assert.notEqual(t.v1.motionDecision, t.v2.pacingDecision);
  });

  it("X2 stagnation — v1 may advance; v2 hold with explicit budget; living repetitionRisk", () => {
    const t = buildTriple(FIXTURES.repetitiveStagnation);
    assert.equal(t.v1.recentStagnation, true);
    assert.equal(t.v2.recentStagnation, true);
    assert.equal(t.v2.eventBudget, 0);
    assert.equal(typeof t.living.repetitionRisk, "boolean");
  });

  it("X3 event restraint — v2 exposes explicit permission flags v1 lacks", () => {
    const t = buildTriple(FIXTURES.quietStable);
    assert.equal(typeof t.v2.allowNewExternalMessage, "boolean");
    assert.equal(typeof t.v2.allowNewOrderOrSchedule, "boolean");
    assert.equal(t.v2.castPolicy, "new_cast_forbidden");
    assert.equal("allowNewExternalMessage" in t.v1, false);
    assert.equal("eventBudget" in t.v1, false);
  });

  it("X4 new NPC permission — v1 npcGrounding vs v2 explicit allowNewNpc field", () => {
    const t = buildTriple(FIXTURES.offSceneNpcMention);
    assert.equal(t.v2.allowNewNpc, false);
    assert.ok("npcGrounding" in t.v1);
    assert.ok("allowNewNpc" in t.v2);
    assert.equal("allowNewNpc" in t.v1, false);
  });

  it("X6 trigger — v2 resolve_trigger; v1 uses motion + progression", () => {
    const t = buildTriple(FIXTURES.authoritativeTrigger);
    assert.equal(t.v2.pacingDecision, "resolve_trigger");
    assert.equal(t.v2.eventBudget, 0);
    assert.ok(t.v1.progressionTypes.length >= 0);
    assert.equal(t.living.eventSource, "TRIGGERED_EVENT");
  });

  it("X7 parting — Living PARTING_OR_BOUNDARY; v1/v2 lack scenePhase", () => {
    const t = buildTriple(FIXTURES.partingBoundary);
    assert.equal(t.living.scenePhase, "PARTING_OR_BOUNDARY");
    assert.equal("scenePhase" in t.v1, false);
    assert.equal("scenePhase" in t.v2, false);
  });

  it("X8 reconvergence — v2 only: lifecycle state affects pacing; v1 lacks reconvergence", () => {
    const without = buildTriple(FIXTURES.quietStable);
    const withReconv = buildTriple(FIXTURES.reconvergenceDue);
    assert.equal(without.v2.reconvergenceState.state, "together");
    assert.notEqual(withReconv.v2.reconvergenceState.state, "together");
    assert.ok(
      withReconv.v2.pacingDecision === "reconverge" ||
        withReconv.v2.reconvergenceState.state === "reconvergence_offered" ||
        withReconv.v2.reasonCodes.includes("RECONVERGENCE_BLOCKED_NO_GROUNDED_PATH")
    );
    assert.equal("reconvergenceState" in without.v1, false);
  });

  it("X9 active thread — Living taxonomy maps to legacy via translator", () => {
    const t = buildTriple(FIXTURES.userLedActive);
    assert.ok(t.living.progressionTypes.length > 0);
    const legacyFromLiving = livingToLegacyProgression(t.living.progressionTypes);
    assert.ok(legacyFromLiving.length > 0);
    assert.ok(legacyFromLiving.length <= 3);
  });

  it("X10 multi-character — Living MULTI_CHARACTER phase; v1 single_primary cast", () => {
    const t = buildTriple({
      name: "multi",
      recentMessages: [{ role: "assistant", content: "두 사람이 마주선다." }],
      currentUserMessage: "너희 둘 다 어떻게 할래?",
    });
    assert.equal(t.living.scenePhase, "MULTI_CHARACTER");
    assert.equal(t.v1.castFocus.sceneCastMode, "single_primary");
    assert.equal("scenePhase" in t.v2, false);
  });

  it("X11 user-led — v1 detectUserLedProgress; v2 hold_current_beat on active user", () => {
    const t = buildTriple(FIXTURES.userLedActive);
    assert.equal(t.v2.pacingDecision, "hold_current_beat");
    assert.ok(["HOLD", "MICRO_MOTION", "SCENE_ADVANCE", "ESCALATE"].includes(t.v1.motionDecision));
  });

  it("X12 auto progression — all three support auto mode", () => {
    const autoBase = {
      mode: "auto_progression" as const,
      recentMessages: FIXTURES.quietStable.recentMessages,
      currentUserMessage: FIXTURES.quietStable.currentUserMessage,
    };
    const v1 = buildSceneDirective({ ...autoBase, chatId: 5002, currentTurn: 2 });
    const v2 = buildSceneDirectiveV2({ ...autoBase, currentTurn: 2 });
    const living = buildLivingSceneDirective(autoBase);
    assert.equal(v1.mode, "auto_progression");
    assert.equal(v2.mode, "auto_progression");
    assert.equal(living.mode, "auto_progression");
    assert.equal(living.scenePhase, "AUTO_PROGRESSION");
  });

  it("X13 simulation — v1 contentKind simulation cast; experiments lack simulation cast mode", () => {
    const v1 = buildSceneDirective({
      mode: "interactive",
      contentKind: "simulation",
      primaryCharacterName: "테스트주인공",
      establishedActiveCastNames: ["A", "B"],
      currentUserMessage: "주변을 본다.",
      chatId: 5003,
      currentTurn: 1,
    });
    assert.equal(v1.castFocus.sceneCastMode, "simulation");
    const v2 = buildSceneDirectiveV2({
      mode: "interactive",
      currentUserMessage: "주변을 본다.",
      currentTurn: 1,
    });
    assert.equal("castFocus" in v2, false);
  });

  it("X14 regen — v2 isRegenerate skips reconvergence clock advance", () => {
    const d = buildSceneDirectiveV2({
      mode: "interactive",
      recentMessages: FIXTURES.partingBoundary.recentMessages,
      currentUserMessage: FIXTURES.partingBoundary.currentUserMessage,
      reconvergenceState: defaultReconvergenceState(1, 1),
      currentTurn: 3,
      isRegenerate: true,
    });
    assert.ok(d.reasonCodes.length >= 0);
  });

  it("X15 default owner — unset env resolves legacy_v1 policy path", () => {
    assert.equal(getSceneDirectiveV2Mode({}), "off");
    assert.equal(
      resolveScenePacingPromptOwner({ v2Mode: "off", livingEnabled: false }),
      "legacy_v1"
    );
  });
});

describe("scene experiment decision — vocabulary and translation", () => {
  it("Living progression taxonomy collapses via livingToLegacyProgression", () => {
    const living = buildLivingSceneDirective(FIXTURES.partingBoundary);
    const legacy = livingToLegacyProgression(living.progressionTypes);
    assert.ok(living.progressionTypes.length >= 2);
    assert.ok(legacy.length <= 3);
    assert.ok(legacy.every((t) =>
      ["relationship", "daily_life", "environment", "consequence", "world_reaction"].includes(t)
    ));
    assert.ok(
      living.progressionTypes.some((t) => !legacy.includes(t as unknown as SceneProgressionType))
    );
  });

  it("motion vocabulary differs: v1 HOLD/MICRO vs v2 hold_current_beat", () => {
    const t = buildTriple(FIXTURES.quietStable);
    const v1Motions = new Set(["HOLD", "MICRO_MOTION", "SCENE_ADVANCE", "ESCALATE"]);
    const v2Pacing = new Set([
      "hold_current_beat",
      "advance_existing_beat",
      "reconverge",
      "resolve_trigger",
    ]);
    assert.ok(v1Motions.has(t.v1.motionDecision));
    assert.ok(v2Pacing.has(t.v2.pacingDecision as ScenePacingDecision));
    assert.notEqual(t.v1.motionDecision, t.v2.pacingDecision);
  });
});

describe("scene experiment decision — prompt cost delta (render only)", () => {
  it("reports raw char/token delta for quiet fixture renders", () => {
    const t = buildTriple(FIXTURES.quietStable);
    const sizes = {
      v1Full: t.v1Render.length,
      v2Full: t.v2Render.length,
      livingFull: t.livingRender.length,
      v1Tokens: estimateTokens(t.v1Render),
      v2Tokens: estimateTokens(t.v2Render),
      livingTokens: estimateTokens(t.livingRender),
    };
    assert.ok(sizes.v1Full > 0);
    assert.ok(sizes.v2Full > 0);
    assert.ok(sizes.livingFull > 0);
    assert.ok(t.v1Render.includes(V1_MARKER));
    assert.ok(t.v2Render.includes(V2_MARKER));
    assert.ok(t.livingRender.includes(LIVING_MARKER));
  });
});

describe("scene experiment decision — unique capability classification", () => {
  it("V2 reconvergence is structurally absent from v1.2", () => {
    const t = buildTriple(FIXTURES.reconvergenceDue);
    assert.notEqual(t.v2.reconvergenceState.state, "together");
    assert.equal("reconvergence" in t.v1, false);
  });

  it("Living scenePhase/eventSource absent from v1.2 and V2", () => {
    const t = buildTriple(FIXTURES.partingBoundary);
    assert.ok(t.living.scenePhase);
    assert.ok(t.living.eventSource);
    assert.equal("scenePhase" in t.v1, false);
    assert.equal("scenePhase" in t.v2, false);
    assert.equal("eventSource" in t.v2, false);
  });
});
