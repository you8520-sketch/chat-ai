import type { TrpgActionType } from "./actionTypes";

/** Party talk, questions, and stage-only speech — no d20. */
const ASK =
  /물어보|물어\s|묻는|질문|의향|의견|어때\b|어떨까|할까요|할까\?|볼까|갈까|줄까|할까\s|상의|의논|모두에게|파티에|동료/;
const PHYSICAL =
  /문을?\s|창문을?\s|화물|조준|석궁|때리|치며|수색|뒤지|훔치|은신|숨는|달리|뛰어|돌진|막는다|방어|집어|던지|부순|조사한다|살핀다|살피|훑|확인한다|연다|민다|뽑는다|베|찌르|잠근|다가가|휘두|메고|꽂|이동|향한다/;

function stripTalkWrappers(body: string): string {
  return body
    .replace(/\*[^*]{0,120}\*/g, " ")
    .replace(/["“”][^"“”]{0,400}["“”]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isQuestionLike(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return /[?？]\s*$/.test(t) || /(?:까(?:요)?|가요|할까요)\s*$/.test(t);
}

export function isTalkOnlyAction(body: string): boolean {
  const text = body.replace(/\s+/g, " ").trim();
  if (!text) return false;
  const leftover = stripTalkWrappers(text);
  if (leftover.length === 0) return true;
  if (PHYSICAL.test(leftover) || (PHYSICAL.test(text) && leftover.length >= 24)) return false;
  if (ASK.test(leftover) || isQuestionLike(leftover)) return true;
  if (ASK.test(text) && leftover.length < 60 && !PHYSICAL.test(text)) return true;
  return false;
}

export function actionNeedsCheck(opts: {
  body: string;
  actionType?: TrpgActionType | null;
}): boolean {
  void opts.actionType;
  return !isTalkOnlyAction(opts.body);
}
