import { normalizeTrpgSelectedStat, type TrpgActionType } from "./actionTypes";
export {
  CONTEXTUAL_BLEED_TREAT_DRAFT,
  CONTEXTUAL_FIRST_AID_DRAFT,
  CONTEXTUAL_PARALYSIS_TREAT_DRAFT,
  CONTEXTUAL_POISON_TREAT_DRAFT,
  CONTEXTUAL_SAFE_REST_DRAFT,
  CONTEXTUAL_STATUS_TREAT_DRAFT,
  RECOVERY_DISCOVERY_HINT,
  SAFE_REST_COOLDOWN_HINT,
  SAFE_REST_ONGOING_NOTICE,
  contextualFirstAidDraft,
  contextualSafeRestDraft,
  contextualStatusTreatDraft,
  showContextualFirstAid,
  showContextualStatusTreat,
} from "./mechanicsIntent";

/** When the GM finishes a turn, the next ACTION_INPUT round must not keep the previous body. */
export function trpgActionComposerForRound(
  previousRound: number | null,
  nextRound: number,
  draft: { body?: string | null; actionType?: TrpgActionType | null; selectedStat?: string | null } | null | undefined
): { body: string; actionType: TrpgActionType; selectedStat: string | null } | null {
  if (previousRound == null || previousRound === nextRound) return null;
  const body = draft?.body?.trim() ? draft.body : "";
  return {
    body,
    actionType: draft?.actionType ?? "free",
    selectedStat: draft?.selectedStat ?? null,
  };
}

/**
 * Locked server selection wins, including an explicit automatic (null) choice.
 * Otherwise the current-round local draft is used. Anything not on the live
 * stat defs is automatic, so a stale key cannot stay selected.
 */
export function resolveTrpgSelectedStat(opts: {
  locked: boolean;
  serverSelectedStat: string | null | undefined;
  localSelectedStat: string | null | undefined;
  statDefs: readonly { key: string }[];
}): string | null {
  const raw = opts.locked ? opts.serverSelectedStat : opts.localSelectedStat;
  return normalizeTrpgSelectedStat(raw, opts.statDefs);
}
