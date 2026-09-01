import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { adaptCheaperInferenceChatBody } from "./cheaperInferenceConfig";
import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
  CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
  CHEAPER_INFERENCE_QWEN_38_MAX_MODEL,
} from "./chatModels";
import {
  buildHandoffFixtureCaptureRecord,
  classifyDeepSeekHandoffRouting,
  computeQaStyleTelemetry,
  DEEPSEEK0813_HANDOFF_DEFAULT_STYLE_ADAPTERS,
  DEEPSEEK_ADULT_HANDOFF_FIXTURE_CAPTURE_MODE,
  describeDeepSeek0813HandoffTrueOffTransport,
  evaluateTrueOffStreamInvariant,
  isDeepSeek0813TrueOffTransport,
  isDeepSeekAdultHandoff,
  isDeepSeekNativeTurn,
  qaStyleTelemetryMustNotEnterPrompt,
  recordDeepSeekHandoffTurn,
  resolveFixturePersistPolicy,
  selectLastVisibleCanonicalNonDeepSeekAssistant,
  sha256Utf8,
  startHandoffSession,
} from "./deepseekAdultHandoffFixtureCapture";
import {
  evaluateKnownCommittedMultiTurnInventory,
  evaluateMultiTurnVanillaDriftReadiness,
  GEMINI37_BASELINE_T2_USER,
  gemini37BaselinePartialChain,
} from "./deepseekAdultHandoffMultiTurnInventory";
import {
  resolveAdultHandoffModelForSource,
  resolveAdultHandoffTargetModelId,
} from "./adultHandoffSourceRouting";
import {
  decideAdultModelRoute,
  DEFAULT_MODEL_ROUTE_STATE,
  classifySceneMode,
  resolveAdultEligibility,
  resolveAdultRoutingConfig,
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

function decideRoute(selectedModelId: string, currentInput: string) {
  const classification = classifySceneMode({
    currentInput,
    previousSceneMode: "normal",
    recentRawText: "",
    adultDialogueProfile: "auto",
    activeConsentMode: "standard",
  });
  return decideAdultModelRoute({
    config,
    state: { ...DEFAULT_MODEL_ROUTE_STATE },
    classification,
    eligibility: eligible,
    adultDialogueProfile: "auto",
    selectedModelId,
  });
}

describe("DeepSeek adult-handoff fixture capture (audit only)", () => {
  it("selects LAST_VISIBLE_CANONICAL_NON_DEEPSEEK_ASSISTANT and stores SHA256", () => {
    const origin = selectLastVisibleCanonicalNonDeepSeekAssistant([
      {
        id: 10,
        role: "assistant",
        content: "OOC 샘플은 무시한다.",
        usage: { canonical: false, generationKind: "ooc_scene_render" },
        generationKind: "ooc_scene_render",
        canonical: false,
        modelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      },
      {
        id: 11,
        role: "assistant",
        content:
          "조태형은 로비에서 짧게 웃었다.\n\n<<<STATUS_VALUES>>>\n{\"mood\":\"calm\"}\n<<<END_STATUS>>>",
        modelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      },
      {
        id: 12,
        role: "assistant",
        content: "DeepSeek later turn must not become origin.",
        modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      },
      { id: 13, role: "user", content: "같이 갈래?" },
    ]);
    assert.equal(origin?.messageId, 11);
    assert.equal(origin?.raw, "조태형은 로비에서 짧게 웃었다.");
    assert.equal(origin?.rawSha, sha256Utf8("조태형은 로비에서 짧게 웃었다."));
    assert.equal(origin?.modelId, CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL);
  });

  it("does not overwrite origin when later DeepSeek turns are recorded", () => {
    const session = startHandoffSession({
      sourceModelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      originAssistantMessageId: 11,
      originAssistantRaw: "조태형은 로비에서 짧게 웃었다.",
      targetModelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      startedAtTurn: 4,
    });
    const after1 = recordDeepSeekHandoffTurn(session, 21);
    const after2 = recordDeepSeekHandoffTurn(after1, 22);
    assert.equal(after2.originAssistantMessageId, 11);
    assert.equal(after2.originAssistantRawSha, session.originAssistantRawSha);
    assert.equal(after2.handoffTurnCount, 2);
    assert.equal(after2.targetModelId, CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL);
  });

  it("builds metadata-only capture records and blocks ordinary chat persistence", () => {
    const record = buildHandoffFixtureCaptureRecord({
      sourceModel: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      targetModel: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      character: "조태형",
      persona: "렌",
      speechLock: "반말",
      world: "에이지스",
      system: "SYSTEM",
      history: "HISTORY",
      originAssistantMessageId: 11,
      originAssistantRaw: "조태형은 로비에서 짧게 웃었다.",
      currentUser: GEMINI37_BASELINE_T2_USER,
      fullPrompt: "FULL",
      runtime: {
        reasoning_stream_events: 0,
        reasoning_chars: 0,
      },
    });
    assert.equal(record.captureMode, DEEPSEEK_ADULT_HANDOFF_FIXTURE_CAPTURE_MODE);
    assert.equal(record.persistOrdinaryUserChats, false);
    assert.equal(record.characterSha, sha256Utf8("조태형"));
    assert.equal(record.currentUserSha, sha256Utf8(GEMINI37_BASELINE_T2_USER));
    assert.deepEqual(record.transport, describeDeepSeek0813HandoffTrueOffTransport());
    assert.equal(record.runtime.trueOffViolation, false);
    assert.equal("originAssistantRaw" in record, false);
    assert.equal("currentUser" in record, false);
    assert.deepEqual(resolveFixturePersistPolicy({
      approvedInternalAuditWorkflow: false,
      ordinaryUserChat: true,
      persistRawBodies: true,
    }), {
      persistMetadata: false,
      persistRawBodies: false,
      reason: "ordinary_user_chat_blocked",
    });
    assert.deepEqual(resolveFixturePersistPolicy({
      approvedInternalAuditWorkflow: true,
      ordinaryUserChat: false,
    }), {
      persistMetadata: true,
      persistRawBodies: false,
      reason: "approved_audit_metadata_only",
    });
  });

  it("treats stream observation as TRUE-OFF source of truth", () => {
    assert.deepEqual(
      evaluateTrueOffStreamInvariant({
        reasoning_stream_events: 0,
        reasoning_chars: 0,
        providerReasoningTokens: 99,
      }),
      { trueOffViolation: false }
    );
    assert.deepEqual(
      evaluateTrueOffStreamInvariant({
        reasoning_stream_events: 1,
        reasoning_chars: 0,
        providerReasoningTokens: 0,
      }),
      { trueOffViolation: true }
    );
    const trueOff = {
      model: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      thinking: { type: "disabled" },
      reasoning_effort: "none",
    };
    assert.equal(isDeepSeek0813TrueOffTransport(trueOff), true);
    const production = adaptCheaperInferenceChatBody({
      model: "deepseek-v4-pro",
      messages: [{ role: "user", content: "hello" }],
      reasoning_effort: "high",
    });
    assert.deepEqual(production.thinking, { type: "disabled" });
    assert.equal(production.reasoning_effort, undefined);
    assert.equal(isDeepSeek0813TrueOffTransport(production), false);
  });

  it("keeps QA style telemetry out of prompts", () => {
    const telemetry = computeQaStyleTelemetry(
      "조태형은 짧게 웃었다.\n\n\"같이 갈래?\"\n\n렌의 시선을 따라갔다."
    );
    assert.ok(telemetry.sentenceMedian != null);
    assert.ok(telemetry.paragraphMedian != null);
    const prompt = "기존 canonical system / character / persona / Speech Lock";
    assert.equal(qaStyleTelemetryMustNotEnterPrompt(prompt, telemetry), true);
    assert.equal(DEEPSEEK0813_HANDOFF_DEFAULT_STYLE_ADAPTERS.SOURCE_MIRROR_PRODUCTION, false);
    assert.equal(DEEPSEEK0813_HANDOFF_DEFAULT_STYLE_ADAPTERS.ORIGIN_POINTER, 0);
    assert.equal(DEEPSEEK0813_HANDOFF_DEFAULT_STYLE_ADAPTERS.TURN_OWNERSHIP, 0);
  });
});

describe("Native DeepSeek isolation", () => {
  it("user selected DeepSeek: handoff=false and extra owners stay 0", () => {
    const classified = classifyDeepSeekHandoffRouting({
      userSelectedModelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      adultHandoffActive: true,
      resolvedTargetModelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
    });
    assert.equal(isDeepSeekNativeTurn(CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL), true);
    assert.equal(classified.isDeepSeekAdultHandoff, false);
    assert.equal(classified.handoffApplied, false);
    assert.equal(classified.turnOwnership, 0);
    assert.equal(classified.originPointer, 0);
    assert.equal(classified.sourceMirror, 0);
    assert.equal(
      resolveAdultHandoffTargetModelId({
        sourceModelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
        existingAdultModelId: config.adultModelId,
        state: {},
      }),
      CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL
    );
  });

  it("user selected non-DeepSeek normal: target remains the selected model", () => {
    const decision = decideRoute(CHEAPER_INFERENCE_GPT_56_TERRA_MODEL, "로비에서 짧게 인사한다.");
    assert.equal(decision.activeRoute, "general");
    const classified = classifyDeepSeekHandoffRouting({
      userSelectedModelId: CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
      adultHandoffActive: false,
      resolvedTargetModelId: CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
    });
    assert.equal(classified.isDeepSeekAdultHandoff, false);
    assert.equal(classified.targetModelId, CHEAPER_INFERENCE_GPT_56_TERRA_MODEL);
  });

  it("user selected Gemini 3.7 handoff: target=0813; production transport stays unchanged", () => {
    const decision = decideRoute(
      CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      "OOC: 현재 장면 계속. 이제 둘의 관계를 성인 장면까지 진행해."
    );
    const target = resolveAdultHandoffModelForSource(
      CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      config.adultModelId
    );
    assert.equal(decision.activeRoute, "adult");
    assert.equal(target, CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL);
    assert.equal(
      isDeepSeekAdultHandoff({
        adultHandoffActive: true,
        selectedSourceModelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
        resolvedTargetModelId: target,
      }),
      true
    );
    assert.equal(
      resolveAdultHandoffModelForSource(
        CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
        config.adultModelId
      ),
      CHEAPER_INFERENCE_QWEN_38_MAX_MODEL
    );
    assert.equal(
      resolveAdultHandoffModelForSource(
        CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
        config.adultModelId
      ),
      CHEAPER_INFERENCE_QWEN_38_MAX_MODEL
    );
  });

  it("production chat route does not import capture or add handoff style owners", () => {
    const routePath = join(
      dirname(fileURLToPath(import.meta.url)),
      "../app/api/chat/route.ts"
    );
    const route = readFileSync(routePath, "utf8");
    assert.equal(route.includes("deepseekAdultHandoffFixtureCapture"), false);
    assert.equal(route.includes("deepseekAdultHandoffMultiTurnInventory"), false);
    assert.equal(route.includes("[HANDOFF ORIGIN]"), false);
    assert.equal(route.includes("[DEEPSEEK HANDOFF — TURN OWNERSHIP]"), false);
    assert.equal(route.includes("HANDOFF SOURCE CONTINUITY — STYLE MIRROR"), false);
  });
});

describe("Multi-turn Vanilla TRUE-OFF inventory", () => {
  it("marks the Gemini37 baseline as incomplete and forbids live calls", () => {
    const inventory = evaluateKnownCommittedMultiTurnInventory();
    assert.equal(inventory.fixtureAvailable, false);
    assert.equal(inventory.liveCalls, 0);
    assert.equal(inventory.modelCalls, 0);
    assert.equal(inventory.reason, "complete_real_multiturn_chain_unavailable");

    const partial = evaluateMultiTurnVanillaDriftReadiness(
      gemini37BaselinePartialChain()
    );
    assert.equal(partial.complete, false);
    assert.equal(partial.humansComplete, false);
    assert.equal(partial.liveCallsAllowed, false);
    assert.equal(partial.requiredLiveCalls, 0);
    assert.ok(partial.missing.includes("origin_canonical_non_deepseek_assistant"));
    assert.ok(partial.missing.includes("turn2_matching_human_user"));
    assert.ok(partial.missing.includes("turn3_matching_human_user"));
  });

  it("rejects synthetic user fills and does not treat a complete chain as this audit's live run", () => {
    const synthetic = evaluateMultiTurnVanillaDriftReadiness({
      sourceModelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      targetModelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      originAssistantRaw: "조태형은 로비에서 짧게 웃었다.",
      originModelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      turns: [
        {
          turnIndex: 1,
          userText: GEMINI37_BASELINE_T2_USER,
          userProvenance: "human_matching",
          assistantRaw: null,
          assistantModelId: null,
        },
        {
          turnIndex: 2,
          userText: "그래, 지원국으로 가자.",
          userProvenance: "synthetic",
          assistantRaw: null,
          assistantModelId: null,
        },
        {
          turnIndex: 3,
          userText: "문을 연다.",
          userProvenance: "synthetic",
          assistantRaw: null,
          assistantModelId: null,
        },
      ],
    });
    assert.equal(synthetic.liveCallsAllowed, false);
    assert.ok(synthetic.blockers.includes("turn2_synthetic_user_forbidden"));
    assert.ok(synthetic.blockers.includes("turn3_synthetic_user_forbidden"));
  });
});
