import { evaluateOfficialPlayerGenderNeutral } from "@/lib/officialSupply/publicProfileText";
import { qaResult, type QaIssue, type QaResult } from "@/lib/officialSupply/types";

/**
 * Canonical owner of "how the user's relationship to an official character
 * starts". One owner for the type vocabulary, the author-prompt wording, the
 * compiled setting lines and the deterministic QA. `bible.ts` compiles and
 * validates through this module; nothing else decides the start type.
 *
 * FREE            user identity, job, personality and past relations are open.
 * ROLE_BOUND      only the role/background the story premise needs is fixed.
 * RELATIONSHIP_BOUND  the relationship or a shared past is fixed.
 *
 * User gender is free in all three. A fixed relationship never implies
 * affection, trust, reconciliation or an ending.
 *
 * Legacy bibles have no `type`; they compile byte-identically (FREE wording).
 */
export const OFFICIAL_USER_RELATION_TYPES = ["free", "role_bound", "relationship_bound"] as const;
export type OfficialUserRelationType = (typeof OFFICIAL_USER_RELATION_TYPES)[number];

/** Planning input per character (portfolio brief): the type plus a one-line hint of what is fixed. */
export type OfficialUserRelationPlan = { type: OfficialUserRelationType; fixed: string };

export type OfficialUserRelationStart = {
  type?: OfficialUserRelationType;
  /** Facts the story fixes about the user's role/background or relationship/shared past. Empty for FREE. */
  fixedFacts?: string;
  /** What the user's persona and conversation still decide. Empty for FREE. */
  userDecides?: string;
};

export const FREE_USER_RELATION_PLAN: OfficialUserRelationPlan = { type: "free", fixed: "" };

export const USER_RELATION_FIXED_MAX = 320;
export const USER_RELATION_DECIDES_MAX = 220;
export const USER_RELATION_PLAN_FIXED_MAX = 160;

export function isOfficialUserRelationType(value: unknown): value is OfficialUserRelationType {
  return typeof value === "string" && (OFFICIAL_USER_RELATION_TYPES as readonly string[]).includes(value);
}

export class InvalidUserRelationPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidUserRelationPlanError";
  }
}

/**
 * Model/manifest JSON -> plan. Absent input (legacy briefs) is FREE. An explicit plan
 * must name a valid `type`; an unknown or missing type is rejected instead of being
 * silently demoted to FREE. FREE never carries fixed text.
 */
export function coerceUserRelationPlan(raw: unknown): OfficialUserRelationPlan {
  if (raw == null) return FREE_USER_RELATION_PLAN;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new InvalidUserRelationPlanError("userRelation must be an object with a valid type");
  }
  const record = raw as Record<string, unknown>;
  if (Object.keys(record).length === 0) return FREE_USER_RELATION_PLAN;
  if (!isOfficialUserRelationType(record.type)) {
    throw new InvalidUserRelationPlanError(
      `userRelation.type must be one of ${OFFICIAL_USER_RELATION_TYPES.join("|")} (got ${JSON.stringify(record.type ?? null)})`
    );
  }
  if (record.type === "free") return FREE_USER_RELATION_PLAN;
  const fixed = typeof record.fixed === "string" ? record.fixed.trim().slice(0, USER_RELATION_PLAN_FIXED_MAX) : "";
  return { type: record.type, fixed };
}

/**
 * Final RP wire carries only a concrete premise the scene cannot be understood without.
 * Persona priority, what the user may decide, and lists of possible endings stay out:
 * the shared chat runtime already owns player agency.
 */
export function compileUserRelationPrinciple(rel: OfficialUserRelationStart): string[] {
  const type = rel.type ?? "free";
  const fixed = rel.fixedFacts?.trim() ?? "";
  if (type === "free" || !fixed) return [];
  const label = type === "role_bound" ? "사건 전제" : "고정된 관계";
  return [`${label}: ${fixed}`];
}

