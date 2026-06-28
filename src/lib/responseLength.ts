import { detectCharStutter } from "./antiRepetition";
import { isDegenerateOutput, isHealthyKoreanNarrative } from "./gibberishGuard";
import {
  extractUniqueRecoveryTail,
  isRecoveryEchoMerge,
} from "./antiRepetition";
import {
  peelIncompleteTailForLengthCap,
} from "./statusWindowTemplate";
import { RECOVERY_SUB_CALLS_ENABLED } from "./turnApiBudget";
import { visibleAssistantDisplayCharCount, visibleAssistantDisplayText } from "./chatDisplayLength";
import { visibleAssistantDisplayKoreanWordCount } from "./koreanWordCount";
import type { BilingualDialoguePolicy } from "@/lib/bilingualDialoguePolicy";
import { buildLangCriticalRule } from "@/lib/bilingualDialoguePolicy";
import { isDeepSeekV4ProModel, isGemini31ProModel, isQwenModel } from "@/lib/chatModels";
import { NO_INPUT_ECHO_RULE } from "@/lib/sceneExpansionPolicy";
import { buildTurnHandoffAndPacingBlock, SCENE_CONTINUATION_PRIORITY_BLOCK } from "./turnHandoffAndPacing";
export * from "./responseLengthConstants";
import {
  ABSOLUTE_MAX_RESPONSE_CHARS,
  CATASTROPHIC_MIN_RESPONSE_CHARS,
  DEFAULT_TARGET_RESPONSE_CHARS,
  KOREAN_CHARS_PER_OUTPUT_TOKEN,
  MAX_OUTPUT_TOKEN_SAFETY_BUFFER,
  resolveMaxOutputTokensForMaxChars,
  resolveResponseLengthTarget,
  TARGET_LENGTH_TO_MAX_OUTPUT_TOKENS,
  type ResponseLengthTarget,
  type ResponseLengthTierId,
  type ResponseLengthTierTarget,
  UNIFIED_RESPONSE_LENGTH_TARGET,
  UNIFIED_TIER_AIM_CHARS,
  UNIFIED_TIER_MAX_CHARS,
  UNIFIED_TIER_MIN_CHARS,
  UNIFIED_TIER_TARGET_RANGE_MIN_CHARS,
} from "./responseLengthConstants";

/** 상태창 tail(<<<STATUS_VALUES>>> 등) 스트림 예약 — narrative cap = tier max − reserve */
export const STATUS_WINDOW_STREAM_RESERVE_CHARS = 750;

/** @deprecated STATUS_WINDOW_STREAM_RESERVE_CHARS */
export const STATUS_WINDOW_STREAM_RESERVE = STATUS_WINDOW_STREAM_RESERVE_CHARS;

/** @deprecated 하이브리드 — narrative 분리 cap 폐지, tier hardMax(=resolveStreamCharCap)만 사용 */
export function resolveNarrativeStreamCharCap(targetInput?: number | null): number {
  return resolveStreamCharCap(targetInput);
}

export type StreamLengthCapOptions = {
  /** HTML 상태창 tail — 미완성 태그 peel */
  allowHtml?: boolean;
  /** 상태창 tail 공간 확보 — narrative cap에서 reserve 차감 */
  reserveStatusTail?: boolean;
  /** Flash ```html 블록 부착 공간 — narrative cap에서 reserve 차감 */
  reserveHtmlFlashChars?: number;
  /** Claude+상태창 원패스 — 스트림 중 LENGTH_CAP 비활성 (저장 직전 clamp만) */
  disableLengthCap?: boolean;
};

/** @deprecated IMMERSIVE 더 이상 maxOutputTokens 가산 없음 */
export const IMMERSIVE_MAX_TOKEN_MULTIPLIER = 1;

/** @deprecated IMMERSIVE_3000_MAX_OUTPUT_TOKENS 사용 */
export const IMMERSIVE_3500_MAX_OUTPUT_TOKENS = Math.round(
  TARGET_LENGTH_TO_MAX_OUTPUT_TOKENS[UNIFIED_RESPONSE_LENGTH_TARGET] * IMMERSIVE_MAX_TOKEN_MULTIPLIER
);

/** @deprecated 레거시 명칭 — 통합 tier */
export const IMMERSIVE_3000_MAX_OUTPUT_TOKENS = IMMERSIVE_3500_MAX_OUTPUT_TOKENS;

/** @deprecated TARGET_RESPONSE_TIERS[].target 사용 */
export const TARGET_RESPONSE_PRESETS = [UNIFIED_RESPONSE_LENGTH_TARGET];

/** @deprecated ABSOLUTE_MAX_RESPONSE_CHARS 사용 */
export const MAX_RESPONSE_CHARS = ABSOLUTE_MAX_RESPONSE_CHARS;

/** @deprecated resolveTierMinimumRequired — 통과 최소 2,200자 */
export const TARGET_RESPONSE_CHARS_MIN = UNIFIED_TIER_MIN_CHARS;
/** @deprecated ABSOLUTE_MAX_RESPONSE_CHARS 사용 */
export const TARGET_RESPONSE_CHARS_MAX = ABSOLUTE_MAX_RESPONSE_CHARS;

/** 이보다 짧으면 MAX_TOKENS 등 비정상 종료로 보고 폴백 */
export const MIN_COMPLETE_RESPONSE_CHARS = 900;

/** tier meaningful RP prose floor — 조기 STOP 방지 (프롬프트·내부 검증) */
export const TIER_CONTENT_FLOOR: Record<ResponseLengthTierTarget, number> = {
  [UNIFIED_RESPONSE_LENGTH_TARGET]: UNIFIED_TIER_MIN_CHARS,
};

export function resolveTierContentFloor(_target: ResponseLengthTierTarget): number {
  return TIER_CONTENT_FLOOR[UNIFIED_RESPONSE_LENGTH_TARGET];
}

/** tier target → 통과 최소 글자 수 */
export const TIER_MINIMUM_REQUIRED: Record<ResponseLengthTierTarget, number> = {
  [UNIFIED_RESPONSE_LENGTH_TARGET]: UNIFIED_TIER_MIN_CHARS,
};

