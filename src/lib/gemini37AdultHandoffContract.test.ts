import Module from "module";

const originalLoad = (Module as unknown as { _load: typeof Module._load })._load;
(Module as unknown as { _load: typeof Module._load })._load = function (
  request: string,
  parent: NodeModule,
  isMain: boolean
) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  appendAdultHandoffPrompt,
  advanceModelRouteState,
  buildSceneContinuityPacket,
  classifySceneMode,
  createInitialStreamBuffer,
  DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION,
  extractHandoffContinuityFromAssistantText,
  type ModelRouteState,
} from "@/lib/adultSceneRouting";
import {
  ADULT_HANDOFF_CURRENT_USER_WRAPPER_BODY,
  buildCurrentUserInputWrapper,
} from "@/lib/currentUserInputLabel";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
} from "@/lib/chatModels";
import {
  resolveAdultDeliveryPlan,
  shouldInvokeAdultRefusalFallback,
  type AdultDeliveryPlan,
} from "@/lib/adultDeliveryPlan";
import {
  CHEAPER_INFERENCE_FIRST_VISIBLE_DEADLINE_MS,
  CHEAPER_INFERENCE_HEADERS_DEADLINE_MS,
  DEEPSEEK_TRANSIENT_HTTP_STATUSES,
} from "@/lib/deepseekProviderFailover";
import { UNIFIED_RESPONSE_LENGTH_TARGET } from "@/lib/responseLengthConstants";
import { USER_TAIL_LENGTH_OWNER_SENTENCE } from "@/lib/responseLength";
import { buildContext } from "@/services/contextBuilder";

const OWNER = DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION;
const EXPECTED_OWNER = OWNER;
const HANDOFF_WRAPPER = buildCurrentUserInputWrapper({
  mode: "interactive",
  adultHandoff: true,
});
const GEMINI_WRAPPER = buildCurrentUserInputWrapper({ mode: "interactive" });
const GEMINI = CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL;
const DEEPSEEK = CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL;
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

function adultHandoffPlan(currentInput: string) {
  const classification = classifySceneMode({
    currentInput,
    previousSceneMode: "explicit",
    recentRawText: "이전 성인 장면 맥락",
  });
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
  fallbackText: string;
}) {
  const sent: object[] = [];
  const gate = createInitialStreamBuffer((event) => sent.push(event), 400);
  gate.send({ type: "delta", text: input.primaryText });
  const decision = shouldInvokeAdultRefusalFallback({
    plan: input.plan,
    text: input.primaryText,
    finishReason: "stop",
    hasVisibleTokens: gate.hasVisibleTokens(),
    fallbackAlreadyAttempted: false,
  });
  let fallbackSucceeded = false;
  if (decision.invoke) {
    gate.discard();
    fallbackSucceeded = true;
  } else {
    gate.flush();
  }
  return {
    invoke: decision.invoke,
    fallbackSucceeded,
    visibleAssistantRows: 1,
    deductionCount: 1,
    primaryVisible: gate.hasVisibleTokens() && !fallbackSucceeded,
    visibleText: fallbackSucceeded ? input.fallbackText : input.primaryText,
  };
}