/**
 * `fixedFacts` owns the fixed relation/role. When the authored user-entry scene restates
 * that sentence verbatim, the restatement is dropped at compile time so the setting and
 * the public intro carry it once. Entries that do not repeat it (and every legacy/FREE
 * bible, which has no fixedFacts) come back unchanged.
 */
export function userEntryWithoutFixedRestatement(userEntry: string, fixedFacts: string | undefined): string {
  const fixed = squashForMatch(fixedFacts ?? "");
  if (!fixed) return userEntry;
  const kept = userEntry
    .split(/(?<=[.!?。！？])\s+/u)
    .filter((sentence) => !squashForMatch(sentence).includes(fixed));
  return kept.length === 0 ? userEntry : kept.join(" ");
}

function squashForMatch(text: string): string {
  return text.replace(/\s+/g, "").replace(/[.!?。！？]+$/u, "");
}

const TYPE_RULES: Record<OfficialUserRelationType, string> = {
  free: "FREE — fixedFacts·userDecides·initialView·userRole·startingPoint·progression은 빈 문자열 또는 빈 배열로 둔다. 유저 정체·선택권·관계 발전을 설명하는 문장은 쓰지 않는다.",
  role_bound:
    "ROLE_BOUND — 사건을 이해하려면 꼭 필요한 소속·역할·배경 한 가지만 fixedFacts에 쓴다. userDecides·initialView·userRole·startingPoint·progression은 비운다. 유저가 정할 수 있는 항목을 나열하지 않는다.",
  relationship_bound:
    "RELATIONSHIP_BOUND — 관계 또는 공동 과거 중 사건 이해에 필요한 사실만 fixedFacts에 쓴다. 그 사실을 신뢰·호감·애정·화해의 결론으로 쓰지 않는다. userDecides·initialView·userRole·startingPoint·progression은 비운다.",
};

/** Short plan lines for part1 / voice user prompts (the bonds system prompt carries the full rules). */
export function formatUserRelationPlanForPrompt(plan: OfficialUserRelationPlan | undefined): string[] {
  const p = plan ?? FREE_USER_RELATION_PLAN;
  return [
    `유저 관계 시작 유형: ${p.type}${p.fixed ? ` — 고정: ${p.fixed}` : ""}`,
    p.type === "free"
      ? "유저의 필수 능력·신분·관계를 전제하지 않는다. 필수 역할이 있는 브리프는 role_bound로 기획한다."
      : "고정 사실만 확정하고 유저 성별·감정·행동·결말은 확정하지 않는다. 고정 관계는 애정·신뢰를 뜻하지 않는다.",
  ];
}

/** Bonds-system rules shared by every type; the type-specific rule travels in the bonds user prompt. */
export function buildUserRelationAuthorRules(): string[] {
  return [
    "- userRelationship.type은 입력값 그대로 둔다. 최종 RP에 실을 문장은 fixedFacts뿐이고, 그것도 사건 이해에 필요한 구체적 사실일 때만 쓴다.",
    `  fixedFacts는 ${USER_RELATION_FIXED_MAX}자 이내. userDecides·initialView·userRole·startingPoint는 "" , progression은 [] 가 기본이다. 유저 관계 원칙, 첫인식, 유저 역할, 시작점, 관계 진행, 가능한 결말 목록은 쓰지 않는다.`,
  ];
}

/** Bonds-user rule for exactly the planned type (the other two types are not sent). */
export function formatUserRelationBondsRule(plan: OfficialUserRelationPlan | undefined): string[] {
  return [`유형 규칙: ${TYPE_RULES[(plan ?? FREE_USER_RELATION_PLAN).type]}`];
}