/** tier target → 통과 최소 한글 단어 수 (미사용 — 글자 minimum만) */
export const TIER_MINIMUM_KOREAN_WORDS: Record<ResponseLengthTierTarget, number> = {
  [UNIFIED_RESPONSE_LENGTH_TARGET]: 0,
};

export function resolveTierMinimumRequired(target: ResponseLengthTierTarget): number {
  return TIER_MINIMUM_REQUIRED[target];
}

export function resolveTierMinimumKoreanWords(target: ResponseLengthTierTarget): number {
  return TIER_MINIMUM_KOREAN_WORDS[target];
}

/** tier 통과 — 글자 minimum */
export function meetsTierLengthRequirements(
  text: string,
  targetInput?: number | null
): { ok: boolean; charCount: number; wordCount: number; minChars: number; minWords: number } {
  const tier = resolveResponseLengthTarget(targetInput).target;
  const minChars = resolveTierMinimumRequired(tier);
  const minWords = resolveTierMinimumKoreanWords(tier);
  const charCount = visibleAssistantDisplayCharCount(text);
  const wordCount = visibleAssistantDisplayKoreanWordCount(text);
  const wordsOk = minWords <= 0 || wordCount >= minWords;
  return {
    ok: charCount >= minChars && wordsOk,
    charCount,
    wordCount,
    minChars,
    minWords,
  };
}

/** tier 통과 최소 미달 — 글자 또는 한글 단어 (1-pass: 서버 recovery 없음) */
export function isBelowTierLengthRequirements(text: string, targetInput?: number | null): boolean {
  return !meetsTierLengthRequirements(text, targetInput).ok;
}

/** tier별 AI 권장 목표 글자 수 (프롬프트 soft aim) */
export function resolveTierAimTarget(_target: ResponseLengthTierTarget): number {
  return UNIFIED_TIER_AIM_CHARS;
}

/** tier별 프롬프트 aim band 하한 (상한 = resolveTierAimTarget) */
export function resolveTierTargetRangeMin(_target: ResponseLengthTierTarget): number {
  return UNIFIED_TIER_TARGET_RANGE_MIN_CHARS;
}

/** tier 통과 최소 output tokens (내부 — UI는 글자수 유지) */
export function resolveTierMinimumOutputTokens(_target: ResponseLengthTierTarget): number {
  return Math.ceil(UNIFIED_TIER_MIN_CHARS / KOREAN_CHARS_PER_OUTPUT_TOKEN);
}

export function snapToResponseLengthTarget(_value: number): ResponseLengthTierTarget {
  return UNIFIED_RESPONSE_LENGTH_TARGET;
}

export type LengthInstructionOpts = {
  /** true — 상태창 규칙은 STATE WINDOW POLICY / Flash firewall에만; LENGTH LIMIT에서 생략 */
  statusWindowEveryTurn?: boolean;
  /** true — OpenRouter Flash firewall이 상태창·HTML 소유; LENGTH LIMIT status line 생략 */
  htmlFlashOwned?: boolean;
  /** true — [SCENE EXPANSION BLUEPRINT] 등은 prose bundle에 있음; verbatim 중복 생략 */
  proseStylePolicyOwnsSceneExpansion?: boolean;
  /** true — 제작자 상태창 위젯; prose 분량과 <<<STATUS_VALUES>>> tail 분리 */
  statusWidgetActive?: boolean;
};

const LENGTH_LIMIT_STATUS_LINE_OOC =
  "- RP length = prose/dialogue only; status blocks follow STATE WINDOW POLICY";

function buildLengthLimitStatusLine(opts?: LengthInstructionOpts): string {
  if (opts?.statusWindowEveryTurn || opts?.htmlFlashOwned) return "";
  return `\n${LENGTH_LIMIT_STATUS_LINE_OOC}`;
}

function buildJsonStatusLengthLine(opts?: LengthInstructionOpts): string {
  if (opts?.statusWidgetActive) {
    return "";
  }
  return "";
}

function assembleLengthInstructionBlock(
  targetInput?: number | null,
  opts?: LengthInstructionOpts
): string {
  const t = resolveResponseLengthTarget(targetInput);
  const jsonOrStatusLine = buildJsonStatusLengthLine(opts);

  return `[LENGTH CONTROL & SCENE EXPANSION]
TARGET_LENGTH: ${t.aimChars.toLocaleString()}+ 한국어 글자
MINIMUM_FLOOR: ${t.min.toLocaleString()}+

${NO_INPUT_ECHO_RULE}

- 짧은 유저 입력에 동조(Mirroring) 금지 — 장문 출력
- 문단: 최소 8~10개 이상의 긴 문단
- 묘사: 대사 1줄당 감정·표정·환경·행동 반응 4~5줄+ 확장

${SCENE_CONTINUATION_PRIORITY_BLOCK}${jsonOrStatusLine}`;
}

/**
 * @deprecated Merged into [LENGTH CONTROL & SCENE EXPANSION] — kept for audit script compatibility.
 */
export function buildTerminalLengthOverrideRecencyBlock(): string {
  return "";
}

/** @deprecated use buildTerminalLengthOverrideRecencyBlock — hardcoded numerics removed (Phase 13 dedup) */
export const TERMINAL_LENGTH_OVERRIDE_BLOCK = "";

export function buildTerminalLengthOverrideBlock(): string {
  return buildTurnHandoffAndPacingBlock();
}

/** 모든 모델 공통 — LENGTH CONTROL + TARGET/FLOOR (자동진행·재생성 포함 단일 출처) */
export function buildLengthInstruction(
  targetInput?: number | null,
  opts?: LengthInstructionOpts
): string {
  return assembleLengthInstructionBlock(targetInput, opts);
}

/** 프롬프트 주입용 tier target (통합 2,400 soft aim) */
export function resolveTargetLengthForPrompt(targetInput?: number | null): number {
  return resolveResponseLengthTarget(targetInput).aimChars;
}

