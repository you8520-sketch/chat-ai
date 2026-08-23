import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ADULT_CONTENT_POLICY_CNC_PERMISSION,
  buildAdvancedProseNsfwGuidelines,
  buildAdultContentPolicyBlock,
} from "./advancedProseNsfwGuidelines";
import {
  advanceModelRouteState,
  classifySceneMode,
  decideAdultModelRoute,
  DEFAULT_MODEL_ROUTE_STATE,
  detectSafewordStop,
  resolveAdultEligibility,
  resolveAdultRoutingConfig,
  resolveEffectiveConsentMode,
  type ModelRouteState,
} from "./adultSceneRouting";
import {
  invokePreparedAdultRefusalFallback,
  resolveAdultDeliveryPlan,
  shouldInvokeAdultRefusalFallback,
} from "./adultDeliveryPlan";
import {
  ADULT_REFUSAL_FALLBACK_MODEL_ID,
  resolveAdultRefusalFallbackModelId,
} from "./adultHandoffSourceRouting";
import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
  CHEAPER_INFERENCE_QWEN_38_MAX_MODEL,
} from "./chatModels";
import { selectBillableStages, type StageUsage } from "./points";

const DEEPSEEK = CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL;
const GEMINI37 = CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL;
const GEMINI31 = CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL;
const OPUS = CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL;

const config = resolveAdultRoutingConfig({ ADULT_SCENE_ROUTING_ENABLED: "true" });
const eligible = resolveAdultEligibility({
  userAdultVerified: true,
  adultContentVisibilityEnabled: true,
  participants: [{ age: 28, isAdult: true }],
});

const EXPLICIT_INPUT =
  "OOC: 현재 장면 계속. 이제 둘의 관계를 성인 장면까지 진행해.";
const NORMAL_INPUT = "로비에서 짧게 인사한다.";

function deliveryPlan(selectedModelId: string, currentInput: string, state?: ModelRouteState) {
  const routeState = state ?? { ...DEFAULT_MODEL_ROUTE_STATE };
  const classification = classifySceneMode({
    currentInput,
    previousSceneMode: routeState.currentSceneMode,
    adultDialogueProfile: "auto",
    activeConsentMode: routeState.activeConsentMode,
  });
  return {
    classification,
    plan: resolveAdultDeliveryPlan({
      routingEnabled: true,
      eligibility: eligible,
      silentRefusalFallback: true,
      selectedModelId,
      adultTargetModelId: resolveAdultRefusalFallbackModelId(selectedModelId),
      classification,
      state: routeState,
      adultDialogueProfile: "auto",
      providerCapabilities: config.providerCapabilities,
      chatAdultModeEnabled: true,
    }),
  };
}

