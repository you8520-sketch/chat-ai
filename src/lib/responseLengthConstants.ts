/** Client-safe response length constants — no chatDisplayLength / server DB deps */

/** Korean output ~1.5 chars/token — 진단·역산용 (RP API max_tokens cap 아님) */
export const KOREAN_CHARS_PER_OUTPUT_TOKEN = 1.5;

/** 채팅 UI — 어시스트 메시지 수동 편집 maxLength (AI 생성·저장 분량 cap 아님) */
export const ASSISTANT_MESSAGE_EDIT_MAX_CHARS = 5000;

/** 통합 분량 — 통과 최소 (출력 표시 글자수) */
export const UNIFIED_TIER_MIN_CHARS = 2700;
/** 프롬프트 aim band 하한 (= 통과 최소) */
export const UNIFIED_TIER_TARGET_RANGE_MIN_CHARS = UNIFIED_TIER_MIN_CHARS;
/** 프롬프트 soft aim target · DB normalize 기본값 (MINIMUM_FLOOR와 분리) */
export const UNIFIED_TIER_AIM_CHARS = 3200;
export const UNIFIED_RESPONSE_LENGTH_TARGET = UNIFIED_TIER_AIM_CHARS;
export type ResponseLengthTierTarget = typeof UNIFIED_RESPONSE_LENGTH_TARGET;

/** AI 출력 목표 분량 — 단일 tier (최소 2,700 · 목표 3,200 · 상한 없음·과금은 실제 출력) */
export const TARGET_RESPONSE_TIERS = [
  {
    id: "unified",
    label: "목표 3,200자 · 최소 2,700자",
    min: UNIFIED_TIER_MIN_CHARS,
    target: UNIFIED_RESPONSE_LENGTH_TARGET,
  },
] as const;

export type ResponseLengthTierId = (typeof TARGET_RESPONSE_TIERS)[number]["id"];

/** 유저 AI 출력 목표 — 통합 tier (레거시 DB·prefs 값은 normalize 시 3,200으로 통일) */
export const DEFAULT_TARGET_RESPONSE_CHARS = UNIFIED_RESPONSE_LENGTH_TARGET;
export const MIN_TARGET_RESPONSE_CHARS = UNIFIED_TIER_MIN_CHARS;

export type ResponseLengthTarget = {
  /** Tier key for minimum tables */
  target: ResponseLengthTierTarget;
  /** Prompt TARGET line — always UNIFIED_TIER_AIM_CHARS (3,200) */
  aimChars: number;
  /** 통과 최소 (MINIMUM_FLOOR) */
  min: number;
};

const TIER_BOUNDS: Record<ResponseLengthTierTarget, Pick<ResponseLengthTarget, "min">> = {
  [UNIFIED_RESPONSE_LENGTH_TARGET]: {
    min: UNIFIED_TIER_MIN_CHARS,
  },
};

/** 레거시 2000/2400/2700/2800/3000 등 — 프롬프트·과금 분량 목표는 항상 3,200으로 통일 */
export function normalizeTargetResponseChars(_value: unknown): number {
  return UNIFIED_TIER_AIM_CHARS;
}

export function findResponseLengthTier(_targetInput?: number | null) {
  return TARGET_RESPONSE_TIERS[0]!;
}

export function resolveResponseLengthTarget(_targetInput?: number | null): ResponseLengthTarget {
  const target = UNIFIED_RESPONSE_LENGTH_TARGET;
  return {
    target,
    aimChars: UNIFIED_TIER_AIM_CHARS,
    ...TIER_BOUNDS[target],
  };
}

/** 이보다 짧으면 MAX_TOKENS 등 비정상 종료로 보고 폴백 */
export const CATASTROPHIC_MIN_RESPONSE_CHARS = 80;

/** AI 응답 본문 길이 표시 — RP 표시 글자수(HTML·코드 라벨 제외) */
export function formatAssistantLengthLabel(
  charCount: number,
  _targetInput?: number | null
): string {
  return `${charCount.toLocaleString()}자`;
}
