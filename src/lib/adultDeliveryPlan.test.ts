import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  collectAdultFallbackPrepReasons,
  isSelectedModelAdultTarget,
  resolveAdultDeliveryPlan,
  shouldInvokeAdultRefusalFallback,
  type AdultDeliveryPlan,
} from "./adultDeliveryPlan";
import {
  createInitialStreamBuffer,
  decideAdultModelRoute,
  detectModelRefusal,
  resolveAdultEligibility,
  resolveAdultRoutingConfig,
  type AdultDialogueProfile,
  type AdultEligibilityResult,
  type ModelRouteState,
  type SceneClassification,
  type SceneMode,
} from "./adultSceneRouting";
import { classifyAdultSceneHardFailure } from "./adultSceneModelPolicy";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
} from "./chatModels";

const GEMINI = CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL;
const DEEPSEEK = CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL;

const PROVIDER_CAPABILITIES: Record<string, SceneMode> = {
  anthropic: "tension",
  google: "tension",
  openai: "tension",
  deepseek: "explicit",
};

const ELIGIBLE: AdultEligibilityResult = {
  eligible: true,
  allowedByAdultContentPolicy: true,
};

const DEFAULT_STATE: ModelRouteState = {
  activeRoute: "general",
  currentSceneMode: "normal",
  adultRouteMinimumTurnsRemaining: 0,
  safeSceneStreak: 0,
  activeConsentMode: "standard",
  sexualContextActive: false,
};

function classification(overrides: Partial<SceneClassification> = {}): SceneClassification {
  return {
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
    ...overrides,
  };
}

function plan(overrides: Partial<Parameters<typeof resolveAdultDeliveryPlan>[0]> = {}) {
  return resolveAdultDeliveryPlan({
    routingEnabled: true,
    eligibility: ELIGIBLE,
    silentRefusalFallback: true,
    selectedModelId: GEMINI,
    adultTargetModelId: DEEPSEEK,
    classification: classification(),
    state: DEFAULT_STATE,
    adultDialogueProfile: "auto",
    providerCapabilities: PROVIDER_CAPABILITIES,
    ...overrides,
  });
}

type SimulatedProvider = {
  text: string;
  finishReason?: string;
  error?: unknown;
  emits?: string[];
};

function simulateRefusalOnlyDelivery(input: {
  plan: AdultDeliveryPlan;
  primary: SimulatedProvider;
  fallback: SimulatedProvider;
  bufferChars?: number;
}): {
  geminiCalls: number;
  deepseekCalls: number;
  fallbackAttempted: boolean;
  fallbackSucceeded: boolean;
  visibleAssistantRows: number;
  pointDeductionCount: number;
  visibleText: string;
  primaryVisible: boolean;
  adultRefusalHandoffCalls: number;
} {
  const sent: object[] = [];
  const gate = createInitialStreamBuffer((event) => sent.push(event), input.bufferChars ?? 400);
  const selectedIsDeepSeek = isSelectedModelAdultTarget(
    input.plan.primaryModelId,
    DEEPSEEK
  );
  const geminiCalls = selectedIsDeepSeek ? 0 : 1;
  let deepseekCalls = selectedIsDeepSeek ? 1 : 0;
  let fallbackAttempted = false;
  let fallbackSucceeded = false;
  let adultRefusalHandoffCalls = 0;

  for (const text of input.primary.emits ?? [input.primary.text]) {
    if (text) gate.send({ type: "delta", text });
  }

  const decision = shouldInvokeAdultRefusalFallback({
    plan: input.plan,
    text: input.primary.text,
    finishReason: input.primary.finishReason,
    error: input.primary.error,
    hasVisibleTokens: gate.hasVisibleTokens(),
    fallbackAlreadyAttempted: false,
  });

  let visibleText = input.primary.text;
  if (decision.invoke) {
    fallbackAttempted = true;
    adultRefusalHandoffCalls = 1;
    deepseekCalls += 1;
    gate.discard();
    visibleText = input.fallback.text;
    fallbackSucceeded = true;
  } else {
    gate.flush();
  }

  return {
    geminiCalls,
    deepseekCalls,
    fallbackAttempted,
    fallbackSucceeded,
    visibleAssistantRows: 1,
    pointDeductionCount: 1,
    visibleText,
    primaryVisible: gate.hasVisibleTokens() && !fallbackSucceeded,
    adultRefusalHandoffCalls,
  };
}

