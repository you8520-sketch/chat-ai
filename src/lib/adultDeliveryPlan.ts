import { normalizeDeepSeekV4ProModelId } from "@/lib/chatModels";
import {
  detectModelRefusal,
  modelFamily,
  providerCanHandleScene,
  type AdultDialogueProfile,
  type AdultEligibilityResult,
  type AdultRoutingConfig,
  type ModelRouteState,
  type SceneClassification,
  type SceneMode,
} from "@/lib/adultSceneRouting";

export type AdultDeliveryPrimaryRoute = "general";

export type AdultFallbackPrepReason =
  | "current_input_explicit_intent"
  | "requires_adult_capable_model"
  | "previous_requires_adult"
  | "frequent_dirty_talk"
  | "provider_boundary_exceeded"
  | "existing_adult_scene";

export type AdultDeliveryPlan = {
  primaryModelId: string;
  primaryRoute: AdultDeliveryPrimaryRoute;
  fallbackPrepared: boolean;
  fallbackModelId: string;
  fallbackReason?: AdultFallbackPrepReason;
};

const SAFE_SCENE_MODES = new Set<SceneMode>(["normal", "romantic"]);

const PREVIOUS_ADULT_SCENE_MODES = new Set<SceneMode>([
  "explicit_dialogue",
  "intimate_transition",
  "explicit",
]);

export function isSelectedModelAdultTarget(
  selectedModelId: string,
  adultTargetModelId: string
): boolean {
  const selected = normalizeDeepSeekV4ProModelId(selectedModelId).trim().toLowerCase();
  const target = normalizeDeepSeekV4ProModelId(adultTargetModelId).trim().toLowerCase();
  return selected.length > 0 && selected === target;
}

function isSafeSceneMode(sceneMode: SceneMode): boolean {
  return SAFE_SCENE_MODES.has(sceneMode);
}

export function collectAdultFallbackPrepReasons(input: {
  eligibility: AdultEligibilityResult;
  classification: SceneClassification;
  state: ModelRouteState;
  adultDialogueProfile: AdultDialogueProfile;
  selectedModelId: string;
  providerCapabilities: Record<string, SceneMode>;
}): AdultFallbackPrepReason[] {
  const { classification, state, eligibility } = input;
  const reasons: AdultFallbackPrepReason[] = [];
  const previousRequiresAdult =
    !classification.sceneReset &&
    PREVIOUS_ADULT_SCENE_MODES.has(state.currentSceneMode);
  const frequentDirtyTalkRoute =
    eligibility.eligible &&
    input.adultDialogueProfile === "explicit_frequent" &&
    classification.sexualContextActive === true;
  const providerBoundaryExceeded = !providerCanHandleScene(
    { providerCapabilities: input.providerCapabilities } as AdultRoutingConfig,
    modelFamily(input.selectedModelId),
    classification.sceneMode
  );
  const existingAdultScene =
    !classification.sceneReset &&
    state.activeRoute === "adult" &&
    !isSafeSceneMode(classification.sceneMode);

  if (classification.currentInputExplicitIntent) {
    reasons.push("current_input_explicit_intent");
  }
  if (classification.requiresAdultCapableModel) {
    reasons.push("requires_adult_capable_model");
  }
  if (previousRequiresAdult && !isSafeSceneMode(classification.sceneMode)) {
    reasons.push("previous_requires_adult");
  }
  if (frequentDirtyTalkRoute) {
    reasons.push("frequent_dirty_talk");
  }
  if (providerBoundaryExceeded) {
    reasons.push("provider_boundary_exceeded");
  }
  if (existingAdultScene) {
    reasons.push("existing_adult_scene");
  }
  return reasons;
}

export function resolveAdultDeliveryPlan(input: {
  routingEnabled: boolean;
  eligibility: AdultEligibilityResult;
  silentRefusalFallback: boolean;
  selectedModelId: string;
  adultTargetModelId: string;
  classification: SceneClassification;
  state: ModelRouteState;
  adultDialogueProfile: AdultDialogueProfile;
  providerCapabilities: Record<string, SceneMode>;
}): AdultDeliveryPlan {
  const primaryModelId = input.selectedModelId;
  const fallbackModelId = input.adultTargetModelId;
  const base: AdultDeliveryPlan = {
    primaryModelId,
    primaryRoute: "general",
    fallbackPrepared: false,
    fallbackModelId,
  };

  if (!input.routingEnabled) return base;
  if (!input.eligibility.eligible) return base;
  if (!input.eligibility.allowedByAdultContentPolicy) return base;
  if (!input.silentRefusalFallback) return base;
  if (isSelectedModelAdultTarget(primaryModelId, fallbackModelId)) return base;

  const reasons = collectAdultFallbackPrepReasons({
    eligibility: input.eligibility,
    classification: input.classification,
    state: input.state,
    adultDialogueProfile: input.adultDialogueProfile,
    selectedModelId: primaryModelId,
    providerCapabilities: input.providerCapabilities,
  });
  if (reasons.length === 0) return base;

  return {
    ...base,
    fallbackPrepared: true,
    fallbackReason: reasons[0],
  };
}

export function shouldInvokeAdultRefusalFallback(input: {
  plan: AdultDeliveryPlan;
  text?: string | null;
  finishReason?: string | null;
  error?: unknown;
  hasVisibleTokens: boolean;
  fallbackAlreadyAttempted: boolean;
}): { invoke: boolean; reason: string } {
  if (!input.plan.fallbackPrepared) {
    return { invoke: false, reason: "fallback_not_prepared" };
  }
  if (input.fallbackAlreadyAttempted) {
    return { invoke: false, reason: "fallback_already_attempted" };
  }
  if (input.hasVisibleTokens) {
    return { invoke: false, reason: "primary_tokens_already_visible" };
  }
  const refusal = detectModelRefusal({
    text: input.text,
    finishReason: input.finishReason,
    error: input.error,
  });
  if (!refusal.refused) {
    return { invoke: false, reason: "not_refusal" };
  }
  return { invoke: true, reason: refusal.reason };
}
