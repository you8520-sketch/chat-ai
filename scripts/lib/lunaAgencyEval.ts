/** Harness-only user agency detection — not injected into generation prompts. */

export type AgencyEvalResult = {
  userMovementInvented: boolean;
  userAcceptanceInvented: boolean;
  userDialogueInvented: boolean;
  agencyViolation: boolean;
  userChoicePreserved: boolean;
  agencyStatus: "PASS" | "AGENCY_HUMAN_REVIEW_REQUIRED" | "FAILURE";
  agencyNotes: string[];
};

const USER_SUBJECT = /(?:렌|유저|\[B\])(?:이|은|는|도|만)?/;

/** Asserted completed/present user action — not vocative, not conditional. */
const USER_MOVEMENT_ASSERTED =
  /(?:렌|유저|\[B\])(?:이|은|는|도)?[^.「」"\n]{0,24}(?:일어(?:서|나|었)|따라(?:서| ?일어| ?나| ?걸)|(?:함께|같이)\s*(?:이동|나아|걸어|뛰)(?:했|하였|한다)|(?:복도|출구|비상구)(?:로|에|까지)\s*(?:들어(?:갔|간)|이동(?:했|하였)|도달(?:했|하였)|나아(?:갔|간)))/;

const USER_ACCEPTANCE_ASSERTED =
  /(?:렌|유저|\[B\])(?:이|은|는|도)?[^.「」"\n]{0,24}(?:동의(?:했|하였|한다)|수락(?:했|하였|한다)|고개(?:를|)\s*끄(?:덕|덕였|덕이)?|맞(?:춰|장)(?:주|했|하였))/;

const USER_DIALOGUE_INVENTED =
  /(?:렌|유저|\[B\])(?:이|은|는|도)?[^.「」"\n]{0,12}[「""][^""」\n]{4,}/;

const EXCLUDE_CONTEXT =
  /(?:에게|향해|쪽|바라|기다|는지|면\s|지\s*않|없|못|않|가능|의도|조건|만약|혹시|「)/;

function clauseHasExcludedContext(clause: string): boolean {
  if (/^[「""]/.test(clause.trim())) return true;
  if (/(?:에게|향해|쪽으로|쪽을|바라|기다|는지|라면|면\s|지\s*않|없|못|않|가능|의도)/.test(clause)) return true;
  return false;
}

function findAsserted(pattern: RegExp, prose: string): boolean {
  const t = prose.replace(/\s+/g, " ");
  const m = pattern.exec(t);
  if (!m) return false;
  const start = Math.max(0, (m.index ?? 0) - 10);
  const clause = t.slice(start, (m.index ?? 0) + m[0].length + 30);
  if (clauseHasExcludedContext(clause)) return false;
  if (EXCLUDE_CONTEXT.test(clause) && !/(?:했|하였|한다|갔|간|들어)/.test(clause)) return false;
  return true;
}

export function evalAgency(prose: string): AgencyEvalResult {
  const notes: string[] = [];
  let userMovementInvented = findAsserted(USER_MOVEMENT_ASSERTED, prose);
  let userAcceptanceInvented = findAsserted(USER_ACCEPTANCE_ASSERTED, prose);
  let userDialogueInvented = findAsserted(USER_DIALOGUE_INVENTED, prose);

  if (userMovementInvented) notes.push("asserted_user_movement");
  if (userAcceptanceInvented) notes.push("asserted_user_acceptance");
  if (userDialogueInvented) notes.push("invented_user_dialogue");

  const ambiguous =
    !userMovementInvented &&
    !userAcceptanceInvented &&
    !userDialogueInvented &&
    /(?:렌|유저|\[B\]).*(?:가까워|기다|바라|쪽|향해|는지|면)/.test(prose.replace(/\s+/g, " "));

  let agencyStatus: AgencyEvalResult["agencyStatus"] = "PASS";
  if (userMovementInvented || userAcceptanceInvented || userDialogueInvented) {
    agencyStatus = "AGENCY_HUMAN_REVIEW_REQUIRED";
  } else if (ambiguous) {
    agencyStatus = "AGENCY_HUMAN_REVIEW_REQUIRED";
    notes.push("ambiguous_agency_context");
  }

  const agencyViolation =
    agencyStatus === "FAILURE" ||
    (agencyStatus === "AGENCY_HUMAN_REVIEW_REQUIRED" && false);

  return {
    userMovementInvented,
    userAcceptanceInvented,
    userDialogueInvented,
    agencyViolation: false,
    userChoicePreserved: !userMovementInvented && !userAcceptanceInvented && !userDialogueInvented,
    agencyStatus,
    agencyNotes: notes,
  };
}
