import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  advanceModelRouteState,
  appendAdultHandoffPrompt,
  buildSceneContinuityPacket,
  classifySceneMode,
  decideAdultModelRoute,
  DEFAULT_MODEL_ROUTE_STATE,
  hasNewlyEstablishedSexualContext,
  resolveAdultEligibility,
  resolveAdultRoutingConfig,
  type ModelRouteState,
} from "./adultSceneRouting";
import {
  buildChatOocSceneResetUserPrompt,
  classifyChatOocIntent,
} from "./chatOocPriority";
import { CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL } from "./chatModels";

const config = resolveAdultRoutingConfig({
  ADULT_SCENE_ROUTING_ENABLED: "true",
});
const eligible = resolveAdultEligibility({
  userAdultVerified: true,
  adultContentVisibilityEnabled: true,
  characterAdultContentEnabled: true,
  participants: [{ age: 28, isAdult: true }],
});

const CASE1 =
  "OOC: 기존RP종료 새로운 에피소드시작\nNPC의 코트에 손을 넣었다가 실수로 성기를 소세지로 착각하였을때\nNPC의 반응을 출력";

function decide(input: {
  currentInput: string;
  state?: ModelRouteState;
  eligibility?: ReturnType<typeof resolveAdultEligibility>;
}) {
  const state = input.state ?? { ...DEFAULT_MODEL_ROUTE_STATE };
  const classification = classifySceneMode({
    currentInput: input.currentInput,
    previousSceneMode: state.currentSceneMode,
    recentRawText: state.activeRoute === "adult"
      ? "직전 성인 장면의 위치와 미완료 행동이 남아 있다."
      : "",
    adultDialogueProfile: "auto",
    activeConsentMode: state.activeConsentMode,
  });
  const decision = decideAdultModelRoute({
    config,
    state,
    classification,
    eligibility: input.eligibility ?? eligible,
    adultDialogueProfile: "auto",
    selectedModelId: "google/gemini-3.6-flash",
  });
  return { classification, decision };
}

