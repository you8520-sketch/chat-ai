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

export type CurrentTurnAuthoringDelegationSource = "explicit_ooc" | null;

export type UserCoauthorDuration = "turn" | "persistent";

export type CurrentTurnAuthoringDelegation = {
  active: boolean;
  allowDialogue: boolean;
  allowMajorActions: boolean;
  source: CurrentTurnAuthoringDelegationSource;
  /** Effective owner duration when active. Omitted by the current-input parser. */
  duration?: UserCoauthorDuration | null;
  /** STANDARD-only: inject turn-only expiry reset. Never used for persistent revoke. */
  postDelegationBoundary?: boolean;
};

export const INACTIVE_CURRENT_TURN_AUTHORING_DELEGATION: CurrentTurnAuthoringDelegation =
  {
    active: false,
    allowDialogue: false,
    allowMajorActions: false,
    source: null,
    duration: null,
    postDelegationBoundary: false,
  };

export function resolveCurrentTurnUserAuthoringDelegation(input: {
  currentUserInput?: string | null;
}): CurrentTurnAuthoringDelegation {
  const directive = resolveUserCoauthorDirective({
    currentUserInput: input.currentUserInput,
  });
  const allowDialogue = directive.dialogue === "grant";
  const allowMajorActions = directive.majorActions === "grant";
  if (!allowDialogue && !allowMajorActions) {
    return INACTIVE_CURRENT_TURN_AUTHORING_DELEGATION;
  }
  return {
    active: true,
    allowDialogue,
    allowMajorActions,
    source: "explicit_ooc",
  };
}
