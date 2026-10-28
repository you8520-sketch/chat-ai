import { stripQuotedDialogue } from "./actionSemantics";

/**
 * Owner of "what movement did this submission declare".
 *
 * A declared movement is a clause that carries a live motion predicate. Its destination is the noun
 * phrase marked as the goal of that actor's motion (`X로`, `X에`, `X까지`, `X를 향해`, `X를 찾아가`).
 * The same marker does not become this actor's destination when it belongs to another predicate
 * (`주 통로로 돌을 던지고 돌아온다`, `돌을 던진 후 이동한다`) or to someone an attributive clause
 * only describes (`주 통로로 들어가는 데모유저를 지켜보며 출발한다`). A manner of the same motion
 * (`은신하며 이동한다`, `달려 이동한다`) keeps it. Following that person (`뒤를 따라 이동`) does.
 * A place that is only the source (`X에서`), a quoted line, or something negated or only wondered about
 * is not a destination. Destination identity and server persistence are decided by the campaign ledger
 * from this declaration; nothing here reads GM output.
 */

export type MovementDeclaration = {
  /** True when at least one clause declares a live (not negated, not hypothetical) motion. */
  live: boolean;
  /** Raw goal phrases, one per goal-marked place in a live clause, in text order. */
  goals: string[];
};

export type SpatialPolarity = "inside" | "outside";

export type MovementGoal = {
  /** Place name the player aimed at, with part words (문/앞/위…) removed. */
  place: string | undefined;
  /** Attributive qualifier directly before the place (북쪽, 붉은, 곶 끝의 …) when present. */
  qualifier: string | undefined;
  /** Declared side of a boundary: `건물 앞으로` is outside, `건물 안으로` is inside. */
  polarity: SpatialPolarity | undefined;
};

const SINO_MOTION_STEM = /^(?:이동|진입|입장|도착|출발|접근|통과|탈출|도망|후퇴|퇴각|복귀|귀환|침투|잠입|피신|대피|전진|질주|쇄도|방문)$/;

const MOTION_PREDICATES: readonly RegExp[] = [
  /^(?:이동|진입|입장|도착|출발|접근|통과|탈출|도망|후퇴|퇴각|복귀|귀환|침투|잠입|피신|대피|전진|질주|쇄도|방문)/,
  /^(?:던지|던졌|던져|날리|날렸|날린)/,
  /^향(?:하|해|한|했|할|함)/,
  /^(?:나가|나간|나갈|나갔|나아|나선|나서|나와|나온)/,
  /^(?:들어(?:가|간|갈|갔|서|선|오|온)|돌아(?:가|간|갈|갔|오|온|왔)|올라(?:가|간|갈|갔|서|선|오|온)|내려(?:가|간|갈|갔|서|선|오|온)|다가(?:가|간|갈|서|선|오|온)|찾아(?:가|간|갈|갔|오|온)|넘어(?:가|간|갈|서|오|온)|건너(?:가|간|갈|서|오|온)|지나(?:가|간|서|쳐|오)|빠져(?:나|들)|걸어(?:가|간|갈|서|나|들|올|내|오)|뛰어(?:가|간|들|나|올|내|넘)|달려(?:가|간|들|나|오|내)|기어(?:가|간|들|나)|헤엄쳐|날아(?:가|간))/,
  /^(?:오르|오른|올랐)/,
  /^(?:가|간|갈|갔|갑)(?:$|다|서|며|고|는|자|면|도|야|라|려|니|봐|보|던)/,
  /^(?:와|온|올|왔|오)(?:$|다|서|며|고|는|자|면|도|야|라|려|니|던)/,
];

/**
 * `X를 향해` is an adverbial of direction. It declares a move only when a real motion predicate of the
 * same clause follows it (`향해 달려간다`); `향해 화살을 쏜다` aims, it does not travel.
 */
const DIRECTION_CONVERB = /^향(?:해|하여|하며|하고|하면서|하다가|해서)/;

const MOVEMENT_VETOES: readonly RegExp[] = [
  /지\s?(?:않|말|못)/,
  /(?:^|\s)(?:안|못)\s?(?:간|가|이동|들어|나가|나간|건너|도착|돌아)/,
  /말고|말자/,
  /는지|을지|려나|[갈할볼올]까(?!지)/,
];

