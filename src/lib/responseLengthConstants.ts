/** Client-safe response length constants — no chatDisplayLength / server DB deps */

/** Korean output ~1.5 chars/token; 1.3× safety buffer on max chars */
export const KOREAN_CHARS_PER_OUTPUT_TOKEN = 1.5;
export const MAX_OUTPUT_TOKEN_SAFETY_BUFFER = 1.3;

/** maxOutputTokens = ceil((maxChars / 1.5) * 1.3) */
export function resolveMaxOutputTokensForMaxChars(maxChars: number): number {
  return Math.ceil((maxChars / KOREAN_CHARS_PER_OUTPUT_TOKEN) * MAX_OUTPUT_TOKEN_SAFETY_BUFFER);
}

/** AI 답변 저장·수정 절대 상한 (recovery 포함) */
export const ABSOLUTE_MAX_RESPONSE_CHARS = 5000;

/** @deprecated TIER_2000_MAX_CHARS — 통합 tier는 UNIFIED_TIER_MAX_CHARS(5,000) 사용 */
export const TIER_2000_MAX_CHARS = ABSOLUTE_MAX_RESPONSE_CHARS;

const ABSOLUTE_MAX_OUTPUT_TOKENS = resolveMaxOutputTokensForMaxChars(ABSOLUTE_MAX_RESPONSE_CHARS);

/** 통합 분량 — 통과 최소 (출력 표시 글자수) */
export const UNIFIED_TIER_MIN_CHARS = 2700;
/** 통합 분량 — 저장·스트림 상한 */
export const UNIFIED_TIER_MAX_CHARS = ABSOLUTE_MAX_RESPONSE_CHARS;
/** 프롬프트 aim band 하한 (= 통과 최소) */
export const UNIFIED_TIER_TARGET_RANGE_MIN_CHARS = UNIFIED_TIER_MIN_CHARS;
/** 프롬프트 soft aim target · DB normalize 기본값 */
export const UNIFIED_TIER_AIM_CHARS = 3000;
export const UNIFIED_RESPONSE_LENGTH_TARGET = UNIFIED_TIER_AIM_CHARS;
export type ResponseLengthTierTarget = typeof UNIFIED_RESPONSE_LENGTH_TARGET;

/** tier별 역산 추정치 — 진단·배경 작업용 (RP API max_tokens cap 아님) */
export const TARGET_LENGTH_TO_MAX_OUTPUT_TOKENS: Record<ResponseLengthTierTarget, number> = {
  [UNIFIED_RESPONSE_LENGTH_TARGET]: ABSOLUTE_MAX_OUTPUT_TOKENS,
};

/** AI 출력 목표 분량 — 단일 tier (최소 2,700 · 목표 3,000 · 최대 5,000자) */
export const TARGET_RESPONSE_TIERS = [
  {
    id: "unified",
    label: "2,700~5,000자",
    min: UNIFIED_TIER_MIN_CHARS,
    max: UNIFIED_TIER_MAX_CHARS,
    target: UNIFIED_RESPONSE_LENGTH_TARGET,
  },
] as const;

export type ResponseLengthTierId = (typeof TARGET_RESPONSE_TIERS)[number]["id"];

/** 유저 AI 출력 목표 — 통합 tier (레거시 2000/3000 DB값은 normalize) */
export const DEFAULT_TARGET_RESPONSE_CHARS = UNIFIED_RESPONSE_LENGTH_TARGET;
export const MIN_TARGET_RESPONSE_CHARS = UNIFIED_TIER_MIN_CHARS;
export const MAX_TARGET_RESPONSE_CHARS = UNIFIED_TIER_MAX_CHARS;

export type ResponseLengthTarget = {
  /** Tier key for token maps / minimum tables */
  target: ResponseLengthTierTarget;
  /** Normalized user aim (characters) — prompt TARGET line */
  aimChars: number;
  min: number;
  max: number;
  hardMax: number;
};

const TIER_BOUNDS: Record<
  ResponseLengthTierTarget,
  Pick<ResponseLengthTarget, "min" | "max" | "hardMax">
> = {
  [UNIFIED_RESPONSE_LENGTH_TARGET]: {
    min: UNIFIED_TIER_MIN_CHARS,
    max: UNIFIED_TIER_MAX_CHARS,
    hardMax: UNIFIED_TIER_MAX_CHARS,
  },
};

export function normalizeTargetResponseChars(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_TARGET_RESPONSE_CHARS;
  const rounded = Math.round(n);
  if (rounded === 2000 || rounded === 3000) return UNIFIED_RESPONSE_LENGTH_TARGET;
  return Math.min(
    UNIFIED_TIER_AIM_CHARS,
    Math.max(MIN_TARGET_RESPONSE_CHARS, rounded)
  );
}

export function findResponseLengthTier(targetInput?: number | null) {
  void targetInput;
  return TARGET_RESPONSE_TIERS[0]!;
}

export function resolveResponseLengthTarget(targetInput?: number | null): ResponseLengthTarget {
  const target = UNIFIED_RESPONSE_LENGTH_TARGET;
  const aimChars = normalizeTargetResponseChars(targetInput);
  return {
    target,
    aimChars,
    ...TIER_BOUNDS[target],
  };
}

/** 이보다 짧으면 MAX_TOKENS 등 비정상 종료로 보고 폴백 */
export const CATASTROPHIC_MIN_RESPONSE_CHARS = 80;

/** AI 답변 본문 길이 표시 — RP 순수 글자수만 (HTML·티어 라벨 제외) */
export function formatAssistantLengthLabel(
  charCount: number,
  _targetInput?: number | null
): string {
  return `${charCount.toLocaleString()}자`;
}
