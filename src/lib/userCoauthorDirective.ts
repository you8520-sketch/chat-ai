/**
 * Leading-OOC user co-authoring directive resolver (H4.4).
 *
 * Deterministic. No model call. Inspects only the current human user input's
 * leading explicit OOC/meta segment — never IC prose, assistant text, persona,
 * memory, or lorebook.
 */

export type UserCoauthorDirectiveDuration = "none" | "turn" | "persistent";
export type UserCoauthorSlotOp = "unchanged" | "grant" | "deny";

export type UserCoauthorDirective = {
  duration: UserCoauthorDirectiveDuration;
  dialogue: UserCoauthorSlotOp;
  majorActions: UserCoauthorSlotOp;
  innerPov?: UserCoauthorSlotOp;
  irreversibleFate?: UserCoauthorSlotOp;
};

export const EMPTY_USER_COAUTHOR_DIRECTIVE: UserCoauthorDirective = {
  duration: "none",
  dialogue: "unchanged",
  majorActions: "unchanged",
  innerPov: "unchanged",
  irreversibleFate: "unchanged",
};

/**
 * Deterministic TURN-ONLY classifiers. A matching grant does not persist.
 * This is state classification only — there is no next-turn prompt lock.
 * Known Gemini limitation: after an explicit TURN-ONLY grant, the next
 * ordinary OFF turn is STANDARD, but Gemini may still continue [B]
 * authorship from RAW history. Explicit revoke is the reliable reclaim path.
 * Do not advertise TURN-ONLY as guaranteed hard isolation.
 */
export const TURN_ONLY_AUTHORING_MARKERS = [
  "이번 턴만",
  "이 턴만",
  "이번 응답만",
  "지금 턴만",
  "이번 턴은",
  "이 턴은",
  "지금 턴은",
  "이번 응답은",
] as const;

/** Compact authoring/delegation verbs — prefer false-negative over false-positive. */
const AUTHORING_INTENT_RE =
  /(?:알아서\s*해|알아서\s*(?:써|작성|진행|움직)|자동\s*서술|맡길게|네가\s*(?:해|알아서|써|작성|진행|움직)|출력(?:해(?:\s*줘|주(?:고|세요)?|[라요])?|하(?:라|세요)?)|서술(?:해(?:\s*줘|[라요])?|하(?:라|세요)?)|묘사(?:해(?:\s*줘|[라요])?|하(?:라|세요)?)|작성(?:해(?:\s*줘|[라요])?|하(?:라|세요)?)|(?:^|[\s,.])써(?:\s*줘|[라요]|라|세요|고)?|진행(?:해(?:\s*줘|[라요])?|하(?:라|세요)?)|움직여(?:\s*줘|[라요])?|같이\s*(?:써|작성|진행))/;

const DIALOGUE_GRANT_RE =
  /(?:유저\s*)?대사(?:만|도|는|은|를|을|랑)|유저(?:의|가)?\s*대사|내\s*대사|페르소나(?:의)?\s*대사|유저대사/;
const ACTION_GRANT_RE = /행동(?:만|도|는|은|를|을|랑)|움직여/;
const SCENE_COAUTHOR_ACTION_GRANT_RE =
  /(?:유저(?:가|의)?|내(?:가|의)?)[^\n。]{0,160}(?:장면|동작|행동|반응)|(?:장면|동작|행동)[^\n。]{0,60}(?:을|를|은|는)?\s*(?:서술|묘사|출력|작성|진행)|(?:서술|묘사|출력|작성|진행)[^\n。]{0,120}(?:유저(?:가|의)?|내(?:가|의)?)/;
const FULL_PERSONA_GRANT_RE =
  /(?:유저\s*)?페르소나\s*도|페르소나까지|턴을\s*진행|자동\s*서술|대사\s*(?:랑|와|과)\s*행동/;
const WHOLE_PERSONA_GRANT_RE =
  /(?:내|유저)\s*캐릭터\s*도|유저\s*페르소나까지|소설처럼/;
const INNER_POV_GRANT_RE =
  /(?:속마음|내면(?:\s*독백)?|생각|감정|욕망|심리)(?:까지|도|을|를)?[^\n。]{0,80}(?:써|작성|서술|묘사|알아서|맡)|(?:내|유저)\s*(?:캐릭터|캐릭|페르소나)?[^\n。]{0,100}(?:속마음|내면|생각|감정)(?:까지|도)?/;
const USER_PERSONA_AUTHORITY_TARGET_RE =
  /(?:내|유저)\s*(?:캐릭터|캐릭|페르소나|대사|행동|서술|속마음|내면)|유저캐/;
const ABSOLUTE_AUTHORITY_GRANT_RE =
  /(?:완전(?:히)?\s*자유|전권(?:을|은|까지|도)?(?:\s*(?:맡|위임|허용|줄|줘|준다))?|생사\s*포함|죽음(?:까지|도|을|를)?\s*(?:허용|맡|포함)|사망(?:까지|도|을|를)?\s*(?:허용|맡|포함)|불가역(?:적)?\s*(?:변화|전개|결정)?\s*(?:포함|허용|맡)|운명(?:까지|도|을|를)?\s*(?:맡|전부|알아서)|결말(?:까지|도|을|를)?\s*(?:맡|전부|알아서))/;

