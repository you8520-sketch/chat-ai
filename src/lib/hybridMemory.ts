import type { ChatMsg } from "@/lib/ai";
import {
  GEMINI_RAW_RECENT_TURN_WINDOW,
  GEMINI_DYNAMIC_RECENT_TURNS,
  MIN_HISTORY_TURN_FLOOR,
} from "@/lib/contextTrack";

/** 하이브리드 메모리 — 슬라이딩 윈도우 + 6턴 롤링 요약 */
export const SHORT_TERM_TURNS = 5;
/** 요약되지 않은 구간 중 AI history에 넣을 raw 턴 상한 — @see resolveRawRecentTurnWindow */
export const RAW_RECENT_TURN_WINDOW = GEMINI_RAW_RECENT_TURN_WINDOW;
/** 단기 기억(채팅 히스토리) 토큰 상한 — @see MAX_HISTORY_TOKENS (types.ts) */
export const SHORT_TERM_TOKEN_BUDGET = 8_000;
export const ROLLING_SUMMARY_INTERVAL = 6;
/** @deprecated ROLLING_SUMMARY_INTERVAL 사용 */
export const BATCH_TURN_SIZE = ROLLING_SUMMARY_INTERVAL;
export const BATCH_SUMMARY_MAX_CHARS = 300;

export type DialogueTurn = {
  user: string;
  assistant: string;
};

export type ChatMessageRow = {
  role: "user" | "assistant";
  content: string;
  model?: string;
};

/** DB 메시지 → 유저/어시스턴트 턴 쌍 (greeting 제외) */
export function messagesToTurns(rows: ChatMessageRow[]): DialogueTurn[] {
  const turns: DialogueTurn[] = [];
  let pendingUser: string | null = null;

  for (const row of rows) {
    if (row.role === "user") {
      pendingUser = row.content;
    } else if (row.role === "assistant") {
      if (row.model === "greeting") continue;
      if (pendingUser !== null) {
        turns.push({ user: pendingUser, assistant: row.content });
        pendingUser = null;
      }
    }
  }
  return turns;
}

/** 최근 N턴을 AI history 형식으로 (원본 유지) */
export function recentTurnsToHistory(
  turns: DialogueTurn[],
  count = SHORT_TERM_TURNS
): { role: "user" | "assistant"; content: string }[] {
  const slice = turns.slice(-count);
  const out: { role: "user" | "assistant"; content: string }[] = [];
  for (const t of slice) {
    out.push({ role: "user", content: t.user });
    out.push({ role: "assistant", content: t.assistant });
  }
  return out;
}

/**
 * summarizedTurnCount 이후 턴만 raw 히스토리 풀에 넣음 — 요약된 구간은 장기기억(로어북)이 담당.
 * 미요약이 raw 윈도우보다 짧아도 summarized 구간을 backfill하지 않음(중복 토큰·환각 방지).
 * maxRawTurns >= 전체 턴 수(DeepSeek 20K 등)일 때만 전체 미요약 구간을 그대로 사용.
 * trimHistoryToBudget(8K~20K)가 실제 주입량을 결정.
 */
export function resolveRawRecentTurnPool(
  turns: DialogueTurn[],
  summarizedTurnCount: number,
  maxRawTurns = RAW_RECENT_TURN_WINDOW,
  _minRawTurns = MIN_HISTORY_TURN_FLOOR
): { pool: DialogueTurn[]; firstTurn1Indexed: number } {
  if (turns.length === 0) {
    return { pool: [], firstTurn1Indexed: 1 };
  }
  const safeSummarized = Math.max(0, Math.min(summarizedTurnCount, turns.length));
  const unsummarized = turns.slice(safeSummarized);
  const pool =
    maxRawTurns >= turns.length
      ? unsummarized
      : unsummarized.slice(-Math.min(unsummarized.length, maxRawTurns));
  const firstTurn1Indexed =
    pool.length > 0 ? turns.length - pool.length + 1 : safeSummarized + 1;
  return { pool, firstTurn1Indexed };
}

