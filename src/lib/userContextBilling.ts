import { USER_NOTE_FOCUS_MAX, USER_NOTE_MAX } from "@/lib/persona";

/** 고집중 영역(0~1,000자)까지 할증 없음 */
export const USER_CONTEXT_SURCHARGE_FREE_CHARS = USER_NOTE_FOCUS_MAX;
/** 이 글자 수 이상이면 할증 10% 고정 */
export const USER_CONTEXT_SURCHARGE_CAP_CHARS = USER_NOTE_MAX;
export const USER_CONTEXT_SURCHARGE_MIN = 0.001;
export const USER_CONTEXT_SURCHARGE_MAX = 0.1;

/** @deprecated USER_CONTEXT_SURCHARGE_FREE_CHARS — 글자 기준 */
export const USER_CONTEXT_SURCHARGE_FREE_TOKENS = USER_CONTEXT_SURCHARGE_FREE_CHARS;
/** @deprecated USER_CONTEXT_SURCHARGE_CAP_CHARS */
export const USER_CONTEXT_SURCHARGE_CAP_TOKENS = USER_CONTEXT_SURCHARGE_CAP_CHARS;

/** 유저 노트(본문+상태창) 합산 글자 수 — 할증·구간 표시 기준 */
export function estimateUserContextChars(userNoteCombinedChars: number): number {
  return Math.max(0, userNoteCombinedChars);
}

/**
 * 유저 노트 합산 글자 수 기준 숨김 할증.
 * 1,001~10,000자: 0.1% → 10% 선형 (고집중 영역 이탈 시 시작)
 */
export function userContextSurcharge(combinedChars: number): number {
  if (combinedChars <= USER_CONTEXT_SURCHARGE_FREE_CHARS) return 0;
  if (combinedChars >= USER_CONTEXT_SURCHARGE_CAP_CHARS) return USER_CONTEXT_SURCHARGE_MAX;

  const range = USER_CONTEXT_SURCHARGE_CAP_CHARS - USER_CONTEXT_SURCHARGE_FREE_CHARS;
  const excess = combinedChars - USER_CONTEXT_SURCHARGE_FREE_CHARS;
  const ratio = excess / range;
  return (
    USER_CONTEXT_SURCHARGE_MIN +
    ratio * (USER_CONTEXT_SURCHARGE_MAX - USER_CONTEXT_SURCHARGE_MIN)
  );
}

/** @deprecated estimateUserContextChars + userContextSurcharge 사용 */
export function estimateUserContextTokens(userNoteText: string, personaPromptText: string): number {
  void userNoteText;
  void personaPromptText;
  return 0;
}
