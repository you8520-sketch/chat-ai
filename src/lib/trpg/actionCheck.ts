import type { TrpgActionType } from "./actionTypes";
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
  /문을?\s|창문을?\s|화물|조준|석궁|때리|치며|달리|뛰어|돌진|막는다|방어|집어|던지|부순|연다|민다|뽑는다|베|찌르|잠근|휘두|메고|꽂|파고들|주먹|내지르|억지로|딴다|칼을|은신|숨는|숨어서|몰래/;
const HAZARD = /무너지|잔해|뛰어넘|틈을|포자|수상한|맨손|잠긴/;
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

const EXPLICIT_RESOLUTION_TYPES: ReadonlySet<TrpgActionType> = new Set([
  "attack",
  "defend",
  "investigate",
  "persuade",
  "stealth",
]);

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
  | "ordinary_free";

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

function isQuestionLike(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return /[?？]\s*$/.test(t) || /(?:까(?:요)?|가요|할까요)\s*$/.test(t);
}

export function hasChallengeSignal(body: string): boolean {
  const text = normalizeBody(body);
  if (!text) return false;
  return INVESTIGATION.test(text) || CHALLENGE.test(text) || HAZARD.test(text) || CONTESTED.test(text);
}

export function classifyChallengeKind(body: string): "challenge" | "hazard" | "contested" | null {
  const text = normalizeBody(body);
  if (!text) return null;
  if (CONTESTED.test(text)) return "contested";
  if (HAZARD.test(text)) return "hazard";
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

function isHazardousSupport(text: string): boolean {
  return (
    isBasicFirstAidIntent(text) ||
    TREATMENT.test(text) ||
    isCoverFireSupport(text) ||
    classifyChallengeKind(text) === "hazard" ||
    classifyChallengeKind(text) === "contested"
  );
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

function classificationText(opts: { body: string; intent?: string | null }): string {
  const intent = (opts.intent ?? "").trim();
  if (intent) return intent;
  return opts.body;
}

export function resolveTrpgActionCheckDecision(opts: {
  body: string;
  actionType?: TrpgActionType | null;
  intent?: string | null;
}): TrpgActionCheckDecision {
  const text = classificationText(opts);
  if (isSafeRestIntent(text) || isSafeRestIntent(opts.body)) {
    return { needsCheck: false, reason: "safe_rest" };
  }
  const actionType = opts.actionType ?? null;
  if (actionType && EXPLICIT_RESOLUTION_TYPES.has(actionType)) {
    return { needsCheck: true, reason: "explicit_resolution" };
  }
  if (actionType === "support") {
    if (isHazardousSupport(text)) {
      const kind = classifyChallengeKind(text);
      if (kind === "contested") return { needsCheck: true, reason: "contested" };
      if (kind === "hazard") return { needsCheck: true, reason: "hazard" };
      return { needsCheck: true, reason: "challenge" };
    }
    return { needsCheck: false, reason: "support_setup" };
  }
  if (actionType === "use_item") {
    if (isHazardousItemUse(text)) {
      const kind = classifyChallengeKind(text);
      if (kind === "contested") return { needsCheck: true, reason: "contested" };
      if (kind === "hazard") return { needsCheck: true, reason: "hazard" };
      return { needsCheck: true, reason: "challenge" };
    }
    if (isOrdinaryTherapeuticItemUse(text)) {
      return { needsCheck: false, reason: "ordinary_item_use" };
    }
    if (isSkillTreatmentWithoutItem(text)) {
      return { needsCheck: true, reason: "challenge" };
    }
    return { needsCheck: false, reason: "ordinary_item_use" };
  }

  const kind = classifyChallengeKind(text);
  if (kind) return { needsCheck: true, reason: kind };
  if (isTalkOnlyAction(text) || isTalkOnlyAction(opts.body)) {
    return { needsCheck: false, reason: "talk" };
  }
  if (isHarmlessFlavorAction(text) || isHarmlessFlavorAction(opts.body)) {
    return { needsCheck: false, reason: "flavor" };
  }
  if (isOrdinaryPreparation(text)) {
    return { needsCheck: false, reason: "ordinary_free" };
  }
  return { needsCheck: false, reason: "ordinary_free" };
}

export function actionNeedsCheck(opts: {
  body: string;
  actionType?: TrpgActionType | null;
  intent?: string | null;
}): boolean {
  return resolveTrpgActionCheckDecision(opts).needsCheck;
}
