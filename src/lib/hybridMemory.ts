import type { ChatMsg } from "@/lib/ai";
import { estimateTokens } from "@/lib/tokenEstimate";
import { OPENING_TURN_USER, isOpeningTurn } from "@/lib/chatGreetingContext";
import {
  GEMINI_DYNAMIC_RECENT_TURNS,
  HISTORY_TRIM_CHUNK_MESSAGES,
  MIN_HISTORY_TURN_FLOOR,
} from "@/lib/contextTrack";

/** 하이브리드 메모리 — 슬라이딩 윈도우 + 6턴 롤링 요약 */
export const SHORT_TERM_TURNS = 5;
/** @deprecated HISTORY_TOKEN_BUDGET (contextTrack.ts) 사용 — 전 모델 10K 통일 */
export const SHORT_TERM_TOKEN_BUDGET = 10_000;
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

/** DB 메시지 → 턴 배열. greeting assistant = turn 0; user+assistant pairs = turn 1+. */
export function messagesToTurns(rows: ChatMessageRow[]): DialogueTurn[] {
  const turns: DialogueTurn[] = [];
  let pendingUser: string | null = null;

  for (const row of rows) {
    if (row.role === "user") {
      pendingUser = row.content;
    } else if (row.role === "assistant") {
      if (row.model === "greeting") {
        turns.push({ user: OPENING_TURN_USER, assistant: row.content });
        continue;
      }
      if (pendingUser !== null) {
        turns.push({ user: pendingUser, assistant: row.content });
        pendingUser = null;
      }
    }
  }
  return turns;
}

export function splitOpeningPlayableTurns(turns: DialogueTurn[]): {
  opening: DialogueTurn | null;
  playable: DialogueTurn[];
} {
  if (turns.length === 0) return { opening: null, playable: [] };
  if (isOpeningTurn(turns[0]!)) {
    return { opening: turns[0]!, playable: turns.slice(1) };
  }
  return { opening: null, playable: turns };
}

/** Playable turns only (turn 1+) — memory message_count / early-turn pacing */
export function countPlayableTurns(turns: DialogueTurn[]): number {
  return splitOpeningPlayableTurns(turns).playable.length;
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

/** 채팅 히스토리 — 토큰 예산 + 최소 턴 floor (예산 초과해도 최근 MIN_HISTORY_TURN_FLOOR턴 유지) */
export function trimHistoryToBudget(
  history: ChatMsg[],
  budget: number,
  minTurnFloor = MIN_HISTORY_TURN_FLOOR
): ChatMsg[] {
  if (history.length === 0) return [];

  // 1턴 = user+assistant 2메시지
  const floorMessages = Math.min(history.length, Math.max(0, minTurnFloor) * 2);

  let tokens = 0;
  const kept: ChatMsg[] = [];
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i]!;
    const t = estimateTokens(msg.content);
    if (tokens + t > budget && kept.length >= Math.max(1, floorMessages)) break;
    kept.unshift(msg);
    tokens += t;
  }
  return alignHistoryPrefixDrop(history, kept, floorMessages);
}

/** Prefix drop — chunk 단위(10msg)로 잘라 Anthropic history cache prefix 안정화 (floor 침범 금지) */
function alignHistoryPrefixDrop(
  full: ChatMsg[],
  kept: ChatMsg[],
  floorMessages = 0
): ChatMsg[] {
  const prefixDrop = full.length - kept.length;
  if (prefixDrop <= 0) return kept;

  let alignedDrop =
    Math.ceil(prefixDrop / HISTORY_TRIM_CHUNK_MESSAGES) * HISTORY_TRIM_CHUNK_MESSAGES;
  // chunk 정렬이 최소 보장 턴을 깎으면 한 chunk 덜 드랍
  while (alignedDrop > prefixDrop && full.length - alignedDrop < floorMessages) {
    alignedDrop -= HISTORY_TRIM_CHUNK_MESSAGES;
  }
  const startIdx = Math.min(Math.max(alignedDrop, 0), full.length);
  if (startIdx <= 0) return kept;
  const aligned = full.slice(startIdx);
  return aligned.length > 0 ? aligned : kept;
}

/**
 * 전체 대화 턴 풀 — opening + playable 전부.
 * 주입량은 trimHistoryToBudget(전 모델 10K + 최소 4턴 floor)만 결정.
 */
export function resolveRawRecentTurnPool(
  turns: DialogueTurn[],
  _summarizedTurnCount?: number
): { pool: DialogueTurn[]; firstTurn1Indexed: number } {
  void _summarizedTurnCount;
  const { opening, playable } = splitOpeningPlayableTurns(turns);
  if (playable.length === 0 && !opening) {
    return { pool: [], firstTurn1Indexed: 1 };
  }

  const pool: DialogueTurn[] = [];
  if (opening) pool.push(opening);
  pool.push(...playable);

  return { pool, firstTurn1Indexed: 1 };
}

/**
 * trim 후 raw에 남은 최초 playable 턴(1-indexed) — 로어북 turn summary 중복 제거.
 * raw에 turn 1부터 있으면 1 → per-turn 요약 전부 제외 (verbatim raw 우선).
 */
export function resolveLorebookExcludeFromTrimmedHistory(
  turns: DialogueTurn[],
  trimmedHistory: ChatMsg[]
): number | undefined {
  if (trimmedHistory.length === 0) return undefined;

  const { opening, playable } = splitOpeningPlayableTurns(turns);
  const firstContent = trimmedHistory[0]!.content;

  if (opening) {
    if (firstContent === OPENING_TURN_USER || firstContent === opening.assistant.trim()) {
      return 1;
    }
  }

  for (let i = 0; i < playable.length; i++) {
    const turn = playable[i]!;
    if (firstContent === turn.user || firstContent === turn.assistant) {
      return i + 1;
    }
  }

  return 1;
}

/** @deprecated resolveLorebookExcludeFromTrimmedHistory 사용 */
export function resolveLorebookExcludeTurnStart(
  _summarizedTurnCount: number,
  rawTurnPool: { firstTurn1Indexed: number }
): number | undefined {
  void _summarizedTurnCount;
  if (rawTurnPool.firstTurn1Indexed <= 1) return undefined;
  return rawTurnPool.firstTurn1Indexed;
}

export function rawRecentTurnsToHistory(
  turns: DialogueTurn[],
  _summarizedTurnCount?: number
): { role: "user" | "assistant"; content: string }[] {
  void _summarizedTurnCount;
  const { pool } = resolveRawRecentTurnPool(turns);
  if (pool.length === 0) return [];
  return recentTurnsToHistory(pool, pool.length);
}

/**
 * Gemini Dynamic — 최근 3턴 raw history (Static cache와 분리)
 */
export function splitTurnsForGeminiCache(
  turns: DialogueTurn[],
  formatUser: (userText: string) => string,
  stripAssistant: (assistantText: string) => string = (t) => t,
  _summarizedTurnCount?: number
): { dynamicHistory: ChatMsg[] } {
  void _summarizedTurnCount;
  const { pool } = resolveRawRecentTurnPool(turns);
  if (pool.length === 0) {
    return { dynamicHistory: [] };
  }

  const dynamicTurns = pool.slice(-GEMINI_DYNAMIC_RECENT_TURNS);

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
