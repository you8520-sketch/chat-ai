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

/** Model/manifest JSON -> plan. Anything unreadable is FREE; FREE never carries fixed text. */
export function coerceUserRelationPlan(raw: unknown): OfficialUserRelationPlan {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return FREE_USER_RELATION_PLAN;
  const record = raw as Record<string, unknown>;
  if (!isOfficialUserRelationType(record.type) || record.type === "free") return FREE_USER_RELATION_PLAN;
  const fixed = typeof record.fixed === "string" ? record.fixed.trim().slice(0, USER_RELATION_PLAN_FIXED_MAX) : "";
  return { type: record.type, fixed };
}

const FREE_PRINCIPLE =
  "유저 관계 원칙: 유저의 이름·신분·성별과 유저-캐릭터 간 기존 관계는 유저 페르소나와 대화에서 명시된 설정을 우선한다. 도입부가 관계를 명시적으로 고정하지 않는 한 현재 장면만 고정한다.";

const ROLE_BOUND_PRINCIPLE =
  "유저 관계 원칙: 아래 고정 배경만 확정이다. 유저의 이름·성별·외형·감정·말·행동과 그 밖의 인적 설정은 페르소나와 대화가 정하며, 페르소나에 이미 관계가 있으면 그것을 우선한다. 고정 배경은 신뢰·호감·애정·결말을 정하지 않는다.";

const RELATIONSHIP_BOUND_PRINCIPLE =
  "유저 관계 원칙: 아래 고정 관계·공동 과거만 확정이다. 관계가 있다는 사실은 신뢰·호감·애정·화해의 결론이 아니다. 유저의 이름·성별·외형·감정·말·행동과 아래 항목 밖의 설정은 페르소나와 대화가 정한다.";

/** Compiled setting lines for the start type; legacy/FREE keeps the pre-existing single line. */
export function compileUserRelationPrinciple(rel: OfficialUserRelationStart): string[] {
  const type = rel.type ?? "free";
  const fixed = rel.fixedFacts?.trim() ?? "";
  const decides = rel.userDecides?.trim() ?? "";
  if (type === "free" || !fixed) return [FREE_PRINCIPLE];
  const principle = type === "role_bound" ? ROLE_BOUND_PRINCIPLE : RELATIONSHIP_BOUND_PRINCIPLE;
  return [
    principle,
    `${type === "role_bound" ? "고정 배경" : "고정 관계"}: ${fixed}`,
    decides ? `유저가 정하는 것: ${decides}` : "",
  ].filter(Boolean);
}

const TYPE_RULES: Record<OfficialUserRelationType, string> = {
  free: "FREE — 유저 신분·직업·성격·과거 관계가 모두 열려 있다. fixedFacts·userDecides는 \"\"로 둔다. 초면으로 강제하지 말고, 페르소나에 이미 관계가 있으면 그것을 우선한다.",
  role_bound:
    "ROLE_BOUND — 이야기 전제에 꼭 필요한 소속·역할·배경만 고정한다(예: 적국 첩자, 망국 후계자, 파견 감찰관). fixedFacts에 그 고정 사실만, userDecides에 성별·외형·감정·말·행동·나머지 인적 설정이 유저 몫임을 쓴다.",
  relationship_bound:
    "RELATIONSHIP_BOUND — 관계 또는 공동 과거를 고정한다(예: 약혼, 가문의 원수, 소꿉친구, 빙의). fixedFacts에 고정할 사실(관계 이름·공동 과거·공개 여부·빙의면 주체·지식·몸의 기존 관계)만, userDecides에 유저가 정할 사실(감정·기억의 세부·행동·결론)을 쓴다. 관계의 존재를 신뢰·호감·애정·화해의 결론과 같게 쓰지 않는다.",
};

