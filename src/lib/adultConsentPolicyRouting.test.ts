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
import { before, describe, it } from "node:test";
import {
  ADULT_CONTENT_POLICY_BASE,
  ADULT_CONTENT_POLICY_CNC_PERMISSION,
  buildAdultContentPolicyBlock,
} from "@/lib/advancedProseNsfwGuidelines";
import {
  advanceModelRouteState,
  classifySceneMode,
  DEFAULT_MODEL_ROUTE_STATE,
  detectSafewordStop,
  resolveAdultEligibility,
  resolveAdultRoutingConfig,
  resolveEffectiveConsentMode,
  type ModelRouteState,
} from "@/lib/adultSceneRouting";
import {
  resolveAdultDeliveryPlan,
  shouldInvokeAdultRefusalFallback,
} from "@/lib/adultDeliveryPlan";
import { resolveAdultRefusalFallbackModelId } from "@/lib/adultHandoffSourceRouting";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
} from "@/lib/chatModels";
import type { buildContext as BuildContextFn } from "@/services/contextBuilder";

/** Frozen provider-wire [ADULT CONTENT POLICY] sections (pre-edit baseline). */
const FROZEN_WIRE_POLICY = {
  standard: buildAdultContentPolicyBlock("standard"),
  power_play: buildAdultContentPolicyBlock("power_play"),
  cnc_opt_in: buildAdultContentPolicyBlock("cnc_opt_in"),
} as const;

const GEMINI = CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL;
const DEEPSEEK = CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL;
const ALLOWED_WITH_CNC = ["standard", "cnc_opt_in"] as const;

const STANDARD_EXPLICIT_INPUT =
  "OOC: 현재 장면 계속. 이제 둘의 관계를 성인 장면까지 진행해.";
const CNC_OPT_IN_INPUT =
  "OOC: CNC 강압 역할극에 사전 동의한다. 세이프워드는 레드다.";
const SAFEWORD_INPUT = "레드";

const config = resolveAdultRoutingConfig({ ADULT_SCENE_ROUTING_ENABLED: "true" });
const eligible = resolveAdultEligibility({
  userAdultVerified: true,
  adultContentVisibilityEnabled: true,
  participants: [{ age: 28, isAdult: true }],
});

let buildContext: typeof BuildContextFn;

before(async () => {
  ({ buildContext } = await import("@/services/contextBuilder"));
});

function extractAdultPolicyWire(systemPrompt: string): string {
  const start = systemPrompt.indexOf("[ADULT CONTENT POLICY]");
  if (start < 0) return "";
  const end = systemPrompt.indexOf("[19+ INTIMACY]", start);
  return systemPrompt.slice(start, end >= 0 ? end : undefined).trim();
}

function buildNsfwWire(activeConsentMode: "standard" | "power_play" | "cnc_opt_in") {
  const built = buildContext({
    charName: "Test",
    chunks: [],
    userNickname: "User",
    shortTermHistory: [{ role: "user", content: "안녕" }],
    currentUserMessage: "계속",
    nsfw: true,
    activeConsentMode,
    provider: "openrouter",
    modelId: GEMINI,
  });
  return extractAdultPolicyWire(built.systemPrompt);
}

function cncPermissionPresent(wire: string): boolean {
  return wire.includes(ADULT_CONTENT_POLICY_CNC_PERMISSION);
}

function deliveryPlanFor(input: {
  currentInput: string;
  state?: ModelRouteState;
  activeConsentMode: "standard" | "power_play" | "cnc_opt_in";
}) {
  const state = input.state ?? { ...DEFAULT_MODEL_ROUTE_STATE };
  const classification = classifySceneMode({
    currentInput: input.currentInput,
    previousSceneMode: state.currentSceneMode,
    activeConsentMode: input.activeConsentMode,
    previousConsentMode: state.activeConsentMode,
  });
  return {
    classification,
    plan: resolveAdultDeliveryPlan({
      routingEnabled: true,
      eligibility: eligible,
      silentRefusalFallback: true,
      selectedModelId: GEMINI,
      adultTargetModelId: resolveAdultRefusalFallbackModelId(GEMINI),
      classification,
      state,
      adultDialogueProfile: "auto",
      providerCapabilities: config.providerCapabilities,
      chatAdultModeEnabled: true,
    }),
  };
}

describe("consent policy routing — frozen provider-wire sections", () => {
  it("Adult ON full contract includes base policy and CNC for all scene consent modes", () => {
    assert.equal(FROZEN_WIRE_POLICY.standard, FROZEN_WIRE_POLICY.cnc_opt_in);
    assert.equal(FROZEN_WIRE_POLICY.power_play, FROZEN_WIRE_POLICY.cnc_opt_in);
    assert.match(FROZEN_WIRE_POLICY.standard, /CNC 역할극/);
    assert.ok(FROZEN_WIRE_POLICY.standard.includes(ADULT_CONTENT_POLICY_CNC_PERMISSION));
    assert.ok(FROZEN_WIRE_POLICY.standard.includes(ADULT_CONTENT_POLICY_BASE));
  });
});

