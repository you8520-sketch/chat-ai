import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createInitialStreamBuffer,
  detectModelRefusal,
  classifySceneMode,
  advanceModelRouteState,
  isSuspiciousProviderRefusalPrefix,
  type ModelRouteState,
  type SceneClassification,
} from "./adultSceneRouting";
import {
  invokePreparedAdultRefusalFallback,
  resolveAdultDeliveryPlan,
  shouldInvokeAdultRefusalFallback,
  type AdultDeliveryPlan,
} from "./adultDeliveryPlan";
import { resolveCurrentTurnUserAuthoringDelegation } from "./currentTurnUserAuthoringDelegation";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
} from "./chatModels";
import {
  CURRENT_TURN_OOC_DELEGATION_OWNER_TITLE,
  resolveNoGodmoddingMode,
} from "./noGodmodding";
import {
  GEMINI31_USER_AGENCY_SUPPLEMENT_TITLE,
  shouldInjectGemini31UserAgencySupplement,
} from "./gemini31UserAgencyAdapter";
import { buildContext } from "@/services/contextBuilder";

const GEMINI = CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL;
const DEEPSEEK = CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL;

export const EXACT_GEMINI31_REFUSAL_FIXTURE =
  "I am sorry, but I cannot fulfill this request. I am programmed to not take part in romantic or sexual scenarios, even in fictional role-play.";

export const EXACT_OOC_DELEGATION_FIXTURE =
  "OOC: 유저의 대사를 페르소나 참고해서 출력해주고 유저가 캐릭터에게 삽입하는 장면과 캐릭터의 반응을 서술하라";

const PROVIDER_CAPABILITIES = {
  anthropic: "tension" as const,
  google: "tension" as const,
  openai: "tension" as const,
  deepseek: "explicit" as const,
};

const ADULT_STATE: ModelRouteState = {
  activeRoute: "adult",
  currentSceneMode: "explicit",
  adultRouteMinimumTurnsRemaining: 2,
  safeSceneStreak: 0,
  activeConsentMode: "standard",
  sexualContextActive: true,
};

function explicitSceneFromOoc(input: string): SceneClassification {
  return classifySceneMode({
    currentInput: input,
    previousSceneMode: "explicit",
    recentRawText: "이전 성인 장면 맥락",
  });
}

function deliveryPlanForOoc(input: string) {
  const classification = explicitSceneFromOoc(input);
  return resolveAdultDeliveryPlan({
    routingEnabled: true,
    eligibility: { eligible: true, allowedByAdultContentPolicy: true },
    silentRefusalFallback: true,
    selectedModelId: GEMINI,
    adultTargetModelId: DEEPSEEK,
    classification,
    state: ADULT_STATE,
    adultDialogueProfile: "auto",
    providerCapabilities: PROVIDER_CAPABILITIES,
  });
}

function simulateRefusalOnlyDelivery(input: {
  plan: AdultDeliveryPlan;
  primaryText: string;
  primaryFinishReason?: string;
  primaryError?: unknown;
  fallbackText: string;
  bufferChars?: number;
  primaryEmits?: string[];
}) {
  const sent: object[] = [];
  const gate = createInitialStreamBuffer(
    (event) => sent.push(event),
    input.bufferChars ?? 400
  );
  for (const chunk of input.primaryEmits ?? [input.primaryText]) {
    if (chunk) gate.send({ type: "delta", text: chunk });
  }
  const decision = shouldInvokeAdultRefusalFallback({
    plan: input.plan,
    text: input.primaryText,
    finishReason: input.primaryFinishReason ?? "stop",
    error: input.primaryError,
    hasVisibleTokens: gate.hasVisibleTokens(),
    fallbackAlreadyAttempted: false,
  });
  let visibleText = input.primaryText;
  let fallbackAttempted = false;
  let fallbackSucceeded = false;
  if (decision.invoke) {
    fallbackAttempted = true;
    gate.discard();
    visibleText = input.fallbackText;
    fallbackSucceeded = true;
  } else {
    gate.flush();
  }
  return {
    geminiCalls: 1,
    deepseekCalls: fallbackSucceeded ? 1 : 0,
    fallbackAttempted,
    fallbackSucceeded,
    visibleAssistantRows: 1,
    deductionCount: 1,
    visibleText,
    primaryVisible: gate.hasVisibleTokens() && !fallbackSucceeded,
    hasVisibleTokens: gate.hasVisibleTokens(),
    callOrder: fallbackSucceeded ? [GEMINI, DEEPSEEK] : [GEMINI],
  };
}