const GOAL_PARTICLE = /^(.+?)(?:으로|로|에|까지)$/;
const OBJECT_PARTICLE = /^(.+?)(?:을|를)$/;
const PHRASE_BOUNDARY = /(?:에서|에게|한테|부터|[을를와과]|하고|하며|하면|하러|하니|해서)$/;
const OBJECT_GOAL_PREDICATE = /^(?:향(?:하|해|한|했|할|함)|찾아(?:가|간|갈|갔|오|온)|방문)/;
/**
 * How far a goal may look for its own motion. Ownership, not this width, decides whether that
 * motion is the actor's: another predicate or an attributive clause ends the search first.
 * A second goal particle still ends it, so an earlier place cannot take a later destination.
 */
const GOAL_PREDICATE_REACH = 8;
/** A bare stem is a command only when nothing follows it, or the next word is the progressive `중`. */
const BARE_STEM_PROGRESSIVE = /^중/;
/** The actor inherits an embedded destination only by following that person. */
const FOLLOW_LINK = /^(?:따라|뒤따라|따라가|따라간|따라갈|따라오|따라온|따라왔)$/;
/**
 * Connective ending of a non-travel predicate.
 * Bare `려` is not one: `달려` is `달리-어`, while the intentive `-려` sits on a motion stem (`이동하려`).
 */
const OTHER_PREDICATE_ENDING = /(?:고|며|면서|어서|아서|여서|려고)$/;
/** Closes a prior verb (`던진 후`). A time noun (`잠시 후`) is not a prior action. */
const PRIOR_EVENT_CLOSER = /^(?:후|후에)$/;
/** Theme of a posture converb (`몸을 낮추고`). It modifies the travel instead of owning the place. */
const POSTURE_OBJECTS = new Set(["몸", "허리", "무릎", "고개", "자세", "어깨"]);
const GOAL_WINDOW_WORDS = 3;

const INSIDE_WORDS = new Set(["내부", "안", "안쪽", "실내", "속", "상층", "하층", "지하"]);
const OUTSIDE_WORDS = new Set([
  "외부",
  "외곽",
  "바깥",
  "바깥쪽",
  "밖",
  "실외",
  "앞",
  "근처",
  "주변",
  "인근",
  "일대",
  "어귀",
  "초입",
  "입구",
  "정문",
]);
const NEUTRAL_PART_WORDS = new Set(["문", "현관", "대문", "출입구", "위", "아래", "옆", "뒤", "쪽", "꼭대기", "옥상"]);
/** Generic building-part nouns: they subdivide the named place but never name another one. */
const STRUCTURE_WORDS = new Set(["청사", "건물", "본관", "별관", "로비"]);
export const DIRECTIONAL_QUALIFIERS = new Set(["북쪽", "남쪽", "동쪽", "서쪽", "좌측", "우측", "왼쪽", "오른쪽"]);

