import { isTrpgActionType, type TrpgActionType } from "./actionTypes";
import { parseTrpgBotAction } from "./botActionParse";
import { declaredMovementGoals } from "./movementDeclaration";

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
/** A line that is only this bot's speech. A quote sharing its line with narration is not one. */
export function isLockedSpokenLine(line: string): boolean {
  return /^[“"][^”"]+[”"]$/.test(line.trim());
}

export function lockedSpokenLines(prose: string): string[] {
  const found: string[] = [];
  for (const rawLine of prose.split(/\n+/)) {
    const trimmed = rawLine.trim();
    if (!isLockedSpokenLine(trimmed)) continue;
    const line = trimmed.replace(/^[“"]|[”"]$/g, "").trim();
    if (line) found.push(line);
  }
  return found;
}

/** The server stay lock. Marker-free, and the whole voluntary act when a move cannot be priced. */
export function stayWatchingInPlace(name: string): string {
  return `${name}은 제자리에 서서 상황을 살핀다.`;
}

function isStayWatchingLock(text: string): boolean {
  const name = text.match(/^(.+)은 제자리에 서서 상황을 살핀다\.$/)?.[1];
  return Boolean(name && stayWatchingInPlace(name) === text);
}

/**
 * GM action text for an AI seat.
 * A non-empty intent is the choice. Locked quote-only lines travel with it, and sensory prose does not.
 * An empty intent is not the novel. The stay sentence and a priced move lock still are that act.
 * Quote-only lines are this bot's speech. Another PC's choice and an unconfirmed result stay out.
 * Mechanics keep using `canonicalAttempt` alone.
 */
export function gmAiActionText(intent: string, prose: string): string {
  const choice = intent.trim();
  const speech = lockedSpokenLines(prose)
    .filter((line) => !choice.includes(line))
    .map((line) => `"${line}"`)
    .join("\n");
  if (!choice) {
    const whole = prose.trim();
    if (isStayWatchingLock(whole) || declaredMovementGoals(whole).length > 0) return whole;
    return speech;
  }
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