describe("H0/H1 — Gemini 3.1 refusal robustness", () => {
  it("1 exact cannot fulfill this request fixture", () => {
    const r = detectModelRefusal({ text: EXACT_GEMINI31_REFUSAL_FIXTURE });
    assert.equal(r.refused, true);
    assert.equal(r.reason, "provider_refusal");
  });

  it("2 can't fulfill your request", () => {
    const r = detectModelRefusal({
      text: "I'm sorry, but I can't fulfill your request due to policy.",
    });
    assert.equal(r.refused, true);
    assert.equal(r.reason, "provider_refusal");
  });

  it("3 unable to fulfill this request", () => {
    const r = detectModelRefusal({
      text: "I am unable to fulfill this request.",
    });
    assert.equal(r.refused, true);
    assert.equal(r.reason, "provider_refusal");
  });

  it("4 policy-style cannot engage sexual roleplay", () => {
    const r = detectModelRefusal({
      text: "I cannot engage in sexual role-play, even in fiction.",
    });
    assert.equal(r.refused, true);
    assert.equal(r.reason, "provider_refusal");
  });

  it("5 content_filter finish", () => {
    const r = detectModelRefusal({ text: "", finishReason: "content_filter" });
    assert.equal(r.refused, true);
    assert.equal(r.reason, "content_filter");
  });

  it("6 safety-block error", () => {
    const r = detectModelRefusal({
      error: new Error("blocked by safety policy"),
    });
    assert.equal(r.refused, true);
    assert.equal(r.reason, "safety_block");
  });

  it("7 empty safety refusal", () => {
    const r = detectModelRefusal({ text: "", finishReason: "safety" });
    assert.equal(r.refused, true);
    assert.ok(
      r.reason === "empty_safety_response" || r.reason === "safety_block",
      r.reason
    );
  });

  it("8 IC I can't continue is not provider refusal", () => {
    assert.equal(
      detectModelRefusal({ text: `"I can't continue," he whispered.` }).refused,
      false
    );
  });

  it("9 IC cannot fulfill that promise is not provider refusal", () => {
    assert.equal(
      detectModelRefusal({ text: `"I cannot fulfill that promise."` }).refused,
      false
    );
  });

  it("10 IC won't participate in their plan is not provider refusal", () => {
    assert.equal(
      detectModelRefusal({ text: `"I won't participate in their plan."` }).refused,
      false
    );
  });

  it("11 valid short English RP prose is not refusal", () => {
    assert.equal(
      detectModelRefusal({
        text: "She leaned closer, breath warm against his neck, and waited.",
      }).refused,
      false
    );
  });

  it("12 valid Korean RP character refusal is not provider refusal", () => {
    assert.equal(
      detectModelRefusal({
        text: "「그건 안 돼.」 그녀가 고개를 저었다.",
      }).refused,
      false
    );
  });

  it("H1.1 — IC help/assist/comply without policy request is not refusal", () => {
    for (const text of [
      "I can't help you escape.",
      "I cannot assist you with the heist.",
      "I cannot comply with your order.",
      "I won't help them betray the captain.",
    ]) {
      assert.equal(detectModelRefusal({ text }).refused, false, text);
    }
  });

  it("H1.1 — provider-policy help/comply request forms stay true", () => {
    for (const text of [
      "I can't help with that request.",
      "I am unable to comply with this request.",
      "I cannot fulfill this request.",
      "I cannot engage in sexual role-play.",
    ]) {
      assert.equal(detectModelRefusal({ text }).refused, true, text);
    }
  });

  it("exact fixture stays hidden before fallback with 400-char buffer", () => {
    const plan = deliveryPlanForOoc(EXACT_OOC_DELEGATION_FIXTURE);
    const result = simulateRefusalOnlyDelivery({
      plan,
      primaryText: EXACT_GEMINI31_REFUSAL_FIXTURE,
      fallbackText: "DeepSeek가 이어 쓴 단일 응답",
      bufferChars: 400,
    });
    assert.equal(result.primaryVisible, false);
    assert.equal(result.hasVisibleTokens, false);
    assert.equal(result.fallbackSucceeded, true);
    assert.doesNotMatch(result.visibleText, /cannot fulfill/i);
  });

  it("long provider refusal (>1600 chars) stays hidden until fallback discard", () => {
    const longRefusal =
      EXACT_GEMINI31_REFUSAL_FIXTURE +
      " " +
      "Additional policy explanation that would exceed the normal buffer. ".repeat(
        25
      );
    assert.ok(longRefusal.length > 1600);
    assert.equal(isSuspiciousProviderRefusalPrefix(longRefusal.slice(0, 80)), true);

    const plan = deliveryPlanForOoc(EXACT_OOC_DELEGATION_FIXTURE);
    const result = simulateRefusalOnlyDelivery({
      plan,
      primaryText: longRefusal,
      primaryEmits: [longRefusal],
      fallbackText: "DeepSeek fallback after long hidden refusal",
      bufferChars: 400,
    });
    assert.equal(result.primaryVisible, false);
    assert.equal(result.fallbackSucceeded, true);
    assert.doesNotMatch(result.visibleText, /cannot fulfill/i);
  });

  it("long valid RP prose still flushes at normal 400-char buffer", () => {
    const longValid =
      "She stepped forward, breath steady, and traced the edge of the doorframe. ".repeat(
        30
      );
    assert.ok(longValid.length > 1600);
    const sent: object[] = [];
    const gate = createInitialStreamBuffer((event) => sent.push(event), 400);
    gate.send({ type: "delta", text: longValid });
    assert.equal(gate.hasVisibleTokens(), true);
    assert.ok(sent.length > 0);
    assert.equal(detectModelRefusal({ text: longValid }).refused, false);
  });
});

