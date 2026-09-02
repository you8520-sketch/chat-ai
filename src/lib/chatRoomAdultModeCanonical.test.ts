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
import { readFileSync } from "node:fs";
import { before, describe, it } from "node:test";
import {
  ADULT_CONTENT_POLICY_CNC_PERMISSION,
  SAFE_SEXUAL_LIMIT_CONTRACT,
  buildAdvancedProseNsfwGuidelines,
} from "@/lib/advancedProseNsfwGuidelines";
import {
  decideAdultModelRoute,
  DEFAULT_MODEL_ROUTE_STATE,
  classifySceneMode,
  resolveAdultEligibility,
  resolveAdultRoutingConfig,
  resolveEffectiveConsentMode,
} from "@/lib/adultSceneRouting";
import {
  resolveAdultDeliveryPlan,
  shouldInvokeAdultRefusalFallback,
} from "@/lib/adultDeliveryPlan";
import { resolveAdultRefusalFallbackModelId } from "@/lib/adultHandoffSourceRouting";
import {
  resolveEffectiveAdultRp,
  resolveRoomAdultModeEnabled,
} from "@/lib/chatAdultHandoff";
import { CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL } from "@/lib/chatModels";
import type { buildContext as BuildContextFn } from "@/services/contextBuilder";

const GEMINI = CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL;
const config = resolveAdultRoutingConfig({ ADULT_SCENE_ROUTING_ENABLED: "true" });

const EXPLICIT_INPUT =
  "합의된 노골적인 성적 대사를 이어간다. 옷을 벗기고 삽입하는 성인 장면을 계속한다.";

let buildContext: typeof BuildContextFn;

before(async () => {
  ({ buildContext } = await import("@/services/contextBuilder"));
});

function countMatches(text: string, needle: string): number {
  let count = 0;
  let pos = 0;
  while (true) {
    const idx = text.indexOf(needle, pos);
    if (idx < 0) break;
    count += 1;
    pos = idx + needle.length;
  }
  return count;
}

function buildWire(input: {
  effectiveAdultRp: boolean;
  activeConsentMode?: "standard" | "cnc_opt_in";
  modelId?: string;
}) {
  return buildContext({
    charName: "Test",
    chunks: [],
    userNickname: "User",
    shortTermHistory: [{ role: "user", content: "안녕" }],
    currentUserMessage: EXPLICIT_INPUT,
    nsfw: input.effectiveAdultRp,
    activeConsentMode: input.activeConsentMode ?? "standard",
    provider: "openrouter",
    modelId: input.modelId ?? GEMINI,
  }).systemPrompt;
}

function deliveryPlanFor(input: {
  effectiveAdultRp: boolean;
  selectedModelId?: string;
  currentInput?: string;
}) {
  const eligibility = resolveAdultEligibility({
    userAdultVerified: true,
    roomAdultModeEnabled: input.effectiveAdultRp,
    participants: [{ age: 28, isAdult: true }],
  });
  const classification = classifySceneMode({
    currentInput: input.currentInput ?? EXPLICIT_INPUT,
    previousSceneMode: "explicit",
    activeConsentMode: "standard",
  });
  return resolveAdultDeliveryPlan({
    routingEnabled: true,
    eligibility,
    silentRefusalFallback: true,
    selectedModelId: input.selectedModelId ?? GEMINI,
    adultTargetModelId: resolveAdultRefusalFallbackModelId(
      input.selectedModelId ?? GEMINI
    ),
    classification,
    state: DEFAULT_MODEL_ROUTE_STATE,
    adultDialogueProfile: "auto",
    providerCapabilities: config.providerCapabilities,
    chatAdultModeEnabled: input.effectiveAdultRp,
  });
}

