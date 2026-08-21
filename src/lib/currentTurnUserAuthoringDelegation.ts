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
  /(?:알아서\s*해|알아서\s*(?:써|작성|진행|움직)|자동\s*서술|맡길게|네가\s*(?:해|알아서|써|작성|진행|움직)|출력(?:해(?:\s*줘|주(?:고|세요)?|[라요])?|하(?:라|세요)?)|서술(?:해(?:\s*줘|[라요])?|하(?:라|세요)?)|묘사(?:해(?:\s*줘|[라요])?|하(?:라|세요)?)|작성(?:해(?:\s*줘|[라요])?|하(?:라|세요)?)|(?:^|[\s,.])써(?:\s*줘|[라요]|라|세요)?|진행(?:해(?:\s*줘|[라요])?|하(?:라|세요)?)|움직여(?:\s*줘|[라요])?)/;

/**
 * Positive authoring relationship for a scope — not mere noun presence.
 * "행동은 내가 할게" contains 행동 but is not action delegation.
 */
const DIALOGUE_GRANT_RE =
  /(?:유저\s*)?대사(?:만|도|는|은|를|을|랑)|유저(?:의|가)?\s*대사|내\s*대사|페르소나(?:의)?\s*대사|유저대사/;
const ACTION_GRANT_RE = /행동(?:만|도|는|은|를|을|랑)|움직여/;
/** OOC names a user action/scene to narrate — not blanket "알아서 진행". */
const SPECIFIED_USER_ACTION_NARRATION_RE =
  /(?:유저(?:가|의)?|내(?:가|의)?)[^\n。]{0,120}(?:장면|동작|행동|삽입|키스|포옹)[^\n。]{0,80}(?:서술|묘사|출력|작성)|(?:서술|묘사|출력|작성)[^\n。]{0,120}(?:유저(?:가|의)?|내(?:가|의)?)[^\n。]{0,120}(?:장면|동작|행동|삽입|키스|포옹|반응)/;
/** Whole-persona / turn-progress — not "페르소나에 맞춰서" style qualifiers. */
const FULL_PERSONA_GRANT_RE =
  /(?:유저\s*)?페르소나\s*도|턴을\s*진행|자동\s*서술|대사\s*(?:랑|와|과)\s*행동/;

const DIALOGUE_RETAIN_OR_DENY_RE =
  /대사(?:는|은|를|을|만|도)?\s*(?:쓰지\s*마|쓰지마|작성하지\s*마|하지\s*마|내가\s*(?:할게|쓸게|쓸래|쓸|작성)|직접\s*(?:쓸|할게|작성))/;
const ACTION_RETAIN_OR_DENY_RE =
  /행동(?:는|은|를|을|만|도)?\s*(?:쓰지\s*마|쓰지마|작성하지\s*마|하지\s*마|내가\s*(?:할게|할래|할|진행할게)|직접\s*(?:할게|할|진행))/;

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

  const dialogueDenied = DIALOGUE_RETAIN_OR_DENY_RE.test(oocBody);
  const actionDenied = ACTION_RETAIN_OR_DENY_RE.test(oocBody);

  let allowDialogue =
    DIALOGUE_GRANT_RE.test(oocBody) || FULL_PERSONA_GRANT_RE.test(oocBody);
  let allowMajorActions =
    ACTION_GRANT_RE.test(oocBody) ||
    FULL_PERSONA_GRANT_RE.test(oocBody) ||
    SPECIFIED_USER_ACTION_NARRATION_RE.test(oocBody);

  if (dialogueDenied) allowDialogue = false;
  if (actionDenied) allowMajorActions = false;

  if (!allowDialogue && !allowMajorActions) return null;
  return { allowDialogue, allowMajorActions };
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