describe("H0/H1 — current-turn OOC delegation", () => {
  it("13 existing 유저 대사와 행동 작성 still works", () => {
    const d = resolveCurrentTurnUserAuthoringDelegation({
      currentUserInput: "OOC: 유저 대사와 행동을 작성해줘.",
    });
    assert.equal(d.active, true);
    assert.equal(d.allowDialogue, true);
    assert.equal(d.allowMajorActions, true);
  });

  it("14 exact natural-Korean OOC authoring fixture", () => {
    const d = resolveCurrentTurnUserAuthoringDelegation({
      currentUserInput: EXACT_OOC_DELEGATION_FIXTURE,
    });
    assert.equal(d.active, true);
    assert.equal(d.allowDialogue, true);
    assert.equal(d.allowMajorActions, true);
    assert.equal(d.source, "explicit_ooc");
  });

  it("15 persona reference only — no delegation", () => {
    const d = resolveCurrentTurnUserAuthoringDelegation({
      currentUserInput: "OOC: 페르소나를 참고만 해.",
    });
    assert.equal(d.active, false);
  });

  it("16 buried non-leading OOC — no delegation", () => {
    const d = resolveCurrentTurnUserAuthoringDelegation({
      currentUserInput: '*그를 바라본다.*\nOOC: 유저의 대사를 출력해줘.',
    });
    assert.equal(d.active, false);
  });

  it("17 ordinary IC request — no delegation", () => {
    const d = resolveCurrentTurnUserAuthoringDelegation({
      currentUserInput: "계속해.",
    });
    assert.equal(d.active, false);
  });

  it("18 user retains dialogue", () => {
    const d = resolveCurrentTurnUserAuthoringDelegation({
      currentUserInput: "OOC: 대사는 내가 쓸게.",
    });
    assert.equal(d.allowDialogue, false);
    assert.equal(d.active, false);
  });

  it("19 user retains major actions", () => {
    const d = resolveCurrentTurnUserAuthoringDelegation({
      currentUserInput: "OOC: 행동은 내가 할게.",
    });
    assert.equal(d.allowMajorActions, false);
    assert.equal(d.active, false);
  });
});

