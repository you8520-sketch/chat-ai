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
  /** User-visible bot novelistic prose. Mechanics stay on the intent. Locked spoken lines from this prose are GM canon. */
  presentationProse: string;
  actionType: TrpgActionType;
};

function normalizeStoredActionType(raw: string | null | undefined): TrpgActionType {
  return raw && isTrpgActionType(raw) ? raw : "free";
}

/** Quoted lines the bot actually spoke. Narration around them stays presentation. */
export function lockedSpokenLines(prose: string): string[] {
  const found: string[] = [];
  for (const match of prose.matchAll(/[“"]([^”"]+)[”"]/g)) {
    const line = match[1]?.trim();
    if (line) found.push(line);
  }
  return found;
}

/**
 * GM action text for an AI seat. The intent remains the choice. Locked quotes travel with it.
 * Sensory prose does not. Mechanics keep using `canonicalAttempt` alone.
 */
export function gmAiActionText(intent: string, prose: string): string {
  const choice = intent.trim();
  const speech = lockedSpokenLines(prose)
    .map((line) => `"${line}"`)
    .join("\n");
  if (!speech) return choice;
  return choice ? `${choice}\n${speech}` : speech;
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