/** Short plan lines for part1 / voice user prompts (the bonds system prompt carries the full rules). */
export function formatUserRelationPlanForPrompt(plan: OfficialUserRelationPlan | undefined): string[] {
  const p = plan ?? FREE_USER_RELATION_PLAN;
  return [
    `유저 관계 시작 유형: ${p.type}${p.fixed ? ` — 고정: ${p.fixed}` : ""}`,
    p.type === "free"
      ? "유저 정체·관계를 확정하지 않는다(페르소나 우선)."
      : "고정 사실만 확정하고 유저 성별·감정·행동·결말은 확정하지 않는다. 고정 관계는 애정·신뢰를 뜻하지 않는다.",
  ];
}

/** Bonds-system rules shared by every type; the type-specific rule travels in the bonds user prompt. */
export function buildUserRelationAuthorRules(): string[] {
  return [
    "- userRelationship.type·fixedFacts·userDecides는 입력의 '유저 관계 시작 유형' 규칙을 따른다(type은 입력값 그대로). 모든 유형에서 유저 성별은 자유이고, 고정 관계는 애정·신뢰·결말 강제가 아니다.",
    `  fixedFacts ${USER_RELATION_FIXED_MAX}자 이내·userDecides ${USER_RELATION_DECIDES_MAX}자 이내. userRole은 "당신은 ~" 꼴로 읽히는 한 줄 라벨이며 fixedFacts를 되풀이하지 않는다(FREE는 '찾아온 방문자'처럼 열린 라벨).`,
  ];
}

/** Bonds-user rule for exactly the planned type (the other two types are not sent). */
export function formatUserRelationBondsRule(plan: OfficialUserRelationPlan | undefined): string[] {
  return [`유형 규칙: ${TYPE_RULES[(plan ?? FREE_USER_RELATION_PLAN).type]}`];
}

const FORCED_OUTCOME_RE =
  /사랑에\s*빠(?:지게|진다|질\s*수밖에)|결국\s*(?:연인|사랑|서로를\s*사랑)|반드시\s*(?:사랑|연인|마음을\s*열|굴복|복종|화해)|굴복하게\s*(?:된다|되며)|복종하게\s*(?:된다|되며)|연인이\s*(?:된다|될\s*운명)|마음을\s*열게\s*(?:된다|되며)|\d+\s*턴\s*(?:후|뒤|이후|째|마다)|매\s*턴|턴마다/u;

const RETREAT_RE =
  /멀어|거리를\s*두|후퇴|적대|배신|의심|등을\s*돌|단절|결렬|이탈|파기|실망|불신|떠나|차단|냉각|악화|틀어|경계(?:가|를)?\s*(?:강|높|굳)/u;
const ADVANCE_RE = /신뢰|협력|가까워|친밀|마음을\s*열|화해|호감|의지|동맹|연대|다가|풀어|열어|열린/u;

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
}): QaResult {
  const errors: QaIssue[] = [];
  const rel = input.userRelationship;
  const type = rel.type;
  if (!isOfficialUserRelationType(type)) {
    errors.push(issue("bible_user_rel_type_invalid", `userRelationship.type must be one of ${OFFICIAL_USER_RELATION_TYPES.join("|")}`));
    return qaResult(errors);
  }
  const fixed = rel.fixedFacts?.trim() ?? "";
  const decides = rel.userDecides?.trim() ?? "";
  if (type === "free") {
    if (fixed || decides) {
      errors.push(issue("bible_user_rel_free_fixed", "FREE start must not carry fixedFacts/userDecides"));
    }
  } else {
    if (fixed.length < 20) errors.push(issue("bible_user_rel_fixed_missing", `${type} needs fixedFacts (>=20 chars) naming exactly what is fixed`));
    if (decides.length < 15) errors.push(issue("bible_user_rel_decides_missing", `${type} needs userDecides (>=15 chars) naming what the user decides`));
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

  const steps = (rel.progression ?? []).filter((step) => step.trim());
  if (steps.length < 2) {
    errors.push(issue("bible_progression_directions", "progression needs at least 2 action-based change conditions"));
  } else {
    const joined = steps.join("\n");
    if (!RETREAT_RE.test(joined) || !ADVANCE_RE.test(joined)) {
      errors.push(issue("bible_progression_one_directional", "progression must include both a warming and a retreating/hostile change condition"));
    }
  }
  return qaResult(errors);
}