export function logLengthAudit(opts: {
  targetInput?: number | null;
  actualChars: number;
  truncationRecoveryTriggered?: boolean;
  underLengthRecoveryTriggered?: boolean;
  lengthRecoveryPasses?: number;
  maxOutputTokens?: number;
  promptLengthRuleCount?: number;
}): void {
  const t = resolveResponseLengthTarget(opts.targetInput);
  const minimum = resolveTierMinimumRequired(t.target);
  const within = opts.actualChars >= minimum && opts.actualChars <= t.max;
  const inflatedBy: string[] = [];

  if (!within && opts.actualChars > t.hardMax) {
    if (opts.underLengthRecoveryTriggered) inflatedBy.push("under-length-recovery");
    if (opts.truncationRecoveryTriggered) inflatedBy.push("truncation-recovery");
    if ((opts.promptLengthRuleCount ?? 1) > 1) {
      inflatedBy.push(`duplicate-length-prompts×${opts.promptLengthRuleCount}`);
    }
    const cap = TARGET_LENGTH_TO_MAX_OUTPUT_TOKENS[t.target];
    if (opts.maxOutputTokens != null && opts.maxOutputTokens > cap) {
      inflatedBy.push(`maxOutputTokens=${opts.maxOutputTokens} (cap=${cap})`);
    }
    if (inflatedBy.length === 0) inflatedBy.push("model-exceeded-max");
  }

  console.log("[LENGTH AUDIT]", {
    target: t.target,
    minimum_required: minimum,
    actual_chars: opts.actualChars,
    allowed_range: `${minimum}~${t.max}`,
    within_range: within,
    ...(opts.lengthRecoveryPasses != null && opts.lengthRecoveryPasses > 0
      ? { length_recovery_passes: opts.lengthRecoveryPasses }
      : {}),
    ...(inflatedBy.length > 0 ? { inflated_by: inflatedBy } : {}),
  });
}

export type GenerationFailureReason = "safety" | "content_filter" | "under_length";

const GENERATION_FAILURE_USER_MESSAGE =
  "AI가 묘사 수위 조절에 실패하여 생성이 중단되었습니다. 대화 방향을 살짝 바꿔서 다시 시도해 주세요.";

export function generationFailureUserMessage(reason?: GenerationFailureReason | null): string {
  if (reason === "under_length") {
    return "AI 응답이 비정상적으로 짧거나 비어 있어 저장하지 않았습니다. 포인트는 차감되지 않습니다. 다시 시도해 주세요.";
  }
  return GENERATION_FAILURE_USER_MESSAGE;
}

/** @deprecated generationFailureUserMessage 사용 */
export function adultGenerationFailureUserMessage(_reason: GenerationFailureReason | null): string {
  return generationFailureUserMessage();
}

/** 19+ OpenRouter — 빈 응답·명시적 필터 (분량 미달 가드는 디버깅용 임시 OFF) */
export const ADULT_MIN_RESPONSE_CHARS = 80;

/** false = «너무 짧음» 조기 종료 비활성 (외계어·루프 차단은 유지) */
export const ADULT_SHORT_RESPONSE_GUARD_ENABLED = process.env.ADULT_SHORT_RESPONSE_GUARD_ENABLED === "true";

/** LOOP_ABORT 후 저장 허용 최소 (정상 한국어 RP 조각) */
export const ADULT_LOOP_PARTIAL_MIN_CHARS = 80;

/** tier minimum 미달이어도 저장 허용 — 1-pass·후처리 후 건강한 한국어 RP */
/** @deprecated resolveTierMinimumRequired — 통과 최소 2,000자 */
export const SUBSTANTIAL_HEALTHY_RP_MIN_CHARS = UNIFIED_TIER_MIN_CHARS;

/** tier·과금·UI — HTML 코드 제외 표시 글자수 */
export function resolveVisibleTierCharCount(text: string): number {
  return visibleAssistantDisplayCharCount(text);
}

/** tier minimum 미달이어도 저장·과금 허용 (1-pass — 건강한 한국어 RP) */
export function passesUnderLengthSaveSoftPass(
  fullText: string,
  narrativeBody: string,
  targetInput?: number | null
): boolean {
  const visibleFull = visibleAssistantDisplayCharCount(fullText);
  const visibleBody =
    narrativeBody.trim().length > 0
      ? visibleAssistantDisplayCharCount(narrativeBody)
      : visibleFull;
  const prose = visibleAssistantDisplayText(
    narrativeBody.trim().length > 0 ? narrativeBody : fullText
  );
  const full = visibleAssistantDisplayText(fullText);
  if (!prose && !full) return false;

  const t = resolveResponseLengthTarget(targetInput);
  const softMin = Math.round(resolveTierMinimumRequired(t.target) * 0.85);
  const softMinWords = Math.round(resolveTierMinimumKoreanWords(t.target) * 0.85);
  const wordCount = visibleAssistantDisplayKoreanWordCount(
    narrativeBody.trim().length > 0 ? narrativeBody : fullText
  );
  const hasStatusTable = /\| 항목 \| 내용 \|/.test(fullText);

  if (
    visibleBody >= softMin &&
    wordCount >= softMinWords &&
    endsAtCompleteSentence(prose) &&
    isHealthyKoreanNarrative(prose)
  ) {
    return true;
  }

  if (
    hasStatusTable &&
    visibleFull >= softMin &&
    wordCount >= softMinWords &&
    endsAtCompleteSentence(prose || full) &&
    isHealthyKoreanNarrative(prose.length >= 80 ? prose : full)
  ) {
    return true;
  }

  return false;
}

/** 이 미만이면 생성 실패·과금 면제·자동 환불 대상 (캐릭터명 prefill만 남은 경우 등) */
export function isCatastrophicallyShortResponse(
  text: string,
  targetInput?: number | null
): boolean {
  const t = text.trim();
  if (t.length === 0) return true;
  const visibleLen = resolveVisibleTierCharCount(text);
  if (visibleLen < CATASTROPHIC_MIN_RESPONSE_CHARS) return true;
  if (targetInput != null) {
    const { min } = resolveResponseLengthTarget(targetInput);
    if (visibleLen < Math.max(CATASTROPHIC_MIN_RESPONSE_CHARS, Math.round(min * 0.06))) {
      return true;
    }
  }
  return false;
}

