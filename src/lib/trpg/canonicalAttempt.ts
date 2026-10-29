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
  /** Adjudication / mechanics — exact human text or AI <<<INTENT>>> only. GM text is `gmAiActionText`. */
  canonicalAttempt: string;
  /** User-visible bot novelistic prose. Mechanics stay on the intent. Locked spoken lines from this prose are GM canon. */
  presentationProse: string;
  actionType: TrpgActionType;
};

function normalizeStoredActionType(raw: string | null | undefined): TrpgActionType {
  return raw && isTrpgActionType(raw) ? raw : "free";
}

/**
 * Lines this bot actually spoke. The prose layout puts that line alone in double quotes.
 * A quote that shares its line with narration — a sign, or someone else's reported line — stays presentation.
 */
export function lockedSpokenLines(prose: string): string[] {
  const found: string[] = [];
  for (const rawLine of prose.split(/\n+/)) {
    const match = rawLine.trim().match(/^[“"]([^”"]+)[”"]$/);
    const line = match?.[1]?.trim();
    if (line) found.push(line);
  }
  return found;
}

/**
 * GM action text for an AI seat.
 * A non-empty intent is the choice. Locked quote-only lines travel with it, and sensory prose does not.
 * An empty intent means the stored prose is the whole voluntary act, including a stay fallback.
 * Mechanics keep using `canonicalAttempt` alone.
 */
export function gmAiActionText(intent: string, prose: string): string {
  const choice = intent.trim();
  if (!choice) return prose.trim();
  const speech = lockedSpokenLines(prose)
    .map((line) => `"${line}"`)
    .join("\n");
  return speech ? `${choice}\n${speech}` : choice;
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
