import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assessParticipantAdultStatus,
  advanceModelRouteState,
  DEFAULT_MODEL_ROUTE_STATE,
  classifySceneMode,
  decideAdultModelRoute,
  resolveAdultEligibility,
  resolveAdultRoutingConfig,
  type ModelRouteState,
} from "./adultSceneRouting";

it("adult-verified account personas are adult unless their own text has a minor conflict", () => {
  assert.equal(
    assessParticipantAdultStatus({
      description: "말수가 적고 긴 머리를 한 현장 요원",
      isVerifiedAdultUserPersona: true,
    }),
    "confirmed"
  );
  assert.equal(
    assessParticipantAdultStatus({
      description: "현재 고등학생",
      isVerifiedAdultUserPersona: true,
    }),
    "minor"
  );
  assert.equal(
    assessParticipantAdultStatus({
      description: "성인이지만 현재 고등학생이라고 설정됨",
      isVerifiedAdultUserPersona: true,
    }),
    "conflict"
  );
});

const config = resolveAdultRoutingConfig({
  ADULT_SCENE_ROUTING_ENABLED: "true",
});
assert.equal(
  resolveAdultRoutingConfig({}).enabled,
  true,
  "adult-scene routing must default on for the approved general rollout"
);
const eligibility = resolveAdultEligibility({
  userAdultVerified: true,
  characterAdultContentEnabled: true,
  participants: [{ age: 28, isAdult: true }],
});

type RouteCase = {
  id: string;
  expected: "general" | "adult";
  state: ModelRouteState;
  currentInput: string;
  recentRawText: string;
};

const CASES: RouteCase[] = [
  {
    id: "romantic_voice",
    expected: "general",
    state: { ...DEFAULT_MODEL_ROUTE_STATE, currentSceneMode: "romantic" },
    currentInput: "나도 손가락을 천천히 맞물린다.",
    recentRawText: "서로의 손을 잡고 조심스럽게 호감을 확인했다.",
  },
  {
    id: "tension_position",
    expected: "general",
    state: { ...DEFAULT_MODEL_ROUTE_STATE, currentSceneMode: "tension" },
    currentInput: "움직이지 않은 채 네 소매 끝을 붙잡는다.",
    recentRawText: "좁은 창고에서 숨결이 가까워졌지만 입술은 닿지 않았다.",
  },
  {
    id: "explicit_dialogue_boundary",
    expected: "adult",
    state: {
      ...DEFAULT_MODEL_ROUTE_STATE,
      currentSceneMode: "explicit_dialogue",
      sexualContextActive: true,
    },
    currentInput: "나도 한 걸음 다가서며, 원하는 걸 숨기지 말라고 말한다.",
    recentRawText: "서로 성인임과 합의를 확인하고 노골적인 대화를 이어가던 중이다.",
  },
  {
    id: "aftercare_emotion",
    expected: "adult",
    state: {
      ...DEFAULT_MODEL_ROUTE_STATE,
      activeRoute: "adult",
      currentSceneMode: "aftercare",
      adultRouteMinimumTurnsRemaining: 2,
      sexualContextActive: true,
    },
    currentInput: "물을 한 모금 마시고 네 손등 위에 손을 올린다.",
    recentRawText: "관계 후 담요를 덮고 물을 건네며 서로의 상태를 확인했다.",
  },
  {
    id: "safe_return_transition",
    expected: "general",
    state: {
      ...DEFAULT_MODEL_ROUTE_STATE,
      activeRoute: "adult",
      currentSceneMode: "aftercare",
      adultRouteMinimumTurnsRemaining: 0,
      safeSceneStreak: 1,
    },
    currentInput: "다음 날 아침, 가디건을 걸치고 거실로 나간다.",
    recentRawText: "잠들기 전 옆방에 있겠다고 말한 뒤 장면이 끝났다.",
  },
];

describe("adult scene routing — initial five-scenario quality gate", () => {
  for (const scenario of CASES) {
    it(`${scenario.id} routes to ${scenario.expected}`, () => {
      const classification = classifySceneMode({
        currentInput: scenario.currentInput,
        previousSceneMode: scenario.state.currentSceneMode,
        recentRawText: scenario.recentRawText,
        adultDialogueProfile: "auto",
        activeConsentMode: scenario.state.activeConsentMode,
      });
      const decision = decideAdultModelRoute({
        config,
        state: scenario.state,
        classification,
        eligibility,
        adultDialogueProfile: "auto",
        selectedModelId: "google/gemini-3.6-flash",
      });
      assert.equal(decision.activeRoute, scenario.expected);
    });
  }
});

it("routes general → adult entry → sticky adult → explicit exit back to general", () => {
  const inputs = [
    "임무 지도를 펼쳐 다음 이동 경로를 확인한다.",
    "합의된 노골적인 성적 대사를 이어간다.",
    "합의된 현재 성인 장면을 같은 위치에서 계속한다.",
    "OOC: 성인 장면 종료. 다음 날의 일반 임무 장면으로 전환한다.",
  ];
  const expected = ["general", "adult", "adult", "general"];
  let state: ModelRouteState = { ...DEFAULT_MODEL_ROUTE_STATE };

  inputs.forEach((currentInput, index) => {
    const classification = classifySceneMode({
      currentInput,
      previousSceneMode: state.currentSceneMode,
      recentRawText: "모든 등장인물은 25세 이상 가상 성인이며 합의 모드가 확인됐다.",
      adultDialogueProfile: "auto",
      activeConsentMode: state.activeConsentMode,
    });
    const decision = decideAdultModelRoute({
      config,
      state,
      classification,
      eligibility,
      adultDialogueProfile: "auto",
      selectedModelId: "gpt-5.6-luna",
    });
    assert.equal(
      decision.activeRoute,
      expected[index],
      `turn ${index + 1}: ${classification.reason}/${classification.sceneMode}`
    );
    state = advanceModelRouteState({
      previous: state,
      deliveredRoute: decision.activeRoute,
      sceneModeAfter: decision.sceneMode,
      sexualContextActive: decision.sexualContextActive,
      routeTriggerReason: decision.routeTriggerReason,
      config,
      enteredAdultThisTurn: decision.firstAdultHandoff,
      explicitSceneEnd:
        classification.oocStop || classification.clearSceneTransition,
    });
  });
});