export function detectAdultGenerationFailure(
  finishReason: string | undefined,
  text: string,
  targetInput?: number | null,
  /** When set, tier check uses this; else visible display text (HTML code excluded) */
  narrativeBody?: string | null
): GenerationFailureReason | null {
  const r = (finishReason ?? "").toUpperCase();
  if (r === "SAFETY" || r === "SAFETY_BLOCK" || r === "RECITATION" || r === "PROHIBITED_CONTENT") {
    return "safety";
  }
  if (r === "CONTENT_FILTER" || r === "BLOCKED" || r === "BLOCKLIST") {
    return "content_filter";
  }

  const trimmed = text.trim();
  const lengthText =
    narrativeBody?.trim() ||
    visibleAssistantDisplayText(trimmed);
  const visibleLen = lengthText.length;
  if (isCatastrophicallyShortResponse(lengthText, targetInput)) {
    return "under_length";
  }

  /** 1-pass mode — tier 미달·상태창 누락도 저장 (recovery API 없음) */
  if (!RECOVERY_SUB_CALLS_ENABLED) {
    return null;
  }

  const t = resolveResponseLengthTarget(targetInput);
  const tierMinimum = resolveTierMinimumRequired(t.target);
  const tierMinWords = resolveTierMinimumKoreanWords(t.target);
  const wordCount = visibleAssistantDisplayKoreanWordCount(lengthText);
  if (visibleLen < tierMinimum || wordCount < tierMinWords) {
    if (passesUnderLengthSaveSoftPass(trimmed, lengthText, targetInput)) {
      return null;
    }
    if (
      visibleLen >= SUBSTANTIAL_HEALTHY_RP_MIN_CHARS &&
      isHealthyKoreanNarrative(lengthText)
    ) {
      return null;
    }
    return "under_length";
  }
  return null;
}

/** finish_reason·출력 길이 — tier 최소 미달이면 실패 (STOP·완결 문장 예외 없음) */
export function detectGenerationFailure(
  finishReason: string | undefined,
  text: string,
  targetInput?: number | null
): GenerationFailureReason | null {
  return detectAdultGenerationFailure(finishReason, text, targetInput);
}

/** @deprecated maxAdultContinuationPasses — under-length recovery in stream layer */
export function maxAdultContinuationPasses(
  _text: string,
  _finishReason: string | undefined,
  _targetInput?: number | null
): number {
  return 0;
}

/** 스트리밍 중 절대 넘기지 않을 글자 상한 (tier max) */
export function resolveStreamCharCap(targetInput?: number | null): number {
  return resolveResponseLengthTarget(targetInput).max;
}

/** @deprecated buildLangCriticalRule() */
export const KOREAN_ONLY_RULE = buildLangCriticalRule();

/** HTML 상태창 활성 시 HTML 금지 문구 완화 */
export function buildKoreanOnlyRule(opts?: {
  allowStatusHtml?: boolean;
  bilingual?: BilingualDialoguePolicy;
}): string {
  return buildLangCriticalRule(opts);
}

/** tier max 초과 */
export function isOverResponseTarget(text: string, targetInput?: number | null): boolean {
  const t = resolveResponseLengthTarget(targetInput);
  const len = text.trim().length;
  return len > t.max;
}

/** 목표 분량(min) 미달 — tier minimum required 기준 */
export function isUnderResponseTarget(text: string, targetInput?: number | null): boolean {
  return needsUnderLengthRecovery(text, targetInput);
}

/** truncation·미완결만 — 분량 미달(under-length)은 1-pass로 recovery 없음 */
export function needsResponseLengthFix(
  text: string,
  finishReason?: string,
  targetInput?: number | null
): boolean {
  if (needsTruncationRecovery(text, finishReason, targetInput)) return true;
  if (endsIncomplete(text)) return true;
  if (isTokenLimitFinish(finishReason)) return true;
  return false;
}

export const STREAM_LENGTH_CAP_FINISH = "LENGTH_CAP";

export function isStreamLengthCapFinish(finishReason?: string): boolean {
  return (finishReason ?? "").toUpperCase() === STREAM_LENGTH_CAP_FINISH;
}

export function isTokenLimitFinish(finishReason?: string): boolean {
  if (!finishReason) return false;
  const r = finishReason.toUpperCase();
  return (
    r === "MAX_TOKENS" ||
    r === "LENGTH" ||
    r === "MAX_OUTPUT_TOKENS" ||
    r === "TOKEN_LIMIT" ||
    r === STREAM_LENGTH_CAP_FINISH
  );
}

function isNaturalStopFinish(finishReason?: string): boolean {
  if (!finishReason) return false;
  const r = finishReason.toUpperCase();
  return r === "STOP" || r === "END_TURN";
}

/** stop 또는 완결 문장 — 분량 미달이어도 이어쓰기·경고 스킵 */
export function isResponseNaturallyComplete(text: string, finishReason?: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (isTokenLimitFinish(finishReason)) return false;
  if (endsIncomplete(trimmed)) return false;
  if (hasUnclosedQuotation(trimmed)) return false;
  if (isNaturalStopFinish(finishReason) && endsAtCompleteSentence(trimmed)) return true;
  return endsAtCompleteSentence(trimmed);
}

/** 이어쓰기 모드 — 문장 마무리 (MAX_TOKENS 잘림 전용) */
export type ResponseContinuationMode = "complete";

export function resolveResponseContinuationMode(
  _text: string,
  _finishReason?: string,
  _targetInput?: number | null
): ResponseContinuationMode | null {
  return null;
}

/** 서버 자동 이어쓰기 — 영구 비활성 (캐시 파괴·다중 API 호출·과금 폭증 방지) */
export const AUTO_CONTINUATION_ENABLED = false;

/** 이어쓰기 비활성 — 단일 길이 규칙 + maxOutputTokens만 사용 */
export const MAX_RESPONSE_CONTINUATION_PASSES = 0;

/** @deprecated MAX_RESPONSE_CONTINUATION_PASSES와 동일 — 레거시 호환 */
export const MAX_TRUNCATION_AUTO_CONTINUATIONS = 0;

