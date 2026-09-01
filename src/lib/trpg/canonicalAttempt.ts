import { isTrpgActionType, type TrpgActionType } from "./actionTypes";
import { parseTrpgBotAction } from "./botActionParse";

export type TrpgParticipantKind = "human" | "ai_character";

export type TrpgCanonicalAttemptInput = {
  participantKind: TrpgParticipantKind;
  submissionBody: string;
  /** Accepted persisted trpg_action_submissions.action_type — canonical after bot accept. */
  actionType?: string | null;
};

export type TrpgResolvedCanonicalAttempt = {
  participantKind: TrpgParticipantKind;
  /** Adjudication / mechanics / GM input — exact human text or AI <<<INTENT>>> only. */
  canonicalAttempt: string;
  /** User-visible bot novelistic prose; never GM canon for AI PCs. */
  presentationProse: string;
  actionType: TrpgActionType;
};

function normalizeStoredActionType(raw: string | null | undefined): TrpgActionType {
  return raw && isTrpgActionType(raw) ? raw : "free";
}

/**
 * Single owner for separating presentation prose from adjudication canon.
 * Human submissions are never parsed with the bot marker format.
 */
export function resolveTrpgCanonicalAttempt(opts: TrpgCanonicalAttemptInput): TrpgResolvedCanonicalAttempt {
  const body = opts.submissionBody.replace(/\r\n/g, "\n").trim();
  if (opts.participantKind === "human") {
    return {
      participantKind: "human",
      canonicalAttempt: body,
      presentationProse: body,
      actionType: normalizeStoredActionType(opts.actionType),
    };
  }
  const parsed = parseTrpgBotAction(body);
  return {
    participantKind: "ai_character",
    canonicalAttempt: parsed.intent.trim(),
    presentationProse: parsed.prose,
    actionType: normalizeStoredActionType(opts.actionType),
  };
}