/** 로어북 주입 시 raw 히스토리와 겹치지 않게 잘라낼 턴 시작(1-indexed) */
export function resolveLorebookExcludeTurnStart(
  summarizedTurnCount: number,
  rawTurnPool: { firstTurn1Indexed: number }
): number | undefined {
  if (summarizedTurnCount <= 0) return undefined;
  if (rawTurnPool.firstTurn1Indexed <= 1) return undefined;
  return rawTurnPool.firstTurn1Indexed;
}

export function rawRecentTurnsToHistory(
  turns: DialogueTurn[],
  summarizedTurnCount: number,
  maxRawTurns = RAW_RECENT_TURN_WINDOW,
  minRawTurns = MIN_HISTORY_TURN_FLOOR
): { role: "user" | "assistant"; content: string }[] {
  const { pool } = resolveRawRecentTurnPool(
    turns,
    summarizedTurnCount,
    maxRawTurns,
    minRawTurns
  );
  if (pool.length === 0) return [];
  return recentTurnsToHistory(pool, maxRawTurns);
}

/**
 * Gemini Dynamic — 최근 3턴 raw history (Static cache와 분리)
 */
export function splitTurnsForGeminiCache(
  turns: DialogueTurn[],
  summarizedTurnCount: number,
  formatUser: (userText: string) => string,
  stripAssistant: (assistantText: string) => string = (t) => t
): { dynamicHistory: ChatMsg[] } {
  if (turns.length === 0) {
    return { dynamicHistory: [] };
  }

  const safeSummarized = Math.max(0, Math.min(summarizedTurnCount, turns.length));
  const unsummarized = turns.slice(safeSummarized);
  const dynamicTurns = unsummarized.slice(-GEMINI_DYNAMIC_RECENT_TURNS);

  const dynamicHistory: ChatMsg[] = [];
  for (const t of dynamicTurns) {
    dynamicHistory.push({ role: "user", content: formatUser(t.user) });
    dynamicHistory.push({ role: "assistant", content: stripAssistant(t.assistant) });
  }

  return { dynamicHistory };
}

/** 5, 10, 15… 턴에서 롤링 요약 트리거 */
export function shouldTriggerRollingSummary(totalTurns: number): boolean {
  return totalTurns > 0 && totalTurns % ROLLING_SUMMARY_INTERVAL === 0;
}

/** 다음 롤링 요약까지 남은 턴 수 (0 = 이번 턴 직후 갱신 예정/진행) */
export function turnsUntilNextRollingSummary(totalTurns: number): number {
  if (totalTurns === 0) return ROLLING_SUMMARY_INTERVAL;
  const rem = totalTurns % ROLLING_SUMMARY_INTERVAL;
  return rem === 0 ? 0 : ROLLING_SUMMARY_INTERVAL - rem;
}

/** @deprecated turnsUntilNextRollingSummary 사용 */
export function turnsUntilNextBatch(totalTurns: number, _archivedTurnCount: number): number {
  return turnsUntilNextRollingSummary(totalTurns);
}

/** 배치 요약 대상 턴 범위 [start, end) 또는 null */
export function nextBatchRange(
  totalTurns: number,
  archivedTurnCount: number
): { start: number; end: number } | null {
  if (totalTurns <= SHORT_TERM_TURNS) return null;
  const windowStart = Math.max(archivedTurnCount, totalTurns - SHORT_TERM_TURNS);
  const pendingBeforeWindow = windowStart - archivedTurnCount;
  if (pendingBeforeWindow <= 0) return null;
  const batchSize = Math.min(BATCH_TURN_SIZE, pendingBeforeWindow);
  return { start: archivedTurnCount, end: archivedTurnCount + batchSize };
}

export function appendLongTermMemory(prev: string, summary: string): string {
  const block = summary.trim();
  if (!block) return prev;
  if (!prev.trim()) return block;
  return `${prev.trim()}\n\n${block}`;
}
