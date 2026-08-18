/**
 * One effective user-authoring policy for a turn.
 *
 * Manual P2 focus: standard vs current-turn OOC delegation.
 * Auto progression and structured persistent opt-in remain existing paths
 * (regression parity only). Auto and current-turn OOC do not coexist —
 * the composer is locked during Auto Progression.
 */

import {
  INACTIVE_CURRENT_TURN_AUTHORING_DELEGATION,
  resolveCurrentTurnUserAuthoringDelegation,
  type CurrentTurnAuthoringDelegation,
} from "@/lib/currentTurnUserAuthoringDelegation";
import {
  resolveNoGodmoddingMode,
  type NoGodmoddingMode,
} from "@/lib/noGodmodding";

export type UserAuthoringPolicyMode =
  | "manual"
  | "auto_progression"
  | "delegated"
  | "structured";

export type UserAuthoringPolicySource =
  | "manual_default"
  | "auto_progression"
  | "structured_existing"
  | "current_turn_ooc";

export type UserAuthoringPolicy = {
  mode: UserAuthoringPolicyMode;
  allowUserDialogue: boolean;
  allowUserMajorActions: boolean;
  source: UserAuthoringPolicySource;
  ownerMode: NoGodmoddingMode;
  currentTurnDelegation: CurrentTurnAuthoringDelegation;
};

export type ResolveUserAuthoringPolicyInput = {
  isContinue?: boolean;
  novelModeEnabled?: boolean;
  legacyNovelModeEnabled?: boolean;
  userImpersonationAllowed?: boolean;
  currentUserInput?: string | null;
  currentTurnDelegation?: CurrentTurnAuthoringDelegation;
};

export function resolveUserAuthoringPolicy(
  input: ResolveUserAuthoringPolicyInput
): UserAuthoringPolicy {
  const autoActive =
    input.isContinue === true ||
    input.novelModeEnabled === true ||
    input.legacyNovelModeEnabled === true;

  const currentTurnDelegation = autoActive
    ? INACTIVE_CURRENT_TURN_AUTHORING_DELEGATION
    : (input.currentTurnDelegation ??
      resolveCurrentTurnUserAuthoringDelegation({
        currentUserInput: input.currentUserInput,
      }));

  const ownerMode = resolveNoGodmoddingMode({
    isContinue: input.isContinue,
    novelModeEnabled: input.novelModeEnabled,
    legacyNovelModeEnabled: input.legacyNovelModeEnabled,
    impersonationOn: input.userImpersonationAllowed,
    currentTurnDelegation,
  });

  if (ownerMode === "autoContinue") {
    return {
      mode: "auto_progression",
      allowUserDialogue: true,
      allowUserMajorActions: true,
      source: "auto_progression",
      ownerMode,
      currentTurnDelegation: INACTIVE_CURRENT_TURN_AUTHORING_DELEGATION,
    };
  }
  if (ownerMode === "coNarration") {
    return {
      mode: "structured",
      allowUserDialogue: true,
      allowUserMajorActions: false,
      source: "structured_existing",
      ownerMode,
      currentTurnDelegation,
    };
  }
  if (ownerMode === "currentTurnDelegated") {
    return {
      mode: "delegated",
      allowUserDialogue: currentTurnDelegation.allowDialogue,
      allowUserMajorActions: currentTurnDelegation.allowMajorActions,
      source: "current_turn_ooc",
      ownerMode,
      currentTurnDelegation,
    };
  }
  return {
    mode: "manual",
    allowUserDialogue: false,
    allowUserMajorActions: false,
    source: "manual_default",
    ownerMode: "standard",
    currentTurnDelegation: INACTIVE_CURRENT_TURN_AUTHORING_DELEGATION,
  };
}
