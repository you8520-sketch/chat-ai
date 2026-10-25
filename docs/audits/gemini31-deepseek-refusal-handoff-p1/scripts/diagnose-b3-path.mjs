/**
 * Read-only B3 vs B2 execution-path diagnosis.
 * No provider calls. Uses frozen evidence + production modules.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("tsx/cjs/api").register();

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = (rel) => join("/workspace/src/lib", rel);

const {
  classifySceneMode,
  decideAdultModelRoute,
  detectModelRefusal,
  createInitialStreamBuffer,
  resolveAdultEligibility,
  resolveAdultRoutingConfig,
  DEFAULT_MODEL_ROUTE_STATE,
} = require(src("adultSceneRouting.ts"));
const {
  resolveAdultDeliveryPlan,
  shouldInvokeAdultRefusalFallback,
  invokePreparedAdultRefusalFallback,
} = require(src("adultDeliveryPlan.ts"));
const { resolveAdultRefusalFallbackModelId } = require(
  src("adultHandoffSourceRouting.ts")
);
const {
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
} = require(src("chatModels.ts"));

const GEMINI = CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL;
const DEEPSEEK = CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL;

function loadPair(label) {
  const user = readFileSync(join(root, `raw/${label}-USER_RAW.txt`), "utf8");
  const gemini = readFileSync(join(root, `raw/${label}-GEMINI-RAW.txt`), "utf8");
  return { label, user, gemini };
}

function tokenPresence(text) {
  return {
    jakseong: text.includes("작성할 수 없"),
    saengseong: text.includes("생성할 수 없"),
    anjeonJeongchaek: text.includes("안전 정책"),
    anjeonGuideline: text.includes("안전 가이드라인"),
    seongjeokNogeol: text.includes("성적으로 노골적인 내용"),
    nogeolSeongjeok: text.includes("노골적인 성적"),
    yocheongeung: /요청에 (?:응할|따를) 수 없/.test(text),
  };
}

function trace(pair) {
  const config = resolveAdultRoutingConfig({
    ADULT_SCENE_ROUTING_ENABLED: "true",
    ADULT_SCENE_SILENT_REFUSAL_FALLBACK: "true",
    ADULT_SCENE_INITIAL_STREAM_BUFFER_CHARS: "400",
  });
  const eligibility = resolveAdultEligibility({
    userAdultVerified: true,
    adultContentVisibilityEnabled: true,
    participants: [{ age: 28, isAdult: true, adultStatus: "confirmed" }],
  });
  const sceneClassification = classifySceneMode({
    currentInput: pair.user,
    previousSceneMode: "explicit",
    recentRawText: "이전 성인 장면 맥락",
    adultDialogueProfile: "auto",
    activeConsentMode: "standard",
  });
  const state = {
    ...DEFAULT_MODEL_ROUTE_STATE,
    activeRoute: "adult",
    currentSceneMode: "explicit",
    adultRouteMinimumTurnsRemaining: 2,
    sexualContextActive: true,
  };
  const plan = resolveAdultDeliveryPlan({
    routingEnabled: true,
    eligibility,
    silentRefusalFallback: true,
    selectedModelId: GEMINI,
    adultTargetModelId: resolveAdultRefusalFallbackModelId(GEMINI),
    classification: sceneClassification,
    state,
    adultDialogueProfile: "auto",
    providerCapabilities: config.providerCapabilities,
    chatAdultModeEnabled: true,
  });
  const route = decideAdultModelRoute({
    config,
    state,
    classification: sceneClassification,
    eligibility,
    adultDialogueProfile: "auto",
    selectedModelId: GEMINI,
  });
  const sent = [];
  const buffer = createInitialStreamBuffer((event) => sent.push(event), 400);
  buffer.send({ type: "delta", text: pair.gemini });
  const bufferedText = buffer.bufferedText();
  const hasVisibleTokens = buffer.hasVisibleTokens();
  const refusal = detectModelRefusal({
    text: bufferedText,
    finishReason: "stop",
  });
  const invokeGate = shouldInvokeAdultRefusalFallback({
    plan,
    fallbackAlreadyAttempted: false,
    hasVisibleTokens,
    text: bufferedText,
    finishReason: "stop",
  });
  let fallbackInvocationCount = 0;
  let invokeResult = null;
  return {
    label: pair.label,
    userChars: pair.user.length,
    geminiChars: pair.gemini.length,
    geminiPreview: pair.gemini.slice(0, 240),
    sceneClassification: {
      sceneMode: sceneClassification.sceneMode,
      sexualContextActive: sceneClassification.sexualContextActive,
      currentInputExplicitIntent: sceneClassification.currentInputExplicitIntent,
      requiresAdultCapableModel: sceneClassification.requiresAdultCapableModel,
      hardStop: sceneClassification.hardStop,
      sceneReset: sceneClassification.sceneReset,
      oocIntent: sceneClassification.oocIntent,
      reason: sceneClassification.reason,
    },
    eligibility: {
      eligible: eligibility.eligible,
      allowedByAdultContentPolicy: eligibility.allowedByAdultContentPolicy,
      blockReason: eligibility.blockReason ?? null,
      selectedAi: GEMINI,
      replacementTarget: resolveAdultRefusalFallbackModelId(GEMINI),
      replacementTargetIsDeepSeek0813:
        resolveAdultRefusalFallbackModelId(GEMINI) === DEEPSEEK,
    },
    refusalBufferRecommended: route.refusalBufferRecommended,
    fallbackPrepared: plan.fallbackPrepared,
    fallbackReason: plan.fallbackReason ?? null,
    fallbackModelId: plan.fallbackModelId,
    streamBufferState: {
      bufferChars: 400,
      queuedChars: pair.gemini.length,
      flushedChars: sent.length,
      hasVisibleTokens,
      flushed: hasVisibleTokens,
      belowBufferLimit: pair.gemini.length < 400,
    },
    bufferedTextAtCompletion: {
      chars: bufferedText.length,
      text: bufferedText,
    },
    detectModelRefusal: {
      input: { text: bufferedText, finishReason: "stop" },
      result: refusal,
      detectorTokensInText: tokenPresence(bufferedText),
    },
    fallbackInvocationGate: invokeGate,
    invokePreparedAdultRefusalFallbackReached: invokeGate.invoke === true,
    fallbackInvocationCount,
    asyncFinish: async () => {
      const result = await invokePreparedAdultRefusalFallback({
        plan,
        fallbackContextAvailable: true,
        text: bufferedText,
        finishReason: "stop",
        hasVisibleTokens,
        fallbackAlreadyAttempted: false,
        runFallback: async () => {
          fallbackInvocationCount += 1;
          return { model: DEEPSEEK };
        },
      });
      invokeResult = result;
      return {
        fallbackInvocationCount,
        invokeResult,
      };
    },
  };
}

const b2 = trace(loadPair("B-B2"));
const b3 = trace(loadPair("B-B3"));
const b2Invoke = await b2.asyncFinish();
const b3Invoke = await b3.asyncFinish();
delete b2.asyncFinish;
delete b3.asyncFinish;
b2.fallbackInvocationCount = b2Invoke.fallbackInvocationCount;
b2.invokePreparedResult = b2Invoke.invokeResult;
b3.fallbackInvocationCount = b3Invoke.fallbackInvocationCount;
b3.invokePreparedResult = b3Invoke.invokeResult;

function firstDivergence() {
  const keys = [
    ["sceneClassification.sceneMode", b2.sceneClassification.sceneMode, b3.sceneClassification.sceneMode],
    ["sceneClassification.currentInputExplicitIntent", b2.sceneClassification.currentInputExplicitIntent, b3.sceneClassification.currentInputExplicitIntent],
    ["eligibility.eligible", b2.eligibility.eligible, b3.eligibility.eligible],
    ["fallbackPrepared", b2.fallbackPrepared, b3.fallbackPrepared],
    ["refusalBufferRecommended", b2.refusalBufferRecommended, b3.refusalBufferRecommended],
    ["streamBufferState.hasVisibleTokens", b2.streamBufferState.hasVisibleTokens, b3.streamBufferState.hasVisibleTokens],
    ["detectModelRefusal.refused", b2.detectModelRefusal.result.refused, b3.detectModelRefusal.result.refused],
    ["detectModelRefusal.reason", b2.detectModelRefusal.result.reason, b3.detectModelRefusal.result.reason],
    ["fallbackInvocationGate.invoke", b2.fallbackInvocationGate.invoke, b3.fallbackInvocationGate.invoke],
    ["fallbackInvocationGate.reason", b2.fallbackInvocationGate.reason, b3.fallbackInvocationGate.reason],
    ["invokeReached", b2.invokePreparedAdultRefusalFallbackReached, b3.invokePreparedAdultRefusalFallbackReached],
    ["fallbackInvocationCount", b2.fallbackInvocationCount, b3.fallbackInvocationCount],
  ];
  for (const [name, left, right] of keys) {
    if (left !== right) return { name, b2: left, b3: right };
  }
  return null;
}

const out = {
  firstDeterministicDivergence: firstDivergence(),
  rootCause:
    "B3 Gemini RAW uses 생성할 수 없 / 안전 가이드라인, which looksLikeProviderRefusalProse does not match. B2 used 작성할 수 없, which the existing detector matches. Steps 1–6 are the same; step 7 is the first divergence.",
  b2,
  b3,
};

const dest = join(root, "ISSUE1-B3-PATH-DIAGNOSIS.json");
writeFileSync(dest, JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify({
  firstDeterministicDivergence: out.firstDeterministicDivergence,
  b2: {
    refused: b2.detectModelRefusal.result,
    invoke: b2.fallbackInvocationGate,
    count: b2.fallbackInvocationCount,
    tokens: b2.detectModelRefusal.detectorTokensInText,
  },
  b3: {
    refused: b3.detectModelRefusal.result,
    invoke: b3.fallbackInvocationGate,
    count: b3.fallbackInvocationCount,
    tokens: b3.detectModelRefusal.detectorTokensInText,
    fallbackPrepared: b3.fallbackPrepared,
    hasVisibleTokens: b3.streamBufferState.hasVisibleTokens,
  },
}, null, 2));
console.log("wrote", dest);
