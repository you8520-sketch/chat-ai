import type { TrpgActionType } from "./actionTypes";
import {
  hasMeaningfulUncertainty,
  hasRealChallengeContext,
  isRoutineEnvironmentalAction,
  isRoutineExpertPreparation,
  isRoutineInvestigation,
  isRoutineOpenRouteTraversal,
} from "./actionCheckContext";
import type { TrpgLocalSceneProgressV1 } from "./localSceneProgress";
import {
  isBasicFirstAidIntent,
  isCoverFireSupport,
  isSafeRestIntent,
  isStatusTreatmentOnly,
} from "./mechanicsIntent";

/** Party talk, questions, and stage-only speech — no d20. */
const ASK =
  /물어보|물어\s|묻는|질문|의향|의견|어때\b|어떨까|할까요|할까\?|볼까|갈까|줄까|할까\s|상의|의논|모두에게|파티에|동료/;

const INVESTIGATION = /수색|뒤지|훔치|조사한다|살핀다|살피|훑|확인한다|기척|탐색|숨은/;
const CHALLENGE =
  /문을?\s|창문을?\s|화물|조준|석궁|때리|치며|달리|뛰어|돌진|막는다|막으려|막아|가로막|방어|집어|던지|부순|연다|민다|뽑는다|베|찌르|잠근|휘두|메고|꽂|파고들|주먹|내지르|억지로|딴다|칼을|은신|숨는|숨어서|몰래/;

/** Actor physically engages a hazard — ambient hazard nouns alone do not qualify. */
const HAZARD_ENGAGEMENT =
  /무너지(?:는|는|진)?[^.]{0,24}(?:뛰|넘|밀|들)|(?:뛰(?:어)?(?:넘)?|넘(?:어)?|밀(?:어)?|들(?:어)?|밟|가로질|통과|파(?:고)?)[^.]{0,24}(?:잔해|틈|포자(?:층|낭| 구역| 지대)?)|(?:잔해|틈|포자(?:층|낭| 구역| 지대)?)[^.]{0,24}(?:뛰(?:어)?(?:넘)?|넘(?:어)?|밀(?:어)?|들(?:어)?|밟|가로질|통과|파(?:고)?)|맨(?:손|몸)[^.]{0,20}(?:집|잡|만|붙|쥐|넣|닿)|잠긴[^.]{0,20}(?:문|창)[^.]{0,20}(?:연|밀|딴|부|억)|(?:억지|강제)[^.]{0,16}(?:연|밀|딴|부)/;

const PHYSICAL_ENTRY =
  /(?:들여(?:놓|넣)|(?:한\s)?발(?:을)?[^.]{0,20}(?:들|옮|내디|디)|(?:안쪽|안으로|통로|틈|문턱)[^.]{0,20}(?:들|진입|밀|뛰)|(?:뛰|달|진)[^.]{0,16}(?:들|진입|통과))/;

const CONTESTED = /속이|거짓말|협박|위협|설득하려|통과하려|거짓말로|속이려/;
const TREATMENT = /응급처치|치료|치유|지혈|해독|중독|출혈|마비/;
const THERAPEUTIC_ITEM = /구급키트|붕대|회복약|해독제|치료제|medkit|bandage|antidote|potion|포션/i;
const ITEM_USE = /사용|쓴다|꺼낸|바른|먹|투여|바르|사용한다/;
const HOSTILE_OR_PRECISION_APPLICATION =
  /억지로|강제로|정밀|조준|위험|폭발|저항하는|(?:적|형체|상대|목표)(?:에게|을|를)?.{0,16}(?:투여|주입|던(?:지|져|진))/;
const HAZARDOUS_OFFENSIVE_ITEM =
  /조준|억지로|잠긴|정밀|위험|폭발|맨손|포자|(?:적|형체|상대|목표)(?:에게|을|를)?.{0,12}던(?:지|져|진)|던(?:지|져|진)\s*(?:공격|맞)/;
const ORDINARY_PREP =
  /준비|정비|장전|점검|정리|자세를|숨 고르|숨을 고르|자리를 잡|재배치|한 발 물러|뒤로 빠|옆으로 옮|그쪽으로 간다|다가선|다가가/;

