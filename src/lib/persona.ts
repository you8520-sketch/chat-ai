/** @deprecated 표시용 — 입력 길이 제한 없음 */
export const PERSONA_NAME_LIMIT = 30;
/** @deprecated 표시용 — 입력 길이 제한 없음 */
export const PERSONA_MEMO_LIMIT = 20;
/** 유저가 만들 수 있는 페르소나 최대 개수 */
export const USER_PERSONA_MAX_COUNT = 50;
/** 기본 설정 + 비밀 설정 합산 상한 */
export const PERSONA_CONTENT_MAX = 1200;
/**
 * 비밀 설정 단독 상한 — 기본 설정과 합산 시 PERSONA_CONTENT_MAX를 넘을 수 없음.
 * (컴파일러 등 비밀 필드만 보는 경로용)
 */
export const PERSONA_SECRET_CONTENT_MAX = PERSONA_CONTENT_MAX;
/** @deprecated PERSONA_CONTENT_MAX 사용 */
export const USER_PERSONA_LIMIT = PERSONA_CONTENT_MAX;
/** @deprecated PERSONA_CONTENT_MAX */
export const PERSONA_SPEECH_EXAMPLES_LIMIT = PERSONA_CONTENT_MAX;
/** @deprecated use PERSONA_CONTENT_MAX */
export const PERSONA_BIO_LIMIT = PERSONA_CONTENT_MAX;
/** @deprecated 표시용 — 입력 길이 제한 없음 */
/** 유저 노트 + 내 상태창 항목 합산 상한 */
export const USER_NOTE_MAX = 10_000;
/** 고집중 영역 — 매 턴 전량 주입 (UI 「중요 기억 · 고집중」 칸) */
export const USER_NOTE_FOCUS_MAX = 1_000;
/** 확장구간 상한 — UI 「유저노트 확장구간」 칸 전용, 키워드 매칭 RAG (고집중 글자 수와 무관) */
export const USER_NOTE_REFERENCE_MAX = 9_000;

export function validateUserNoteLength(length: number): { ok: true } | { ok: false; error: string } {
  if (length > USER_NOTE_MAX) {
    return { ok: false, error: `유저 노트는 ${USER_NOTE_MAX.toLocaleString()}자 이하여야 합니다.` };
  }
  return { ok: true };
}

export function personaContentLength(description: string): number {
  return description.trim().length;
}

export function personaCombinedContentLength(
  description: string,
  secretDescription = ""
): number {
  return personaContentLength(description) + personaContentLength(secretDescription);
}

export function validatePersonaContentLength(
  description: string
): { ok: true } | { ok: false; error: string } {
  const len = personaContentLength(description);
  if (len > PERSONA_CONTENT_MAX) {
    return {
      ok: false,
      error: `페르소나 설정은 ${PERSONA_CONTENT_MAX.toLocaleString()}자 이하여야 합니다. (현재 ${len.toLocaleString()}자)`,
    };
  }
  return { ok: true };
}

export function validatePersonaCombinedContentLength(
  description: string,
  secretDescription = ""
): { ok: true } | { ok: false; error: string } {
  const len = personaCombinedContentLength(description, secretDescription);
  if (len > PERSONA_CONTENT_MAX) {
    return {
      ok: false,
      error: `기본 설정과 비밀 설정의 합계는 ${PERSONA_CONTENT_MAX.toLocaleString()}자 이하여야 합니다. (현재 ${len.toLocaleString()}자)`,
    };
  }
  return { ok: true };
}

export function validatePersonaSecretContentLength(
  secretDescription: string,
  publicDescription = ""
): { ok: true } | { ok: false; error: string } {
  return validatePersonaCombinedContentLength(publicDescription, secretDescription);
}

/** 다른 필드 길이를 반영해 합산 예산 안으로 잘라 냄 */
export function capPersonaFieldToSharedBudget(
  otherField: string,
  nextValue: string,
  max = PERSONA_CONTENT_MAX
): string {
  const budget = Math.max(0, max - personaContentLength(otherField));
  if (nextValue.length <= budget) return nextValue;
  return nextValue.slice(0, budget);
}

/** UI 입력 — 설명 1200자 이내로 필드 값 제한 */
export function capPersonaDescription(description: string, nextValue: string): string {
  return nextValue.slice(0, PERSONA_CONTENT_MAX);
}

export function validateUserPersonaLength(length: number): { ok: true } | { ok: false; error: string } {
  if (length > PERSONA_CONTENT_MAX) {
    return {
      ok: false,
      error: `페르소나 설정은 ${PERSONA_CONTENT_MAX.toLocaleString()}자 이하여야 합니다.`,
    };
  }
  return { ok: true };
}

export type UserPersona = {
  personaName: string;
  personaBio: string;
  userNote: string;
};

export function formatUserPersonaForPrompt(
  personaName: string,
  personaBio: string,
  fallbackNickname: string
): string | null {
  const name = personaName.trim() || fallbackNickname.trim();
  const bio = personaBio.trim();
  const parts: string[] = [];
  if (name) parts.push(`이름/호칭: ${name}`);
  if (bio) parts.push(bio);
  if (parts.length === 0) return null;
  return parts.join("\n");
}

import { userNoteForPrompt as expandUserNoteForPrompt } from "@/lib/userNoteStatusWindow";

export function formatUserNoteForPrompt(note: string): string | null {
  const trimmed = expandUserNoteForPrompt(note).trim();
  return trimmed || null;
}