const FORCED_OUTCOME_RE =
  /사랑에\s*빠(?:지게|진다|질\s*수밖에)|결국\s*(?:연인|사랑|서로를\s*사랑)|반드시\s*(?:사랑|연인|마음을\s*열|굴복|복종|화해)|굴복하게\s*(?:된다|되며)|복종하게\s*(?:된다|되며)|연인이\s*(?:된다|될\s*운명)|마음을\s*열게\s*(?:된다|되며)|\d+\s*턴\s*(?:후|뒤|이후|째|마다)|매\s*턴|턴마다/u;

export function userRelationTextOf(bible: {
  userRelationship: OfficialUserRelationStart & { initialView: string; startingPoint: string; progression: string[] };
}): string[] {
  const rel = bible.userRelationship;
  return [rel.initialView, rel.startingPoint, ...(rel.progression ?? []), rel.fixedFacts ?? "", rel.userDecides ?? ""];
}

export function findForcedRelationOutcome(texts: readonly string[]): string | null {
  for (const text of texts) {
    const hit = FORCED_OUTCOME_RE.exec(text ?? "");
    if (hit) return hit[0];
  }
  return null;
}

function issue(code: string, message: string): QaIssue {
  return { code, message };
}

/** Explicit mandatory user ability/role in authored premise text, before compilation.
 * Bounded surface cues only: a required ability, a copular present-role assignment,
 * or a shared past the scene already treats as fact. Not a semantic classifier.
 */
const FREE_ABILITY_PREMISE =
  /(?:당신|유저|사용자)(?:의|만이|만|은|는|이|가)?[^.!?。！？\n]{0,60}(?:(?:능력|공명|혈통|신분|소속|역할)[^.!?。！？\n]{0,35}(?:없이는|없인|뿐|필수|유일)|(?:없이는|없인)[^.!?。！？\n]{0,20}(?:불가능|할 수 없))|(?:가능한|멈출 수 있는|살릴 수 있는)[^.!?。！？\n]{0,15}(?:건|것은|자는)[^.!?。！？\n]{0,10}(?:당신|유저|사용자)[^.!?。！？\n]{0,20}(?:뿐|유일)/u;
const USER_TOPIC = /(?:당신|유저|사용자)(?:은|는)/u;
const COPULA_SPLIT = /(이자|이며|입니다|로서|이다(?![가-힣]|니))/u;
const COPULA_TOKEN = /^(?:이자|이며|입니다|로서|이다)$/u;
const FREE_SHARED_PAST =
  /(?:당신|유저|사용자)(?:와|과)\s*(?:나눈|함께\s*(?:한|했던)|맺은)\s*(?:약속|맹약|인연)/u;
/**
 * The copula's own predicate says the role or relationship is unset.
 * `아직` alone does not: `아직 목격자입니다` fixes the role, while
 * `아직 처분은 정해지지 않았습니다` leaves a different fact open.
 */
const UNFIXED_PREDICATE =
  /미정|확정되지\s*않|확정되어\s*있지\s*않|정해지지\s*않|정해져\s*있지\s*않|고정하지\s*않|정하지\s*않|어떤\s+\S{0,16}도/u;
const SHARED_PAST_DENIAL = /^\s*(?:은|는|이|가)\s*없/u;

function sentencesOf(text: string): string[] {
  return text.split(/[.!?。！？\n]+/u).map((sentence) => sentence.trim()).filter(Boolean);
}

function assignsFixedRole(text: string): boolean {
  return sentencesOf(text).some((sentence) => {
    if (!USER_TOPIC.test(sentence)) return false;
    const parts = sentence.split(COPULA_SPLIT);
    let pending = "";
    let topicOpen = false;
    for (const part of parts) {
      if (COPULA_TOKEN.test(part)) {
        if (topicOpen && !UNFIXED_PREDICATE.test(pending)) return true;
        pending = "";
        continue;
      }
      pending += part;
      if (USER_TOPIC.test(part)) topicOpen = true;
    }
    return false;
  });
}

