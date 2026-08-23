import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifySceneMode,
  DEFAULT_MODEL_ROUTE_STATE,
  detectSafewordStop,
  isCanonicalSafewordInvocation,
  resolveAdultEligibility,
  resolveAdultRoutingConfig,
  resolveEffectiveConsentMode,
  type ModelRouteState,
} from "./adultSceneRouting";
import { resolveAdultDeliveryPlan } from "./adultDeliveryPlan";
import {
  buildAdvancedProseNsfwGuidelines,
  ADULT_CONTENT_POLICY_CNC_PERMISSION,
} from "./advancedProseNsfwGuidelines";
import {
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
} from "./chatModels";
import { resolveAdultRefusalFallbackModelId } from "./adultHandoffSourceRouting";

const GEMINI = CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL;
const DEEPSEEK = CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL;
const ALLOWED = ["standard", "cnc_opt_in"] as const;

const CNC_T1_INPUT =
  "OOC: CNC 강압 역할극에 사전 동의한다. 세이프워드는 레드다.";
const CNC_T2_INPUT = "계속해.";
const CNC_T3_INPUT = "레드";
const FALSE_POSITIVE_INPUT = "그녀의 레드 드레스가 눈에 띄었다.";

const config = resolveAdultRoutingConfig({ ADULT_SCENE_ROUTING_ENABLED: "true" });
const eligible = resolveAdultEligibility({
  userAdultVerified: true,
  adultContentVisibilityEnabled: true,
  participants: [{ age: 28, isAdult: true }],
});

function cncPolicyPresent(activeConsentMode: "standard" | "cnc_opt_in"): boolean {
  const block = buildAdvancedProseNsfwGuidelines({
    nsfwEnabled: true,
    activeConsentMode,
  });
  return block.includes(ADULT_CONTENT_POLICY_CNC_PERMISSION);
}

function explicitSceneState(consent: "standard" | "cnc_opt_in"): ModelRouteState {
  return {
    ...DEFAULT_MODEL_ROUTE_STATE,
    currentSceneMode: "explicit",
    sexualContextActive: true,
    activeConsentMode: consent,
  };
}

function deliveryPlanForTurn(input: {
  currentInput: string;
  state: ModelRouteState;
  activeConsentMode: "standard" | "cnc_opt_in";
  classification: ReturnType<typeof classifySceneMode>;
}) {
  return resolveAdultDeliveryPlan({
    routingEnabled: true,
    eligibility: eligible,
    silentRefusalFallback: true,
    selectedModelId: GEMINI,
    adultTargetModelId: resolveAdultRefusalFallbackModelId(GEMINI),
    classification: input.classification,
    state: input.state,
    adultDialogueProfile: "auto",
    providerCapabilities: config.providerCapabilities,
    chatAdultModeEnabled: true,
  });
}

describe("CNC scene-scoped lifecycle (T1 → T2 → T3)", () => {
  it("T1 — explicit CNC opt-in activates policy; Gemini stays primary", () => {
    const previous = DEFAULT_MODEL_ROUTE_STATE;
    const consent = resolveEffectiveConsentMode({
      requested: undefined,
      previous: previous.activeConsentMode,
      currentInput: CNC_T1_INPUT,
      allowedConsentModes: [...ALLOWED],
      sceneReset: false,
    });
    assert.equal(consent, "cnc_opt_in");

    const classification = classifySceneMode({
      currentInput: CNC_T1_INPUT,
      previousSceneMode: previous.currentSceneMode,
      activeConsentMode: consent,
      previousConsentMode: previous.activeConsentMode,
    });
    assert.equal(classification.hardStop, false);

    const plan = deliveryPlanForTurn({
      currentInput: CNC_T1_INPUT,
      state: previous,
      activeConsentMode: consent,
      classification,
    });
    assert.equal(plan.primaryModelId, GEMINI);
    assert.equal(plan.fallbackModelId, DEEPSEEK);
    assert.equal(cncPolicyPresent(consent), true);
  });

  it("T2 — ordinary continuation keeps cnc_opt_in without repeated OOC opt-in", () => {
    const previous = explicitSceneState("cnc_opt_in");
    const consent = resolveEffectiveConsentMode({
      requested: undefined,
      previous: previous.activeConsentMode,
      currentInput: CNC_T2_INPUT,
      allowedConsentModes: [...ALLOWED],
      sceneReset: false,
    });
    assert.equal(consent, "cnc_opt_in");

    const classification = classifySceneMode({
      currentInput: CNC_T2_INPUT,
      previousSceneMode: previous.currentSceneMode,
      recentRawText: "합의된 CNC 성인 장면이 진행 중이다.",
      activeConsentMode: consent,
      previousConsentMode: previous.activeConsentMode,
    });
    assert.equal(classification.hardStop, false);

    const plan = deliveryPlanForTurn({
      currentInput: CNC_T2_INPUT,
      state: previous,
      activeConsentMode: consent,
      classification,
    });
    assert.equal(plan.primaryModelId, GEMINI);
    assert.equal(cncPolicyPresent(consent), true);
    assert.equal(plan.fallbackPrepared, true);
  });

  it("T3 — standalone 레드 safeword resets consent and blocks handoff", () => {
    const previous = explicitSceneState("cnc_opt_in");
    assert.equal(isCanonicalSafewordInvocation(CNC_T3_INPUT), true);
    assert.equal(
      detectSafewordStop(CNC_T3_INPUT, { previousConsentMode: "cnc_opt_in" }),
      true
    );

    const consent = resolveEffectiveConsentMode({
      requested: undefined,
      previous: previous.activeConsentMode,
      currentInput: CNC_T3_INPUT,
      allowedConsentModes: [...ALLOWED],
      sceneReset: false,
    });
    assert.equal(consent, "standard");

    const classification = classifySceneMode({
      currentInput: CNC_T3_INPUT,
      previousSceneMode: previous.currentSceneMode,
      activeConsentMode: consent,
      previousConsentMode: previous.activeConsentMode,
    });
    assert.equal(classification.hardStop, true);

    const plan = deliveryPlanForTurn({
      currentInput: CNC_T3_INPUT,
      state: previous,
      activeConsentMode: consent,
      classification,
    });
    assert.equal(plan.fallbackPrepared, false);
    assert.equal(cncPolicyPresent(consent), false);
  });

  it("false positive — ordinary sentence with 레드 is not a safeword stop", () => {
    assert.equal(isCanonicalSafewordInvocation(FALSE_POSITIVE_INPUT), false);
    assert.equal(
      detectSafewordStop(FALSE_POSITIVE_INPUT, {
        previousConsentMode: "cnc_opt_in",
      }),
      false
    );
    const classification = classifySceneMode({
      currentInput: FALSE_POSITIVE_INPUT,
      previousSceneMode: "explicit",
      activeConsentMode: "cnc_opt_in",
      previousConsentMode: "cnc_opt_in",
    });
    assert.equal(classification.hardStop, false);
    const consent = resolveEffectiveConsentMode({
      requested: undefined,
      previous: "cnc_opt_in",
      currentInput: FALSE_POSITIVE_INPUT,
      allowedConsentModes: [...ALLOWED],
    });
    assert.equal(consent, "cnc_opt_in");
  });
});
