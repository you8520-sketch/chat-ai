import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { adaptCheaperInferenceChatBody } from "./cheaperInferenceConfig";
import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
  CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
  CHEAPER_INFERENCE_QWEN_38_MAX_MODEL,
  SELECTED_AI_OPTIONS,
  USER_SELECTABLE_AI_OPTIONS,
  isCheaperInferenceModel,
  isValidSelectedAI,
} from "./chatModels";
import {
  GEMINI31_QWEN_STYLE_CONTINUITY_BLOCK,
  OPUS_QWEN_FRAGMENT_SENTENCE,
  rebuildAdultHandoffPromptForDeepSeekFallback,
  rebuildAdultHandoffSystemSplitForDeepSeekFallback,
  resolveAdultHandoffModelForSource,
  resolveAdultHandoffTargetModelId,
  resolvePersistedAdultHandoffSourceModelId,
  shouldFallbackQwenHandoffToDeepSeek,
} from "./adultHandoffSourceRouting";
import {
  advanceModelRouteState,
  appendAdultHandoffPrompt,
  classifySceneMode,
  decideAdultModelRoute,
  DEFAULT_MODEL_ROUTE_STATE,
  DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION,
  hasNewlyEstablishedSexualContext,
  resolveAdultEligibility,
  resolveAdultRoutingConfig,
  type ModelRouteState,
} from "./adultSceneRouting";

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
const ADULT_TRIGGER =
  "OOC: 현재 장면 계속. 이제 둘의 관계를 성인 장면까지 진행해.";
const ADULT_CONTINUE = "같은 위치에서 성인 장면을 계속한다.";
const ADULT_ASSISTANT = "둘은 삽입한 채 숨을 고르며 같은 자세를 유지했다.";

function decideForSource(input: {
  currentInput: string;
  selectedModelId: string;
  state?: ModelRouteState;
}) {
  const state = input.state ?? { ...DEFAULT_MODEL_ROUTE_STATE };
  const classification = classifySceneMode({
    currentInput: input.currentInput,
    previousSceneMode: state.currentSceneMode,
    recentRawText:
      state.activeRoute === "adult"
        ? "직전 성인 장면의 위치와 미완료 행동이 남아 있다."
        : "",
    adultDialogueProfile: "auto",
    activeConsentMode: state.activeConsentMode,
  });
  const decision = decideAdultModelRoute({
    config,
    state,
    classification,
    eligibility: eligible,
    adultDialogueProfile: "auto",
    selectedModelId: input.selectedModelId,
  });
  const sourceModelId = resolvePersistedAdultHandoffSourceModelId({
    selectedModelId: input.selectedModelId,
    state,
  });
  const adultTargetModelId = resolveAdultHandoffTargetModelId({
    sourceModelId,
    existingAdultModelId: config.adultModelId,
    state,
  });
  const handoff = appendAdultHandoffPrompt("COMMON SYSTEM", {
    previousSceneMode: "explicit",
    sexualContextActive: true,
    sceneReset: false,
  }, {
    sourceModelId,
    adultTargetModelId,
  });
  const requestBody = adaptCheaperInferenceChatBody({
    model: adultTargetModelId,
    messages: [{ role: "user", content: "hello" }],
    reasoning_effort: "high",
  });
  return {
    classification,
    decision,
    sourceModelId,
    adultTargetModelId,
    handoff,
    requestBody,
  };
}

function finalizeAdult(input: {
  selectedModelId: string;
  currentInput: string;
  state?: ModelRouteState;
  assistantText?: string;
}) {
  const decided = decideForSource(input);
  const standalone = classifySceneMode({
    currentInput: input.assistantText ?? "그는 코트 안에서 당황한 표정을 지었다.",
    previousSceneMode: "normal",
  });
  const next = advanceModelRouteState({
    previous: input.state ?? { ...DEFAULT_MODEL_ROUTE_STATE },
    deliveredRoute: decided.decision.activeRoute,
    sceneModeAfter: decided.decision.sceneMode,
    sexualContextActive: decided.decision.sexualContextActive,
    routeTriggerReason: decided.decision.routeTriggerReason,
    config,
    enteredAdultThisTurn:
      decided.decision.firstAdultHandoff &&
      !(
        decided.decision.transientAdultCapableRoute &&
        !hasNewlyEstablishedSexualContext(standalone)
      ),
    explicitSceneEnd: decided.classification.hardStop,
    transientAdultCapableRoute: decided.decision.transientAdultCapableRoute,
    establishedOngoingSexualContext: hasNewlyEstablishedSexualContext(standalone),
    adultHandoffSourceModelId: decided.sourceModelId,
    adultHandoffTargetModelId: decided.adultTargetModelId,
  });
  return { ...decided, next };
}

