/** Google Gemini explicit CachedContent — 최소 토큰 (gemini-3.1-pro 등) */
import { MAX_PAYLOAD_INPUT_TOKENS } from "@/lib/turnApiBudget";

export const GEMINI_IMPLICIT_CACHE_INPUT_THRESHOLD = 32_768;

/** Static CachedContent — 최소/최대 토큰 (32K 할인 트리거) */
export const GEMINI_STATIC_CACHE_MIN_TOKENS = 32_768;
export const GEMINI_STATIC_CACHE_MAX_TOKENS = 60_000;

/** Dynamic — Gemini static/dynamic cache split용 최근 raw 턴 */
export const GEMINI_DYNAMIC_RECENT_TURNS = 3;

/** Static CachedContent — 저장된 5턴 요약(chat_turn_summaries) 최대 주입 개수 */
export const GEMINI_STATIC_STORED_SUMMARY_LIMIT = 15;

/** Gemini bulk-up — 최근 대화 raw 히스토리 토큰 상한 */
export const GEMINI_HISTORY_TOKEN_BUDGET = 8_000;

/** Claude / OpenRouter — 히스토리 토큰 상한 */
export const CLAUDE_HISTORY_TOKEN_BUDGET = 8_000;

/** @deprecated trimHistoryToBudget — 토큰 예산만 적용 (턴 floor 없음) */
export const MIN_HISTORY_TURN_FLOOR = 0;

/** Anthropic history cache — prefix drop 시 1msg씩이 아닌 chunk 단위 drop */
export const HISTORY_TRIM_CHUNK_MESSAGES = 10;

/** @deprecated raw 풀은 전체 대화 — trimHistoryToBudget가 토큰 상한 적용 */
export const GEMINI_RAW_RECENT_TURN_WINDOW = 15;

/** Gemini — chat_turn_summaries 최소 주입 개수 (가용 시) */
export const GEMINI_MIN_NARRATIVE_CONTEXT = 5;

/** @deprecated */
export const CLAUDE_RAW_RECENT_TURN_WINDOW = 6;

/** Gemini — [3] 현재기억 프롬프트 토큰 상한 */
export const GEMINI_MEMORY_TOKEN_RESERVE = 12_000;

/** Claude / 기본 — 현재기억 truncate 상한 */
export const CLAUDE_MEMORY_TOKEN_RESERVE = 3_500;

/** DeepSeek V4 Pro — [3] 현재기억 프롬프트 토큰 상한 */
export const DEEPSEEK_MEMORY_TOKEN_RESERVE = 14_000;

/** DeepSeek V4 Pro — 최근 대화 raw 히스토리 토큰 상한 */
export const DEEPSEEK_HISTORY_TOKEN_BUDGET = 16_000;

/** DeepSeek V4 Pro — chat_turn_summaries 최대 주입 개수 */
export const DEEPSEEK_STATIC_STORED_SUMMARY_LIMIT = 10;

/** DeepSeek V4 Pro — 루프 버그 payload 상한 */
export const DEEPSEEK_MAX_PAYLOAD_INPUT_TOKENS = 180_000;

/** Gemini — chat_turn_summaries 최신 15개 */
export const GEMINI_RECENT_NARRATIVE_CONTEXT_LIMIT = 15;

/** Claude / OpenRouter — 프롬프트 주입 시 최신 요약 개수 (read-only, DB·압축 로직 무관) */
export const CLAUDE_RECENT_NARRATIVE_CONTEXT_LIMIT = 5;

export type ContextTrack = "gemini-bulk" | "claude-diet";

export function isGeminiModelId(modelId: string): boolean {
  return modelId.toLowerCase().includes("gemini");
}

export function isClaudeModelId(modelId: string): boolean {
  return modelId.toLowerCase().includes("claude");
}

export function isDeepSeekModelId(modelId: string): boolean {
  return modelId.toLowerCase().includes("deepseek");
}

export function isQwenModelId(modelId: string): boolean {
  return modelId.toLowerCase().includes("qwen");
}