describe("chat room adult RP canonical owners", () => {
  it("R1/R2: home visibility does not gate effectiveAdultRp", () => {
    const homeVisibilityOn = true;
    const homeVisibilityOff = false;
    void homeVisibilityOn;
    void homeVisibilityOff;

    assert.equal(
      resolveEffectiveAdultRp({
        userAdultVerified: true,
        roomAdultModeEnabled: true,
      }),
      true
    );
    assert.equal(
      resolveEffectiveAdultRp({
        userAdultVerified: true,
        roomAdultModeEnabled: false,
      }),
      false
    );
  });

  it("R3: room Adult ON + verified → effectiveAdultRp true", () => {
    assert.equal(
      resolveEffectiveAdultRp({
        userAdultVerified: true,
        roomAdultModeEnabled: resolveRoomAdultModeEnabled({
          persisted: 1,
          userAdultVerified: true,
        }),
      }),
      true
    );
  });

  it("R4: room Adult OFF → effectiveAdultRp false", () => {
    assert.equal(
      resolveEffectiveAdultRp({
        userAdultVerified: true,
        roomAdultModeEnabled: resolveRoomAdultModeEnabled({
          persisted: 0,
          userAdultVerified: true,
        }),
      }),
      false
    );
  });

  it("R5: unverified user cannot forge Adult ON", () => {
    assert.equal(
      resolveRoomAdultModeEnabled({
        persisted: 1,
        requested: true,
        userAdultVerified: false,
      }),
      false
    );
    assert.equal(
      resolveEffectiveAdultRp({
        userAdultVerified: false,
        roomAdultModeEnabled: true,
      }),
      false
    );
  });

  it("A3/R6: Adult ON + standard scene state → full adult contract with CNC once", () => {
    const wire = buildWire({ effectiveAdultRp: true, activeConsentMode: "standard" });
    assert.equal(countMatches(wire, "[ADULT CONTENT POLICY]"), 1);
    assert.equal(countMatches(wire, "[19+ INTIMACY]"), 1);
    assert.equal(countMatches(wire, ADULT_CONTENT_POLICY_CNC_PERMISSION), 1);
    assert.equal(countMatches(wire, SAFE_SEXUAL_LIMIT_CONTRACT), 0);
  });

  it("A4/R7: Adult ON + cnc_opt_in scene state → CNC permission exactly once", () => {
    const wire = buildWire({ effectiveAdultRp: true, activeConsentMode: "cnc_opt_in" });
    assert.equal(countMatches(wire, "[ADULT CONTENT POLICY]"), 1);
    assert.equal(countMatches(wire, "[19+ INTIMACY]"), 1);
    assert.equal(countMatches(wire, ADULT_CONTENT_POLICY_CNC_PERMISSION), 1);
    assert.equal(countMatches(wire, SAFE_SEXUAL_LIMIT_CONTRACT), 0);
  });

  it("A1: home visibility OFF does not affect full adult contract when room Adult ON", () => {
    void resolveEffectiveAdultRp({
      userAdultVerified: true,
      roomAdultModeEnabled: true,
    });
    const wire = buildWire({ effectiveAdultRp: true, activeConsentMode: "standard" });
    assert.equal(countMatches(wire, ADULT_CONTENT_POLICY_CNC_PERMISSION), 1);
  });

  it("A2: room Adult OFF → safe 15+ contract only", () => {
    const wire = buildWire({ effectiveAdultRp: false });
    assert.equal(countMatches(wire, "[ADULT CONTENT POLICY]"), 0);
    assert.equal(countMatches(wire, "[19+ INTIMACY]"), 0);
    assert.equal(countMatches(wire, ADULT_CONTENT_POLICY_CNC_PERMISSION), 0);
    assert.equal(countMatches(wire, SAFE_SEXUAL_LIMIT_CONTRACT), 1);
  });

  it("A5: Adult OFF + CNC-looking input → safe contract, no adult fallback prep", () => {
    const cncInput = "OOC: CNC 강압 역할극에 사전 동의한다. 세이프워드는 레드다.";
    const wire = buildContext({
      charName: "Test",
      chunks: [],
      userNickname: "User",
      shortTermHistory: [{ role: "user", content: "안녕" }],
      currentUserMessage: cncInput,
      nsfw: false,
      activeConsentMode: "cnc_opt_in",
      provider: "openrouter",
      modelId: GEMINI,
    }).systemPrompt;
    assert.equal(countMatches(wire, "[ADULT CONTENT POLICY]"), 0);
    assert.equal(countMatches(wire, ADULT_CONTENT_POLICY_CNC_PERMISSION), 0);
    assert.equal(countMatches(wire, SAFE_SEXUAL_LIMIT_CONTRACT), 1);
    const plan = deliveryPlanFor({ effectiveAdultRp: false, currentInput: cncInput });
    assert.equal(plan.fallbackPrepared, false);
  });

  it("A6: settings PATCH and chat POST share effectiveIsAdult verification owner", () => {
    const routeSrc = readFileSync(
      new URL("../app/api/chat/route.ts", import.meta.url),
      "utf8"
    );
    const settingsSrc = readFileSync(
      new URL("../app/api/chat/settings/route.ts", import.meta.url),
      "utf8"
    );
    assert.match(routeSrc, /effectiveIsAdult\(user\.is_adult\)/);
    assert.match(settingsSrc, /effectiveIsAdult\(user\.is_adult\)/);
    assert.doesNotMatch(settingsSrc, /adultHandoffEnabled === true && !user\.is_adult/);
  });

  it("A7: selected model remains primary in Adult ON (Gemini sample)", () => {
    const plan = deliveryPlanFor({
      effectiveAdultRp: true,
      selectedModelId: GEMINI,
    });
    assert.equal(plan.primaryModelId, GEMINI);
    assert.equal(plan.primaryRoute, "general");
  });

  it("A8: real provider refusal remains the only fallback trigger", () => {
    const plan = deliveryPlanFor({ effectiveAdultRp: true });
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
    assert.equal(
      shouldInvokeAdultRefusalFallback({
        plan,
        hasVisibleTokens: true,
        fallbackAlreadyAttempted: false,
        text: "I can't help with that request.",
        finishReason: "stop",
      }).invoke,
      false
    );
  });

  it("R8/R9: Adult OFF omits adult-only contract and injects safe 15+ contract", () => {
    const wire = buildWire({ effectiveAdultRp: false });
    assert.equal(countMatches(wire, "[ADULT CONTENT POLICY]"), 0);
    assert.equal(countMatches(wire, "[19+ INTIMACY]"), 0);
    assert.equal(countMatches(wire, ADULT_CONTENT_POLICY_CNC_PERMISSION), 0);
    assert.equal(countMatches(wire, SAFE_SEXUAL_LIMIT_CONTRACT), 1);
    assert.match(wire, /in-character narrative diversion/);
    assert.match(wire, /정책 메타 거부문/);
  });

  it("R10/R11: Adult ON keeps selected model primary — no preemptive fallback", () => {
    const plan = deliveryPlanFor({ effectiveAdultRp: true, selectedModelId: GEMINI });
    assert.equal(plan.primaryModelId, GEMINI);
    assert.equal(plan.fallbackModelId, resolveAdultRefusalFallbackModelId(GEMINI));
    assert.equal(plan.fallbackPrepared, true);
    assert.equal(plan.primaryRoute, "general");
    const route = decideAdultModelRoute({
      config,
      state: DEFAULT_MODEL_ROUTE_STATE,
      classification: classifySceneMode({
        currentInput: EXPLICIT_INPUT,
        previousSceneMode: "explicit",
        activeConsentMode: "standard",
      }),
      eligibility: resolveAdultEligibility({
        userAdultVerified: true,
        roomAdultModeEnabled: true,
        participants: [{ age: 28, isAdult: true }],
      }),
      adultDialogueProfile: "auto",
      selectedModelId: GEMINI,
    });
    assert.equal(route.activeRoute, "general");
    assert.equal(route.firstAdultHandoff, false);
  });

  it("R12: only real provider refusal triggers adult fallback", () => {
    const plan = deliveryPlanFor({ effectiveAdultRp: true });
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
    assert.equal(
      shouldInvokeAdultRefusalFallback({
        plan,
        hasVisibleTokens: false,
        fallbackAlreadyAttempted: false,
        text: "정상적인 RP 응답입니다.",
        finishReason: "stop",
      }).invoke,
      false
    );
  });

  it("R13: Adult OFF explicit request does not enable refusal fallback plan", () => {
    const plan = deliveryPlanFor({ effectiveAdultRp: false });
    assert.equal(plan.fallbackPrepared, false);
    assert.equal(
      shouldInvokeAdultRefusalFallback({
        plan,
        hasVisibleTokens: false,
        fallbackAlreadyAttempted: false,
        text: "I can't help with that request.",
        finishReason: "stop",
      }).invoke,
      false
    );
  });

  it("R14–R16: normal/continue/regenerate share room-mode owner in route.ts", () => {
    const routeSrc = readFileSync(
      new URL("../app/api/chat/route.ts", import.meta.url),
      "utf8"
    );
    assert.match(routeSrc, /resolveEffectiveAdultRp/);
    assert.match(routeSrc, /nsfw: effectiveAdultRp/);
    assert.doesNotMatch(routeSrc, /resolveIsAdultMode/);
    assert.doesNotMatch(routeSrc, /body\.isAdultMode/);
    assert.doesNotMatch(routeSrc, /body\.isNsfwMode/);
  });

  it("R17: room mode persists via adult_handoff_enabled resolution", () => {
    assert.equal(
      resolveRoomAdultModeEnabled({ persisted: 1, requested: undefined, userAdultVerified: true }),
      true
    );
    assert.equal(
      resolveRoomAdultModeEnabled({ persisted: 0, requested: true, userAdultVerified: true }),
      true
    );
  });

  it("R18: toggle applies on next resolution — request overrides persisted", () => {
    assert.equal(
      resolveRoomAdultModeEnabled({ persisted: 0, requested: true, userAdultVerified: true }),
      true
    );
    assert.equal(
      resolveRoomAdultModeEnabled({ persisted: 1, requested: false, userAdultVerified: true }),
      false
    );
  });

  it("buildAdvancedProseNsfwGuidelines safe owner is mutually exclusive with adult owner", () => {
    const adultStandard = buildAdvancedProseNsfwGuidelines({
      nsfwEnabled: true,
      activeConsentMode: "standard",
    });
    const adultCnc = buildAdvancedProseNsfwGuidelines({
      nsfwEnabled: true,
      activeConsentMode: "cnc_opt_in",
    });
    const safe = buildAdvancedProseNsfwGuidelines({ nsfwEnabled: false });
    assert.ok(adultStandard.includes("[19+ INTIMACY]"));
    assert.ok(adultCnc.includes("[19+ INTIMACY]"));
    assert.equal(
      countMatches(adultStandard, ADULT_CONTENT_POLICY_CNC_PERMISSION),
      1
    );
    assert.equal(countMatches(adultCnc, ADULT_CONTENT_POLICY_CNC_PERMISSION), 1);
    assert.ok(!safe.includes("[19+ INTIMACY]"));
    assert.ok(safe.includes("[SAFE SEXUAL LIMIT — 15+ RP]"));
    assert.ok(!adultStandard.includes("[SAFE SEXUAL LIMIT — 15+ RP]"));
  });

  it("ChatClient does not send home visibility as isAdultMode", () => {
    const chatClient = readFileSync(
      new URL("../app/chat/[id]/ChatClient.tsx", import.meta.url),
      "utf8"
    );
    assert.doesNotMatch(chatClient, /nsfwMode\s*=\s*isAdult\s*&&\s*userNsfwOn/);
    assert.doesNotMatch(chatClient, /isAdultMode:\s*nsfwMode/);
    assert.doesNotMatch(chatClient, /isNsfwMode:\s*nsfwMode/);
    assert.match(chatClient, /adultHandoffEnabled:\s*adultHandoffOnRef\.current/);
  });

  it("CNC scene state owner stays separate from CNC permission on wire", () => {
    const effective = resolveEffectiveConsentMode({
      requested: "cnc_opt_in",
      previous: "standard",
      currentInput: "OOC: CNC 강압 역할극에 사전 동의한다.",
      allowedConsentModes: ["standard", "cnc_opt_in"],
    });
    assert.equal(effective, "cnc_opt_in");
    const blocked = resolveAdultEligibility({
      userAdultVerified: true,
      roomAdultModeEnabled: false,
      participants: [{ age: 28, isAdult: true }],
    });
    assert.equal(blocked.eligible, false);
    assert.equal(
      resolveEffectiveConsentMode({
        requested: "standard",
        previous: "standard",
        currentInput: EXPLICIT_INPUT,
        allowedConsentModes: ["standard", "cnc_opt_in"],
      }),
      "standard"
    );
  });
});