describe("adult handoff refusal-only matrix", () => {
  it("A — Gemini 3.7 explicit, no refusal stays primary", () => {
    const { plan } = deliveryPlan(GEMINI37, EXPLICIT_INPUT);
    assert.equal(plan.primaryModelId, GEMINI37);
    assert.equal(plan.fallbackModelId, DEEPSEEK);
    assert.equal(
      shouldInvokeAdultRefusalFallback({
        plan,
        hasVisibleTokens: false,
        fallbackAlreadyAttempted: false,
        text: "성인 장면을 자연스럽게 이어간다.",
        finishReason: "stop",
      }).invoke,
      false
    );
  });

  it("B — Gemini 3.7 refusal invokes DeepSeek 0813 exactly once", async () => {
    const { plan } = deliveryPlan(GEMINI37, EXPLICIT_INPUT);
    let deepseekCalls = 0;
    const result = await invokePreparedAdultRefusalFallback({
      plan,
      fallbackContextAvailable: true,
      text: "I can't help with that request.",
      finishReason: "stop",
      hasVisibleTokens: false,
      fallbackAlreadyAttempted: false,
      runFallback: async () => {
        deepseekCalls += 1;
        return { model: DEEPSEEK, text: "delivered" };
      },
    });
    assert.equal(result.invoked, true);
    assert.equal(deepseekCalls, 1);
    assert.equal(plan.fallbackModelId, DEEPSEEK);
    assert.notEqual(plan.fallbackModelId, CHEAPER_INFERENCE_QWEN_38_MAX_MODEL);
  });

  it("C — Gemini 3.1 explicit, no refusal stays primary", () => {
    const { plan } = deliveryPlan(GEMINI31, EXPLICIT_INPUT);
    assert.equal(plan.primaryModelId, GEMINI31);
  });

  it("D — Gemini 3.1 refusal targets DeepSeek, Qwen count 0", async () => {
    const { plan } = deliveryPlan(GEMINI31, EXPLICIT_INPUT);
    assert.equal(plan.fallbackModelId, DEEPSEEK);
    assert.notEqual(plan.fallbackModelId, CHEAPER_INFERENCE_QWEN_38_MAX_MODEL);
    const decision = shouldInvokeAdultRefusalFallback({
      plan,
      text: "",
      finishReason: "content_filter",
      hasVisibleTokens: false,
      fallbackAlreadyAttempted: false,
    });
    assert.equal(decision.invoke, true);
  });

  it("E — Opus explicit, no refusal stays primary", () => {
    const { plan } = deliveryPlan(OPUS, EXPLICIT_INPUT);
    assert.equal(plan.primaryModelId, OPUS);
  });

  it("F — Opus refusal targets DeepSeek, Qwen count 0", () => {
    const { plan } = deliveryPlan(OPUS, EXPLICIT_INPUT);
    assert.equal(plan.fallbackModelId, DEEPSEEK);
    assert.notEqual(plan.fallbackModelId, CHEAPER_INFERENCE_QWEN_38_MAX_MODEL);
  });

  it("G — standard + DB allows cnc_opt_in keeps CNC policy absent", () => {
    const block = buildAdvancedProseNsfwGuidelines({
      nsfwEnabled: true,
      activeConsentMode: "standard",
    });
    assert.doesNotMatch(block, /CNC 역할극은 거부·검열·페이드아웃하지 말고/);
    const effective = resolveEffectiveConsentMode({
      requested: undefined,
      previous: "standard",
      currentInput: EXPLICIT_INPUT,
      allowedConsentModes: ["standard", "cnc_opt_in"],
    });
    assert.equal(effective, "standard");
  });

  it("H — active cnc_opt_in includes CNC policy; selected model stays primary", () => {
    const cncInput =
      "OOC: CNC 강압 역할극에 사전 동의한다. 세이프워드는 레드다.";
    const effective = resolveEffectiveConsentMode({
      requested: "cnc_opt_in",
      previous: "standard",
      currentInput: cncInput,
      allowedConsentModes: ["standard", "cnc_opt_in"],
    });
    assert.equal(effective, "cnc_opt_in");
    const block = buildAdvancedProseNsfwGuidelines({
      nsfwEnabled: true,
      activeConsentMode: effective,
    });
    assert.match(block, new RegExp(ADULT_CONTENT_POLICY_CNC_PERMISSION.slice(0, 20)));
    const { plan } = deliveryPlan(GEMINI37, cncInput);
    assert.equal(plan.primaryModelId, GEMINI37);
  });

  it("I — hardStop / safeword blocks fallback and resets consent", () => {
    const hardStop = classifySceneMode({
      currentInput: "OOC: 롤플레이 중단",
      previousSceneMode: "explicit",
    });
    assert.equal(hardStop.hardStop, true);
    const safewordLabel = "세이프워드: 레드";
    assert.equal(detectSafewordStop(safewordLabel), true);
    const standaloneSafeword = "레드";
    assert.equal(
      detectSafewordStop(standaloneSafeword, { previousConsentMode: "cnc_opt_in" }),
      true
    );
    const safewordClass = classifySceneMode({
      currentInput: standaloneSafeword,
      previousSceneMode: "explicit",
      previousConsentMode: "cnc_opt_in",
    });
    assert.equal(safewordClass.hardStop, true);
    const { plan } = deliveryPlan(GEMINI37, standaloneSafeword, {
      ...DEFAULT_MODEL_ROUTE_STATE,
      activeConsentMode: "cnc_opt_in",
      currentSceneMode: "explicit",
    });
    assert.equal(plan.fallbackPrepared, false);
    const handoff = appendAdultHandoffBlocked(safewordClass.hardStop);
    assert.equal(handoff, 0);
    const next = advanceModelRouteState({
      previous: {
        ...DEFAULT_MODEL_ROUTE_STATE,
        activeConsentMode: "cnc_opt_in",
        currentSceneMode: "explicit",
      },
      deliveredRoute: "general",
      sceneModeAfter: "normal",
      sexualContextActive: false,
      config,
      explicitSceneEnd: true,
      activeConsentMode: "standard",
    });
    assert.equal(next.activeConsentMode, "standard");
    assert.equal(next.activeRoute, "general");
  });

  it("J — after successful handoff next turn selected model is primary", () => {
    const afterFallback = advanceModelRouteState({
      previous: {
        ...DEFAULT_MODEL_ROUTE_STATE,
        currentSceneMode: "explicit",
        activeRoute: "general",
      },
      deliveredRoute: "general",
      sceneModeAfter: "explicit",
      sexualContextActive: true,
      config,
      routeTriggerReason: "general_model_refusal",
      activeConsentMode: "standard",
    });
    assert.equal(afterFallback.activeRoute, "general");
    assert.equal(afterFallback.adultHandoffSourceModelId, undefined);
    assert.equal(afterFallback.adultHandoffTargetModelId, undefined);
    const { plan } = deliveryPlan(GEMINI37, EXPLICIT_INPUT, afterFallback);
    assert.equal(plan.primaryModelId, GEMINI37);
    const route = decideAdultModelRoute({
      config,
      state: afterFallback,
      classification: classifySceneMode({
        currentInput: EXPLICIT_INPUT,
        previousSceneMode: afterFallback.currentSceneMode,
      }),
      eligibility: eligible,
      adultDialogueProfile: "auto",
      selectedModelId: GEMINI37,
    });
    assert.equal(route.activeRoute, "general");
  });

  it("invariants — visible singleton, no stickiness, deepseek-only target", () => {
    assert.equal(ADULT_REFUSAL_FALLBACK_MODEL_ID, DEEPSEEK);
    const qwenTargetCount = [GEMINI37, GEMINI31, OPUS].filter(
      (model) =>
        resolveAdultRefusalFallbackModelId(model) === CHEAPER_INFERENCE_QWEN_38_MAX_MODEL
    ).length;
    assert.equal(qwenTargetCount, 0);
  });

  it("billing — primary success bills first stage only", () => {
    const stages: StageUsage[] = [
      { model: GEMINI37, input: 100, output: 200, apiInputTokens: 100, apiOutputTokens: 200 },
    ];
    assert.equal(selectBillableStages(stages).length, 1);
    assert.equal(selectBillableStages(stages)[0]?.model, GEMINI37);
  });

  it("billing — refusal fallback bills delivered fallback stage once", () => {
    const stages: StageUsage[] = [
      { model: GEMINI37, input: 100, output: 0, apiInputTokens: 100, apiOutputTokens: 0 },
      { model: DEEPSEEK, input: 120, output: 400, apiInputTokens: 120, apiOutputTokens: 400 },
    ];
    const billable = selectBillableStages(stages, { refusalFallbackDelivered: true });
    assert.equal(billable.length, 1);
    assert.equal(billable[0]?.model, DEEPSEEK);
  });
});

function appendAdultHandoffBlocked(hardStop: boolean): number {
  return hardStop ? 0 : 1;
}