export function resolveContextTrack(
  modelId?: string | null,
  provider?: "gemini" | "openrouter"
): ContextTrack {
  const id = (modelId ?? "").trim().toLowerCase();
  if (isClaudeModelId(id) || provider === "openrouter") {
    return "claude-diet";
  }
  if (isGeminiModelId(id) || provider === "gemini") {
    return "gemini-bulk";
  }
  return "gemini-bulk";
}

export function resolveHistoryTokenBudget(
  modelId?: string | null,
  provider?: "gemini" | "openrouter"
): number {
  if (isDeepSeekModelId(modelId ?? "")) return DEEPSEEK_HISTORY_TOKEN_BUDGET;
  return resolveContextTrack(modelId, provider) === "gemini-bulk"
    ? GEMINI_HISTORY_TOKEN_BUDGET
    : CLAUDE_HISTORY_TOKEN_BUDGET;
}

export function resolveRawRecentTurnWindow(
  modelId?: string | null,
  provider?: "gemini" | "openrouter"
): number {
  void modelId;
  void provider;
  return Number.MAX_SAFE_INTEGER;
}

/** @deprecated raw 풀은 전체 대화 — trimHistoryToBudget만 적용 */
export function resolveRawRecentTurnWindowForHistory(
  modelId: string | null | undefined,
  provider: "gemini" | "openrouter",
  totalCompletedTurns: number
): number {
  void modelId;
  void provider;
  return totalCompletedTurns;
}

export function resolveMinNarrativeContext(
  modelId?: string | null,
  provider?: "gemini" | "openrouter"
): number {
  return resolveContextTrack(modelId, provider) === "gemini-bulk"
    ? GEMINI_MIN_NARRATIVE_CONTEXT
    : 0;
}

export function resolveMemoryTokenReserve(
  modelId?: string | null,
  provider?: "gemini" | "openrouter"
): number {
  if (isDeepSeekModelId(modelId ?? "")) return DEEPSEEK_MEMORY_TOKEN_RESERVE;
  return resolveContextTrack(modelId, provider) === "gemini-bulk"
    ? GEMINI_MEMORY_TOKEN_RESERVE
    : CLAUDE_MEMORY_TOKEN_RESERVE;
}

export function resolveStaticStoredSummaryLimit(
  modelId?: string | null,
  provider?: "gemini" | "openrouter"
): number {
  if (isDeepSeekModelId(modelId ?? "")) return DEEPSEEK_STATIC_STORED_SUMMARY_LIMIT;
  return resolveContextTrack(modelId, provider) === "gemini-bulk"
    ? GEMINI_STATIC_STORED_SUMMARY_LIMIT
    : CLAUDE_RECENT_NARRATIVE_CONTEXT_LIMIT;
}

export function resolveMaxPayloadInputTokens(modelId?: string | null): number {
  if (isDeepSeekModelId(modelId ?? "")) return DEEPSEEK_MAX_PAYLOAD_INPUT_TOKENS;
  return MAX_PAYLOAD_INPUT_TOKENS;
}

export function resolveRecentNarrativeContextLimit(
  modelId?: string | null,
  provider?: "gemini" | "openrouter"
): number {
  if (isDeepSeekModelId(modelId ?? "")) return DEEPSEEK_STATIC_STORED_SUMMARY_LIMIT;
  return resolveContextTrack(modelId, provider) === "gemini-bulk"
    ? GEMINI_RECENT_NARRATIVE_CONTEXT_LIMIT
    : CLAUDE_RECENT_NARRATIVE_CONTEXT_LIMIT;
}

/** archive_summary 비어 있지 않으면 관련성 필터 없이 항상 주입 */
export function shouldIncludeArchiveAlways(
  _modelId?: string | null,
  _provider?: "gemini" | "openrouter"
): boolean {
  return true;
}

/** Gemini bulk + OpenRouter — 캐릭터 설정은 코어 아이덴티티 매턴 + RAG 보조 */
export function usesFullLoreInjection(
  _modelId?: string | null,
  _provider?: "gemini" | "openrouter"
): boolean {
  return false;
}
