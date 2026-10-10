import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  classifySceneMode,
  createInitialStreamBuffer,
  decideAdultModelRoute,
  DEFAULT_MODEL_ROUTE_STATE,
  detectModelRefusal,
  resolveAdultEligibility,
  resolveAdultRoutingConfig,
} from "./adultSceneRouting";
import {
  invokePreparedAdultRefusalFallback,
  resolveAdultDeliveryPlan,
  shouldInvokeAdultRefusalFallback,
} from "./adultDeliveryPlan";
import { resolveAdultRefusalFallbackModelId } from "./adultHandoffSourceRouting";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
} from "./chatModels";

const AUDIT = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../docs/audits/gemini31-deepseek-refusal-handoff-p1"
);

const B3_USER = readFileSync(join(AUDIT, "raw/B-B3-USER_RAW.txt"), "utf8");
const B3_GEMINI = readFileSync(join(AUDIT, "raw/B-B3-GEMINI-RAW.txt"), "utf8");
const B2_GEMINI = readFileSync(join(AUDIT, "raw/B-B2-GEMINI-RAW.txt"), "utf8");

const GEMINI = CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL;
const DEEPSEEK = CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL;

function frozenB3Plan() {
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
  const classification = classifySceneMode({
    currentInput: B3_USER,
    previousSceneMode: "normal",
    adultDialogueProfile: "auto",
    activeConsentMode: "standard",
  });
  const state = { ...DEFAULT_MODEL_ROUTE_STATE };
  const plan = resolveAdultDeliveryPlan({
    routingEnabled: true,
    eligibility,
    silentRefusalFallback: true,
    selectedModelId: GEMINI,
    adultTargetModelId: resolveAdultRefusalFallbackModelId(GEMINI),
    classification,
    state,
    adultDialogueProfile: "auto",
    providerCapabilities: config.providerCapabilities,
    chatAdultModeEnabled: true,
  });
  const route = decideAdultModelRoute({
    config,
    state,
    classification,
    eligibility,
    adultDialogueProfile: "auto",
    selectedModelId: GEMINI,
  });
  return { config, eligibility, classification, plan, route };
}

function preVisibleBuffer(text: string) {
  const sent: object[] = [];
  const gate = createInitialStreamBuffer((event) => sent.push(event), 400);
  gate.send({ type: "delta", text });
  return { gate, sent };
}

describe("Issue 1 — frozen B3 Gemini refusal path", () => {
  it("diagnosis: B3 stays eligible and pre-visible; first controlling miss is detectModelRefusal", () => {
    const { eligibility, classification, plan, route } = frozenB3Plan();
    const { gate } = preVisibleBuffer(B3_GEMINI);

    assert.equal(classification.sceneMode, "explicit");
    assert.equal(classification.currentInputExplicitIntent, true);
    assert.equal(classification.hardStop, false);
    assert.equal(eligibility.eligible, true);
    assert.equal(eligibility.allowedByAdultContentPolicy, true);
    assert.equal(route.refusalBufferRecommended, true);
    assert.equal(plan.fallbackPrepared, true);
    assert.equal(plan.fallbackModelId, DEEPSEEK);
    assert.equal(gate.hasVisibleTokens(), false);
    assert.equal(gate.bufferedText(), B3_GEMINI);
    assert.ok(B3_GEMINI.includes("생성할 수 없"));
    assert.equal(B3_GEMINI.includes("작성할 수 없"), false);
    assert.ok(B2_GEMINI.includes("작성할 수 없"));
    assert.equal(
      detectModelRefusal({ text: B2_GEMINI, finishReason: "stop" }).refused,
      true
    );

    const current = detectModelRefusal({
      text: gate.bufferedText(),
      finishReason: "stop",
    });
    assert.equal(current.refused, false);
    assert.equal(current.reason, "unknown");
    assert.deepEqual(
      shouldInvokeAdultRefusalFallback({
        plan,
        text: gate.bufferedText(),
        finishReason: "stop",
        hasVisibleTokens: gate.hasVisibleTokens(),
        fallbackAlreadyAttempted: false,
      }),
      { invoke: false, reason: "not_refusal" }
    );
  });

  it("expected invariant: qualifying pre-visible B3 Gemini refusal invokes DeepSeek 0813 once", async () => {
    const { eligibility, plan, route } = frozenB3Plan();
    const { gate } = preVisibleBuffer(B3_GEMINI);

    assert.equal(eligibility.eligible, true);
    assert.equal(plan.fallbackPrepared, true);
    assert.equal(plan.fallbackModelId, DEEPSEEK);
    assert.notEqual(plan.fallbackModelId, GEMINI);
    assert.equal(route.refusalBufferRecommended, true);
    assert.equal(gate.hasVisibleTokens(), false);
    assert.ok(B3_GEMINI.length > 0 && B3_GEMINI.length < 400);

    const refusal = detectModelRefusal({
      text: B3_GEMINI,
      finishReason: "stop",
    });
    assert.equal(
      refusal.refused,
      true,
      "frozen B3 Gemini RAW is a qualifying provider refusal"
    );

    let fallbackInvocationCount = 0;
    const result = await invokePreparedAdultRefusalFallback({
      plan,
      fallbackContextAvailable: true,
      text: B3_GEMINI,
      finishReason: "stop",
      hasVisibleTokens: false,
      fallbackAlreadyAttempted: false,
      runFallback: async () => {
        fallbackInvocationCount += 1;
        return { model: DEEPSEEK };
      },
    });
    assert.equal(result.invoked, true);
    assert.equal(fallbackInvocationCount, 1);
  });
});