const PASSIVE_OBSERVATION =
  /(?:댄 채|좁혔|보였|보인|관찰|지켜|응시|바라보|알았|느꼈|재고|갈라|서서|선 채|기대|웃음기|말했다|경고(?:한|하)|알려(?:준|주)|이야기(?:한|하)|얘기(?:한|하))/;

/** These explicit action types always imply a roll unless pure talk/flavor disambiguation applies. */
const EXPLICIT_ALWAYS_ROLL_TYPES: ReadonlySet<TrpgActionType> = new Set([
  "attack",
  "defend",
  "persuade",
  "stealth",
]);

/** Investigate may skip when routine context shows no meaningful uncertainty. Support keeps its dedicated owner below. */
const EXPLICIT_CONTEXTUAL_ROLL_TYPES: ReadonlySet<TrpgActionType> = new Set(["investigate"]);

export type TrpgActionCheckReason =
  | "explicit_resolution"
  | "challenge"
  | "hazard"
  | "contested"
  | "support_setup"
  | "ordinary_item_use"
  | "talk"
  | "flavor"
  | "safe_rest"
  | "ordinary_free"
  | "routine_traversal"
  | "routine_competence"
  | "no_meaningful_uncertainty";

export type TrpgActionCheckDecision = {
  needsCheck: boolean;
  reason: TrpgActionCheckReason;
};

const HARMLESS_FLAVOR_PHRASES = [
  "벽에 기대 선다",
  "고개를 끄덕",
  "고개를 젓",
  "시선을 돌린",
  "어깨를 으쓱",
  "팔짱을 낀",
  "숨을 고른",
  "옷깃을 정리",
  "소매를 정리",
  "장갑을 정리",
  "머리를 정리",
  "자리에 앉",
  "벽에 기대",
  "기대 선다",
  "가만히 선다",
  "정리하고",
  "작게 웃",
  "조용히 웃",
  "내쉬며",
  "일어선다",
  "앉는다",
  "바라보",
  "웃는다",
  "한숨",
  "미소",
  "옷깃",
  "소매",
  "장갑",
].sort((a, b) => b.length - a.length);

function normalizeBody(body: string): string {
  return body.replace(/\s+/g, " ").trim();
}

