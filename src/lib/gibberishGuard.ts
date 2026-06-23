/** Token Salad / Gibberish — 한국어 RP 맥락 감지. 반복 루프는 antiRepetition.ts */

/** 디버깅 시에만 .env GIBBERISH_GUARD_ENABLED=false (기본: 항상 ON) */
export const GIBBERISH_GUARD_ENABLED = process.env.GIBBERISH_GUARD_ENABLED !== "false";

export const DEGENERATION_USER_MESSAGE =
  "AI가 문장 생성 중 오류를 일으켰습니다. 다시 시도해 주세요.";

export class DegenerationAbortError extends Error {
  constructor(message = DEGENERATION_USER_MESSAGE) {
    super(message);
    this.name = "DegenerationAbortError";
  }
}

export type DegenerationGuardContext = { oocHtmlMode?: boolean };

const HANGUL = /[가-힣]/g;
const CYRILLIC = /[\u0400-\u04FF]/g;
const ARABIC = /[\u0600-\u06FF]/g;
const DEVANAGARI = /[\u0900-\u097F]/g;

const HARD_CODE =
  /(?:getToken|sprintf|(?:function|const|import)\s+\w|\bstate\.[a-zA-Z_]+\()/i;

const SCHEME_OR_URL = /[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//;

const ALNUM_GLUE = /\b[a-zA-Z]{3,}\d{2,}\b|\b\d{3,}[a-zA-Z]{3,}\b/g;

const LATIN_FRAGMENT = /\b[a-zA-Z]{3,12}\b/g;
const DIGIT_FRAGMENT = /\b\d{2,}\b/g;

function countMatches(text: string, re: RegExp): number {
  const flags = re.flags.includes("g") ? re.flags : re.flags + "g";
  return [...text.matchAll(new RegExp(re.source, flags))].length;
}

function hangulCount(text: string): number {
  return (text.match(HANGUL) ?? []).length;
}

function hangulRatio(text: string): number {
  if (!text.length) return 0;
  return hangulCount(text) / text.length;
}

/** 연속 한글 구절 — 정상 RP 문장 */
function hasHangulSentenceRuns(text: string, minRun = 10): boolean {
  return new RegExp(`[가-힣]{${minRun},}`).test(text);
}

/** 정상 한국어 RP — 오탐 방지 우회 (저장·분량 가드 공용) */
export function isHealthyKoreanNarrative(text: string): boolean {
  return isHealthyKoreanRp(text);
}

/** 정상 한국어 RP — 오탐 방지 우회 */
function isHealthyKoreanRp(text: string): boolean {
  const h = hangulCount(text);
  if (h >= 40) return true;
  if (text.length >= 50 && hangulRatio(text) >= 0.22) return true;
  if (hasHangulSentenceRuns(text, 12)) return true;
  if (h >= 25 && hasHangulSentenceRuns(text, 8)) return true;
  return false;
}

function hasHardSaladSignals(text: string): boolean {
  if (SCHEME_OR_URL.test(text)) return true;
  if (HARD_CODE.test(text)) return true;
  if (countMatches(text, ALNUM_GLUE) >= 4) return true;

  const len = text.length;
  if (len < 20) return false;

  const cyrillic = (text.match(CYRILLIC) ?? []).length;
  const arabic = (text.match(ARABIC) ?? []).length;
  const devanagari = (text.match(DEVANAGARI) ?? []).length;

  if (cyrillic >= 6 || (cyrillic >= 3 && cyrillic / len >= 0.08)) return true;
  if (arabic >= 6 || (arabic >= 3 && arabic / len >= 0.08)) return true;
  if (devanagari >= 3) return true;

  if (
    len >= 80 &&
    countMatches(text, ALNUM_GLUE) >= 2 &&
    hangulRatio(text) < 0.15 &&
    cyrillic + arabic + devanagari >= 2
  ) {
    return true;
  }

  return false;
}

/** 영한 혼합 Token Salad — OpenRouter 등 모델 퇴화 패턴 */
function hasEnKrTokenSalad(text: string): boolean {
  const t = text.trim();
  const len = t.length;
  if (len < 80) return false;

  const ratio = hangulRatio(t);
  const latinMatches = countMatches(t, LATIN_FRAGMENT);
  const digitMatches = countMatches(t, DIGIT_FRAGMENT);

  if (latinMatches >= 6 && digitMatches >= 2 && ratio < 0.2) return true;
  if (latinMatches >= 8 && ratio < 0.25 && !hasHangulSentenceRuns(t, 15)) return true;

  const tokens = t.split(/\s+/).filter(Boolean);
  if (tokens.length < 12) return false;

  let saladTokens = 0;
  for (const tok of tokens) {
    if (/^[a-zA-Z]{3,10}$/.test(tok)) saladTokens++;
    else if (/^[a-zA-Z]*\d+[a-zA-Z\d]*$/.test(tok) && tok.length >= 4) saladTokens++;
    else if (/^\d+[a-zA-Z]+$/.test(tok)) saladTokens++;
  }

  const saladRatio = saladTokens / tokens.length;
  if (saladRatio >= 0.35 && ratio < 0.22 && !hasHangulSentenceRuns(t, 12)) return true;

  return false;
}

/** 띄어쓰기·짧은 영문 토큰 산재 — Token Salad 조기 감지 */
function hasAbnormalSpacing(text: string): boolean {
  const t = text.trim();
  if (t.length < 60) return false;
  if (isHealthyKoreanRp(t)) return false;

  const tokens = t.split(/\s+/).filter(Boolean);
  if (tokens.length < 10) return false;

  let shortLatin = 0;
  for (const tok of tokens) {
    if (/^[a-zA-Z]{1,5}$/.test(tok)) shortLatin++;
  }
  const ratio = hangulRatio(t);
  if (shortLatin / tokens.length >= 0.35 && ratio < 0.25) return true;
  if (/\s{3,}[a-zA-Z]/.test(t) && ratio < 0.2 && shortLatin >= 4) return true;

  return false;
}

function isDegenerateSlice(text: string): boolean {
  if (hasHardSaladSignals(text)) return true;
  if (hasEnKrTokenSalad(text)) return true;
  if (hasAbnormalSpacing(text)) return true;
  const len = text.length;
  if (len >= 150 && hangulRatio(text) < 0.1 && countMatches(text, ALNUM_GLUE) >= 3) return true;
  return false;
}

/** 제작자 지정 HTML 상태창(sw-hud) — 라틴 토큰 비율이 높아도 정상 */
export function isExpectedStatusHtmlOutput(text: string): boolean {
  const t = text.trim();
  if (t.length < 16) return false;
  return (
    /sw-hud/i.test(t) ||
    /◆\s*상태\s*로그/i.test(t) ||
    (/<div\b/i.test(t) && /class\s*=\s*["']sw-hud/i.test(t))
  );
}

/** 스트리밍 누적 텍스트 — 꼬리 구간 검사 */
export function detectStreamingDegeneration(
  text: string,
  context?: DegenerationGuardContext
): boolean {
  if (context?.oocHtmlMode) return false;
  if (!GIBBERISH_GUARD_ENABLED) return false;
  const t = text.trim();
  if (t.length < 80) return false;
  if (isExpectedStatusHtmlOutput(t)) return false;
  if (isHealthyKoreanRp(t)) return false;
  if (isDegenerateSlice(t)) return true;
  const tail = t.slice(-200);
  return isDegenerateSlice(tail);
}

/** 단일 청크 — 누적 맥락 충분할 때만 (조기 오탐 방지) */
export function detectChunkDegeneration(
  chunk: string,
  accumulated: string,
  context?: DegenerationGuardContext
): boolean {
  if (context?.oocHtmlMode) return false;
  if (!GIBBERISH_GUARD_ENABLED) return false;
  const c = chunk.trim();
  if (!c || c.length < 20) return false;
  if (accumulated.trim().length < 60) return false;
  const combined = accumulated + chunk;
  if (isExpectedStatusHtmlOutput(combined)) return false;
  if (isHealthyKoreanRp(combined)) return false;
  if (hasHardSaladSignals(c)) return true;
  if (combined.trim().length >= 80 && isDegenerateSlice(combined.slice(-240))) return true;
  return false;
}

/** 최종 저장 전 검사 */
export function isDegenerateOutput(text: string, context?: DegenerationGuardContext): boolean {
  if (context?.oocHtmlMode) return false;
  if (!GIBBERISH_GUARD_ENABLED) return false;
  const t = text.trim();
  if (t.length < 80) return false;
  if (isExpectedStatusHtmlOutput(t)) return false;
  if (isHealthyKoreanRp(t)) return false;
  return isDegenerateSlice(t);
}

export function getDegenerationReason(text: string): string | null {
  if (!GIBBERISH_GUARD_ENABLED) return null;
  if (!isDegenerateOutput(text)) return null;
  if (SCHEME_OR_URL.test(text)) return "scheme_url";
  if (HARD_CODE.test(text)) return "hard_code";
  if (countMatches(text, ALNUM_GLUE) >= 4) return "alnum_glue";
  if (hasEnKrTokenSalad(text)) return "en_kr_salad";
  if (hasAbnormalSpacing(text)) return "abnormal_spacing";
  if (hangulRatio(text) < 0.1) return "low_hangul_soup";
  return "hard_salad";
}