function assertsSharedPast(text: string): boolean {
  return sentencesOf(text).some((sentence) => {
    const match = new RegExp(FREE_SHARED_PAST.source, "u").exec(sentence);
    if (!match) return false;
    const after = sentence.slice(match.index + match[0].length);
    return !SHARED_PAST_DENIAL.test(after);
  });
}

/** Brief fields both portfolio replacement and character-bible generation must scan. */
export function officialUserRelationPremiseTexts(brief: {
  rpHook?: string;
  marketFit?: {
    userRelationship?: string;
    oneLineConflict?: string;
    differentiationTwist?: string;
  } | null;
}): string[] {
  return [
    brief.rpHook ?? "",
    brief.marketFit?.userRelationship ?? "",
    brief.marketFit?.oneLineConflict ?? "",
    brief.marketFit?.differentiationTwist ?? "",
  ];
}

export function evaluateUserRelationPremise(type: OfficialUserRelationType, texts: readonly string[]): QaResult {
  if (type !== "free") return qaResult([]);
  const hit = texts.find((text) => FREE_ABILITY_PREMISE.test(text) || assignsFixedRole(text) || assertsSharedPast(text));
  return qaResult(hit ? [issue(
    "bible_user_rel_free_premise",
    "FREE premise requires a specific user role or a shared past; declare only that fact as ROLE_BOUND or RELATIONSHIP_BOUND, or remove the prerequisite",
  )] : []);
}

/**
 * Deterministic start-type contract. Runs only for bibles that declare a
 * `type` (new authoring); legacy bibles keep the checks they always had.
 * `forcedOutcomeTexts` are extra author texts (rpEngine, selfDrive) scanned
 * for forced affection/surrender/fixed-turn progression.
 */
export function evaluateUserRelationStart(input: {
  userRelationship: OfficialUserRelationStart & {
    initialView: string;
    userRole: string;
    startingPoint: string;
    progression: string[];
  };
  forcedOutcomeTexts?: readonly string[];
  premiseTexts?: readonly string[];
}): QaResult {
  const errors: QaIssue[] = [];
  const rel = input.userRelationship;
  const type = rel.type;
  if (!isOfficialUserRelationType(type)) {
    errors.push(issue("bible_user_rel_type_invalid", `userRelationship.type must be one of ${OFFICIAL_USER_RELATION_TYPES.join("|")}`));
    return qaResult(errors);
  }
  const fixed = rel.fixedFacts?.trim() ?? "";
  errors.push(...evaluateUserRelationPremise(type, input.premiseTexts ?? []).errors);
  const decides = rel.userDecides?.trim() ?? "";
  if (type === "free") {
    if (fixed || decides) {
      errors.push(issue("bible_user_rel_free_fixed", "FREE start must not carry fixedFacts/userDecides"));
    }
  } else {
    if (fixed.length < 20) errors.push(issue("bible_user_rel_fixed_missing", `${type} needs fixedFacts (>=20 chars) naming exactly what is fixed`));
    if (fixed.length > USER_RELATION_FIXED_MAX) errors.push(issue("bible_user_rel_fixed_long", `fixedFacts ${fixed.length} chars (> ${USER_RELATION_FIXED_MAX})`));
    if (decides.length > USER_RELATION_DECIDES_MAX) errors.push(issue("bible_user_rel_decides_long", `userDecides ${decides.length} chars (> ${USER_RELATION_DECIDES_MAX})`));
  }

  const gender = evaluateOfficialPlayerGenderNeutral({
    description: [fixed, decides, rel.userRole, rel.startingPoint, rel.initialView].join("\n"),
  });
  errors.push(...gender.errors);

  const forced = findForcedRelationOutcome([...userRelationTextOf({ userRelationship: rel }), ...(input.forcedOutcomeTexts ?? [])]);
  if (forced) {
    errors.push(issue("bible_user_rel_forced_outcome", `relationship text forces an outcome or a fixed-turn schedule: "${forced}"`));
  }

  return qaResult(errors);
}
