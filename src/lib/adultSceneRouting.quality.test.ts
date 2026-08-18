import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assessParticipantAdultStatus,
  advanceModelRouteState,
  DEFAULT_MODEL_ROUTE_STATE,
  classifySceneMode,
  decideAdultModelRoute,
  detectActualNonConsent,
  extractHandoffContinuityFromAssistantText,
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
  "adult-scene routing master switch defaults on; general-user gate stays separate"
);
const eligibility = resolveAdultEligibility({
  userAdultVerified: true,
  adultContentVisibilityEnabled: true,
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
      explicitSceneEnd: classification.hardStop,
    });
  });
});

it("extracts actor/target contact direction to block handoff inversion", () => {
  const extracted = extractHandoffContinuityFromAssistantText({
    text: "호텔 침실에서 라이크가 렌의 허리를 감싸 안았다. 「괜찮아?」",
    characterName: "라이크",
    personaName: "렌",
  });
  assert.equal(extracted.previousActionActor, "라이크");
  assert.equal(extracted.previousActionTarget, "렌");
  assert.match(extracted.contactDirection ?? "", /라이크 → 렌/);
  assert.ok(extracted.location);
  assert.equal(extracted.currentSpeechState, "괜찮아?");
});

it("uses user-stated waist wrap as character→persona contact direction", () => {
  const extracted = extractHandoffContinuityFromAssistantText({
    text: "호텔 거실 조명이 낮았다.",
    characterName: "밤의 비서실장",
    personaName: "렌",
    currentUserText: "내 허리를 감싼 손길을 느끼며 더 가까이 간다.",
  });
  assert.equal(extracted.previousActionTarget, "렌");
  assert.ok(extracted.previousActionActor);
  assert.match(extracted.contactDirection ?? "", /→ 렌 contact/);
});

it("chat-room adult mode OFF disables handoff without hard-blocking", () => {
  const off = resolveAdultEligibility({
    userAdultVerified: true,
    adultContentVisibilityEnabled: false,
    characterAdultContentEnabled: true,
    participants: [{ age: 28, isAdult: true }],
  });
  assert.equal(off.eligible, false);
  assert.equal(off.allowedByAdultContentPolicy, true);
  assert.equal(off.blockReason, "adult_visibility_off");

  const classification = classifySceneMode({
    currentInput: "합의된 노골적인 성적 대사를 이어간다.",
    previousSceneMode: "romantic",
    recentRawText: "모든 등장인물은 25세 이상 가상 성인이며 합의 모드가 확인됐다.",
    adultDialogueProfile: "auto",
    activeConsentMode: "standard",
  });
  const decision = decideAdultModelRoute({
    config,
    state: DEFAULT_MODEL_ROUTE_STATE,
    classification,
    eligibility: off,
    adultDialogueProfile: "auto",
    selectedModelId: "gpt-5.6-terra",
  });
  assert.equal(decision.activeRoute, "general");
  assert.equal(decision.shouldBlock, false);
});

it("chat-room adult mode OFF breaks sticky adult handoff", () => {
  const off = resolveAdultEligibility({
    userAdultVerified: true,
    adultContentVisibilityEnabled: false,
    characterAdultContentEnabled: true,
    participants: [{ age: 28, isAdult: true }],
  });
  const classification = classifySceneMode({
    currentInput: "합의된 현재 성인 장면을 같은 위치에서 계속한다.",
    previousSceneMode: "explicit",
    recentRawText: "합의된 성인 장면이 진행 중이다.",
    adultDialogueProfile: "auto",
    activeConsentMode: "standard",
  });
  const decision = decideAdultModelRoute({
    config,
    state: {
      ...DEFAULT_MODEL_ROUTE_STATE,
      activeRoute: "adult",
      currentSceneMode: "explicit",
      sexualContextActive: true,
    },
    classification,
    eligibility: off,
    adultDialogueProfile: "auto",
    selectedModelId: "gpt-5.6-terra",
  });
  assert.equal(decision.activeRoute, "general");
  assert.equal(decision.shouldBlock, false);
});

it("keeps blocking minors and real people, but never blocks coercion / non-consent", () => {
  const adultParticipants = [{ age: 28, isAdult: true, description: "28세 가상 성인" }];
  const coercive =
    "싫다고 하는데 억지로 밀어붙인다. 동의 없이 성인 장면을 이어가.";
  assert.equal(detectActualNonConsent(coercive), false);
  assert.equal(
    classifySceneMode({
      currentInput: coercive,
      previousSceneMode: "normal",
      recentRawText: "호텔 스위트 침실.",
    }).actualNonConsent,
    false
  );

  const allowed = resolveAdultEligibility({
    userAdultVerified: true,
    adultContentVisibilityEnabled: true,
    characterAdultContentEnabled: true,
    participants: adultParticipants,
    actualNonConsent: true,
  });
  assert.equal(allowed.eligible, true);
  assert.equal(allowed.allowedByAdultContentPolicy, true);
  assert.equal(allowed.blockReason, undefined);

  const classification = classifySceneMode({
    currentInput:
      "싫다고 하는데 억지로 밀어붙인다. 옷을 벗기고 삽입하는 성인 장면을 이어가.",
    previousSceneMode: "explicit",
    recentRawText: "둘 다 28세 가상 성인이다. 침대에서 밀착했다.",
  });
  const decision = decideAdultModelRoute({
    config,
    state: {
      ...DEFAULT_MODEL_ROUTE_STATE,
      activeRoute: "adult",
      currentSceneMode: "explicit",
      sexualContextActive: true,
    },
    classification,
    eligibility: allowed,
    adultDialogueProfile: "auto",
    selectedModelId: "deepseek-v4-pro-0813",
  });
  assert.equal(decision.shouldBlock, false);
  assert.equal(decision.activeRoute, "adult");

  const minor = resolveAdultEligibility({
    userAdultVerified: true,
    adultContentVisibilityEnabled: true,
    characterAdultContentEnabled: true,
    participants: [{ description: "현재 고등학생" }],
    actualNonConsent: true,
  });
  assert.equal(minor.eligible, false);
  assert.equal(minor.blockReason, "participant_minor");

  const realPerson = resolveAdultEligibility({
    userAdultVerified: true,
    adultContentVisibilityEnabled: true,
    characterAdultContentEnabled: true,
    participants: [{ description: "실존 인물 연예인", isRealPerson: true }],
  });
  assert.equal(realPerson.eligible, false);
  assert.equal(realPerson.blockReason, "real_person");
});