function trimPunctuation(word: string): string {
  return word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

function isMotionPredicate(word: string): boolean {
  return MOTION_PREDICATES.some((pattern) => pattern.test(word));
}

function finalJongseong(word: string): number {
  const last = word.charCodeAt(word.length - 1);
  return last >= 0xac00 && last <= 0xd7a3 ? (last - 0xac00) % 28 : -1;
}

/**
 * Attributive forms (`가는`, `간`, `향한`, `올라갈`) modify a following noun (`가는 길`); they describe
 * something, they do not perform the motion. The one exception is the future periphrasis `-ㄹ 것/거`.
 */
function isAttributiveForm(words: readonly string[], index: number): boolean {
  const word = words[index]!;
  if (word.endsWith("는") || word.endsWith("던")) return true;
  const jongseong = finalJongseong(word);
  if (jongseong === 8) return !/^(?:것|거)/.test(words[index + 1] ?? "");
  return jongseong === 4;
}

/**
 * `이동 흔적` names the act. `주 통로로 이동` and `이동 중이다` perform it.
 * A bare stem with no following word is the short command; a following content word is a noun.
 */
function isBareMotionMention(words: readonly string[], index: number): boolean {
  if (!SINO_MOTION_STEM.test(words[index]!)) return false;
  const next = words[index + 1];
  if (!next || BARE_STEM_PROGRESSIVE.test(next)) return false;
  return true;
}

function isAttributiveMotion(words: readonly string[], index: number): boolean {
  const word = words[index]!;
  return isMotionPredicate(word) && isAttributiveForm(words, index) && !isBareMotionMention(words, index);
}

function hasFollowLink(words: readonly string[], from: number, to: number): boolean {
  for (let index = from; index < to; index += 1) {
    if (FOLLOW_LINK.test(words[index]!)) return true;
  }
  return false;
}

function themeBetween(words: readonly string[], from: number, to: number): string | undefined {
  for (let index = to - 1; index > from; index -= 1) {
    const head = words[index]!.match(OBJECT_PARTICLE)?.[1];
    if (head) return head;
  }
  return undefined;
}

/** `돌을 던지고` throws at a place; `몸을 던졌다` hurls the actor toward it. */
function isPropelledObjectThrow(words: readonly string[], index: number, goalIndex: number): boolean {
  const word = words[index]!;
  if (!/^(?:던지|던졌|던져|날리|날렸|날린)/.test(word)) return false;
  const theme = themeBetween(words, goalIndex, index);
  return theme !== undefined && !POSTURE_OBJECTS.has(theme);
}

/**
 * An earlier action owns the place when it has its own theme (`돌을 던지고`, `돌을 던진`).
 * A bare manner (`은신하며`, `달려`) and a posture theme (`몸을 낮추고`) modify the travel.
 */
function consumesDirectional(words: readonly string[], index: number, goalIndex: number): boolean {
  const word = words[index]!;
  if (FOLLOW_LINK.test(word)) return false;
  if (isPropelledObjectThrow(words, index, goalIndex)) return true;
  if (isMotionPredicate(word)) return false;
  const verbal = isAttributiveForm(words, index) || OTHER_PREDICATE_ENDING.test(word);
  if (!verbal) return false;
  const theme = themeBetween(words, goalIndex, index);
  return theme !== undefined && !POSTURE_OBJECTS.has(theme);
}

/** `던진 후` finishes another action. `잠시 후` only times the same motion. */
function closesPriorEvent(words: readonly string[], index: number): boolean {
  if (!PRIOR_EVENT_CLOSER.test(words[index]!)) return false;
  const previous = index - 1;
  if (previous < 0 || isMotionPredicate(words[previous]!)) return false;
  return isAttributiveForm(words, previous) || OTHER_PREDICATE_ENDING.test(words[previous]!);
}

/** True when `words[index]` is the predicate of a live motion rather than a mention of one. */
function isMotionAt(words: readonly string[], index: number): boolean {
  const word = words[index]!;
  if (isBareMotionMention(words, index) || !isMotionPredicate(word) || isAttributiveForm(words, index)) return false;
  if (!DIRECTION_CONVERB.test(word)) return true;
  const end = Math.min(words.length, index + 1 + GOAL_PREDICATE_REACH);
  for (let next = index + 1; next < end; next += 1) {
    if (OBJECT_PARTICLE.test(words[next]!)) return false;
    if (isMotionAt(words, next)) return true;
  }
  return false;
}

function hasModifierEnding(word: string): boolean {
  if (DIRECTIONAL_QUALIFIERS.has(word) || word.endsWith("의")) return true;
  const last = word.charCodeAt(word.length - 1);
  return last >= 0xac00 && last <= 0xd7a3 && (last - 0xac00) % 28 === 4;
}

function isInsideWord(word: string): boolean {
  return INSIDE_WORDS.has(word) || /^\d+층$/.test(word);
}

/**
 * A label token that only subdivides a place (side, floor, building part). Any other token after the
 * place name makes the label a different place (`등대 마을`, `등대 선술집`).
 */
export function isPlacePartWord(token: string): boolean {
  return (
    INSIDE_WORDS.has(token) ||
    OUTSIDE_WORDS.has(token) ||
    NEUTRAL_PART_WORDS.has(token) ||
    STRUCTURE_WORDS.has(token) ||
    /^\d+층$/.test(token)
  );
}

export function spatialPolarity(words: readonly string[]): SpatialPolarity | undefined {
  const cleaned = words.map(trimPunctuation).filter(Boolean);
  const inside = cleaned.some(isInsideWord);
  const outside = cleaned.some((word) => OUTSIDE_WORDS.has(word));
  if (inside === outside) return undefined;
  return inside ? "inside" : "outside";
}

function splitClauses(visible: string): string[] {
  return visible
    .replace(/(않고|말고)\s*/g, "$1\n")
    .split(/[.!?。…;\n]+|,\s*/)
    .map((clause) => clause.trim())
    .filter(Boolean);
}

function goalPhraseBefore(words: readonly string[], index: number, head: string): string {
  const phrase = [head];
  for (let i = index - 1; i >= 0 && phrase.length <= GOAL_WINDOW_WORDS; i -= 1) {
    const word = words[i]!;
    if (PHRASE_BOUNDARY.test(word)) break;
    phrase.unshift(word);
  }
  return phrase.join(" ");
}

function predicateFollows(words: readonly string[], goalIndex: number, accept: (index: number) => boolean): boolean {
  const end = Math.min(words.length, goalIndex + 1 + GOAL_PREDICATE_REACH);
  let embedded = false;
  for (let j = goalIndex + 1; j < end; j += 1) {
    const word = words[j]!;
    if (GOAL_PARTICLE.test(word)) return false;
    if (isAttributiveMotion(words, j)) {
      embedded = true;
      continue;
    }
    if (closesPriorEvent(words, j)) return false;
    if (consumesDirectional(words, j, goalIndex)) return false;
    if (accept(j)) return !embedded || hasFollowLink(words, goalIndex + 1, j);
  }
  return false;
}

function clauseGoals(words: readonly string[]): string[] {
  const goals: string[] = [];
  words.forEach((word, index) => {
    const goal = word.match(GOAL_PARTICLE);
    if (goal && predicateFollows(words, index, (next) => isMotionAt(words, next))) {
      goals.push(goalPhraseBefore(words, index, goal[1]!));
      return;
    }
    const object = word.match(OBJECT_PARTICLE);
    if (
      object &&
      predicateFollows(words, index, (next) => OBJECT_GOAL_PREDICATE.test(words[next]!) && isMotionAt(words, next))
    ) {
      goals.push(goalPhraseBefore(words, index, object[1]!));
    }
  });
  return goals;
}

export function parseMovementDeclaration(body: string): MovementDeclaration {
  const declaration: MovementDeclaration = { live: false, goals: [] };
  for (const clause of splitClauses(stripQuotedDialogue(body))) {
    if (MOVEMENT_VETOES.some((pattern) => pattern.test(clause))) continue;
    const words = clause.split(/\s+/).map(trimPunctuation).filter(Boolean);
    if (!words.some((_word, index) => isMotionAt(words, index))) continue;
    declaration.live = true;
    declaration.goals.push(...clauseGoals(words));
  }
  return declaration;
}

export function declaredMovementGoals(body: string): string[] {
  return parseMovementDeclaration(body).goals;
}

/** Drops clauses that priced a live destination. Remaining prose is not a granted move. */
export function omitLiveMovementClauses(body: string): string {
  return splitClauses(body)
    .filter((clause) => parseMovementDeclaration(clause).goals.length === 0)
    .join(" ")
    .trim();
}

/**
 * Drops remainder clauses that name a place the actor is not in.
 * A clause is kept only when it names `here` or a colocated seat — absence of a
 * foreign room name is not independence. `에서` uses the existing source particle.
 */
export function omitClausesAwayFromHere(opts: {
  body: string;
  here: string;
  colocatedNames: readonly string[];
  foreignPlaces: readonly string[];
}): string {
  const foreign = [...new Set(opts.foreignPlaces.map((place) => place.trim()).filter(Boolean))].sort(
    (left, right) => right.length - left.length
  );
  const allowed = [opts.here, ...opts.colocatedNames].map((token) => token.trim()).filter(Boolean);
  return splitClauses(opts.body)
    .filter((clause) => {
      if (foreign.some((place) => clause.includes(place))) return false;
      if (clauseHasUnresolvedSourcePlace(clause, allowed)) return false;
      return allowed.some((token) => clause.includes(token));
    })
    .join(" ")
    .trim();
}

function clauseHasUnresolvedSourcePlace(clause: string, allowed: readonly string[]): boolean {
  const words = clause.split(/\s+/).map(trimPunctuation).filter(Boolean);
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]!;
    if (!word.endsWith("에서") || word.length === 2) continue;
    const phrase = goalPhraseBefore(words, index, word.slice(0, -2));
    if (allowed.some((token) => phrase.includes(token) || word.includes(token))) continue;
    return true;
  }
  return false;
}

/** Splits a goal phrase (or an open-route label) into the place the player named and its boundary side. */
export function describeMovementGoal(phrase: string): MovementGoal {
  const words = phrase.split(/\s+/).map(trimPunctuation).filter(Boolean);
  const polarity = spatialPolarity(words);
  const nameWords = [...words];
  while (nameWords.length > 0) {
    const last = nameWords[nameWords.length - 1]!;
    if (!NEUTRAL_PART_WORDS.has(last) && !OUTSIDE_WORDS.has(last) && !isInsideWord(last)) break;
    nameWords.pop();
  }
  const place = nameWords[nameWords.length - 1];
  if (!place || place.length < 2) return { place: undefined, qualifier: undefined, polarity };
  const before = nameWords[nameWords.length - 2];
  const qualifier = before && hasModifierEnding(before) ? before : undefined;
  return { place, qualifier, polarity };
}
