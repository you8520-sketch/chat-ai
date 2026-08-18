/**
 * Current-turn OOC user-authoring delegation (P2).
 *
 * Deterministic. No model call. Inspects only the current human user input.
 * Leading explicit OOC/meta markers only — never in-character prose, persona,
 * history, or assistant text.
 *
 * Duration: this turn only. No persisted DB/session authoring state.
 */

export type CurrentTurnAuthoringDelegationSource = "explicit_ooc" | null;

export type CurrentTurnAuthoringDelegation = {
  active: boolean;
  allowDialogue: boolean;
  allowMajorActions: boolean;
  source: CurrentTurnAuthoringDelegationSource;
};

export const INACTIVE_CURRENT_TURN_AUTHORING_DELEGATION: CurrentTurnAuthoringDelegation =
  {
    active: false,
    allowDialogue: false,
    allowMajorActions: false,
    source: null,
  };

/** Compact authoring/delegation verbs — prefer false-negative over false-positive. */
const AUTHORING_INTENT_RE =
  /알아서\s*해|알아서\s*(?:써|작성|진행|움직)|자동\s*서술|맡길게|네가\s*(?:해|알아서|써|작성|진행|움직)|써\s*줘|작성해(?:\s*줘|[라요])?|작성한다|진행해(?:\s*줘|[라요])?|진행한다|움직여(?:\s*줘|[라요])?/;

const DIALOGUE_SCOPE_RE = /대사/;
const ACTION_SCOPE_RE = /행동|움직여/;
/** Whole-persona / turn-progress — not "페르소나에 맞춰서" style qualifiers. */
const FULL_PERSONA_SCOPE_RE =
  /(?:유저\s*)?페르소나\s*도|턴을\s*진행|자동\s*서술/;

const LEADING_BARE_COLON_RE = /^OOC\s*[:：]/i;
const LEADING_BRACKET_RE = /^\[\s*OOC\s*\]/i;
const LEADING_PAREN_RE = /^[\(（]\s*OOC\s*[\)）]/i;
const LEADING_CORNER_RE = /^【\s*OOC\s*】/;
const LEADING_BRACKET_COLON_RE = /^\[\s*OOC\s*[:：]\s*([^\]\n]*)\]/i;
const LEADING_PAREN_COLON_RE = /^[\(（]\s*OOC\s*[:：]\s*([^\)）\n]*)[\)）]/i;
const LEADING_CORNER_COLON_RE = /^【\s*OOC\s*[:：]\s*([^】\n]*)】/;

function isInCharacterContinuationLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (/^OOC\b/i.test(t)) return false;
  if (/^\[\s*OOC\b/i.test(t)) return false;
  if (/^[\(（]\s*OOC\b/i.test(t)) return false;
  if (/^【\s*OOC\b/.test(t)) return false;
  if (/^[*_]/.test(t)) return true;
  if (/^[\u201c\u201d"「『]/.test(t)) return true;
  return false;
}

function collectLeadingOocContinuation(head: string, remainder: string): string {
  const lines = remainder.split("\n");
  const collected: string[] = [head];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (i === 0 && !head) {
      collected[0] = line;
      continue;
    }
    if (isInCharacterContinuationLine(line)) break;
    if (!line.trim() && collected.some((part) => part.trim())) break;
    collected.push(line);
  }
  return collected.join("\n").trim();
}

/**
 * Leading OOC/meta segment only. Whitespace before the marker is allowed.
 * Does not scan later RP prose for buried OOC.
 */
export function extractLeadingOocSegment(currentUserInput: string): string | null {
  const stripped = String(currentUserInput ?? "").replace(/^\s+/, "");
  if (!stripped) return null;

  const bracketColon = stripped.match(LEADING_BRACKET_COLON_RE);
  if (bracketColon) {
    return collectLeadingOocContinuation(
      bracketColon[1] ?? "",
      stripped.slice(bracketColon[0].length)
    );
  }
  const parenColon = stripped.match(LEADING_PAREN_COLON_RE);
  if (parenColon) {
    return collectLeadingOocContinuation(
      parenColon[1] ?? "",
      stripped.slice(parenColon[0].length)
    );
  }
  const cornerColon = stripped.match(LEADING_CORNER_COLON_RE);
  if (cornerColon) {
    return collectLeadingOocContinuation(
      cornerColon[1] ?? "",
      stripped.slice(cornerColon[0].length)
    );
  }

  const prefix =
    stripped.match(LEADING_BARE_COLON_RE) ??
    stripped.match(LEADING_BRACKET_RE) ??
    stripped.match(LEADING_PAREN_RE) ??
    stripped.match(LEADING_CORNER_RE);
  if (!prefix) return null;

  const rest = stripped.slice(prefix[0].length).replace(/^[ \t]+/, "");
  return collectLeadingOocContinuation("", rest);
}

function resolveDelegationScope(oocBody: string): {
  allowDialogue: boolean;
  allowMajorActions: boolean;
} | null {
  if (!AUTHORING_INTENT_RE.test(oocBody)) return null;

  const hasDialogue = DIALOGUE_SCOPE_RE.test(oocBody);
  const hasAction = ACTION_SCOPE_RE.test(oocBody);
  const hasFullPersona = FULL_PERSONA_SCOPE_RE.test(oocBody);

  if (hasDialogue && hasAction) {
    return { allowDialogue: true, allowMajorActions: true };
  }
  if (hasFullPersona && (hasDialogue || hasAction)) {
    return { allowDialogue: true, allowMajorActions: true };
  }
  if (hasDialogue) {
    return { allowDialogue: true, allowMajorActions: false };
  }
  if (hasAction) {
    return { allowDialogue: false, allowMajorActions: true };
  }
  if (hasFullPersona) {
    return { allowDialogue: true, allowMajorActions: true };
  }
  return null;
}

export function resolveCurrentTurnUserAuthoringDelegation(input: {
  currentUserInput?: string | null;
}): CurrentTurnAuthoringDelegation {
  const oocBody = extractLeadingOocSegment(input.currentUserInput ?? "");
  if (!oocBody) return INACTIVE_CURRENT_TURN_AUTHORING_DELEGATION;

  const scope = resolveDelegationScope(oocBody);
  if (!scope) return INACTIVE_CURRENT_TURN_AUTHORING_DELEGATION;

  return {
    active: true,
    allowDialogue: scope.allowDialogue,
    allowMajorActions: scope.allowMajorActions,
    source: "explicit_ooc",
  };
}
