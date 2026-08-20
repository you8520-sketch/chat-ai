import type {
  AdultEligibilityResult,
  SceneClassification,
  SceneMode,
} from "@/lib/adultSceneRouting";
import type { SecondarySceneSafetySnapshot } from "@/lib/secondarySceneParticipantSafety";

export type SecondarySceneParticipantGuardAction =
  | "ALLOW"
  | "DISABLE_ADULT_HANDOFF_ONLY"
  | "HARD_BLOCK_TURN";

export type SecondarySceneParticipantGuardReason =
  | null
  | "secondary_participant_minor"
  | "secondary_participant_conflict"
  | "secondary_participant_unknown"
  | "secondary_real_person"
  | "secondary_safety_coverage_incomplete"
  | "secondary_safety_unavailable";

export type SecondarySceneParticipantGuardInput = {
  sceneClassification: SceneClassification;
  baseAdultEligibility: AdultEligibilityResult;
  prospectiveSecondarySafety: SecondarySceneSafetySnapshot | null;
  adultRoutingEnabled: boolean;
  safetyEvaluationFailed?: boolean;
};

export type SecondarySceneParticipantGuardResult = {
  action: SecondarySceneParticipantGuardAction;
  reason: SecondarySceneParticipantGuardReason;
  participantIds: string[];
};

const HARD_BLOCK_SCENE_MODES = new Set<SceneMode>([
  "aftercare",
  "intimate_transition",
  "explicit_dialogue",
  "explicit",
]);

function isTensionAdultContext(classification: SceneClassification): boolean {
  return (
    classification.sexualContextActive === true ||
    classification.currentInputExplicitIntent === true ||
    classification.requiresAdultCapableModel === true
  );
}

function isAdultSexualGuardContext(
  classification: SceneClassification
): boolean {
  if (HARD_BLOCK_SCENE_MODES.has(classification.sceneMode)) return true;
  if (classification.sceneMode === "tension") {
    return isTensionAdultContext(classification);
  }
  return false;
}

function classifyProblematicSecondary(
  snapshot: SecondarySceneSafetySnapshot
): {
  problematic: boolean;
  reason: SecondarySceneParticipantGuardReason;
  participantIds: string[];
} {
  if (snapshot.realPersonParticipantIds.length > 0) {
    return {
      problematic: true,
      reason: "secondary_real_person",
      participantIds: snapshot.realPersonParticipantIds,
    };
  }
  if (snapshot.minorParticipantIds.length > 0) {
    return {
      problematic: true,
      reason: "secondary_participant_minor",
      participantIds: snapshot.minorParticipantIds,
    };
  }
  if (snapshot.conflictParticipantIds.length > 0) {
    return {
      problematic: true,
      reason: "secondary_participant_conflict",
      participantIds: snapshot.conflictParticipantIds,
    };
  }
  if (snapshot.unknownParticipantIds.length > 0) {
    return {
      problematic: true,
      reason: "secondary_participant_unknown",
      participantIds: snapshot.unknownParticipantIds,
    };
  }
  if (snapshot.coverage === "INCOMPLETE") {
    return {
      problematic: true,
      reason: "secondary_safety_coverage_incomplete",
      participantIds: [],
    };
  }
  return { problematic: false, reason: null, participantIds: [] };
}

export function isSecondarySceneParticipantGuardEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const normalized = env.SECONDARY_SCENE_PARTICIPANT_GUARD_ENABLED?.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

export function secondarySceneParticipantGuardUserMessage(): string {
  return "현재 장면의 모든 참여자가 성인인지 확인할 수 없어 성인 장면을 진행할 수 없습니다.";
}

export function evaluateSecondarySceneParticipantGuard(
  input: SecondarySceneParticipantGuardInput
): SecondarySceneParticipantGuardResult {
  void input.baseAdultEligibility;
  void input.adultRoutingEnabled;

  if (input.safetyEvaluationFailed) {
    if (isAdultSexualGuardContext(input.sceneClassification)) {
      return {
        action: "HARD_BLOCK_TURN",
        reason: "secondary_safety_unavailable",
        participantIds: [],
      };
    }
    return {
      action: "DISABLE_ADULT_HANDOFF_ONLY",
      reason: "secondary_safety_unavailable",
      participantIds: [],
    };
  }

  if (!input.prospectiveSecondarySafety) {
    if (isAdultSexualGuardContext(input.sceneClassification)) {
      return {
        action: "HARD_BLOCK_TURN",
        reason: "secondary_safety_unavailable",
        participantIds: [],
      };
    }
    return {
      action: "DISABLE_ADULT_HANDOFF_ONLY",
      reason: "secondary_safety_unavailable",
      participantIds: [],
    };
  }

  const issue = classifyProblematicSecondary(input.prospectiveSecondarySafety);
  if (!issue.problematic) {
    return { action: "ALLOW", reason: null, participantIds: [] };
  }

  const mode = input.sceneClassification.sceneMode;
  if (mode === "normal" || mode === "romantic") {
    return {
      action: "DISABLE_ADULT_HANDOFF_ONLY",
      reason: issue.reason,
      participantIds: issue.participantIds,
    };
  }
  if (mode === "tension") {
    if (isTensionAdultContext(input.sceneClassification)) {
      return {
        action: "HARD_BLOCK_TURN",
        reason: issue.reason,
        participantIds: issue.participantIds,
      };
    }
    return {
      action: "DISABLE_ADULT_HANDOFF_ONLY",
      reason: issue.reason,
      participantIds: issue.participantIds,
    };
  }

  return {
    action: "HARD_BLOCK_TURN",
    reason: issue.reason,
    participantIds: issue.participantIds,
  };
}