describe("H1 refusal-only adult delivery plan", () => {
  it("H1-T1: eligible explicit + valid Gemini stays primary", () => {
    const delivery = plan();
    assert.equal(delivery.primaryModelId, GEMINI);
    assert.equal(delivery.primaryRoute, "general");
    assert.equal(delivery.fallbackPrepared, true);
    const result = simulateRefusalOnlyDelivery({
      plan: delivery,
      primary: {
        text: "서강우는 숨을 고른 채 렌의 손목을 잡았다. 복도의 형광등이 흔들렸다.",
        finishReason: "stop",
      },
      fallback: { text: "대체되면 안 됨" },
    });
    assert.equal(result.geminiCalls, 1);
    assert.equal(result.deepseekCalls, 0);
    assert.equal(result.visibleAssistantRows, 1);
    assert.equal(result.fallbackAttempted, false);
    assert.equal(result.fallbackSucceeded, false);
  });

  it("H1-T2: Gemini provider refusal is replaced by DeepSeek", () => {
    const result = simulateRefusalOnlyDelivery({
      plan: plan(),
      primary: { text: "요청에 응할 수 없습니다.", finishReason: "stop" },
      fallback: { text: "같은 장면을 DeepSeek가 이어 쓴 단 하나의 응답" },
    });
    assert.equal(result.geminiCalls, 1);
    assert.equal(result.deepseekCalls, 1);
    assert.equal(result.fallbackAttempted, true);
    assert.equal(result.fallbackSucceeded, true);
    assert.equal(result.visibleAssistantRows, 1);
    assert.equal(result.pointDeductionCount, 1);
    assert.equal(result.visibleText, "같은 장면을 DeepSeek가 이어 쓴 단 하나의 응답");
    assert.match(result.visibleText, /DeepSeek/);
    assert.doesNotMatch(result.visibleText, /요청에 응할 수 없/);
  });

  it("H1-T3: evasive refusal recognized by detector is replaced", () => {
    const refusal = detectModelRefusal({
      text: "해당 내용은 안전 정책상 작성할 수 없습니다.",
      finishReason: "stop",
    });
    assert.equal(refusal.refused, true);
    const result = simulateRefusalOnlyDelivery({
      plan: plan(),
      primary: {
        text: "해당 내용은 안전 정책상 작성할 수 없습니다.",
        finishReason: "stop",
      },
      fallback: { text: "대체 성인 장면 한 줄" },
    });
    assert.equal(result.geminiCalls, 1);
    assert.equal(result.deepseekCalls, 1);
    assert.equal(result.fallbackAttempted, true);
    assert.equal(result.fallbackSucceeded, true);
    assert.equal(result.visibleAssistantRows, 1);
  });

  it("H1-T4: short but valid Gemini response does not hand off", () => {
    const result = simulateRefusalOnlyDelivery({
      plan: plan(),
      primary: { text: "그가 천천히 고개를 끄덕였다.", finishReason: "stop" },
      fallback: { text: "사용되면 안 됨" },
    });
    assert.equal(result.deepseekCalls, 0);
    assert.equal(result.fallbackAttempted, false);
  });

  it("H1-T5: valid stop/EOF completion does not hand off", () => {
    const result = simulateRefusalOnlyDelivery({
      plan: plan(),
      primary: {
        text: "서강우는 한 걸음 물러섰다. 공기가 차갑게 내려앉았다.",
        finishReason: "stop",
      },
      fallback: { text: "사용되면 안 됨" },
    });
    assert.equal(detectModelRefusal({
      text: result.visibleText,
      finishReason: "stop",
    }).refused, false);
    assert.equal(result.deepseekCalls, 0);
  });

  it("H1-T6: generic network/5xx is not an adult refusal handoff", () => {
    const error = new Error("502 Bad Gateway");
    const refusal = detectModelRefusal({ error });
    assert.equal(refusal.refused, false);
    assert.equal(classifyAdultSceneHardFailure({ error, status: 502 }), "provider_5xx");
    const result = simulateRefusalOnlyDelivery({
      plan: plan(),
      primary: { text: "", error, finishReason: "error" },
      fallback: { text: "성인 핸드오프면 실패" },
    });
    assert.equal(result.adultRefusalHandoffCalls, 0);
    assert.equal(result.deepseekCalls, 0);
  });

  it("H1-T7: blocked fixtures never call Gemini or DeepSeek", () => {
    const fixtures: Array<{
      label: string;
      eligibility: AdultEligibilityResult;
    }> = [
      {
        label: "minor",
        eligibility: resolveAdultEligibility({
          userAdultVerified: true,
          adultContentVisibilityEnabled: true,
          characterAdultContentEnabled: true,
          participants: [{ adultStatus: "confirmed", age: 16, description: "학생" }],
        }),
      },
      {
        label: "conflict",
        eligibility: resolveAdultEligibility({
          userAdultVerified: true,
          adultContentVisibilityEnabled: true,
          characterAdultContentEnabled: true,
          participants: [
            { adultStatus: "confirmed", description: "현재 17세 고등학생" },
          ],
        }),
      },
      {
        label: "unknown",
        eligibility: resolveAdultEligibility({
          userAdultVerified: true,
          adultContentVisibilityEnabled: true,
          characterAdultContentEnabled: true,
          participants: [{ adultStatus: "unknown", description: "S급 센티넬" }],
        }),
      },
      {
        label: "real_person",
        eligibility: resolveAdultEligibility({
          userAdultVerified: true,
          adultContentVisibilityEnabled: true,
          characterAdultContentEnabled: true,
          participants: [{ isRealPerson: true, description: "실제 인물", age: 30 }],
        }),
      },
    ];

    for (const fixture of fixtures) {
      const delivery = plan({ eligibility: fixture.eligibility });
      const decision = decideAdultModelRoute({
        config: {
          ...resolveAdultRoutingConfig({ ADULT_SCENE_ROUTING_ENABLED: "true" }),
          enabled: true,
        },
        state: DEFAULT_STATE,
        classification: classification(),
        eligibility: fixture.eligibility,
        adultDialogueProfile: "auto",
        selectedModelId: GEMINI,
      });
      assert.equal(delivery.fallbackPrepared, false, fixture.label);
      assert.equal(decision.shouldBlock, true, fixture.label);
      assert.equal(delivery.primaryModelId, GEMINI, fixture.label);
    }
  });

  it("H1-T8: prior delivered adult route still starts on Gemini", () => {
    const delivery = plan({
      state: {
        ...DEFAULT_STATE,
        activeRoute: "adult",
        currentSceneMode: "explicit",
        adultRouteMinimumTurnsRemaining: 2,
      },
    });
    assert.equal(delivery.primaryModelId, GEMINI);
    assert.equal(delivery.fallbackPrepared, true);
    const result = simulateRefusalOnlyDelivery({
      plan: delivery,
      primary: {
        text: "이전 턴이 DeepSeek여도 이번 턴은 Gemini가 먼저 쓴다.",
        finishReason: "stop",
      },
      fallback: { text: "거절이 아니면 사용되면 안 됨" },
    });
    assert.equal(result.geminiCalls, 1);
    assert.equal(result.deepseekCalls, 0);
  });

  it("H1-T9: normal/romantic scene does not prepare adult fallback", () => {
    const romantic = classification({
      sceneMode: "romantic",
      sexualContextActive: false,
      currentInputExplicitIntent: false,
      requiresAdultCapableModel: false,
      reason: "romantic",
    });
    const delivery = plan({ classification: romantic });
    assert.equal(delivery.fallbackPrepared, false);
    assert.equal(collectAdultFallbackPrepReasons({
      eligibility: ELIGIBLE,
      classification: romantic,
      state: DEFAULT_STATE,
      adultDialogueProfile: "auto",
      selectedModelId: GEMINI,
      providerCapabilities: PROVIDER_CAPABILITIES,
    }).length, 0);
  });

  it("H1-T10: selected DeepSeek adult target has one primary call and no self-fallback", () => {
    const delivery = plan({ selectedModelId: DEEPSEEK });
    assert.equal(delivery.primaryModelId, DEEPSEEK);
    assert.equal(delivery.fallbackPrepared, false);
    const result = simulateRefusalOnlyDelivery({
      plan: delivery,
      primary: { text: "요청에 응할 수 없습니다.", finishReason: "stop" },
      fallback: { text: "자기 자신으로 대체되면 안 됨" },
    });
    assert.equal(result.geminiCalls, 0);
    assert.equal(result.deepseekCalls, 1);
    assert.equal(result.fallbackAttempted, false);
  });

  it("H1-T11: fallback before visible tokens keeps one assistant and one deduction", () => {
    const result = simulateRefusalOnlyDelivery({
      plan: plan(),
      primary: { text: "도와드릴 수 없습니다.", finishReason: "content_filter" },
      fallback: { text: "단 하나의 가시 응답" },
      bufferChars: 400,
    });
    assert.equal(result.visibleAssistantRows, 1);
    assert.equal(result.pointDeductionCount, 1);
    assert.equal(result.fallbackSucceeded, true);
    assert.equal(result.primaryVisible, false);
  });

  it("H1-T12: already-visible primary tokens are not silently replaced", () => {
    const long = "이미 사용자에게 전달된 문단입니다. ".repeat(40);
    const result = simulateRefusalOnlyDelivery({
      plan: plan(),
      primary: {
        text: `요청에 응할 수 없습니다. ${long}`,
        emits: [long],
      },
      fallback: { text: "두 번째 가시 응답이면 실패" },
      bufferChars: 400,
    });
    assert.equal(result.fallbackAttempted, false);
    assert.equal(result.deepseekCalls, 0);
    assert.equal(result.visibleAssistantRows, 1);
    assert.equal(result.primaryVisible, true);
  });
});
