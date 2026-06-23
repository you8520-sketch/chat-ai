import { USER_NOTE_FOCUS_MAX, USER_NOTE_MAX } from "@/lib/persona";

/** @deprecated 장기기억·유저노트 할증 제거 — 항상 0 */
export const USER_CONTEXT_SURCHARGE_FREE_CHARS = USER_NOTE_FOCUS_MAX;
/** @deprecated */
export const USER_CONTEXT_SURCHARGE_CAP_CHARS = USER_NOTE_MAX;
export const USER_CONTEXT_SURCHARGE_MIN = 0;
export const USER_CONTEXT_SURCHARGE_MAX = 0;

/** @deprecated USER_CONTEXT_SURCHARGE_FREE_CHARS — 글자 기준 */
export const USER_CONTEXT_SURCHARGE_FREE_TOKENS = USER_CONTEXT_SURCHARGE_FREE_CHARS;
/** @deprecated USER_CONTEXT_SURCHARGE_CAP_CHARS */
export const USER_CONTEXT_SURCHARGE_CAP_TOKENS = USER_CONTEXT_SURCHARGE_CAP_CHARS;

/** 유저 노트(본문+상태창) 합산 글자 수 — 할증·구간 표시 기준 */
export function estimateUserContextChars(userNoteCombinedChars: number): number {
  return Math.max(0, userNoteCombinedChars);
}

/** @deprecated 장기기억·유저노트 할증(최대 10%) 제거 — 항상 0 */
export function userContextSurcharge(_combinedChars: number): number {
  return 0;
}

/** @deprecated estimateUserContextChars + userContextSurcharge 사용 */
export function estimateUserContextTokens(userNoteText: string, personaPromptText: string): number {
  void userNoteText;
  void personaPromptText;
  return 0;
}
