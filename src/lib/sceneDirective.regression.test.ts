/**
 * SceneDirective root-cause regression pack (Q1–Q18).
 * Deterministic — no provider calls.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ChatMsg } from "@/lib/ai";
import {
  analyzeStagnation,
  buildSceneDirective,
  detectSceneStagnation,
  getLastProgressionSelectionMeta,
  renderSceneDirectiveForPrompt,
  resolveNpcGrounding,
  selectProgressionTypesWeighted,
} from "@/lib/sceneDirective";

function msgs(pairs: Array<[ChatMsg["role"], string]>): ChatMsg[] {
  return pairs.map(([role, content]) => ({ role, content }));
}

const quietRomance: ChatMsg[] = [
  { role: "assistant", content: "휴게실 조명이 낮게 켜져 있었다. 그는 소파에 앉아 장갑을 정리했다." },
  { role: "user", content: "옆에 앉는다." },
  { role: "assistant", content: "그는 대답 없이 손끝만 잠깐 멈췄다. 창밖은 고요했다." },
  { role: "user", content: "조금만 더 이대로." },
];

const stagnantReassurance: ChatMsg[] = [
  { role: "assistant", content: "괜찮아. 말하지 않아도 돼." },
  { role: "user", content: "응." },
  { role: "assistant", content: "정말 괜찮아. 미안해." },
  { role: "user", content: "..." },
  { role: "assistant", content: "괜찮으면 그냥 곁에 있을게." },
  { role: "user", content: "응." },
];

const slowBurnShortReplies: ChatMsg[] = [
  { role: "assistant", content: "소파에 기대앉는다." },
  { role: "user", content: "응." },
  { role: "assistant", content: "어깨에 손을 올린다." },
  { role: "user", content: "…" },
  { role: "assistant", content: "호흡이 맞춰진다." },
  { role: "user", content: "그대로." },
];

const activeUserLed: ChatMsg[] = [
  { role: "assistant", content: "복도 끝에서 안개가 옅어 보인다." },
  { role: "user", content: "이쪽으로 빠져나가자. 발소리만 따라와." },
  { role: "assistant", content: "고개를 끄덕이며 문을 연다." },
  { role: "user", content: "저쪽 바람결이 바뀌었다. 계속 이동한다." },
];

describe("sceneDirective root-cause regression Q1–Q18", () => {
  it("Q1 quiet romance — HOLD or MICRO, no ungrounded npc_action", () => {
    const d = buildSceneDirective({
      mode: "interactive",
      contentKind: "character",
      primaryCharacterName: "태형",
      chatId: 101,
      currentTurn: 4,
      recentMessages: quietRomance,
      currentUserMessage: "손을 가볍게 겹친다.",
    });
    assert.ok(d.motionDecision === "HOLD" || d.motionDecision === "MICRO_MOTION");
    assert.ok(!d.progressionTypes.includes("npc_action"));
    assert.equal(d.npcGrounding.newNpcAllowed, false);
  });

  it("Q2 active user-led progression — HOLD, no stacked unrelated event", () => {
    const d = buildSceneDirective({
      mode: "interactive",
      contentKind: "character",
      primaryCharacterName: "에녹",
      chatId: 102,
      currentTurn: 5,
      recentMessages: activeUserLed,
      currentUserMessage: "골목 입구로 들어간다.",
    });
    assert.equal(d.motionDecision, "HOLD");
    assert.deepEqual(d.progressionTypes, []);
    assert.ok(d.motionReasons.includes("user_led_progress"));
  });

  it("Q3 short replies slow burn — not false-positive stagnation", () => {
    const analysis = analyzeStagnation(slowBurnShortReplies);
    assert.equal(analysis.recentStagnation, false);
    assert.equal(detectSceneStagnation(slowBurnShortReplies), false);
  });

  it("Q4 repeated reassurance stagnation — motion without new NPC", () => {
    const d = buildSceneDirective({
      mode: "interactive",
      contentKind: "character",
      primaryCharacterName: "태형",
      chatId: 104,
      currentTurn: 8,
      recentMessages: stagnantReassurance,
      currentUserMessage: "응.",
    });
    assert.equal(d.recentStagnation, true);
    assert.ok(d.progressionTypes.length >= 1 || d.motionDecision === "MICRO_MOTION");
    assert.ok(!d.npcGrounding.newNpcAllowed);
  });

  it("Q5 investigation / no established NPC — npc_action not eligible", () => {
    const { meta } = selectProgressionTypesWeighted({
      sceneSignalText: "보관함에서 단서와 기록을 찾는다.",
      groundingText: "조직 단서",
      intensity: 3,
      stagnant: false,
      chatId: 105,
      currentTurn: 2,
      sceneCastMode: "single_primary",
      knownSupportingCastNames: [],
      activeSpeakingCast: ["수사관"],
    });
    assert.ok(!meta.eligible.includes("npc_action"));
  });

  it("Q6 investigation / existing NPC — existing NPC may act", () => {
    const grounding = resolveNpcGrounding({
      sceneSignalText: "윤태건이 보관함 앞에 서 있다.",
      groundingText: "",
      knownSupportingCastNames: ["윤태건"],
      activeSpeakingCast: ["수사관", "윤태건"],
    });
    assert.equal(grounding.existingNpcEligible, true);
    assert.ok(grounding.eligibleActorNames.includes("윤태건"));
  });

  it("Q7 operation / no established NPC — npc_action not eligible", () => {
    const { meta } = selectProgressionTypesWeighted({
      sceneSignalText: "작전 회의에서 침투와 구출 경로를 논의한다.",
      groundingText: "",
      intensity: 4,
      stagnant: false,
      chatId: 107,
      currentTurn: 2,
      sceneCastMode: "single_primary",
      knownSupportingCastNames: [],
      activeSpeakingCast: ["지휘관"],
    });
    assert.ok(!meta.eligible.includes("npc_action"));
  });

  it("Q8 operation / grounded guard — guard may act when named in cast", () => {
    const { meta } = selectProgressionTypesWeighted({
      sceneSignalText: "작전 회의에서 침투 경로를 논의한다. 경비 김철수가 대기 중.",
      groundingText: "",
      intensity: 4,
      stagnant: false,
      chatId: 108,
      currentTurn: 2,
      sceneCastMode: "single_primary",
      knownSupportingCastNames: ["김철수"],
      activeSpeakingCast: ["지휘관", "김철수"],
    });
    assert.ok(meta.eligible.includes("npc_action"));
  });

  it("Q9 explicit triggered support arrival — external actor eligible", () => {
    const grounding = resolveNpcGrounding({
      sceneSignalText: "작전 중이다.",
      groundingText: "지원팀 경비대",
      triggeredEventText: "[TRIGGER] 윤태건이 지원으로 도착했다.",
      knownSupportingCastNames: ["윤태건"],
      activeSpeakingCast: ["지휘관"],
    });
    assert.equal(grounding.newNpcAllowed, true);
    assert.ok(grounding.eligibleActorNames.includes("윤태건"));
  });

  it("Q10 generic word only (경비) — lexical alone does not ground NPC", () => {
    const grounding = resolveNpcGrounding({
      sceneSignalText: "복도 끝에 경비가 서 있다고 적혀 있다.",
      groundingText: "",
      knownSupportingCastNames: [],
      activeSpeakingCast: ["주인공"],
    });
    assert.equal(grounding.existingNpcEligible, false);
    assert.equal(grounding.newNpcAllowed, false);
    assert.ok(grounding.sources.includes("lexical_only"));
  });

  it("Q11 existing consequence preferred before unrelated new event", () => {
    const { types } = selectProgressionTypesWeighted({
      sceneSignalText: "이전 선택의 결과가 아직 미완료다. 조용히 앉아 있다.",
      groundingText: "미완료 결과",
      intensity: 2,
      stagnant: true,
      chatId: 111,
      currentTurn: 3,
      sceneCastMode: "single_primary",
    });
    assert.ok(types.length >= 1, String(types));
    assert.ok(!types.includes("npc_action"));
    assert.ok(!types.includes("tactical_planning"));
  });

  it("Q12 quiet scene — HOLD with empty progressionTypes", () => {
    const d = buildSceneDirective({
      mode: "interactive",
      contentKind: "character",
      primaryCharacterName: "태형",
      chatId: 112,
      currentTurn: 3,
      recentMessages: quietRomance,
      currentUserMessage: "조용히 손을 잡는다.",
    });
    assert.equal(d.motionDecision, "HOLD");
    assert.deepEqual(d.progressionTypes, []);
    const block = renderSceneDirectiveForPrompt(d);
    assert.match(block, /전개 필요: 없음/);
    assert.match(block, /새 인물 도입: 없음/);
  });

  it("Q13 cooldown 4 turns — same primary not spammed 3-in-a-row", () => {
    const history: Array<{ turn: number; types: import("./sceneDirective").SceneProgressionType[] }> =
      [];
    const primaries: string[] = [];
    for (let turn = 1; turn <= 8; turn++) {
      const d = buildSceneDirective({
        mode: "interactive",
        contentKind: "character",
        primaryCharacterName: "태형",
        chatId: 113,
        currentTurn: turn,
        recentMessages: stagnantReassurance,
        currentUserMessage: "응.",
        progressionHistory: history.slice(-4),
      });
      if (d.progressionTypes[0]) primaries.push(d.progressionTypes[0]);
      history.push({ turn, types: d.progressionTypes });
    }
    for (let i = 0; i < primaries.length - 2; i++) {
      const triple = primaries.slice(i, i + 3);
      assert.ok(
        !(triple[0] === triple[1] && triple[1] === triple[2]),
        `3-in-a-row: ${triple.join(",")}`
      );
    }
  });

  it("Q14 auto progression — preserves motion when stagnant", () => {
    const d = buildSceneDirective({
      mode: "auto_progression",
      contentKind: "character",
      primaryCharacterName: "태형",
      chatId: 114,
      currentTurn: 6,
      recentMessages: stagnantReassurance,
      currentUserMessage: "계속 진행",
    });
    assert.notEqual(d.motionDecision, "HOLD");
    assert.ok(d.progressionTypes.length >= 1 || d.motionDecision === "MICRO_MOTION");
  });

  it("Q15 simulation — ensemble motion preserved", () => {
    const d = buildSceneDirective({
      mode: "interactive",
      contentKind: "simulation",
      primaryCharacterName: "서윤",
      establishedActiveCastNames: ["도진", "관리 AI"],
      chatId: 115,
      currentTurn: 2,
      currentUserMessage: "경보가 울렸다.",
    });
    assert.equal(d.castFocus.sceneCastMode, "simulation");
    assert.notEqual(d.motionDecision, "HOLD");
    assert.ok(d.progressionTypes.length >= 1);
  });

  it("Q16 party — ensemble behavior preserved", () => {
    const d = buildSceneDirective({
      mode: "interactive",
      contentKind: "character",
      party: true,
      primaryCharacterName: "리더",
      establishedActiveCastNames: ["부관", "정찰"],
      chatId: 116,
      currentTurn: 2,
      currentUserMessage: "전진한다.",
    });
    assert.equal(d.castFocus.sceneCastMode, "ensemble");
    assert.notEqual(d.motionDecision, "HOLD");
  });

  it("Q17 regenerate — same turn deterministic selection", () => {
    const input = {
      mode: "interactive" as const,
      contentKind: "character" as const,
      primaryCharacterName: "태형",
      chatId: 117,
      currentTurn: 4,
      recentMessages: quietRomance,
      currentUserMessage: "손을 겹친다.",
    };
    assert.deepEqual(
      buildSceneDirective(input).progressionTypes,
      buildSceneDirective(input).progressionTypes
    );
  });

  it("Q18 early greeting — first turn can HOLD on quiet scene", () => {
    const d = buildSceneDirective({
      mode: "interactive",
      contentKind: "character",
      primaryCharacterName: "태형",
      chatId: 118,
      currentTurn: 1,
      recentMessages: [{ role: "assistant", content: "안녕. 오늘은 조용히 쉬자." }],
      currentUserMessage: "응, 좋아.",
    });
    assert.ok(d.motionDecision === "HOLD" || d.motionDecision === "MICRO_MOTION");
    assert.ok(!d.npcGrounding.newNpcAllowed);
  });

  it("H1 FORCED_MOTION — quiet rest intensity 0 does not force progression", () => {
    const d = buildSceneDirective({
      mode: "interactive",
      contentKind: "character",
      primaryCharacterName: "태형",
      chatId: 201,
      currentTurn: 4,
      recentMessages: quietRomance,
      currentUserMessage: "손을 겹친다.",
    });
    assert.equal(d.recommendedIntensity, 0);
    assert.equal(d.motionDecision, "HOLD");
    assert.deepEqual(d.progressionTypes, []);
  });

  it("H3 LEXICAL_NPC_GROUNDING — generic 경비 does not make npc_action eligible", () => {
    const { meta } = selectProgressionTypesWeighted({
      sceneSignalText: "복도 끝에 경비가 서 있다.",
      groundingText: "",
      intensity: 1,
      stagnant: false,
      chatId: 203,
      currentTurn: 2,
      sceneCastMode: "single_primary",
    });
    assert.ok(!meta.eligible.includes("npc_action"));
    assert.equal(getLastProgressionSelectionMeta()?.npcGrounding.existingNpcEligible, false);
  });
});