/** 생성 결과가 토큰 상한·미완결로 잘린 것으로 보이는지 */
export type TruncationCheckOpts = {
  allowHtml?: boolean;
  templateLabels?: string[];
};

export function narrativeProseForHealthCheck(text: string, opts?: TruncationCheckOpts): string {
  return peelIncompleteTailForLengthCap(text.trim(), { allowHtml: opts?.allowHtml }).trim();
}

export function detectProbableOutputTruncation(
  text: string,
  finishReason?: string,
  targetInput?: number | null,
  opts?: TruncationCheckOpts
): boolean {
  const prose = narrativeProseForHealthCheck(text, opts);
  if (!prose) return true;
  if (isStreamLengthCapFinish(finishReason)) {
    const minimum = resolveTierMinimumRequired(resolveResponseLengthTarget(targetInput).target);
    if (prose.length >= minimum && endsAtCompleteSentence(prose)) {
      return false;
    }
    return true;
  }
  if (isTokenLimitFinish(finishReason)) return true;
  if (endsIncomplete(prose)) return true;
  if (hasUnclosedQuotation(prose)) return true;
  if (!endsAtCompleteSentence(prose)) return true;
  return false;
}

/** 이어쓰기(append)가 필요한지 — AUTO_CONTINUATION_ENABLED=false 이면 항상 false */
export function needsResponseContinuation(
  text: string,
  finishReason?: string,
  targetInput?: number | null
): boolean {
  if (!AUTO_CONTINUATION_ENABLED) return false;
  return resolveResponseContinuationMode(text, finishReason, targetInput) != null;
}

/** 분량·미완결에 따라 허용할 이어쓰기 횟수 (최대 MAX_RESPONSE_CONTINUATION_PASSES) */
export function maxContinuationPasses(
  text: string,
  finishReason?: string,
  targetInput?: number | null
): number {
  if (!needsResponseContinuation(text, finishReason, targetInput)) return 0;
  return MAX_RESPONSE_CONTINUATION_PASSES;
}

/** Gemini 3.1 Pro OpenRouter — reasoning+prose shared pool */
export const OPENROUTER_GEMINI_31_PRO_MAX_OUTPUT_TOKENS = 8192;

/** Qwen / DeepSeek / default RP — tier max (5,000자 역산 ≈ 4,334) */
export function resolveOpenRouterTierMaxOutputTokens(): number {
  return TARGET_LENGTH_TO_MAX_OUTPUT_TOKENS[UNIFIED_RESPONSE_LENGTH_TARGET];
}

/** @deprecated OPENROUTER_GEMINI_31_PRO_MAX_OUTPUT_TOKENS */
export const GEMINI_PRO_OPENROUTER_MAX_OUTPUT_TOKENS = OPENROUTER_GEMINI_31_PRO_MAX_OUTPUT_TOKENS;

/** @deprecated resolveOpenRouterTierMaxOutputTokens() */
export const OPENROUTER_RP_MAX_OUTPUT_TOKENS = OPENROUTER_GEMINI_31_PRO_MAX_OUTPUT_TOKENS;

/** 1회 출력 recency tail — LENGTH CONTROL + scene continuation */
export function buildSingleShotLengthReminder(_targetInput?: number | null): string {
  return `[분량 — 이번 턴 1회 출력]
MINIMUM_FLOOR 미달·조기 handoff 금지. [LENGTH CONTROL & SCENE EXPANSION] · [SCENE CONTINUATION PRIORITY] 준수.`;
}

/** 유저 메시지 하단 — recency bias로 분량 리마인더 주입 */
export function appendSingleShotLengthReminderToUserTurn(
  userContent: string,
  targetInput?: number | null
): string {
  const tail = buildSingleShotLengthReminder(targetInput);
  const body = userContent.trim();
  if (!body) return tail;
  if (body.includes("[분량 — 이번 턴 1회 출력]")) return body;
  return `${body}\n\n${tail}`;
}

export function resolveMaxOutputTokensForTarget(
  targetInput?: number | null,
  modelId?: string | null
): number {
  const model = modelId?.trim() ?? "";
  if (isGemini31ProModel(model)) {
    return OPENROUTER_GEMINI_31_PRO_MAX_OUTPUT_TOKENS;
  }
  if (model && (isDeepSeekV4ProModel(model) || isQwenModel(model))) {
    return resolveOpenRouterTierMaxOutputTokens();
  }
  if (model) {
    return resolveOpenRouterTierMaxOutputTokens();
  }
  const t = resolveResponseLengthTarget(targetInput ?? DEFAULT_TARGET_RESPONSE_CHARS);
  return TARGET_LENGTH_TO_MAX_OUTPUT_TOKENS[t.target];
}

/** 미완결 문장·토큰 상한(length) 잘림 — under-length recovery 이후에도 연쇄 가능 */
export function needsTruncationRecovery(
  text: string,
  finishReason?: string,
  targetInput?: number | null,
  opts?: TruncationCheckOpts
): boolean {
  if (!detectProbableOutputTruncation(text, finishReason, targetInput, opts)) return false;
  const r = (finishReason ?? "").toUpperCase();
  if (isTokenLimitFinish(finishReason)) return true;
  if (r === "STOP" || r === "END_TURN") return true;
  if (!r && endsIncomplete(narrativeProseForHealthCheck(text, opts))) return true;
  return false;
}

/** tier minimum 이상이면 truncation API recovery 생략 가능 — 단, 문장·상태창 미완이면 로컬/API 유지 */
export function shouldSkipTruncationApiRecovery(
  text: string,
  targetInput?: number | null,
  opts?: TruncationCheckOpts
): boolean {
  const prose = narrativeProseForHealthCheck(text, opts);
  if (!prose) return false;
  const minimum = resolveTierMinimumRequired(resolveResponseLengthTarget(targetInput).target);
  if (prose.length < minimum) return false;
  if (endsIncomplete(prose)) return false;
  if (!endsAtCompleteSentence(prose)) return false;
  return true;
}

/**
 * 분량이 충분할 때 미완결 tail을 마지막 완결 문장으로 정리 — API 재호출 없음.
 * @returns 정리된 텍스트, 또는 로컬 정리 불가 시 null
 */