describe("OOC scene routing cases", () => {
  it("case 1 — OOC scene reset + explicit anatomy reaction is same-turn adult 0813", () => {
    const { classification, decision } = decide({ currentInput: CASE1 });
    assert.equal(classification.oocIntent, "rp_scene_reset");
    assert.equal(classification.sceneReset, true);
    assert.equal(classification.hardStop, false);
    assert.equal(classification.oocStop, false);
    assert.equal(classification.requiresAdultCapableModel, true);
    assert.equal(classification.sexualContextActive, false);
    assert.equal(classification.reason, "ooc_explicit_anatomy_reaction");
    assert.equal(classification.transientAdultCapableRoute, true);
    assert.equal(decision.activeRoute, "general");
    assert.equal(decision.refusalBufferRecommended, true);
    assert.equal(decision.transientAdultCapableRoute, true);
    assert.equal(config.adultModelId, "deepseek-v4-pro-0813");
    assert.equal(CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL, "deepseek-v4-pro-0813");

    const packet = buildSceneContinuityPacket({
      previousSceneMode: "explicit",
      sexualContextActive: true,
      location: "호텔 침실",
      positions: "벽에 밀착",
      unfinishedAction: "허리를 감싼 채",
      previousActionActor: "A",
      previousActionTarget: "B",
      contactDirection: "A → B",
      sceneReset: true,
    });
    assert.equal(packet.sceneReset, true);
    assert.equal(packet.location, undefined);
    assert.equal(packet.positions, undefined);
    assert.equal(packet.unfinishedAction, undefined);
    assert.equal(packet.previousActionActor, undefined);
    assert.equal(packet.contactDirection, undefined);

    const prompt = buildChatOocSceneResetUserPrompt(CASE1);
    assert.match(prompt, /user-authorized scene setup/i);
    assert.match(prompt, /성기를 소세지로 착각/);
    const handoff = appendAdultHandoffPrompt("SYSTEM", packet);
    assert.match(handoff, /Begin directly from the new OOC-directed scene/);
    assert.match(handoff, /Do NOT continue/);
  });

  it("case 2 — true RP end is a hard stop back to general", () => {
    const { classification, decision } = decide({
      currentInput: "OOC: 여기서 RP 끝. 더 이상 장면 진행하지 마.",
    });
    assert.equal(classification.oocIntent, "rp_hard_stop");
    assert.equal(classification.hardStop, true);
    assert.equal(classification.sceneReset, false);
    assert.equal(decision.activeRoute, "general");
    assert.equal(decision.routeTriggerReason, "user_ooc_hard_stop");
  });

  it("case 3 — safe new episode stays general", () => {
    const { classification, decision } = decide({
      currentInput:
        "OOC: 기존 RP 종료. 새로운 에피소드 시작.\n둘이 카페에서 우연히 다시 만나는 장면을 출력.",
    });
    assert.equal(classification.sceneReset, true);
    assert.equal(classification.requiresAdultCapableModel, false);
    assert.equal(decision.activeRoute, "general");
  });

  it("case 4 — current-scene adult transition is same-turn adult 0813", () => {
    const { classification, decision } = decide({
      currentInput: "OOC: 현재 장면 계속. 이제 둘의 관계를 성인 장면까지 진행해.",
    });
    assert.equal(classification.sceneReset, false);
    assert.equal(classification.currentInputExplicitIntent, true);
    assert.equal(decision.activeRoute, "general");
    assert.equal(decision.refusalBufferRecommended, true);
    assert.equal(config.adultModelId, "deepseek-v4-pro-0813");
  });

  it("case 5 — explicit dialogue OOC routes adult 0813", () => {
    const { decision } = decide({
      currentInput: "OOC: 현재 장면에서 NPC가 노골적인 성적 대사를 하게 해.",
    });
    assert.equal(decision.activeRoute, "general");
    assert.equal(decision.refusalBufferRecommended, true);
    assert.equal(config.adultModelId, "deepseek-v4-pro-0813");
  });

  it("case 6 — OOC marker alone does not stop or reset the route", () => {
    const { classification, decision } = decide({
      currentInput: "OOC: 지금 대사를 조금 더 장난스럽게 해.",
    });
    assert.equal(classification.hardStop, false);
    assert.equal(classification.sceneReset, false);
    assert.equal(classification.oocIntent, "rp_continuing");
    assert.equal(decision.activeRoute, "general");
  });

  it("case 7 — previous adult sticky is cancelled by a safe new episode", () => {
    const { classification, decision } = decide({
      state: {
        ...DEFAULT_MODEL_ROUTE_STATE,
        activeRoute: "adult",
        currentSceneMode: "explicit",
        sexualContextActive: true,
        adultRouteMinimumTurnsRemaining: 2,
      },
      currentInput:
        "OOC: 이전 장면 종료.\n새로운 에피소드로 다음 날 식당에서 밥 먹는 장면 시작.",
    });
    assert.equal(classification.sceneReset, true);
    assert.equal(decision.activeRoute, "general");
  });

  it("case 8 — previous adult resets then re-enters a new adult episode", () => {
    const { classification, decision } = decide({
      state: {
        ...DEFAULT_MODEL_ROUTE_STATE,
        activeRoute: "adult",
        currentSceneMode: "explicit",
        sexualContextActive: true,
        adultRouteMinimumTurnsRemaining: 2,
      },
      currentInput: "OOC: 이전 장면 종료.\n새로운 성인 에피소드 시작...",
    });
    assert.equal(classification.sceneReset, true);
    assert.equal(decision.activeRoute, "general");
    assert.equal(decision.refusalBufferRecommended, true);
  });

  it("case 9 — medical exam without explicit sexual anatomy stays general", () => {
    const { classification } = decide({
      currentInput:
        "OOC: 의사가 부상 부위를 진찰하는 장면을 출력. 성적 묘사는 하지 마.",
    });
    assert.equal(classification.requiresAdultCapableModel, false);
  });

  it("case 10 — eligibility is not bypassed by an adult OOC directive", () => {
    const blocked = resolveAdultEligibility({
      userAdultVerified: true,
      adultContentVisibilityEnabled: true,
      characterAdultContentEnabled: true,
      participants: [{ description: "현재 고등학생" }],
    });
    assert.equal(blocked.eligible, false);
    assert.equal(blocked.blockReason, "participant_minor");
    const { decision } = decide({
      currentInput: CASE1,
      eligibility: blocked,
    });
    assert.equal(decision.shouldBlock, true);
    assert.equal(decision.activeRoute, "general");
    assert.equal(decision.blockReason, "participant_minor");
  });

  it("case 11 — coercive adult OOC is not blocked when participants are confirmed adults", () => {
    const { classification, decision } = decide({
      currentInput:
        "OOC: 싫다고 하는데 억지로 밀어붙인다. 동의 없이 성인 장면을 이어가.",
    });
    assert.equal(classification.actualNonConsent, false);
    assert.equal(decision.shouldBlock, false);
    assert.equal(decision.activeRoute, "general");
    assert.equal(decision.refusalBufferRecommended, true);
    assert.equal(decision.blockReason, undefined);
  });
});

