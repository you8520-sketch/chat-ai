import type { TrpgActionType } from "./actionTypes";
import { isSafeRestIntent } from "./mechanicsIntent";

/** Party talk, questions, and stage-only speech — no d20. */
const ASK =
  /물어보|물어\s|묻는|질문|의향|의견|어때\b|어떨까|할까요|할까\?|볼까|갈까|줄까|할까\s|상의|의논|모두에게|파티에|동료/;

const INVESTIGATION = /수색|뒤지|훔치|조사한다|살핀다|살피|훑|확인한다|기척|탐색|숨은/;
const CHALLENGE =
  /문을?\s|창문을?\s|화물|조준|석궁|때리|치며|달리|뛰어|돌진|막는다|방어|집어|던지|부순|연다|민다|뽑는다|베|찌르|잠근|휘두|메고|꽂|파고들|주먹|내지르|억지로|딴다|칼을|은신|숨는|숨어서|몰래/;
const HAZARD = /무너지|잔해|뛰어넘|틈을|포자|수상한|맨손|잠긴/;
const CONTESTED = /속이|거짓말|협박|위협|설득하려|통과하려|거짓말로|속이려/;

const EXPLICIT_RESOLUTION_TYPES: ReadonlySet<TrpgActionType> = new Set([
  "attack",
  "defend",
  "investigate",
  "persuade",
  "stealth",
]);

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

export function actionNeedsCheck(opts: {
  body: string;
  actionType?: TrpgActionType | null;
}): boolean {
  // Dedicated server-owned no-check (safe rest) wins before chip category.
  if (isSafeRestIntent(opts.body)) return false;
  const actionType = opts.actionType ?? null;
  // Explicit resolution chips are authoritative: dialogue/flavor cannot skip.
  if (actionType && EXPLICIT_RESOLUTION_TYPES.has(actionType)) {
    return true;
  }
  if (hasChallengeSignal(opts.body)) return true;
  if (isTalkOnlyAction(opts.body)) return false;
  if (isHarmlessFlavorAction(opts.body)) return false;
  return true;
}