const DIALOGUE_RETAIN_OR_DENY_RE =
  /대사(?:는|은|를|을|만|도)?\s*(?:쓰지\s*마|쓰지마|작성하지\s*마|하지\s*마|내가\s*(?:할게|쓸게|쓸래|쓸|작성)|직접\s*(?:쓸|할게|작성))/;
const ACTION_RETAIN_OR_DENY_RE =
  /행동(?:는|은|를|을|만|도)?\s*(?:쓰지\s*마|쓰지마|작성하지\s*마|하지\s*마|내가\s*(?:할게|할래|할|진행할게)|직접\s*(?:할게|할|진행))/;
const BOTH_DENY_RE =
  /(?:대사(?:나|와|과)\s*행동|행동(?:이나|나|와|과)\s*대사)(?:은|는|을|를)?\s*(?:쓰지\s*마|쓰지마|작성하지\s*마|하지\s*마)/;
const WHOLE_PERSONA_REVOKE_RE =
  /(?:내|유저)\s*캐릭터(?:는|을|를)?\s*(?:이제\s*)?내가\s*직접|유저캐(?:를|은|는)?\s*건드리지\s*마|유저\s*캐(?:릭터)?(?:를|은|는)?\s*건드리지\s*마/;
const INNER_POV_DENY_RE =
  /(?:속마음|내면(?:\s*독백)?|생각|감정|욕망)(?:은|는|을|를)?\s*(?:쓰지\s*마|서술하지\s*마|묘사하지\s*마|내가\s*(?:쓸게|정할게|할게))/;
const IRREVERSIBLE_FATE_DENY_RE =
  /(?:죽이지\s*마|사망(?:은|을|를)?\s*(?:금지|시키지\s*마)|불가역(?:적)?\s*(?:변화|결정)?(?:는|은|을|를)?\s*(?:금지|하지\s*마)|영구(?:적)?\s*(?:변화|결정|상실)(?:은|을|를)?\s*(?:금지|하지\s*마))/;

const TURN_ONLY_RE =
  /(?:이번|이|지금)\s*턴만|(?:이번|이|지금)\s*턴은|이번\s*응답만|이번\s*응답은/;

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

function slotOp(grant: boolean, deny: boolean): UserCoauthorSlotOp {
  if (deny) return "deny";
  if (grant) return "grant";
  return "unchanged";
}

export function resolveUserCoauthorDirective(input: {
  currentUserInput?: string | null;
}): UserCoauthorDirective {
  const oocBody = extractLeadingOocSegment(input.currentUserInput ?? "");
  if (!oocBody) return EMPTY_USER_COAUTHOR_DIRECTIVE;

  const wholeRevoke = WHOLE_PERSONA_REVOKE_RE.test(oocBody);
  const bothDeny = BOTH_DENY_RE.test(oocBody);
  const dialogueDenied =
    wholeRevoke || bothDeny || DIALOGUE_RETAIN_OR_DENY_RE.test(oocBody);
  const actionDenied =
    wholeRevoke || bothDeny || ACTION_RETAIN_OR_DENY_RE.test(oocBody);
  const innerPovDenied = wholeRevoke || INNER_POV_DENY_RE.test(oocBody);
  const irreversibleFateDenied =
    wholeRevoke || IRREVERSIBLE_FATE_DENY_RE.test(oocBody);

  const hasAuthoringIntent = AUTHORING_INTENT_RE.test(oocBody);
  const userPersonaTarget = USER_PERSONA_AUTHORITY_TARGET_RE.test(oocBody);
  const absoluteGrant =
    userPersonaTarget && ABSOLUTE_AUTHORITY_GRANT_RE.test(oocBody);
  const novelGrant =
    absoluteGrant ||
    (userPersonaTarget &&
      hasAuthoringIntent &&
      INNER_POV_GRANT_RE.test(oocBody)) ||
    (userPersonaTarget && hasAuthoringIntent && /소설처럼/.test(oocBody));
  const fullGrant =
    absoluteGrant ||
    novelGrant ||
    (hasAuthoringIntent &&
      (FULL_PERSONA_GRANT_RE.test(oocBody) || WHOLE_PERSONA_GRANT_RE.test(oocBody)));
  const dialogueGrant =
    (hasAuthoringIntent && DIALOGUE_GRANT_RE.test(oocBody)) || fullGrant;
  const actionGrant =
    (hasAuthoringIntent &&
      (ACTION_GRANT_RE.test(oocBody) ||
        SCENE_COAUTHOR_ACTION_GRANT_RE.test(oocBody))) ||
    fullGrant;
  const innerPovGrant = novelGrant;
  const irreversibleFateGrant = absoluteGrant;

  const dialogue = slotOp(dialogueGrant, dialogueDenied);
  const majorActions = slotOp(actionGrant, actionDenied);
  const innerPov = slotOp(innerPovGrant, innerPovDenied);
  const irreversibleFate = slotOp(
    irreversibleFateGrant,
    irreversibleFateDenied
  );
  if (
    dialogue === "unchanged" &&
    majorActions === "unchanged" &&
    innerPov === "unchanged" &&
    irreversibleFate === "unchanged"
  ) {
    return EMPTY_USER_COAUTHOR_DIRECTIVE;
  }

  return {
    duration: TURN_ONLY_RE.test(oocBody) ? "turn" : "persistent",
    dialogue,
    majorActions,
    innerPov,
    irreversibleFate,
  };
}
