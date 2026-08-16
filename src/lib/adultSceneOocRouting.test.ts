import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  appendAdultHandoffPrompt,
  buildSceneContinuityPacket,
  classifySceneMode,
  decideAdultModelRoute,
  DEFAULT_MODEL_ROUTE_STATE,
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
    assert.equal(decision.activeRoute, "adult");
    assert.equal(decision.firstAdultHandoff, true);
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
    assert.equal(decision.activeRoute, "adult");
    assert.equal(config.adultModelId, "deepseek-v4-pro-0813");
  });

  it("case 5 — explicit dialogue OOC routes adult 0813", () => {
    const { decision } = decide({
      currentInput: "OOC: 현재 장면에서 NPC가 노골적인 성적 대사를 하게 해.",
    });
    assert.equal(decision.activeRoute, "adult");
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
    assert.equal(decision.activeRoute, "adult");
    assert.equal(decision.firstAdultHandoff, true);
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
});

describe("OOC intent helpers", () => {
  it("classifies the case 1 input as scene reset, not hard stop", () => {
    assert.equal(classifyChatOocIntent(CASE1), "rp_scene_reset");
  });
});