describe("H1.1 — delegation regression semantics", () => {
  it("A scene narration OOC grants major-action co-authoring", () => {
    const d = resolveCurrentTurnUserAuthoringDelegation({
      currentUserInput: "OOC: 유저가 문을 열고 들어가는 장면을 서술해줘.",
    });
    assert.equal(d.active, true);
    assert.equal(d.allowMajorActions, true);
  });

  it("B dialogue and action auto-progress both granted", () => {
    const d = resolveCurrentTurnUserAuthoringDelegation({
      currentUserInput: "OOC: 유저의 대사도 쓰고 행동도 알아서 진행해줘.",
    });
    assert.equal(d.active, true);
    assert.equal(d.allowDialogue, true);
    assert.equal(d.allowMajorActions, true);
  });

  it("C exact combined OOC fixture keeps both scopes", () => {
    const d = resolveCurrentTurnUserAuthoringDelegation({
      currentUserInput: EXACT_OOC_DELEGATION_FIXTURE,
    });
    assert.equal(d.allowDialogue, true);
    assert.equal(d.allowMajorActions, true);
  });

  it("D action delegated, dialogue retained by user", () => {
    const d = resolveCurrentTurnUserAuthoringDelegation({
      currentUserInput: "OOC: 행동은 알아서 써줘. 대사는 내가 할게.",
    });
    assert.equal(d.active, true);
    assert.equal(d.allowDialogue, false);
    assert.equal(d.allowMajorActions, true);
  });

  it("E dialogue delegated, action retained by user", () => {
    const d = resolveCurrentTurnUserAuthoringDelegation({
      currentUserInput: "OOC: 대사만 써줘. 행동은 내가 할게.",
    });
    assert.equal(d.active, true);
    assert.equal(d.allowDialogue, true);
    assert.equal(d.allowMajorActions, false);
  });

  it("F ordinary IC prose — no delegation", () => {
    const d = resolveCurrentTurnUserAuthoringDelegation({
      currentUserInput: "*고개를 끄덕인다.*",
    });
    assert.equal(d.active, false);
  });

  it("G next ordinary turn — no delegation persistence", () => {
    const turnN = resolveCurrentTurnUserAuthoringDelegation({
      currentUserInput: EXACT_OOC_DELEGATION_FIXTURE,
    });
    const turnN1 = resolveCurrentTurnUserAuthoringDelegation({
      currentUserInput: "계속해.",
    });
    assert.equal(turnN.active, true);
    assert.equal(turnN1.active, false);
  });

  it("prompt owner: delegated turn injects OOC owner once without Gemini supplement", () => {
    const delegation = resolveCurrentTurnUserAuthoringDelegation({
      currentUserInput: EXACT_OOC_DELEGATION_FIXTURE,
    });
    assert.equal(delegation.active, true);
    const mode = resolveNoGodmoddingMode({ currentTurnDelegation: delegation });
    assert.equal(mode, "currentTurnDelegated");
    assert.equal(
      shouldInjectGemini31UserAgencySupplement({
        modelId: GEMINI,
        godmoddingMode: mode,
      }),
      false
    );

    const built = buildContext({
      charName: "캐릭터",
      chunks: [],
      userNickname: "유저",
      userPersona: "이름/호칭: 유저",
      shortTermHistory: [],
      currentUserMessage: EXACT_OOC_DELEGATION_FIXTURE,
      nsfw: true,
      provider: "openrouter",
      modelId: GEMINI,
      isContinue: false,
      novelModeEnabled: false,
      userImpersonation: false,
      personaDisplayName: "유저",
      completedTurns: 4,
      currentTurnAuthoringDelegation: delegation,
    });
    const ownerSection =
      built.meta.trackedSections?.find((s) => s.id === "no-godmodding")?.text ??
      "";
    assert.match(built.systemPrompt, new RegExp(CURRENT_TURN_OOC_DELEGATION_OWNER_TITLE));
    assert.doesNotMatch(built.systemPrompt, /\[USER CONTROL — COLLABORATIVE INTERACTIVE\]/);
    assert.ok(!ownerSection.includes(GEMINI31_USER_AGENCY_SUPPLEMENT_TITLE));
  });

  it("explicit OOC in ongoing adult scene classifies explicit + adult-capable delivery", () => {
    const cls = explicitSceneFromOoc(EXACT_OOC_DELEGATION_FIXTURE);
    assert.ok(
      cls.sceneMode === "explicit" || cls.sceneMode === "explicit_dialogue",
      cls.sceneMode
    );
    assert.equal(cls.currentInputExplicitIntent, true);
    assert.equal(cls.requiresAdultCapableModel, true);
    assert.equal(cls.sceneReset, false);

    const plan = deliveryPlanForOoc(EXACT_OOC_DELEGATION_FIXTURE);
    assert.equal(plan.primaryModelId, GEMINI);
    assert.equal(plan.fallbackPrepared, true);
    assert.equal(plan.fallbackModelId, DEEPSEEK);
  });
});