export function repairTruncatedOutputLocally(
  text: string,
  targetInput?: number | null,
  finishReason?: string,
  opts?: { allowHtml?: boolean }
): string | null {
  const trimmed = peelIncompleteTailForLengthCap(text.trim(), opts);
  if (!trimmed) return null;
  if (!detectProbableOutputTruncation(trimmed, finishReason, targetInput)) return null;

  const minimum = resolveTierMinimumRequired(resolveResponseLengthTarget(targetInput).target);
  const cap = resolveResponseLengthTarget(targetInput).max;
  const breakAt = findLastSentenceBreakIndex(trimmed, Math.min(trimmed.length, cap));
  if (breakAt > 0) {
    const candidate = trimmed.slice(0, breakAt).trimEnd();
    if (
      candidate.length >= minimum &&
      !detectProbableOutputTruncation(candidate, finishReason, targetInput)
    ) {
      return candidate;
    }
  }

  const clamped = clampResponseLength(trimmed, targetInput);
  if (
    clamped.length >= minimum &&
    !detectProbableOutputTruncation(clamped, finishReason, targetInput)
  ) {
    return clamped;
  }

  return null;
}

/** tier minimum required 미달 — STOP이어도 recovery */
export type LengthRecoveryOpts = {
  /** API usage.output_tokens — 글자수와 함께 통과 판정 */
  outputTokens?: number;
};

export function meetsTierMinimumRequired(
  text: string,
  targetInput?: number | null,
  _opts?: LengthRecoveryOpts
): boolean {
  const visibleLen = resolveVisibleTierCharCount(text);
  if (visibleLen <= 0) return false;
  const minimum = resolveTierMinimumRequired(resolveResponseLengthTarget(targetInput).target);
  return visibleLen >= minimum;
}

/** UI=글자 · 엔진=토큰 — tier minimum 통과 (recovery/API 재호출 스킵) */
export function meetsTierPassCriteria(
  text: string,
  targetInput?: number | null,
  opts?: LengthRecoveryOpts
): boolean {
  if (meetsTierMinimumRequired(text, targetInput, opts)) return true;
  const tokens = opts?.outputTokens;
  if (tokens != null && tokens > 0) {
    const tier = resolveResponseLengthTarget(targetInput).target;
    const minTok = resolveTierMinimumOutputTokens(tier);
    const minimum = resolveTierMinimumRequired(tier);
    const visibleLen = resolveVisibleTierCharCount(text);
    const nearMinimum = visibleLen >= minimum * 0.95;
    if (
      nearMinimum &&
      tokens >= minTok &&
      visibleLen >= SUBSTANTIAL_HEALTHY_RP_MIN_CHARS &&
      isHealthyKoreanNarrative(visibleAssistantDisplayText(text))
    ) {
      return true;
    }
  }
  return false;
}

/**
 * UI 라벨(N자 이상) 기준 — 전체 길이(본문+상태창)가 tier target 이상이면 recovery·재출력 생략.
 * narrative만 target 미만이어도 상태창/HTML 때문에 그럴 수 있음.
 */
export function meetsVisibleTierSufficient(
  fullText: string,
  narrativeBody: string,
  targetInput?: number | null,
  opts?: LengthRecoveryOpts,
  truncationOpts?: TruncationCheckOpts
): boolean {
  void opts;
  void fullText;
  const tier = resolveResponseLengthTarget(targetInput);
  const prose = visibleAssistantDisplayText(
    narrativeBody.trim().length > 0 ? narrativeBody : fullText
  );
  const minimum = resolveTierMinimumRequired(tier.target);
  const visibleLen = prose.length;
  if (visibleLen < SUBSTANTIAL_HEALTHY_RP_MIN_CHARS) return false;
  if (!endsAtCompleteSentence(prose)) return false;
  if (!isHealthyKoreanNarrative(prose)) return false;
  if (visibleLen >= minimum) return true;
  if (visibleLen >= tier.aimChars) return true;
  return false;
}

/**
 * UI 약속(N자 이상) 충족 시 분량 API recovery 생략.
 * 내부 strict minimum(1,800/3,600) 미달이어도 본문이 UI 기준 이상·완결·건강하면 이어쓰기 금지.
 */
export function meetsTierSoftPassCriteria(
  text: string,
  targetInput?: number | null,
  opts?: LengthRecoveryOpts
): boolean {
  if (meetsTierPassCriteria(text, targetInput, opts)) return true;
  const tier = resolveResponseLengthTarget(targetInput);
  const visibleLen = resolveVisibleTierCharCount(text);
  const prose = visibleAssistantDisplayText(text);
  if (visibleLen < tier.aimChars) return false;
  if (visibleLen < SUBSTANTIAL_HEALTHY_RP_MIN_CHARS) return false;
  if (!endsAtCompleteSentence(prose)) return false;
  if (!isHealthyKoreanNarrative(prose)) return false;
  return true;
}

/** @deprecated 1-pass — recovery skip criteria 미사용 */
export function meetsTierRecoverySkipCriteria(
  text: string,
  targetInput?: number | null,
  truncationOpts?: TruncationCheckOpts
): boolean {
  const prose = narrativeProseForHealthCheck(text.trim(), truncationOpts);
  if (!prose) return false;
  const minimum = resolveTierMinimumRequired(resolveResponseLengthTarget(targetInput).target);
  return prose.length >= minimum && endsAtCompleteSentence(prose) && isHealthyKoreanNarrative(prose);
}

/** 분량 미달 — 1-pass legacy recovery 없음; server 85% gate는 별도 */
export function needsUnderLengthRecovery(
  _text: string,
  _targetInput?: number | null,
  _opts?: LengthRecoveryOpts,
  _truncationOpts?: TruncationCheckOpts,
  _fullTextForCloseEnough?: string
): boolean {
  return false;
}

/** Server-side recovery gate: clean stop below 85% of tier target. */
export const SERVER_UNDER_LENGTH_RECOVERY_THRESHOLD = 0.85;