describe("consent policy routing — buildContext provider wire", () => {
  it("DB cnc capability + standard turn keeps scene state standard; wire has full adult contract", () => {
    const effective = resolveEffectiveConsentMode({
      requested: "cnc_opt_in",
      previous: "standard",
      currentInput: STANDARD_EXPLICIT_INPUT,
      allowedConsentModes: [...ALLOWED_WITH_CNC],
    });
    assert.equal(effective, "standard");

    const wire = buildNsfwWire(effective);
    assert.equal(wire, FROZEN_WIRE_POLICY.standard);
    assert.equal(cncPermissionPresent(wire), true);
  });

  it("explicit valid CNC activation keeps same wire; scene state becomes cnc_opt_in", () => {
    const effective = resolveEffectiveConsentMode({
      requested: "cnc_opt_in",
      previous: "standard",
      currentInput: CNC_OPT_IN_INPUT,
      allowedConsentModes: [...ALLOWED_WITH_CNC],
    });
    assert.equal(effective, "cnc_opt_in");

    const wire = buildNsfwWire(effective);
    assert.equal(wire, FROZEN_WIRE_POLICY.cnc_opt_in);
    assert.equal(cncPermissionPresent(wire), true);
  });

  it("power_play activeConsentMode keeps full adult wire", () => {
    const effective = resolveEffectiveConsentMode({
      requested: "power_play",
      previous: "standard",
      currentInput: STANDARD_EXPLICIT_INPUT,
      allowedConsentModes: ["standard", "power_play", "cnc_opt_in"],
    });
    assert.equal(effective, "power_play");

    const wire = buildNsfwWire(effective);
    assert.equal(wire, FROZEN_WIRE_POLICY.power_play);
    assert.equal(cncPermissionPresent(wire), true);
  });

  it("safeword hard stop resets scene consent; wire still has full adult contract", () => {
    const previous = {
      ...DEFAULT_MODEL_ROUTE_STATE,
      currentSceneMode: "explicit" as const,
      sexualContextActive: true,
      activeConsentMode: "cnc_opt_in" as const,
    };
    assert.equal(
      detectSafewordStop(SAFEWORD_INPUT, { previousConsentMode: "cnc_opt_in" }),
      true
    );

    const resetConsent = resolveEffectiveConsentMode({
      requested: undefined,
      previous: previous.activeConsentMode,
      currentInput: SAFEWORD_INPUT,
      allowedConsentModes: [...ALLOWED_WITH_CNC],
    });
    assert.equal(resetConsent, "standard");

    const nextState = advanceModelRouteState({
      previous,
      deliveredRoute: "general",
      sceneModeAfter: "normal",
      sexualContextActive: false,
      config,
      explicitSceneEnd: true,
      activeConsentMode: resetConsent,
    });
    assert.equal(nextState.activeConsentMode, "standard");

    const wire = buildNsfwWire(nextState.activeConsentMode);
    assert.equal(cncPermissionPresent(wire), true);
  });

  it("selected model routing unchanged under consent modes", () => {
    const standardPlan = deliveryPlanFor({
      currentInput: STANDARD_EXPLICIT_INPUT,
      activeConsentMode: "standard",
    }).plan;
    assert.equal(standardPlan.primaryModelId, GEMINI);
    assert.equal(standardPlan.fallbackModelId, DEEPSEEK);

    const cncPlan = deliveryPlanFor({
      currentInput: CNC_OPT_IN_INPUT,
      activeConsentMode: "cnc_opt_in",
    }).plan;
    assert.equal(cncPlan.primaryModelId, GEMINI);
    assert.equal(cncPlan.fallbackModelId, DEEPSEEK);
  });

  it("adult refusal handoff routing unchanged after consent resolution", () => {
    const { plan } = deliveryPlanFor({
      currentInput: STANDARD_EXPLICIT_INPUT,
      activeConsentMode: "standard",
    });
    assert.equal(plan.fallbackPrepared, true);
    assert.equal(
      shouldInvokeAdultRefusalFallback({
        plan,
        hasVisibleTokens: false,
        fallbackAlreadyAttempted: false,
        text: "I can't help with that request.",
        finishReason: "stop",
      }).invoke,
      true
    );

    const safewordClass = classifySceneMode({
      currentInput: SAFEWORD_INPUT,
      previousSceneMode: "explicit",
      previousConsentMode: "cnc_opt_in",
      activeConsentMode: "standard",
    });
    assert.equal(safewordClass.hardStop, true);
    const { plan: stoppedPlan } = deliveryPlanFor({
      currentInput: SAFEWORD_INPUT,
      state: {
        ...DEFAULT_MODEL_ROUTE_STATE,
        currentSceneMode: "explicit",
        activeConsentMode: "cnc_opt_in",
      },
      activeConsentMode: "standard",
    });
    assert.equal(stoppedPlan.fallbackPrepared, false);
  });
});
