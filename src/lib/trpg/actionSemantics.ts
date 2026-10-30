/** Low-level action text semantics — no localScene, stats, or adjudication policy. */

function normalizeBody(body: string): string {
  return body.replace(/\s+/g, " ").trim();
}

/** Quoted dialogue only — preserves *stage/action* wrappers and unquoted action prose. */
export function stripQuotedDialogue(body: string): string {
  return normalizeBody(body)
    .replace(/「[^」]{0,400}」/g, " ")
    .replace(/『[^』]{0,400}』/g, " ")
    .replace(/["“”][^"“”]{0,400}["“”]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const INVESTIGATION = /수색|뒤지|훔치|조사한다|살핀다|살피|훑|확인한다|기척|탐색|숨은|암호/;
const CHALLENGE =
  /문을?\s|창문을?\s|화물|조준|석궁|때리|치며|달리|뛰어|돌진|막는다|막으려|막아|가로막|방어|집어|던지|부순|연다|민다|뽑는다|베|찌르|잠근|휘두|메고|꽂|파고들|주먹|내지르|억지로|딴다|칼을|은신|숨는|숨어서|몰래/;

const HAZARD_ENGAGEMENT =
  /무너지(?:는|는|진)?[^.]{0,24}(?:뛰|넘|밀|들)|(?:뛰(?:어)?(?:넘)?|넘(?:어)?|밀(?:어)?|들(?:어)?|밟|가로질|통과|파(?:고)?)[^.]{0,24}(?:잔해|틈|포자(?:층|낭| 구역| 지대)?)|(?:잔해|틈|포자(?:층|낭| 구역| 지대)?)[^.]{0,24}(?:뛰(?:어)?(?:넘)?|넘(?:어)?|밀(?:어)?|들(?:어)?|밟|가로질|통과|파(?:고)?)|맨(?:손|몸)[^.]{0,20}(?:집|잡|만|붙|쥐|넣|닿)|잠긴[^.]{0,20}(?:문|창)[^.]{0,20}(?:연|밀|딴|부|억)|(?:억지|강제)[^.]{0,16}(?:연|밀|딴|부)/;

const PHYSICAL_ENTRY =
  /(?:들여(?:놓|넣)|(?:한\s)?발(?:을)?[^.]{0,20}(?:들|옮|내디|디)|(?:안쪽|안으로|통로|틈|문턱)[^.]{0,20}(?:들|진입|밀|뛰)|(?:뛰|달|진)[^.]{0,16}(?:들|진입|통과))/;

const CONTESTED = /속이|거짓말|협박|위협|설득하려|통과하려|거짓말로|속이려/;

function hasHazardEngagement(text: string): boolean {
  const normalized = normalizeBody(text);
  if (!HAZARD_ENGAGEMENT.test(normalized)) return false;
  if (
    /(?:[^\s]{1,12}(?:이|가|은|는))[^.]{0,28}(?:밟|들어|넘)[^.]{0,28}(?:포자|잔해|틈)/.test(normalized) &&
    !/(?:몸을|미끼(?:를)?|손(?:을)?|발(?:을)?|맨(?:손|몸))[^.]{0,28}(?:내밀|밀|넣|들|밟|가로질|통과)[^.]{0,28}(?:포자|잔해|틈|함몰|흐름)/.test(
      normalized
    )
  ) {
    return false;
  }
  if (isNonCommittingHazardProbe(normalized)) return false;
  return true;
}

function isNonCommittingHazardProbe(text: string): boolean {
  return /(?:전원|스위치|장치|미끼|장비|진동)[^.]{0,28}(?:넣지|켜지|작동|가동)[^.]{0,12}않[^.]{0,48}(?:내밀|뻗|들|밀)/.test(
    text
  );
}

function hasActorPhysicalEntry(text: string): boolean {
  const normalized = normalizeBody(text);
  if (!PHYSICAL_ENTRY.test(normalized)) return false;
  if (
    /(?:[^\s]{1,16}(?:이|가))[^.]{0,28}(?:들어|진입)[^.]{0,12}(?:순간|모습|뒤|장면)/.test(normalized)
  ) {
    return false;
  }
  if (
    /(?:보였|보인|보이|알았|느꼈|재고|갈라|좁혔|말했다|경고(?:한|하)|알려(?:준|주))/.test(normalized) &&
    !/(?:몸을|발(?:을|뒤꿈치)?|손(?:을)?|어깨|한\s?발)[^.]{0,20}(?:들|밀|넘|진입|내디|디|놓|넣)/.test(
      normalized
    )
  ) {
    return false;
  }
  return true;
}

/**
 * Verbal conditional connective inside one clause. Nouns such as 장면/반면 do not match.
 * `(으)면` is conditional; `면서` is a simultaneous conjunct and stays an act.
 */
const CONDITIONAL_CONNECTIVE =
  /만약|조건이\s*맞으면|상황에\s*따라|(?:있|없|하|되|오|가|보|치|리|나|자|두|르|맞|싶|쫓)(?:으)?면(?!서)|다면|라면|거든/;

const NEGATED_PREDICATE = /(?:지\s*않|지\s*못|지\s*말|않는다|않다|안\s+[가-힣]{1,12}다|못\s+[가-힣]{1,12}다)\s*$/;

/** Consumption is the clause's final predicate. 사용법/사용설명 are nouns. */
const ITEM_CONSUMPTION_PREDICATE =
  /(?:사용(?!법|설명|자|처|량)(?:한다|하고|하며|해서|했다|함|해)?|먹(?:는다|고|으며|었다|어)?|마신(?:다)?|마셔|바른다|바르고|발라|꺼낸다|꺼내|투여(?:한다|하고)?|쓴다|써서)\s*$/;

/** Take/receive is the clause's final predicate. Look, wish, and refusal stay out. */
const ITEM_TAKE_PREDICATE =
  /(?:(?:건네받|받아(?:들|쥐)|받|챙기|집어들)(?:는다|ㄴ다|고|며|어|아서|어서|었다|았다|음)?|(?:챙겨|받아(?:서)?|집어(?:서)?)\s+[^.]{0,24}(?:주머니|가방|파우치|배낭|품)(?:에|으로)\s*넣(?:는다|고|으며|었다|어)?)\s*$/;

export type ActionClauseKind = "conditional" | "declined" | "act" | "empty";

function actionClauses(body: string): string[] {
  const text = normalizeBody(body);
  if (!text) return [];
  return text
    .split(/(?<=[.!?。！？])\s+/u)
    .map((part) => part.trim())
    .filter(Boolean);
}

function visibleClause(clause: string): string {
  return stripQuotedDialogue(clause)
    .replace(/[.!?。！？]+$/g, "")
    .trim();
}

/** The committed predicate, after a negated adverb such as 설득하지 않고. */
function positiveActSpan(visible: string): string {
  const adverb = visible.match(/지\s*않(?:고|으며|아서|어서)\s+([\s\S]+)$/);
  const rest = adverb?.[1]?.trim() ?? "";
  if (rest && !NEGATED_PREDICATE.test(rest)) return rest;
  return visible;
}

export function classifyActionClause(clause: string): { kind: ActionClauseKind; span: string } {
  const visible = visibleClause(clause);
  if (!visible) return { kind: "empty", span: "" };
  if (CONDITIONAL_CONNECTIVE.test(visible)) return { kind: "conditional", span: "" };
  const adverb = visible.match(/지\s*않(?:고|으며|아서|어서)\s+([\s\S]+)$/);
  if (adverb) {
    const rest = adverb[1]?.trim() ?? "";
    if (rest && !NEGATED_PREDICATE.test(rest)) return { kind: "act", span: rest };
  }
  if (NEGATED_PREDICATE.test(visible)) return { kind: "declined", span: "" };
  return { kind: "act", span: positiveActSpan(visible) };
}

/** Clauses the human actually performs. Conditional, negated, and quoted-only text is omitted. */
export function committedActionText(body: string): string {
  const spans = actionClauses(body)
    .map((clause) => classifyActionClause(clause))
    .filter((clause) => clause.kind === "act" && clause.span)
    .map((clause) => clause.span);
  return normalizeBody(spans.join(" "));
}

/** Every clause is a condition and at least one condition is present. */
export function isConditionalCommitment(body: string): boolean {
  const clauses = actionClauses(body);
  if (clauses.length === 0) return false;
  const kinds = clauses.map((clause) => classifyActionClause(clause).kind);
  return kinds.every((kind) => kind === "conditional" || kind === "empty") && kinds.includes("conditional");
}

/** The human refused the act and committed nothing else. Quoted speech stays talk. */
export function isDeclinedCommitment(body: string): boolean {
  const text = normalizeBody(body);
  if (!text || committedActionText(text)) return false;
  if (isConditionalCommitment(text)) return false;
  return actionClauses(text).some((clause) => classifyActionClause(clause).kind === "declined");
}

function clauseSurface(span: string): string {
  return span
    .replace(/^\*+|\*+$/g, "")
    .replace(/[.!?。！？]+$/g, "")
    .trim();
}

function clauseConsumesItem(span: string): boolean {
  const committed = clauseSurface(span);
  if (!committed) return false;
  return ITEM_CONSUMPTION_PREDICATE.test(committed);
}

function clauseTakesItem(span: string): boolean {
  const committed = clauseSurface(span);
  if (!committed) return false;
  return ITEM_TAKE_PREDICATE.test(committed);
}

/**
 * Text governed by the clause's final predicate: the last sequential conjunct only.
 * `회복약을 바라보면서 붕대를 사용한다` → `붕대를`. `살펴본 뒤 칼을 받는다` → `칼을`.
 */
const PRIOR_CONJUNCT = /(?:면서|며|다가|(?<=[가-힣])고|(?:^|\s)(?:뒤(?:에)?|다음(?:에|으로)?|후(?:에)?|그리고))\s+/u;

function governedObjectSpan(span: string, predicate: RegExp): string {
  const surface = clauseSurface(span);
  const match = surface.match(predicate);
  const governed = match ? surface.slice(0, surface.length - match[0].length).trim() : surface;
  const parts = governed.split(PRIOR_CONJUNCT).map((part) => part.trim()).filter(Boolean);
  return parts[parts.length - 1] ?? governed;
}

export function consumptionObjectSpan(span: string): string {
  return governedObjectSpan(span, ITEM_CONSUMPTION_PREDICATE);
}

export function takeObjectSpan(span: string): string {
  return governedObjectSpan(span, ITEM_TAKE_PREDICATE);
}

/** Act spans whose predicate is item consumption. Mention and refusal clauses are omitted. */
export function committedItemConsumptionSpans(body: string): string[] {
  return actionClauses(body)
    .map((clause) => classifyActionClause(clause))
    .filter((clause) => clause.kind === "act" && clause.span && clauseConsumesItem(clause.span))
    .map((clause) => clause.span);
}

/** Committed acts that are not themselves an item-consumption predicate. */
export function otherCommittedActSpans(body: string): string[] {
  return actionClauses(body)
    .map((clause) => classifyActionClause(clause))
    .filter((clause) => clause.kind === "act" && clause.span && !clauseConsumesItem(clause.span))
    .map((clause) => clause.span);
}

/** True when any committed act clause ends in an item-consumption predicate (not usage-instruction nouns). */
export function isCommittedItemConsumption(body: string): boolean {
  return committedItemConsumptionSpans(body).length > 0;
}

/** Act spans whose predicate is a take or receive of an item. */
export function committedItemTakeSpans(body: string): string[] {
  return actionClauses(body)
    .map((clause) => classifyActionClause(clause))
    .filter((clause) => clause.kind === "act" && clause.span && clauseTakesItem(clause.span))
    .map((clause) => clause.span);
}

/** True when a committed take clause governs this item name. Mention, look, wish, and refusal do not. */
export function isCommittedItemTake(body: string, item: string): boolean {
  if (!item) return false;
  return committedItemTakeSpans(body).some((span) => takeObjectSpan(span).includes(item));
}

/** GM note for clauses that must not be narrated as done or charged. Locked quoted speech stays spoken. */
export function uncommittedActionWire(body: string): string | null {
  const held = actionClauses(body).filter((clause) => {
    const kind = classifyActionClause(clause).kind;
    return kind === "conditional" || kind === "declined";
  });
  if (held.length === 0) return null;
  const bits = held.map((clause) => clause.replace(/[.!?。！？]+$/g, "").trim());
  return `uncommitted=${bits.join(" || ")} — do not narrate these as completed acts, and do not spend items or HP for them`;
}

export function hasChallengeSignal(body: string): boolean {
  const text = normalizeBody(body);
  if (!text) return false;
  return (
    INVESTIGATION.test(text) ||
    CHALLENGE.test(text) ||
    hasHazardEngagement(text) ||
    hasActorPhysicalEntry(text) ||
    CONTESTED.test(text)
  );
}

export function classifyChallengeKind(body: string): "challenge" | "hazard" | "contested" | null {
  const text = normalizeBody(body);
  if (!text) return null;
  if (CONTESTED.test(text)) return "contested";
  if (hasHazardEngagement(text)) return "hazard";
  if (hasActorPhysicalEntry(text)) return "challenge";
  if (INVESTIGATION.test(text) || CHALLENGE.test(text)) return "challenge";
  return null;
}
