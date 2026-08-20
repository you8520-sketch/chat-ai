import type Database from "better-sqlite3";
import {
  decideAdultModelRoute,
  type AdultDialogueProfile,
  type AdultEligibilityResult,
  type AdultRoutingConfig,
  type ModelRouteState,
  type SceneClassification,
} from "@/lib/adultSceneRouting";
import {
  resolveAdultDeliveryPlan,
  type AdultDeliveryPlan,
} from "@/lib/adultDeliveryPlan";
import {
  evaluateSecondarySceneParticipantGuard,
  type SecondarySceneParticipantGuardResult,
} from "@/lib/secondarySceneParticipantGuard";
import {
  commitCurrentTurnSecondarySafetyCore,
  type EvaluateSecondarySceneSafetyInput,
  type SecondarySceneSafetySnapshot,
} from "@/lib/secondarySceneParticipantSafety";
import {
  bootstrapStreamingTurnCore,
  type StreamingTurnBootstrap,
  type StreamingTurnBootstrapOptions,
} from "@/lib/streamingPersistence";

export type SecondarySceneParticipantExecutionPlan = {
  guardResult: SecondarySceneParticipantGuardResult | null;
  effectiveAdultRoutingEnabled: boolean;
  effectiveAdultRoutingConfig: AdultRoutingConfig;
  adultRouteDecision: ReturnType<typeof decideAdultModelRoute>;
  adultDeliveryPlan: AdultDeliveryPlan;
};

/**
 * Production pre-provider policy seam used by the chat route.
 *
 * Secondary participant safety is scene-local and applies independently of
 * whether adult handoff routing is enabled. The base eligibility and routing
 * inputs are intentionally retained for policy context only; they do not
 * weaken a secondary-participant hard block.
 */
export function resolveSecondarySceneParticipantExecutionPlan(input: {
  guardEnabled: boolean;
  sceneClassification: SceneClassification;
  baseAdultEligibility: AdultEligibilityResult;
  prospectiveSecondarySafety: SecondarySceneSafetySnapshot | null;
  safetyEvaluationFailed: boolean;
  adultRoutingConfig: AdultRoutingConfig;
  adultDialogueProfile: AdultDialogueProfile;
  priorModelRouteState: ModelRouteState;
  selectedModelId: string;
  adultTargetModelId: string;
}): SecondarySceneParticipantExecutionPlan {
  const guardResult = input.guardEnabled
    ? evaluateSecondarySceneParticipantGuard({
        sceneClassification: input.sceneClassification,
        baseAdultEligibility: input.baseAdultEligibility,
        prospectiveSecondarySafety: input.prospectiveSecondarySafety,
        adultRoutingEnabled: input.adultRoutingConfig.enabled,
        safetyEvaluationFailed: input.safetyEvaluationFailed,
      })
    : null;
  const effectiveAdultRoutingEnabled =
    guardResult?.action === "DISABLE_ADULT_HANDOFF_ONLY"
      ? false
      : input.adultRoutingConfig.enabled;
  const effectiveAdultRoutingConfig = {
    ...input.adultRoutingConfig,
    enabled: effectiveAdultRoutingEnabled,
  };
  const adultRouteDecision = decideAdultModelRoute({
    config: effectiveAdultRoutingConfig,
    state: input.priorModelRouteState,
    classification: input.sceneClassification,
    eligibility: input.baseAdultEligibility,
    adultDialogueProfile: input.adultDialogueProfile,
    selectedModelId: input.selectedModelId,
  });
  const adultDeliveryPlan = resolveAdultDeliveryPlan({
    routingEnabled: effectiveAdultRoutingEnabled,
    eligibility: input.baseAdultEligibility,
    silentRefusalFallback: input.adultRoutingConfig.silentRefusalFallback,
    selectedModelId: input.selectedModelId,
    adultTargetModelId: input.adultTargetModelId,
    classification: input.sceneClassification,
    state: input.priorModelRouteState,
    adultDialogueProfile: input.adultDialogueProfile,
    providerCapabilities: input.adultRoutingConfig.providerCapabilities,
  });
  return {
    guardResult,
    effectiveAdultRoutingEnabled,
    effectiveAdultRoutingConfig,
    adultRouteDecision,
    adultDeliveryPlan,
  };
}

export function bootstrapAndCommitSecondarySafetyAtomic(
  db: Database.Database,
  input: {
    bootstrap: StreamingTurnBootstrapOptions;
    safety:
      | Omit<EvaluateSecondarySceneSafetyInput, "db" | "sourceMessageId">
      | ((
          bootstrapped: StreamingTurnBootstrap
        ) => Omit<
          EvaluateSecondarySceneSafetyInput,
          "db" | "sourceMessageId"
        >);
  }
): StreamingTurnBootstrap {
  if (db.inTransaction) {
    throw new Error(
      "SECONDARY_SAFETY_COMPOSED_TRANSACTION_REQUIRES_OUTER_OWNER"
    );
  }
  return db.transaction(() => {
    const bootstrapped = bootstrapStreamingTurnCore(db, input.bootstrap);
    const safety =
      typeof input.safety === "function"
        ? input.safety(bootstrapped)
        : input.safety;
    commitCurrentTurnSecondarySafetyCore({
      ...safety,
      sourceMessageId: bootstrapped.userMessageId,
      db,
    });
    return bootstrapped;
  }).immediate();
}