export function stripTalkWrappers(body: string): string {
  return normalizeBody(body)
    .replace(/\*[^*]{0,120}\*/g, " ")
    .replace(/「[^」]{0,400}」/g, " ")
    .replace(/『[^』]{0,400}』/g, " ")
    .replace(/["“”][^"“”]{0,400}["“”]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

function visibleActorActionText(body: string): string {
  return stripQuotedDialogue(body);
}

function isQuestionLike(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return /[?？]\s*$/.test(t) || /(?:까(?:요)?|가요|할까요)\s*$/.test(t);
}

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

/** Deliberate non-activating probe/extension — coordination, not a committed hazard attempt. */
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

function leftoverAfterFlavor(text: string): string {
  let leftover = text;
  for (const phrase of HARMLESS_FLAVOR_PHRASES) {
    leftover = leftover.split(phrase).join(" ");
  }
  return leftover
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/(?:인다|한다|된다|는다|선다|진다|으며|며|고|을|를|이|가|은|는|에게|과|와|에|로|으로|다)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isHarmlessFlavorAction(body: string): boolean {
  const text = normalizeBody(body);
  if (!text) return false;
  if (hasChallengeSignal(text)) return false;
  const leftover = stripTalkWrappers(text);
  if (!leftover) return false;
  if (hasChallengeSignal(leftover)) return false;
  if (!HARMLESS_FLAVOR_PHRASES.some((phrase) => leftover.includes(phrase))) return false;
  const rest = leftoverAfterFlavor(leftover);
  if (!rest) return true;
  return rest.length <= 6 && !hasChallengeSignal(rest);
}

export function isTalkOnlyAction(body: string): boolean {
  const text = normalizeBody(body);
  if (!text) return false;
  const leftover = stripTalkWrappers(text);
  if (leftover.length === 0) return true;
  if (hasChallengeSignal(leftover) || (hasChallengeSignal(text) && leftover.length >= 24)) return false;
  if (ASK.test(leftover) || isQuestionLike(leftover)) return true;
  if (ASK.test(text) && leftover.length < 60 && !hasChallengeSignal(text)) return true;
  return false;
}

function isPassiveObservationOrPositioning(body: string): boolean {
  const visible = visibleActorActionText(body);
  if (!visible) return false;
  if (classifyChallengeKind(visible)) return false;
  return PASSIVE_OBSERVATION.test(visible);
}

function supportTreatmentRisk(text: string): TrpgActionCheckReason | null {
  if (isBasicFirstAidIntent(text) || TREATMENT.test(text) || isCoverFireSupport(text)) {
    return "challenge";
  }
  return null;
}

function resolveVisibleActorRisk(body: string): TrpgActionCheckReason | null {
  const visible = visibleActorActionText(body);
  if (!visible) return null;
  const visibleKind = classifyChallengeKind(visible);
  if (visibleKind) return visibleKind;
  return supportTreatmentRisk(visible);
}

function resolveIntentDisambiguation(body: string, intent: string): TrpgActionCheckReason | null {
  if (!intent.trim()) return null;
  if (isTalkOnlyAction(body)) return null;
  if (isPassiveObservationOrPositioning(body)) return null;
  if (isHarmlessFlavorAction(body) || isOrdinaryPreparation(body)) return null;
  if (resolveVisibleActorRisk(body)) return null;

  const intentKind = classifyChallengeKind(intent);
  if (intentKind) return intentKind;
  return supportTreatmentRisk(intent);
}

function isDangerousItemApplication(text: string): boolean {
  if (HOSTILE_OR_PRECISION_APPLICATION.test(text) || HAZARDOUS_OFFENSIVE_ITEM.test(text)) return true;
  if (/던(?:지|져|진)/.test(text)) return true;
  const kind = classifyChallengeKind(text);
  return kind === "hazard" || kind === "contested";
}

function isOrdinaryTherapeuticItemUse(text: string): boolean {
  const normalized = normalizeBody(text);
  if (!ITEM_USE.test(normalized) || !THERAPEUTIC_ITEM.test(normalized)) return false;
  return !isDangerousItemApplication(normalized);
}

function isSkillTreatmentWithoutItem(text: string): boolean {
  const normalized = normalizeBody(text);
  if (THERAPEUTIC_ITEM.test(normalized) && ITEM_USE.test(normalized)) return false;
  return (
    isBasicFirstAidIntent(normalized) ||
    isStatusTreatmentOnly(normalized) ||
    TREATMENT.test(normalized)
  );
}

function isHazardousItemUse(text: string): boolean {
  return isDangerousItemApplication(text);
}

function isOrdinaryPreparation(text: string): boolean {
  if (hasChallengeSignal(text)) return false;
  return ORDINARY_PREP.test(text);
}

function resolveItemUseDecision(body: string, intent: string): TrpgActionCheckDecision {
  const visible = visibleActorActionText(body);
  if (visible) {
    if (isHazardousItemUse(visible)) {
      const kind = classifyChallengeKind(visible);
      if (kind === "contested") return { needsCheck: true, reason: "contested" };
      if (kind === "hazard") return { needsCheck: true, reason: "hazard" };
      return { needsCheck: true, reason: "challenge" };
    }
    if (isOrdinaryTherapeuticItemUse(visible)) {
      return { needsCheck: false, reason: "ordinary_item_use" };
    }
    if (isSkillTreatmentWithoutItem(visible)) {
      return { needsCheck: true, reason: "challenge" };
    }
  }
  if (isTalkOnlyAction(body)) {
    return { needsCheck: false, reason: "talk" };
  }
  const intentReason = intent ? resolveIntentDisambiguation(body, intent) : null;
  if (intentReason && isHazardousItemUse(intent)) {
    return { needsCheck: true, reason: intentReason };
  }
  return { needsCheck: false, reason: "ordinary_item_use" };
}

export function resolveTrpgActionCheckDecision(opts: {
  body: string;
  actionType?: TrpgActionType | null;
  intent?: string | null;
  localScene?: TrpgLocalSceneProgressV1 | null;
  statValue?: number | null;
}): TrpgActionCheckDecision {
  const body = normalizeBody(opts.body);
  const intent = (opts.intent ?? "").trim();
  if (isSafeRestIntent(body) || (intent && isSafeRestIntent(intent))) {
    return { needsCheck: false, reason: "safe_rest" };
  }
  const actionType = opts.actionType ?? null;
  if (isRoutineOpenRouteTraversal({ body: opts.body, localScene: opts.localScene })) {
    return { needsCheck: false, reason: "routine_traversal" };
  }
  if (isRoutineEnvironmentalAction(body)) {
    return { needsCheck: false, reason: "routine_competence" };
  }
  if (actionType === "investigate" && isRoutineInvestigation(body)) {
    return { needsCheck: false, reason: "no_meaningful_uncertainty" };
  }
  if (actionType === "support" && isRoutineExpertPreparation(body) && !hasRealChallengeContext(body)) {
    return { needsCheck: false, reason: "routine_competence" };
  }
  if (actionType && EXPLICIT_ALWAYS_ROLL_TYPES.has(actionType)) {
    const visibleRisk = resolveVisibleActorRisk(opts.body);
    if (visibleRisk) return { needsCheck: true, reason: visibleRisk };
    const intentReason = intent ? resolveIntentDisambiguation(opts.body, intent) : null;
    if (intentReason) return { needsCheck: true, reason: intentReason };
    return { needsCheck: true, reason: "explicit_resolution" };
  }
  if (actionType && EXPLICIT_CONTEXTUAL_ROLL_TYPES.has(actionType)) {
    const visibleRisk = resolveVisibleActorRisk(opts.body);
    if (visibleRisk) return { needsCheck: true, reason: visibleRisk };
    const intentReason = intent ? resolveIntentDisambiguation(opts.body, intent) : null;
    if (intentReason) return { needsCheck: true, reason: intentReason };
    return { needsCheck: true, reason: "explicit_resolution" };
  }

  const visibleRisk = resolveVisibleActorRisk(opts.body);

  if (actionType === "support") {
    if (visibleRisk) return { needsCheck: true, reason: visibleRisk };
    if (isTalkOnlyAction(opts.body)) return { needsCheck: false, reason: "support_setup" };
    const intentReason = resolveIntentDisambiguation(opts.body, intent);
    if (intentReason) return { needsCheck: true, reason: intentReason };
    if (isHarmlessFlavorAction(opts.body)) return { needsCheck: false, reason: "flavor" };
    if (isOrdinaryPreparation(body)) return { needsCheck: false, reason: "ordinary_free" };
    return { needsCheck: false, reason: "support_setup" };
  }

  if (actionType === "use_item") {
    return resolveItemUseDecision(body, intent);
  }

  if (visibleRisk) return { needsCheck: true, reason: visibleRisk };
  const intentReason = resolveIntentDisambiguation(opts.body, intent);
  if (intentReason) return { needsCheck: true, reason: intentReason };
  if (isTalkOnlyAction(opts.body)) return { needsCheck: false, reason: "talk" };
  if (isHarmlessFlavorAction(opts.body)) return { needsCheck: false, reason: "flavor" };
  if (isOrdinaryPreparation(body)) return { needsCheck: false, reason: "ordinary_free" };
  if (
    hasMeaningfulUncertainty({
      body: opts.body,
      actionType,
      intent,
      localScene: opts.localScene,
      statValue: opts.statValue,
    })
  ) {
    const kind = classifyChallengeKind(body);
    if (kind === "contested") return { needsCheck: true, reason: "contested" };
    if (kind === "hazard") return { needsCheck: true, reason: "hazard" };
    return { needsCheck: true, reason: "challenge" };
  }
  return { needsCheck: false, reason: "no_meaningful_uncertainty" };
}

export function actionNeedsCheck(opts: {
  body: string;
  actionType?: TrpgActionType | null;
  intent?: string | null;
}): boolean {
  return resolveTrpgActionCheckDecision(opts).needsCheck;
}
