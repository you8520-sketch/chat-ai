import type { TrpgActionType } from "./actionTypes";

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