describe("OOC intent helpers", () => {
  it("classifies the case 1 input as scene reset, not hard stop", () => {
    assert.equal(classifyChatOocIntent(CASE1), "rp_scene_reset");
  });
});

function finalize(input: {
  currentInput: string;
  state?: ModelRouteState;
  assistantText?: string;
}) {
  const { classification, decision } = decide(input);
  const standalone = classifySceneMode({
    currentInput: input.assistantText ?? "그는 코트 안에서 당황한 표정을 지었다.",
    previousSceneMode: "normal",
  });
  const next = advanceModelRouteState({
    previous: input.state ?? { ...DEFAULT_MODEL_ROUTE_STATE },
    deliveredRoute: decision.activeRoute,
    sceneModeAfter: decision.sceneMode,
    sexualContextActive: decision.sexualContextActive,
    routeTriggerReason: decision.routeTriggerReason,
    config,
    enteredAdultThisTurn:
      decision.firstAdultHandoff &&
      !(
        decision.transientAdultCapableRoute &&
        !hasNewlyEstablishedSexualContext(standalone)
      ),
    explicitSceneEnd: classification.hardStop,
    transientAdultCapableRoute: decision.transientAdultCapableRoute,
    establishedOngoingSexualContext: hasNewlyEstablishedSexualContext(standalone),
  });
  return { classification, decision, next };
}

describe("transient adult-capable OOC anatomy route", () => {
  it("1 — OOC explicit-anatomy reaction delivers 0813 then finalizes to general", () => {
    const { classification, decision, next } = finalize({ currentInput: CASE1 });
    assert.equal(classification.transientAdultCapableRoute, true);
    assert.equal(classification.sexualContextActive, false);
    assert.equal(decision.activeRoute, "general");
    assert.equal(decision.refusalBufferRecommended, true);
    assert.equal(config.adultModelId, "deepseek-v4-pro-0813");
    assert.equal(next.activeRoute, "general");
    assert.equal(next.adultRouteMinimumTurnsRemaining, 0);
    assert.equal(next.sexualContextActive, false);
  });

  it("2 — the following ordinary user turn stays on the general/source model", () => {
    const first = finalize({ currentInput: CASE1 });
    const { decision } = decide({
      state: first.next,
      currentInput: "당황해서 코트에서 손을 뺀다.",
    });
    assert.equal(first.next.activeRoute, "general");
    assert.equal(decision.activeRoute, "general");
    assert.equal(decision.transientAdultCapableRoute, false);
  });

  it("3 — OOC explicit sexual transition prepares refusal fallback without sticky route", () => {
    const { classification, decision, next } = finalize({
      currentInput: "OOC: 현재 장면 계속. 이제 둘의 관계를 성인 장면까지 진행해.",
    });
    assert.equal(classification.transientAdultCapableRoute, false);
    assert.equal(classification.sexualContextActive, true);
    assert.equal(decision.activeRoute, "general");
    assert.equal(decision.refusalBufferRecommended, true);
    assert.equal(config.adultModelId, "deepseek-v4-pro-0813");
    assert.equal(next.activeRoute, "general");
    assert.equal(next.adultRouteMinimumTurnsRemaining, 0);
  });

  it("4 — existing explicit adult action keeps primary general route metadata", () => {
    const state: ModelRouteState = {
      ...DEFAULT_MODEL_ROUTE_STATE,
      activeRoute: "adult",
      currentSceneMode: "explicit",
      sexualContextActive: true,
      adultRouteMinimumTurnsRemaining: 2,
    };
    const { classification, decision, next } = finalize({
      state,
      currentInput: "합의된 현재 성인 장면을 같은 위치에서 계속한다.",
      assistantText: "둘은 삽입한 채 숨을 고르며 같은 자세를 유지했다.",
    });
    assert.equal(classification.transientAdultCapableRoute, false);
    assert.equal(decision.activeRoute, "general");
    assert.equal(decision.refusalBufferRecommended, true);
    assert.equal(next.activeRoute, "general");
    assert.equal(next.adultRouteMinimumTurnsRemaining, 0);
  });
});