describe("source-specific adult handoff routing", () => {
  it("keeps Qwen 3.8 Max as an internal Cheaper Inference model", () => {
    assert.equal(CHEAPER_INFERENCE_QWEN_38_MAX_MODEL, "qwen-3-8-max");
    assert.equal(isCheaperInferenceModel(CHEAPER_INFERENCE_QWEN_38_MAX_MODEL), true);
    assert.equal(
      USER_SELECTABLE_AI_OPTIONS.some((o) => o.id === CHEAPER_INFERENCE_QWEN_38_MAX_MODEL),
      false
    );
    assert.equal(
      SELECTED_AI_OPTIONS.some((o) => o.id === CHEAPER_INFERENCE_QWEN_38_MAX_MODEL),
      false
    );
    assert.equal(isValidSelectedAI(CHEAPER_INFERENCE_QWEN_38_MAX_MODEL), false);
  });

  it("locks Opus→Qwen fragment to Candidate B replacement only", () => {
    assert.equal(
      OPUS_QWEN_FRAGMENT_SENTENCE,
      "직전 assistant의 호흡을 기준으로 문단은 한두 문장 수가 아니라 의미 단위로 나눈다. 같은 화자의 짧은 연속 발화·확인·감탄은 가능한 한 하나의 대사 블록으로 묶고, 하나의 행동·감각·생각 흐름에 속한 서술은 한 문단 안에서 충분히 연결하며, 실제 의미 초점이나 행동 단계가 바뀔 때만 새 문단으로 전환한다."
    );
    assert.equal(
      OPUS_QWEN_FRAGMENT_SENTENCE.includes(
        "문단과 대사 분절은 직전 assistant의 패턴을 따른다."
      ),
      false
    );
    assert.equal(
      GEMINI31_QWEN_STYLE_CONTINUITY_BLOCK.startsWith(
        "[QWEN SOURCE STYLE CONTINUITY — GEMINI 3.1]"
      ),
      true
    );
  });

  it("CASE A — Opus adult trigger uses Qwen with the Opus fragment only", () => {
    const result = decideForSource({
      selectedModelId: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
      currentInput: ADULT_TRIGGER,
    });
    assert.equal(result.decision.activeRoute, "adult");
    assert.equal(result.adultTargetModelId, "qwen-3-8-max");
    assert.equal(result.requestBody.model, "qwen-3-8-max");
    assert.equal(result.requestBody.reasoning_effort, "none");
    assert.equal(result.requestBody.thinking, undefined);
    assert.equal(
      result.handoff.split(OPUS_QWEN_FRAGMENT_SENTENCE).length - 1,
      1
    );
    assert.equal(result.handoff.includes(GEMINI31_QWEN_STYLE_CONTINUITY_BLOCK), false);
  });

  it("CASE B — Gemini 3.1 adult trigger uses Qwen with the Gemini block only", () => {
    const result = decideForSource({
      selectedModelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      currentInput: ADULT_TRIGGER,
    });
    assert.equal(result.decision.activeRoute, "adult");
    assert.equal(result.adultTargetModelId, "qwen-3-8-max");
    assert.equal(result.requestBody.reasoning_effort, "none");
    assert.equal(
      result.handoff.split(GEMINI31_QWEN_STYLE_CONTINUITY_BLOCK).length - 1,
      1
    );
    assert.equal(result.handoff.includes(OPUS_QWEN_FRAGMENT_SENTENCE), false);
  });

  it("CASE C — Gemini 3.7 adult trigger uses DeepSeek 0813 without Qwen prompts", () => {
    const result = decideForSource({
      selectedModelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      currentInput: ADULT_TRIGGER,
    });
    assert.equal(result.decision.activeRoute, "adult");
    assert.equal(result.adultTargetModelId, "deepseek-v4-pro-0813");
    assert.equal(result.requestBody.model, "deepseek-v4-pro-0813");
    assert.deepEqual(result.requestBody.thinking, { type: "disabled" });
    assert.equal(result.requestBody.reasoning_effort, undefined);
    assert.equal(result.handoff.includes(OPUS_QWEN_FRAGMENT_SENTENCE), false);
    assert.equal(result.handoff.includes(GEMINI31_QWEN_STYLE_CONTINUITY_BLOCK), false);
  });

  it("CASE D — Gemini 3.7 normal RP stays on Gemini 3.7", () => {
    const result = decideForSource({
      selectedModelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      currentInput: "로비에서 짧게 인사한다.",
    });
    assert.equal(result.decision.activeRoute, "general");
    assert.equal(result.sourceModelId, CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL);
  });

  it("CASE E — Opus normal RP stays on Opus", () => {
    const result = decideForSource({
      selectedModelId: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
      currentInput: "로비에서 짧게 인사한다.",
    });
    assert.equal(result.decision.activeRoute, "general");
    assert.equal(result.sourceModelId, CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL);
  });

  it("CASE F — Gemini 3.1 normal RP stays on Gemini 3.1", () => {
    const result = decideForSource({
      selectedModelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      currentInput: "로비에서 짧게 인사한다.",
    });
    assert.equal(result.decision.activeRoute, "general");
    assert.equal(result.sourceModelId, CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL);
  });

  it("CASE G — unlisted source keeps the existing production adult model", () => {
    const result = decideForSource({
      selectedModelId: CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
      currentInput: ADULT_TRIGGER,
    });
    assert.equal(result.decision.activeRoute, "adult");
    assert.equal(result.adultTargetModelId, config.adultModelId);
    assert.equal(result.adultTargetModelId, "deepseek-v4-pro-0813");
    assert.equal(result.handoff.includes(OPUS_QWEN_FRAGMENT_SENTENCE), false);
    assert.equal(result.handoff.includes(GEMINI31_QWEN_STYLE_CONTINUITY_BLOCK), false);
    assert.equal(
      resolveAdultHandoffModelForSource(
        CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
        config.adultModelId
      ),
      config.adultModelId
    );
  });

  it("CASE H — Opus → Qwen entry stays on Qwen for the next explicit turn", () => {
    const first = finalizeAdult({
      selectedModelId: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
      currentInput: ADULT_TRIGGER,
      assistantText: ADULT_ASSISTANT,
    });
    assert.equal(first.next.activeRoute, "adult");
    assert.equal(first.next.adultHandoffSourceModelId, "claude-opus-5");
    assert.equal(first.next.adultHandoffTargetModelId, "qwen-3-8-max");
    const second = decideForSource({
      selectedModelId: CHEAPER_INFERENCE_QWEN_38_MAX_MODEL,
      currentInput: ADULT_CONTINUE,
      state: first.next,
    });
    assert.equal(second.sourceModelId, "claude-opus-5");
    assert.equal(second.adultTargetModelId, "qwen-3-8-max");
    assert.equal(second.decision.activeRoute, "adult");
  });

  it("CASE I — Gemini 3.1 → Qwen entry stays on Qwen for the next explicit turn", () => {
    const first = finalizeAdult({
      selectedModelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      currentInput: ADULT_TRIGGER,
      assistantText: ADULT_ASSISTANT,
    });
    assert.equal(first.next.adultHandoffTargetModelId, "qwen-3-8-max");
    const second = decideForSource({
      selectedModelId: CHEAPER_INFERENCE_QWEN_38_MAX_MODEL,
      currentInput: ADULT_CONTINUE,
      state: first.next,
    });
    assert.equal(second.sourceModelId, "gemini-3.1-pro-preview");
    assert.equal(second.adultTargetModelId, "qwen-3-8-max");
  });

  it("CASE J — Gemini 3.7 → DeepSeek entry stays on DeepSeek 0813", () => {
    const first = finalizeAdult({
      selectedModelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      currentInput: ADULT_TRIGGER,
      assistantText: ADULT_ASSISTANT,
    });
    assert.equal(first.next.adultHandoffTargetModelId, "deepseek-v4-pro-0813");
    const second = decideForSource({
      selectedModelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      currentInput: ADULT_CONTINUE,
      state: first.next,
    });
    assert.equal(second.sourceModelId, "gemini-3.7-flash");
    assert.equal(second.adultTargetModelId, "deepseek-v4-pro-0813");
  });

  it("CASE K — transient OOC anatomy from Opus is one Qwen turn then source Opus", () => {
    const first = finalizeAdult({
      selectedModelId: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
      currentInput: CASE1,
    });
    assert.equal(first.decision.activeRoute, "adult");
    assert.equal(first.adultTargetModelId, "qwen-3-8-max");
    assert.equal(first.next.activeRoute, "general");
    assert.equal(first.next.adultHandoffSourceModelId, undefined);
    assert.equal(first.next.adultHandoffTargetModelId, undefined);
    const second = decideForSource({
      selectedModelId: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
      currentInput: "당황해서 코트에서 손을 뺀다.",
      state: first.next,
    });
    assert.equal(second.decision.activeRoute, "general");
    assert.equal(second.sourceModelId, "claude-opus-5");
  });

  it("CASE L — transient OOC anatomy from Gemini 3.7 is one DeepSeek turn then source Gemini 3.7", () => {
    const first = finalizeAdult({
      selectedModelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      currentInput: CASE1,
    });
    assert.equal(first.decision.activeRoute, "adult");
    assert.equal(first.adultTargetModelId, "deepseek-v4-pro-0813");
    assert.equal(first.next.activeRoute, "general");
    const second = decideForSource({
      selectedModelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      currentInput: "당황해서 코트에서 손을 뺀다.",
      state: first.next,
    });
    assert.equal(second.decision.activeRoute, "general");
    assert.equal(second.sourceModelId, "gemini-3.7-flash");
  });

  it("Opus→Qwen hard fail→DeepSeek rebuilds prompt without the Opus Qwen adapter", () => {
    const qwen = decideForSource({
      selectedModelId: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
      currentInput: ADULT_TRIGGER,
    });
    assert.equal(qwen.handoff.includes(OPUS_QWEN_FRAGMENT_SENTENCE), true);
    const deepSeek = rebuildAdultHandoffPromptForDeepSeekFallback(
      qwen.handoff,
      qwen.sourceModelId
    );
    const split = rebuildAdultHandoffSystemSplitForDeepSeekFallback(
      { dynamicBlock: qwen.handoff },
      qwen.sourceModelId
    );
    assert.equal(deepSeek.includes(OPUS_QWEN_FRAGMENT_SENTENCE), false);
    assert.equal(deepSeek.includes(GEMINI31_QWEN_STYLE_CONTINUITY_BLOCK), false);
    assert.equal(deepSeek.includes(DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION), true);
    assert.equal(split?.dynamicBlock.includes(OPUS_QWEN_FRAGMENT_SENTENCE), false);
    assert.equal(
      split?.dynamicBlock.includes(DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION),
      true
    );
  });

  it("Gemini3.1→Qwen hard fail→DeepSeek rebuilds prompt without the Gemini Qwen adapter", () => {
    const qwen = decideForSource({
      selectedModelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      currentInput: ADULT_TRIGGER,
    });
    assert.equal(qwen.handoff.includes(GEMINI31_QWEN_STYLE_CONTINUITY_BLOCK), true);
    const deepSeek = rebuildAdultHandoffPromptForDeepSeekFallback(
      qwen.handoff,
      qwen.sourceModelId
    );
    assert.equal(deepSeek.includes(GEMINI31_QWEN_STYLE_CONTINUITY_BLOCK), false);
    assert.equal(deepSeek.includes(OPUS_QWEN_FRAGMENT_SENTENCE), false);
    assert.equal(deepSeek.includes(DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION), true);
  });

  it("Qwen hard-failure fallback to DeepSeek is max 1 and blocked after visible tokens", () => {
    assert.equal(
      shouldFallbackQwenHandoffToDeepSeek({
        reason: "provider_5xx",
        fallbackAttemptCount: 0,
        hasVisibleTokens: false,
      }),
      true
    );
    assert.equal(
      shouldFallbackQwenHandoffToDeepSeek({
        reason: "provider_5xx",
        fallbackAttemptCount: 1,
        hasVisibleTokens: false,
      }),
      false
    );
    assert.equal(
      shouldFallbackQwenHandoffToDeepSeek({
        reason: "provider_5xx",
        fallbackAttemptCount: 0,
        hasVisibleTokens: true,
      }),
      false
    );
  });
});