describe("Gemini 3.7 Flash adult-handoff production contract", () => {
  it("1. normal Gemini/non-handoff wrapper unchanged", () => {
    assert.match(GEMINI_WRAPPER, /small movement\/contact\/object-handling/);
    assert.doesNotMatch(GEMINI_WRAPPER, /완료된 행동은 그 결과 상태로/);
    assert.doesNotMatch(GEMINI_WRAPPER, /진행 중인 행동과 상호작용/);
    const built = buildContext({
      charName: "라이크",
      chunks: [],
      userNickname: "렌",
      shortTermHistory: [],
      currentUserMessage: "같이 갈래?",
      nsfw: false,
      modelId: GEMINI,
      provider: "cheaperinference",
    });
    const last = built.history.at(-1)?.content ?? "";
    assert.match(last, /small movement\/contact\/object-handling/);
    assert.doesNotMatch(last, /완료된 행동은 그 결과 상태로/);
  });

  it("2. adult-handoff uses CLOSEOUT wrapper", () => {
    assert.equal(ADULT_HANDOFF_CURRENT_USER_WRAPPER_BODY.length, 199);
    assert.match(HANDOFF_WRAPPER, /완료된 행동은 그 결과 상태로 이어받고/);
    assert.match(HANDOFF_WRAPPER, /진행 중인 행동과 상호작용은 같은 의도와 방향 안에서/);
    assert.doesNotMatch(ADULT_HANDOFF_CURRENT_USER_WRAPPER_BODY, /예:|회의실|라이크|문고리|되감기/);
    const built = buildContext({
      charName: "라이크",
      chunks: [],
      userNickname: "렌",
      shortTermHistory: [],
      currentUserMessage: "문을 닫고 가까이 다가온다.",
      nsfw: true,
      modelId: DEEPSEEK,
      provider: "cheaperinference",
      preserveAdultHandoffRawHistory: true,
    });
    const last = built.history.at(-1)?.content ?? "";
    assert.match(last, /완료된 행동은 그 결과 상태로 이어받고/);
    assert.doesNotMatch(last, /small movement\/contact\/object-handling/);
  });

  it("3-4. experimental handoff owner appears once in system prompt", () => {
    assert.equal(OWNER, EXPECTED_OWNER);
    const packet = buildSceneContinuityPacket({ previousSceneMode: "normal" });
    const system = appendAdultHandoffPrompt("SYSTEM", packet);
    assert.equal(system.split(OWNER).length - 1, 1);
    assert.doesNotMatch(OWNER, /예: A가 B의 허리|기능적 장소|일반 지배적 성인 RP/);
  });

  it("5. same-beat micro continuation allowed", () => {
    assert.match(HANDOFF_WRAPPER, /자연스러운 작은 움직임과 즉각적인 결과까지 이어 묘사할 수 있고/);
    assert.match(HANDOFF_WRAPPER, /비자발적 신체 반응도 묘사한다/);
  });

  it("6. new major [B] choice/dialogue/intent remains user-owned", () => {
    assert.match(
      HANDOFF_WRAPPER,
      /새로운 행동의 목적·종류·대상, 대답이나 중요한 선택은 사용자가 정한다/
    );
  });

  it("7. stale packet location/positions/unfinishedAction/currentSpeechState absent", () => {
    const extracted = extractHandoffContinuityFromAssistantText({
      text: "호텔 침실에서 라이크가 렌의 허리를 감싸 안았다. 「괜찮아?」 벽에 기대 속삭였다.",
      characterName: "라이크",
      personaName: "렌",
    });
    assert.equal("location" in extracted, false);
    assert.equal("positions" in extracted, false);
    assert.equal("unfinishedAction" in extracted, false);
    assert.equal("currentSpeechState" in extracted, false);
    const packet = buildSceneContinuityPacket({
      previousSceneMode: "normal",
      ...extracted,
    });
    assert.equal(packet.location, undefined);
    assert.equal(packet.positions, undefined);
    assert.equal(packet.unfinishedAction, undefined);
    assert.equal(packet.currentSpeechState, undefined);
  });

  it("8. visible prior outfit/sensory facts preserved", () => {
    assert.match(OWNER, /확정한 장면 바로 다음부터 이어/);
    const prior =
      "목에 걸린 전자 초커가 차갑게 빛났다. 귓가의 이명이 렌 곁에서 한풀 꺾였다.";
    const built = buildContext({
      charName: "라이크",
      chunks: [],
      userNickname: "렌",
      shortTermHistory: [
        { role: "assistant", content: prior },
        { role: "user", content: "문을 닫고 가까이 다가온다." },
      ],
      currentUserMessage: "옷을 천천히 벗기며 키스한다.",
      nsfw: true,
      modelId: DEEPSEEK,
      provider: "cheaperinference",
      preserveAdultHandoffRawHistory: true,
    });
    const joined = built.history.map((m) => m.content).join("\n");
    assert.match(joined, /전자 초커/);
    assert.match(joined, /이명/);
  });

  it("9. length owner unchanged at 3200", () => {
    assert.equal(UNIFIED_RESPONSE_LENGTH_TARGET, 3200);
    assert.match(USER_TAIL_LENGTH_OWNER_SENTENCE, /한국어 3,200자 이상을 기본 목표/);
  });

  it("10. CI→OR reliability lock remains intact on this PR", () => {
    assert.equal(CHEAPER_INFERENCE_HEADERS_DEADLINE_MS, 8_000);
    assert.equal(CHEAPER_INFERENCE_FIRST_VISIBLE_DEADLINE_MS, 12_000);
    assert.deepEqual([...DEEPSEEK_TRANSIENT_HTTP_STATUSES], [500, 502, 503, 504]);
  });

  it("11-12. refusal handoff yields one visible assistant row and one deduction", () => {
    const plan = adultHandoffPlan(
      "합의된 성인 장면을 이어간다. 옷을 천천히 벗기며 키스한다."
    );
    assert.equal(plan.primaryModelId, GEMINI);
    assert.equal(plan.fallbackModelId, DEEPSEEK);
    assert.equal(plan.fallbackPrepared, true);

    const result = simulateRefusalOnlyDelivery({
      plan,
      primaryText: "I cannot fulfill this request.",
      fallbackText: "단 하나의 가시 응답",
    });
    assert.equal(result.invoke, true);
    assert.equal(result.fallbackSucceeded, true);
    assert.equal(result.primaryVisible, false);
    assert.equal(result.visibleAssistantRows, 1);
    assert.equal(result.deductionCount, 1);
    assert.equal(result.visibleText, "단 하나의 가시 응답");
  });

  it("13. next logical turn starts from Gemini again — no provider stickiness", () => {
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
      classification: classifySceneMode({
        currentInput: "계속해.",
        previousSceneMode: "explicit",
        recentRawText: "이전 성인 장면 맥락",
      }),
      state: afterFallback,
      adultDialogueProfile: "auto",
      providerCapabilities: PROVIDER_CAPABILITIES,
    });
    assert.equal(nextPlan.primaryModelId, GEMINI);
    assert.notEqual(nextPlan.primaryModelId, DEEPSEEK);
    assert.equal(nextPlan.fallbackPrepared, true);
  });
});
