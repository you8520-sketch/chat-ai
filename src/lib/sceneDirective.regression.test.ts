/**
 * SceneDirective root-cause regression pack (Q1–Q32).
 * Deterministic — no provider calls. Synthetic fixture names only.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ChatMsg } from "@/lib/ai";
import {
  analyzeStagnation,
  buildSceneDirective,
  detectSceneStagnation,
  detectUserLedProgress,
  getLastProgressionSelectionMeta,
  renderSceneDirectiveForPrompt,
  renderSceneEngineRule,
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

describe("sceneDirective root-cause regression Q1–Q32", () => {
  it("Q1 quiet romance — HOLD or MICRO, no ungrounded npc_action", () => {
    const d = buildSceneDirective({
      mode: "interactive",
      contentKind: "character",
      primaryCharacterName: "테스트주인공",
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
      primaryCharacterName: "테스트주인공",
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
      primaryCharacterName: "테스트주인공",
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
      activeSpeakingCast: ["테스트수사관"],
    });
    assert.ok(!meta.eligible.includes("npc_action"));
  });

  it("Q6 investigation / existing NPC — existing NPC may act", () => {
    const grounding = resolveNpcGrounding({
      sceneSignalText: "테스트조연이 보관함 앞에 서 있다.",
      groundingText: "",
      knownSupportingCastNames: ["테스트조연"],
      activeSpeakingCast: ["테스트수사관", "테스트조연"],
    });
    assert.equal(grounding.existingNpcEligible, true);
    assert.ok(grounding.eligibleActorNames.includes("테스트조연"));
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
      activeSpeakingCast: ["테스트지휘관"],
    });
    assert.ok(!meta.eligible.includes("npc_action"));
  });

  it("Q8 operation / grounded guard — guard may act when named in cast", () => {
    const { meta } = selectProgressionTypesWeighted({
      sceneSignalText: "작전 회의에서 침투 경로를 논의한다. 경비 테스트경비가 대기 중.",
      groundingText: "",
      intensity: 4,
      stagnant: false,
      chatId: 108,
      currentTurn: 2,
      sceneCastMode: "single_primary",
      knownSupportingCastNames: ["테스트경비"],
      activeSpeakingCast: ["테스트지휘관", "테스트경비"],
    });
    assert.ok(meta.eligible.includes("npc_action"));
  });

  it("Q9 explicit triggered support arrival — external actor eligible", () => {
    const grounding = resolveNpcGrounding({
      sceneSignalText: "작전 중이다.",
      groundingText: "지원팀 경비대",
      triggeredEventText: "[TRIGGER] 테스트조연이 지원으로 도착했다.",
      knownSupportingCastNames: ["테스트조연"],
      activeSpeakingCast: ["테스트지휘관"],
    });
    assert.equal(grounding.newNpcAllowed, true);
    assert.ok(grounding.eligibleActorNames.includes("테스트조연"));
  });

  it("Q10 generic word only (경비) — lexical alone does not ground NPC", () => {
    const grounding = resolveNpcGrounding({
      sceneSignalText: "복도 끝에 경비가 서 있다고 적혀 있다.",
      groundingText: "",
      knownSupportingCastNames: [],
      activeSpeakingCast: ["테스트주인공"],
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
      primaryCharacterName: "테스트주인공",
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
        primaryCharacterName: "테스트주인공",
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
      primaryCharacterName: "테스트주인공",
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
      primaryCharacterName: "테스트시뮬주인공",
      establishedActiveCastNames: ["테스트조연B", "테스트시설AI"],
      chatId: 115,
      currentTurn: 2,
      currentUserMessage: "경보가 울렸다.",
    });
    assert.equal(d.castFocus.sceneCastMode, "simulation");
    assert.notEqual(d.motionDecision, "HOLD");
    assert.ok(d.progressionTypes.length >= 1);
  });

  it("Q16 party — motion policy matches single_primary for same scene", () => {
    const shared = {
      mode: "interactive" as const,
      contentKind: "character" as const,
      primaryCharacterName: "테스트리더",
      chatId: 116,
      currentTurn: 2,
      currentUserMessage: "작전 회의를 계속하자. 침투 경로를 다시 짠다.",
      recentMessages: [
        { role: "assistant", content: "작전실에서 지도를 펼치고 침투 경로를 검토했다." },
      ],
    };
    const party = buildSceneDirective({
      ...shared,
      party: true,
      establishedActiveCastNames: ["테스트부관", "테스트정찰"],
    });
    const single = buildSceneDirective(shared);
    assert.equal(party.castFocus.sceneCastMode, "ensemble");
    assert.equal(party.motionDecision, single.motionDecision);
    assert.ok(!party.motionReasons.includes("ensemble_mode"));
  });

  it("Q17 regenerate — same turn deterministic selection", () => {
    const input = {
      mode: "interactive" as const,
      contentKind: "character" as const,
      primaryCharacterName: "테스트주인공",
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
      primaryCharacterName: "테스트주인공",
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
      primaryCharacterName: "테스트주인공",
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

  it("Q19 HOLD prompt — no contradictory mandatory-motion instruction", () => {
    const d = buildSceneDirective({
      mode: "interactive",
      contentKind: "character",
      primaryCharacterName: "테스트주인공",
      chatId: 219,
      currentTurn: 4,
      recentMessages: quietRomance,
      currentUserMessage: "손을 겹친다.",
    });
    assert.equal(d.motionDecision, "HOLD");
    const block = renderSceneDirectiveForPrompt(d);
    assert.doesNotMatch(block, /하나를 조용히 움직인/);
    assert.doesNotMatch(block, /관계, 단서, 환경, NPC, 세계 반응/);
    assert.match(block, /별도 사건, 새 전개 축, 새 인물 도입 의무는 없다/);
    assert.match(block, /전개 필요: 없음/);
    assert.equal(renderSceneEngineRule("HOLD").includes("의무는 없다"), true);
  });

  it("Q20 lore-only NPC — not scene-present => existingNpcEligible=false", () => {
    const grounding = resolveNpcGrounding({
      sceneSignalText: "조용히 소파에 앉아 있다.",
      groundingText: "테스트조연은 과거 동료였고 작전 기록에 자주 등장한다.",
      knownSupportingCastNames: ["테스트조연"],
      activeSpeakingCast: ["테스트주인공"],
    });
    assert.equal(grounding.existingNpcEligible, false);
    assert.deepEqual(grounding.eligibleActorNames, []);
  });

  it("Q21 known NPC explicitly current/present => existingNpcEligible=true", () => {
    const grounding = resolveNpcGrounding({
      sceneSignalText: "테스트조연이 입구에 서 있다.",
      groundingText: "",
      knownSupportingCastNames: ["테스트조연"],
      activeSpeakingCast: ["테스트주인공", "테스트조연"],
    });
    assert.equal(grounding.existingNpcEligible, true);
    assert.ok(grounding.eligibleActorNames.includes("테스트조연"));
  });

  it("Q22 departed/off-scene NPC => not eligible for npc_action", () => {
    const grounding = resolveNpcGrounding({
      sceneSignalText: "테스트조연은 이미 퇴장했다. 테스트주인공만 남아 있다.",
      groundingText: "",
      knownSupportingCastNames: ["테스트조연"],
      activeSpeakingCast: ["테스트주인공"],
    });
    assert.equal(grounding.existingNpcEligible, false);
    const { meta } = selectProgressionTypesWeighted({
      sceneSignalText: "테스트조연은 이미 퇴장했다. 테스트주인공만 남아 있다.",
      groundingText: "",
      intensity: 2,
      stagnant: false,
      chatId: 222,
      currentTurn: 3,
      sceneCastMode: "single_primary",
      knownSupportingCastNames: ["테스트조연"],
      activeSpeakingCast: ["테스트주인공"],
    });
    assert.ok(!meta.eligible.includes("npc_action"));
  });

  it("Q23 long emotional dialogue without action => userLedProgress=false", () => {
    const longEmotional =
      "사실은… 오늘 하루 종일 네 생각뿐이었어. 말하지 못했지만, 네가 곁에 있어서 정말 다행이라고 느꼈어. 이런 마음을 어떻게 표현해야 할지 모르겠어.";
    assert.equal(
      detectUserLedProgress({ currentUserMessage: longEmotional }),
      false
    );
    const d = buildSceneDirective({
      mode: "interactive",
      contentKind: "character",
      primaryCharacterName: "테스트주인공",
      chatId: 223,
      currentTurn: 5,
      recentMessages: quietRomance,
      currentUserMessage: longEmotional,
    });
    assert.notEqual(d.motionReasons[0], "user_led_progress");
  });

  it("Q24 substring collision — 질문/문득 do not trigger userLedProgress", () => {
    assert.equal(detectUserLedProgress({ currentUserMessage: "질문 하나만 해도 될까?" }), false);
    assert.equal(detectUserLedProgress({ currentUserMessage: "문득 생각이 났어." }), false);
  });

  it("Q25 quiet interactive party — cast count alone does not force SCENE_ADVANCE", () => {
    const d = buildSceneDirective({
      mode: "interactive",
      contentKind: "character",
      party: true,
      primaryCharacterName: "테스트리더",
      establishedActiveCastNames: ["테스트부관", "테스트정찰"],
      chatId: 225,
      currentTurn: 4,
      recentMessages: quietRomance,
      currentUserMessage: "조용히 앉아 있자.",
    });
    assert.equal(d.castFocus.sceneCastMode, "ensemble");
    assert.ok(d.motionDecision === "HOLD" || d.motionDecision === "MICRO_MOTION");
  });

  it("Q26 auto progression quiet non-stagnant => MICRO_MOTION per continue contract", () => {
    const d = buildSceneDirective({
      mode: "auto_progression",
      contentKind: "character",
      primaryCharacterName: "테스트주인공",
      chatId: 226,
      currentTurn: 3,
      recentMessages: quietRomance,
      currentUserMessage: "자동진행",
    });
    assert.equal(d.recentStagnation, false);
    assert.equal(d.motionDecision, "MICRO_MOTION");
    assert.notEqual(d.motionDecision, "HOLD");
    assert.ok(d.progressionTypes.length >= 1);
  });

  it("Q27 vague contact + organization memory != new NPC arrival", () => {
    const grounding = resolveNpcGrounding({
      sceneSignalText: "조용히 앉아 있다.",
      groundingText: "조직 기록과 부대 연락망",
      triggeredEventText: "[TRIGGER] 연락이 왔다.",
      knownSupportingCastNames: [],
      activeSpeakingCast: ["테스트주인공"],
    });
    assert.equal(grounding.newNpcAllowed, false);
  });

  it("Q28 explicit support arrival => newNpcAllowed", () => {
    const grounding = resolveNpcGrounding({
      sceneSignalText: "작전 중이다.",
      groundingText: "",
      triggeredEventText: "[TRIGGER] 지원팀이 도착했다.",
      knownSupportingCastNames: [],
      activeSpeakingCast: ["테스트지휘관"],
    });
    assert.equal(grounding.newNpcAllowed, true);
  });

  it("Q29 full-build departed NPC — recent mention must not leak into activeSpeakingCast", () => {
    const d = buildSceneDirective({
      mode: "interactive",
      contentKind: "character",
      primaryCharacterName: "테스트주인공",
      knownSupportingCastNames: ["테스트조연"],
      chatId: 929,
      currentTurn: 5,
      recentMessages: [
        { role: "assistant", content: "테스트조연은 이미 퇴장했다." },
        { role: "user", content: "..." },
      ],
      currentUserMessage: "테스트주인공을 바라본다.",
    });
    assert.ok(!d.castFocus.activeSpeakingCast.includes("테스트조연"));
    assert.ok(!d.npcGrounding.eligibleActorNames.includes("테스트조연"));
    assert.equal(d.npcGrounding.existingNpcEligible, false);
    assert.ok(!d.progressionTypes.includes("npc_action"));
  });

  it("Q30 historical mention != presence — recall does not add supporting cast", () => {
    const d = buildSceneDirective({
      mode: "interactive",
      contentKind: "character",
      primaryCharacterName: "테스트주인공",
      knownSupportingCastNames: ["테스트조연"],
      chatId: 930,
      currentTurn: 4,
      recentMessages: [
        { role: "assistant", content: "테스트조연이 전에 했던 말이 떠올랐다." },
      ],
      currentUserMessage: "조용히 앉아 있다.",
    });
    assert.deepEqual(d.castFocus.activeSpeakingCast, ["테스트주인공"]);
    assert.equal(d.npcGrounding.existingNpcEligible, false);
    assert.ok(!d.npcGrounding.eligibleActorNames.includes("테스트조연"));
  });

  it("Q31 named remote contact != arrival — existing eligible but no newNpcAllowed", () => {
    const d = buildSceneDirective({
      mode: "interactive",
      contentKind: "character",
      primaryCharacterName: "테스트주인공",
      knownSupportingCastNames: ["테스트조연"],
      triggeredEventText: "[TRIGGER] 테스트조연에게서 연락이 왔다.",
      chatId: 931,
      currentTurn: 5,
      currentUserMessage: "메시지를 확인한다.",
    });
    assert.equal(d.npcGrounding.existingNpcEligible, true);
    assert.equal(d.npcGrounding.newNpcAllowed, false);
  });

  it("Q32 empty multi-cast grounding invariant — no ungrounded npc_action", () => {
    const party = buildSceneDirective({
      mode: "interactive",
      contentKind: "character",
      party: true,
      primaryCharacterName: "테스트리더",
      establishedActiveCastNames: [],
      chatId: 932,
      currentTurn: 3,
      currentUserMessage: "회의를 계속하자.",
      recentMessages: [
        { role: "assistant", content: "작전실에서 지도를 펼쳤다." },
      ],
    });
    assert.equal(party.castFocus.sceneCastMode, "ensemble");
    assert.equal(party.npcGrounding.existingNpcEligible, false);
    assert.equal(party.npcGrounding.newNpcAllowed, false);
    assert.ok(!party.progressionTypes.includes("npc_action"));

    const simulation = buildSceneDirective({
      mode: "interactive",
      contentKind: "simulation",
      primaryCharacterName: "테스트시뮬주인공",
      establishedActiveCastNames: [],
      chatId: 933,
      currentTurn: 2,
      currentUserMessage: "경보가 울렸다.",
    });
    assert.equal(simulation.castFocus.sceneCastMode, "simulation");
    assert.equal(simulation.npcGrounding.existingNpcEligible, false);
    assert.ok(!simulation.progressionTypes.includes("npc_action"));
  });
});
