/**
 * Current-turn OOC user-authoring grant parser.
 *
 * Deterministic. No model call. Inspects only the current human user input.
 * Leading explicit OOC/meta markers only — never in-character prose, persona,
 * history, or assistant text.
 *
 * This parser answers "does THIS input grant authoring scopes?"
 * Persistent chat-scoped state lives in userCoauthorState.ts.
 * A grant without a turn-only limiter still returns active=true for this turn;
 * whether it mutates persisted state is decided by resolveUserCoauthorDirective.
 */

import { resolveUserCoauthorDirective } from "@/lib/userCoauthorDirective";

export { extractLeadingOocSegment } from "@/lib/userCoauthorDirective";

export type CurrentTurnAuthoringDelegationSource = "explicit_ooc" | "chat_setting" | null;

export type UserCoauthorDuration = "turn" | "persistent";

export type CurrentTurnAuthoringDelegation = {
  active: boolean;
  allowDialogue: boolean;
  allowMajorActions: boolean;
  /** Allow direct narration of [B]'s private thoughts, feelings, desires, and inner POV. */
  allowInnerPov?: boolean;
  /** Allow irreversible [B] fate/canon changes such as death or permanent loss. OOC full-authority only. */
  allowIrreversibleFate?: boolean;
  /** Allow AI-controlled cast/world to create canon-consistent blank history and irreversible outcomes. */
  allowAiCastIrreversibleExpansion?: boolean;
  source: CurrentTurnAuthoringDelegationSource;
  /** Effective owner duration when active. Omitted by the current-input parser. */
  duration?: UserCoauthorDuration | null;
};

export const INACTIVE_CURRENT_TURN_AUTHORING_DELEGATION: CurrentTurnAuthoringDelegation =
  {
    active: false,
    allowDialogue: false,
    allowMajorActions: false,
    allowInnerPov: false,
    allowIrreversibleFate: false,
    allowAiCastIrreversibleExpansion: false,
    source: null,
    duration: null,
  };

export function resolveCurrentTurnUserAuthoringDelegation(input: {
  currentUserInput?: string | null;
}): CurrentTurnAuthoringDelegation {
  const directive = resolveUserCoauthorDirective({
    currentUserInput: input.currentUserInput,
  });
  const allowDialogue = directive.dialogue === "grant";
  const allowMajorActions = directive.majorActions === "grant";
  const allowInnerPov = directive.innerPov === "grant";
  const allowIrreversibleFate = directive.irreversibleFate === "grant";
  if (!allowDialogue && !allowMajorActions && !allowInnerPov && !allowIrreversibleFate) {
    return INACTIVE_CURRENT_TURN_AUTHORING_DELEGATION;
  }
  return {
    active: true,
    allowDialogue,
    allowMajorActions,
    allowInnerPov,
    allowIrreversibleFate,
    allowAiCastIrreversibleExpansion: allowIrreversibleFate,
    source: "explicit_ooc",
  };
}

/** Whether this turn needs the effective authoring policy owner even if [B] itself is fully user-owned. */
export function currentTurnAuthoringPolicyRequiresOwner(
  delegation?: CurrentTurnAuthoringDelegation | null
): boolean {
  return (
    delegation?.active === true ||
    delegation?.allowAiCastIrreversibleExpansion === true
  );
}