export function resolveServerUnderLengthRecoveryFloor(
  targetInput?: number | null
): number {
  const target = resolveResponseLengthTarget(targetInput).target;
  return Math.floor(target * SERVER_UNDER_LENGTH_RECOVERY_THRESHOLD);
}

export function isCleanStopFinishReason(finishReason: string | undefined | null): boolean {
  const r = (finishReason ?? "").toLowerCase();
  return r === "stop" || r === "end_turn";
}

export function needsServerUnderLengthRecovery(
  text: string,
  finishReason: string | undefined | null,
  targetInput?: number | null
): boolean {
  if (!isCleanStopFinishReason(finishReason)) return false;
  const floor = resolveServerUnderLengthRecoveryFloor(targetInput);
  return visibleAssistantDisplayCharCount(text) < floor;
}

export function buildServerUnderLengthRecoveryUserMessage(): string {
  return `직전 응답이 목표 분량의 85% 미달로 종료됨. 같은 장면을 이어서, Scene Blueprint의 남은 phase(Sensory Shift, Internal Contradiction, Lingering Aftermath 중 미완료 항목)를 추가로 작성할 것. 새로운 사건을 시작하지 말고 현재 장면을 심화할 것.`;
}

/** @deprecated 1-pass — recovery user message 미사용 */
export function buildUnderLengthRecoveryUserMessage(): string {
  return "";
}

/** @deprecated 1-pass — recovery token 계산 미사용 */
export function resolveUnderLengthRecoveryMaxTokens(
  targetInput?: number | null
): number {
  return resolveMaxOutputTokensForTarget(targetInput);
}

/** @deprecated 1-pass — 분량 미달 이어쓰기 제거; truncation 문장 마무리만 */
export function buildContinuationUserMessage(
  t: ResponseLengthTarget,
  currentLen: number
): string {
  return buildSentenceCompletionUserMessage(t, currentLen);
}

/** MAX_TOKENS·미완결 시 짧게 이어써 마무리 */
export function buildSentenceCompletionUserMessage(t: ResponseLengthTarget, currentLen: number): string {
  const headroom = Math.max(0, t.hardMax - currentLen);
  return `[이어쓰기 — 문장 미완]
${currentLen.toLocaleString()}자에서 **문장·장면 중간**에 끊겼다.
직전 마지막 글자 **바로 다음**부터 1~3문장만 이어 써 자연스럽게 마무리한다.
새 전개·반복·요약 금지. **${t.hardMax.toLocaleString()}자를 넘기지 말 것** (남은 여유 ~${headroom.toLocaleString()}자).
절대 이전 텍스트를 반복(Echo)하지 마라. 쓰다 만 단어/글자의 **바로 다음**부터 즉시 시작하라.`;
}

export type RecoveryMergeOpts = {
  /** Claude recovery prefill — echo 판정 완화 */
  claudeRecovery?: boolean;
  /** Claude — recovery 병합·tail dedupe echo 폐기 완전 bypass */
  bypassEchoDiscard?: boolean;
};

/** @deprecated antiRepetition.stripDuplicateRecoveryPrefix 사용 */
export { stripDuplicateRecoveryPrefix } from "./antiRepetition";

/** recovery 병합 후 본문 에코면 recovery 폐기 */
export function finalizeRecoveryMerge(
  priorText: string,
  mergedText: string,
  opts?: RecoveryMergeOpts
): string {
  if (opts?.bypassEchoDiscard) {
    return mergedText.trim().length > priorText.trim().length ? mergedText : priorText.trim();
  }
  if (isRecoveryEchoMerge(priorText, mergedText, opts)) {
    return priorText.trim();
  }
  return mergedText;
}

/** recovery 이어쓰기 누적 — 절대 상한 초과 방지 */
export function capRecoveryContinuation(
  priorText: string,
  continuation: string,
  targetInput?: number | null,
  opts?: RecoveryMergeOpts
): string {
  const deduped = extractUniqueRecoveryTail(priorText, continuation, {
    claudeRecovery: opts?.claudeRecovery,
  });
  const t = resolveResponseLengthTarget(targetInput);
  const merged = priorText + deduped;
  if (merged.length <= t.hardMax) return deduped;
  const capped = clampResponseLength(merged, targetInput);
  return capped.slice(priorText.length);
}

const CLOSING_QUOTES = `"'"」』)]`;