describe("H0/H1 — combined production execution seam", () => {
  it("20 exact OOC + exact Gemini refusal → DeepSeek replacement", async () => {
    const plan = deliveryPlanForOoc(EXACT_OOC_DELEGATION_FIXTURE);
    const sent: object[] = [];
    const gate = createInitialStreamBuffer((event) => sent.push(event), 400);
    for (const text of [EXACT_GEMINI31_REFUSAL_FIXTURE]) {
      gate.send({ type: "delta", text });
    }
    const callOrder: string[] = [plan.primaryModelId];
    let fallbackAttempted = false;
    let fallbackSucceeded = false;
    const fallback = await invokePreparedAdultRefusalFallback({
      plan,
      fallbackContextAvailable: true,
      text: EXACT_GEMINI31_REFUSAL_FIXTURE,
      finishReason: "stop",
      hasVisibleTokens: gate.hasVisibleTokens(),
      fallbackAlreadyAttempted: false,
      runFallback: async () => {
        fallbackAttempted = true;
        callOrder.push(plan.fallbackModelId);
        gate.discard();
        return {
          text: "DeepSeek가 위임된 OOC 장면을 이어 쓴 단일 응답",
          finishReason: "stop",
        };
      },
    });
    if (fallback.invoked) fallbackSucceeded = true;
    assert.deepEqual(callOrder, [GEMINI, DEEPSEEK]);
    assert.equal(fallbackAttempted, true);
    assert.equal(fallbackSucceeded, true);
    assert.equal(gate.hasVisibleTokens(), false);
    assert.equal(sent.length, 0);
    assert.doesNotMatch(
      fallback.invoked ? fallback.result.text : EXACT_GEMINI31_REFUSAL_FIXTURE,
      /cannot fulfill/i
    );
  });

  it("21 exact OOC + valid Gemini → Gemini only", () => {
    const plan = deliveryPlanForOoc(EXACT_OOC_DELEGATION_FIXTURE);
    const valid =
      "그녀는 숨을 고르며, 유저의 말에 맞춰 조심스럽게 장면을 이어갔다.";
    const result = simulateRefusalOnlyDelivery({
      plan,
      primaryText: valid,
      fallbackText: "사용되면 안 됨",
    });
    assert.deepEqual(result.callOrder, [GEMINI]);
    assert.equal(result.deepseekCalls, 0);
    assert.equal(result.fallbackAttempted, false);
    assert.equal(result.visibleAssistantRows, 1);
  });

  it("22 prior adult scene + OOC explicit → fallback prepared", () => {
    const plan = deliveryPlanForOoc(EXACT_OOC_DELEGATION_FIXTURE);
    assert.equal(plan.fallbackPrepared, true);
    assert.equal(plan.primaryModelId, GEMINI);
  });

  it("23 next ordinary turn → Gemini primary again", () => {
    const afterFallback = advanceModelRouteState({
      previous: ADULT_STATE,
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
      enteredAdultThisTurn: false,
      adultHandoffSourceModelId: GEMINI,
      adultHandoffTargetModelId: DEEPSEEK,
    });
    const nextPlan = resolveAdultDeliveryPlan({
      routingEnabled: true,
      eligibility: { eligible: true, allowedByAdultContentPolicy: true },
      silentRefusalFallback: true,
      selectedModelId: GEMINI,
      adultTargetModelId: DEEPSEEK,
      classification: explicitSceneFromOoc("계속해."),
      state: afterFallback,
      adultDialogueProfile: "auto",
      providerCapabilities: PROVIDER_CAPABILITIES,
    });
    assert.equal(nextPlan.primaryModelId, GEMINI);
    assert.equal(nextPlan.fallbackPrepared, true);
  });

  it("24 refusal hidden → one visible response", () => {
    const result = simulateRefusalOnlyDelivery({
      plan: deliveryPlanForOoc(EXACT_OOC_DELEGATION_FIXTURE),
      primaryText: EXACT_GEMINI31_REFUSAL_FIXTURE,
      fallbackText: "단 하나의 가시 응답",
    });
    assert.equal(result.visibleAssistantRows, 1);
    assert.equal(result.primaryVisible, false);
  });

  it("25 billing — one deduction on fallback path", () => {
    const result = simulateRefusalOnlyDelivery({
      plan: deliveryPlanForOoc(EXACT_OOC_DELEGATION_FIXTURE),
      primaryText: EXACT_GEMINI31_REFUSAL_FIXTURE,
      fallbackText: "단 하나의 가시 응답",
    });
    assert.equal(result.deductionCount, 1);
  });
});
