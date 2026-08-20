import type { TrpgActionType } from "./actionTypes";
export {
  CONTEXTUAL_FIRST_AID_DRAFT,
  CONTEXTUAL_SAFE_REST_DRAFT,
  RECOVERY_DISCOVERY_HINT,
  SAFE_REST_COOLDOWN_HINT,
  SAFE_REST_ONGOING_NOTICE,
  contextualFirstAidDraft,
  contextualSafeRestDraft,
  showContextualFirstAid,
} from "./mechanicsIntent";

/** When the GM finishes a turn, the next ACTION_INPUT round must not keep the previous body. */
export function trpgActionComposerForRound(
  previousRound: number | null,
  nextRound: number,
  draft: { body?: string | null; actionType?: TrpgActionType | null } | null | undefined
): { body: string; actionType: TrpgActionType } | null {
  if (previousRound == null || previousRound === nextRound) return null;
  const body = draft?.body?.trim() ? draft.body : "";
  return {
    body,
    actionType: draft?.actionType ?? "free",
  };
}