/** 열린 따옴표·괄호가 닫히지 않았는지 */
function hasUnclosedQuotation(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const doubleQuotes = (trimmed.match(/"/g) ?? []).length;
  if (doubleQuotes % 2 !== 0) return true;
  const singleQuotes = (trimmed.match(/'/g) ?? []).length;
  if (singleQuotes % 2 !== 0) return true;
  if (/「[^」]*$/.test(trimmed)) return true;
  if (/『[^』]*$/.test(trimmed)) return true;
  if (/[\[(][^\])]*$/.test(trimmed)) return true;
  return false;
}

/** 문장·대사가 완결된 종결 부호로 끝나는지 */
export function endsAtCompleteSentence(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/\[태그:[^\]]*$/.test(trimmed)) return false;
  if (/[.!?…](?:["'」』)]*)$/.test(trimmed)) return true;
  if (/["'"」』)]$/.test(trimmed) && !hasUnclosedQuotation(trimmed)) return true;
  if (/[<[\]】「『]$/.test(trimmed)) return false;
  return false;
}

/** 단어·구 중간에서 끊긴 것으로 보이는지 */
export function endsIncomplete(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (/\[태그:[^\]]+\]$/.test(trimmed)) return false;
  if (endsAtCompleteSentence(trimmed)) return false;
  if (/[가-힣a-zA-Z0-9]$/.test(trimmed)) return true;
  if (/[,;:—–-]$/.test(trimmed)) return true;
  if (/[<[\]】」』"']$/.test(trimmed)) return true;
  if (/\[태그:[^\]]*$/.test(trimmed)) return true;
  return false;
}

/** cap 이전 마지막 완결 문장/단락 경계 (exclusive end index) */
export function findLastSentenceBreakIndex(
  text: string,
  cap: number,
  minRatio = 0.4
): number {
  if (text.length <= cap) return text.length;
  const slice = text.slice(0, cap);
  const minPos = Math.max(1, Math.floor(cap * minRatio));

  const paraBreak = slice.lastIndexOf("\n\n");
  if (paraBreak >= minPos) return paraBreak + 2;

  for (let i = slice.length - 1; i >= minPos; i--) {
    const c = slice[i];
    if (!".!?…".includes(c)) continue;
    let end = i + 1;
    while (end < slice.length && CLOSING_QUOTES.includes(slice[end]!)) end++;
    if (end === slice.length || /\s/.test(slice[end]!)) return end;
  }

  for (let i = slice.length - 1; i >= 0; i--) {
    const c = slice[i];
    if (!".!?…".includes(c)) continue;
    let end = i + 1;
    while (end < slice.length && CLOSING_QUOTES.includes(slice[end]!)) end++;
    if (end === slice.length || /\s/.test(slice[end]!)) return end;
  }

  const lineBreak = slice.lastIndexOf("\n");
  if (lineBreak >= minPos) return lineBreak + 1;

  const spaceBreak = slice.lastIndexOf(" ");
  if (spaceBreak >= minPos) return spaceBreak;

  return -1;
}

/** Safe-Stop: 문장·단락 경계에서만 절단. mid-word/mid-sentence 물리 절단 회피 */
function truncateAtSentenceBoundary(text: string, cap: number): string {
  if (text.length <= cap) return text;

  let breakAt = findLastSentenceBreakIndex(text, cap);
  if (breakAt > 0) return text.slice(0, breakAt).trimEnd();

  breakAt = findLastSentenceBreakIndex(text, cap, 0.15);
  if (breakAt > 0) return text.slice(0, breakAt).trimEnd();

  const slice = text.slice(0, cap);
  const paraBreak = slice.lastIndexOf("\n\n");
  if (paraBreak >= Math.floor(cap * 0.25)) return text.slice(0, paraBreak + 2).trimEnd();

  const lineBreak = slice.lastIndexOf("\n");
  if (lineBreak >= Math.floor(cap * 0.25)) return text.slice(0, lineBreak + 1).trimEnd();

  const spaceBreak = slice.lastIndexOf(" ");
  if (spaceBreak >= Math.floor(cap * 0.4)) return text.slice(0, spaceBreak).trimEnd();

  breakAt = findLastSentenceBreakIndex(text, text.length, 0);
  if (breakAt > 0 && breakAt <= cap) return text.slice(0, breakAt).trimEnd();

  return text.slice(0, cap).trimEnd();
}

/** 스트림 누출 — 미완성 태그·HTML 조각 제거 */
export function sanitizeStreamArtifacts(text: string): string {
  let out = text.trimEnd();
  out = out.replace(/\[태그:[^\]]*$/, "").trimEnd();
  out = out.replace(/<[^>\n]*$/, "").trimEnd();
  return out;
}

export type ClampResponseLengthOptions = Record<string, never>;

/** narrative 본문만 cap — 문장·단락 경계에서만 절단 */
function clampNarrativeBody(text: string, cap: number): string {
  const result = text.trim();
  if (!result) return result;
  if (result.length <= cap) return result;
  let out = truncateAtSentenceBoundary(result, cap);
  if (!endsAtCompleteSentence(out.trim())) {
    const breakAt = findLastSentenceBreakIndex(result, cap);
    if (breakAt > 0) out = result.slice(0, breakAt).trimEnd();
  }
  if (out.length > cap) out = out.slice(0, cap).trimEnd();
  return out;
}

/** @public — HTML append 등 RP prose 단독 cap */
export function clampTextToCharCap(text: string, cap: number): string {
  return clampNarrativeBody(text, cap);
}

/** 절대 상한(5,000자) — 문장·단락 경계에서만 절단. 완성된 상태창 tail은 본문 cap 후 재부착 */
export function clampResponseLength(
  text: string,
  targetInput?: number | null,
  absoluteMax = ABSOLUTE_MAX_RESPONSE_CHARS,
  _opts?: ClampResponseLengthOptions
): string {
  const result = text.trim();
  if (!result) return result;
  const tierCap = targetInput != null ? resolveResponseLengthTarget(targetInput).hardMax : absoluteMax;
  const cap = Math.min(tierCap, absoluteMax);
  if (result.length <= cap) return result;
  return clampNarrativeBody(result, cap);
}

/** 스트림 중 tier max 도달 — 문장 경계까지 허용 후 중단 */
export function applyStreamLengthCap(
  currentText: string,
  delta: string,
  targetInput?: number | null,
  opts?: StreamLengthCapOptions
): { text: string; emittedDelta: string; capped: boolean } {
  if (opts?.disableLengthCap) {
    const next = peelIncompleteTailForLengthCap(currentText + delta, { allowHtml: opts?.allowHtml });
    return { text: next, emittedDelta: next.slice(currentText.length), capped: false };
  }
  if (!delta) return { text: currentText, emittedDelta: "", capped: false };
  let cap = resolveStreamCharCap(targetInput);
  if (opts?.reserveStatusTail) {
    cap = Math.max(0, cap - STATUS_WINDOW_STREAM_RESERVE_CHARS);
  }
  const htmlReserve = opts?.reserveHtmlFlashChars ?? 0;
  if (htmlReserve > 0) {
    cap = Math.max(0, cap - htmlReserve);
  }
  const base = peelIncompleteTailForLengthCap(currentText, { allowHtml: opts?.allowHtml });
  const prospective = peelIncompleteTailForLengthCap(base + delta, { allowHtml: opts?.allowHtml });
  if (prospective.length <= cap) {
    return { text: prospective, emittedDelta: prospective.slice(base.length), capped: false };
  }
  if (base.length >= cap) {
    return { text: base, emittedDelta: "", capped: true };
  }
  const bounded = truncateAtSentenceBoundary(prospective, cap);
  const emittedDelta = bounded.slice(base.length);
  return { text: bounded, emittedDelta, capped: true };
}

/** UI amber hint — 통과 최소 미달 */
export function isBelowResponseTarget(charCount: number, targetInput?: number | null): boolean {
  const t = resolveResponseLengthTarget(targetInput);
  return charCount < t.min;
}
