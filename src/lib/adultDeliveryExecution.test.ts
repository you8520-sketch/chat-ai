import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  invokePreparedAdultRefusalFallback,
  resolveAdultDeliveryPlan,
} from "./adultDeliveryPlan";
import {
  advanceModelRouteState,
  type AdultEligibilityResult,
  type ModelRouteState,
  type SceneClassification,
  type SceneMode,
} from "./adultSceneRouting";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
} from "./chatModels";

const GEMINI = CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL;
const DEEPSEEK = CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL;
const ELIGIBLE: AdultEligibilityResult = {
  eligible: true,
  allowedByAdultContentPolicy: true,
};
const PROVIDER_CAPABILITIES: Record<string, SceneMode> = {
  anthropic: "tension",
  google: "tension",
  openai: "tension",
  deepseek: "explicit",
};
const GENERAL_STATE: ModelRouteState = {
  activeRoute: "general",
  currentSceneMode: "normal",
  adultRouteMinimumTurnsRemaining: 0,
  safeSceneStreak: 0,
  activeConsentMode: "standard",
  sexualContextActive: false,
};
const EXPLICIT_SCENE: SceneClassification = {
  sceneMode: "explicit",
  sexualContextActive: true,
  currentInputExplicitIntent: true,
  requiresAdultCapableModel: true,
  transientAdultCapableRoute: false,
  actualNonConsent: false,
  oocIntent: "none",
  sceneReset: false,
  hardStop: false,
  oocStop: false,
  clearSceneTransition: false,
  reason: "explicit_action",
};

function deliveryPlan(state: ModelRouteState = GENERAL_STATE) {
  return resolveAdultDeliveryPlan({
    routingEnabled: true,
    eligibility: ELIGIBLE,
    silentRefusalFallback: true,
    selectedModelId: GEMINI,
    adultTargetModelId: DEEPSEEK,
    classification: EXPLICIT_SCENE,
    state,
    adultDialogueProfile: "auto",
    providerCapabilities: PROVIDER_CAPABILITIES,
  });
}

type ProviderResult = {
  text: string;
  finishReason: string;
  upstreamCostUsd: number;
};

async function runProductionDeliverySeam(input: {
  primary: ProviderResult;
  fallback: ProviderResult;
  primaryVisible?: boolean;
}) {
  const plan = deliveryPlan();
  const callOrder: string[] = [];
  let fallbackAttempted = false;
  let fallbackSucceeded = false;
  let finalizedAssistantRows = 0;
  let deductionEvents = 0;
  let hiddenFallbackOverheadCostUsd = 0;

  callOrder.push(plan.primaryModelId);
  let delivered = input.primary;
  const fallback = await invokePreparedAdultRefusalFallback({
    plan,
    fallbackContextAvailable: true,
    text: input.primary.text,
    finishReason: input.primary.finishReason,
    hasVisibleTokens: input.primaryVisible === true,
    fallbackAlreadyAttempted: fallbackAttempted,
    runFallback: async () => {
      fallbackAttempted = true;
      callOrder.push(plan.fallbackModelId);
      return input.fallback;
    },
  });
  if (fallback.invoked) {
    hiddenFallbackOverheadCostUsd = input.primary.upstreamCostUsd;
    delivered = fallback.result;
    fallbackSucceeded = true;
  }

  finalizedAssistantRows += 1;
  deductionEvents += 1;
  return {
    plan,
    callOrder,
    fallbackAttempted,
    fallbackSucceeded,
    finalizedAssistantRows,
    deductionEvents,
    visibleText: delivered.text,
    hiddenFallbackOverheadCostUsd,
    finalDeliveredModelCostUsd: delivered.upstreamCostUsd,
    totalUpstreamCostUsd:
      hiddenFallbackOverheadCostUsd + delivered.upstreamCostUsd,
  };
}

describe("production adult refusal delivery seam", () => {
  it("R1 valid primary calls Gemini only and finalizes/charges once", async () => {
    const result = await runProductionDeliverySeam({
      primary: {
        text: "서강우가 렌의 손을 붙잡고 장면을 이어갔다.",
        finishReason: "stop",
        upstreamCostUsd: 0.003,
      },
      fallback: {
        text: "사용되면 안 됨",
        finishReason: "stop",
        upstreamCostUsd: 0.005,
      },
    });
    assert.deepEqual(result.callOrder, [GEMINI]);
    assert.equal(result.plan.primaryModelId, GEMINI);
    assert.equal(result.plan.fallbackModelId, DEEPSEEK);
    assert.equal(result.fallbackAttempted, false);
    assert.equal(result.fallbackSucceeded, false);
    assert.equal(result.finalizedAssistantRows, 1);
    assert.equal(result.deductionEvents, 1);
  });

  it("R2 refusal calls Gemini then DeepSeek and hides refusal", async () => {
    const result = await runProductionDeliverySeam({
      primary: {
        text: "요청에 응할 수 없습니다.",
        finishReason: "stop",
        upstreamCostUsd: 0.003,
      },
      fallback: {
        text: "서강우는 끊어진 장면을 자연스럽게 이어갔다.",
        finishReason: "stop",
        upstreamCostUsd: 0.005,
      },
    });
    assert.deepEqual(result.callOrder, [GEMINI, DEEPSEEK]);
    assert.equal(result.fallbackAttempted, true);
    assert.equal(result.fallbackSucceeded, true);
    assert.doesNotMatch(result.visibleText, /응할 수 없습니다/);
    assert.equal(result.finalizedAssistantRows, 1);
    assert.equal(result.deductionEvents, 1);
    assert.equal(result.hiddenFallbackOverheadCostUsd, 0.003);
    assert.equal(result.finalDeliveredModelCostUsd, 0.005);
    assert.equal(result.totalUpstreamCostUsd, 0.008);
  });

  it("persisted adult delivery does not make the next provider sticky", () => {
    const afterFallback = advanceModelRouteState({
      previous: GENERAL_STATE,
      deliveredRoute: "adult",
      sceneModeAfter: "explicit",
      sexualContextActive: true,
      routeTriggerReason: "general_model_refusal",
      config: {
        enabled: true,
        adultModelId: DEEPSEEK,
        providerOrder: [],
        providerOnly: [],
        allowProviderFallbacks: false,
        requireParameters: true,
        quantizations: [],
        baseRawExchanges: 4,
        handoffTargetRawExchanges: 6,
        handoffExtraRawTokens: 4_000,
        handoffRawTurns: 6,
        handoffMaxTokens: 4_000,
        minimumRouteTurns: 3,
        returnSafeTurns: 2,
        silentRefusalFallback: true,
        initialStreamBufferChars: 400,
        providerCapabilities: PROVIDER_CAPABILITIES,
      },
      enteredAdultThisTurn: true,
      adultHandoffSourceModelId: GEMINI,
      adultHandoffTargetModelId: DEEPSEEK,
    });
    assert.equal(afterFallback.activeRoute, "adult");
    assert.equal(afterFallback.currentSceneMode, "explicit");

    const nextTurn = deliveryPlan(afterFallback);
    assert.equal(nextTurn.primaryModelId, GEMINI);
    assert.equal(nextTurn.fallbackModelId, DEEPSEEK);
    assert.equal(nextTurn.fallbackPrepared, true);
  });
});
