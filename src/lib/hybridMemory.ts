import type { ChatMsg } from "@/lib/ai";
import { estimateTokens } from "@/lib/tokenEstimate";
import { OPENING_TURN_USER, isOpeningTurn } from "@/lib/chatGreetingContext";
import {
  GEMINI_DYNAMIC_RECENT_TURNS,
  HISTORY_TRIM_CHUNK_MESSAGES,
  MIN_HISTORY_TURN_FLOOR,
} from "@/lib/contextTrack";
import { isCanonAdoptedScene } from "@/lib/oocSceneRender";

/** 하이브리드 메모리 — 슬라이딩 윈도우 + 5턴 롤링 요약 */
export const SHORT_TERM_TURNS = 5;
/** @deprecated HISTORY_TOKEN_BUDGET (contextTrack.ts) 사용 — 전 모델 10K 통일 */
export const SHORT_TERM_TOKEN_BUDGET = 10_000;
/** New summary batches seal every 5 complete playable turns. */
export const ROLLING_SUMMARY_INTERVAL = 5;
/** Normal provider RAW history — latest N complete playable exchanges (not messages). */
export const RAW_HISTORY_COMPLETE_EXCHANGES = 4;
/** @deprecated ROLLING_SUMMARY_INTERVAL 사용 */
export const BATCH_TURN_SIZE = ROLLING_SUMMARY_INTERVAL;
export const BATCH_SUMMARY_MAX_CHARS = 300;

export type DialogueTurn = {
  user: string;
  assistant: string;
  assistantOnly?: boolean;
};

export type ChatMessageRow = {
  role: "user" | "assistant";
  content: string;
  model?: string;
  usage?: unknown;
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
      } else if (isCanonAdoptedScene(row.usage)) {
        turns.push({ user: "", assistant: row.content, assistantOnly: true });
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
    if (t.assistantOnly) {
      if (t.assistant) out.push({ role: "assistant", content: t.assistant });
      continue;
    }
    out.push({ role: "user", content: t.user });
    out.push({ role: "assistant", content: t.assistant });
  }
  return out;
}

function normalizeNonNegativeInteger(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.floor(numeric));
}

/**
 * RAW ↔ sealed summary coverage를 지키기 위한 최소 playable turn 수.
 * opening greeting은 completedTurns에 포함하지 않는다.
 */
export function resolveMemoryCoverageTurnFloor(opts: {
  completedTurns: number;
  summarizedTurnCount?: number | null;
  baseFloor?: number;
}): number {
  const completedTurns = normalizeNonNegativeInteger(opts.completedTurns);
  const summarizedTurnCount = normalizeNonNegativeInteger(opts.summarizedTurnCount);
  const baseFloor = normalizeNonNegativeInteger(
    opts.baseFloor ?? MIN_HISTORY_TURN_FLOOR
  );
  const unsummarizedTurns = Math.max(0, completedTurns - summarizedTurnCount);
  return Math.max(baseFloor, unsummarizedTurns);
}

/** Memory OFF and provider RAW both use the fixed exchange floor (not coverage lag). */
export function resolveHistoryMinTurnFloor(opts: {
  memoryFeatureEnabled: boolean;
  completedTurns: number;
  summarizedTurnCount?: number | null;
  baseFloor?: number;
}): number {
  void opts.memoryFeatureEnabled;
  void opts.completedTurns;
  void opts.summarizedTurnCount;
  return normalizeNonNegativeInteger(
    opts.baseFloor ?? RAW_HISTORY_COMPLETE_EXCHANGES
  );
}

/** first RAW playable turn과 sealed summary 사이의 미보존 구간. */
export function resolveMemoryCoverageGap(opts: {
  firstRawPlayableTurn: number | null | undefined;
  summarizedTurnCount: number;
}): number {
  const firstRaw = Number(opts.firstRawPlayableTurn);
  if (!Number.isFinite(firstRaw) || firstRaw < 1) return 0;
  const summarizedTurnCount = normalizeNonNegativeInteger(opts.summarizedTurnCount);
  return Math.max(0, Math.floor(firstRaw) - (summarizedTurnCount + 1));
}

/** history에 남은 complete playable turns 수 (opening greeting 제외). */
export function countPlayableHistoryTurns(history: ChatMsg[]): number {
  let pendingUser: ChatMsg | null = null;
  let playableTurns = 0;

  for (const message of history) {
    if (message.role === "user") {
      pendingUser = message;
      continue;
    }
    if (message.role !== "assistant" || !pendingUser) continue;
    if (pendingUser.content !== OPENING_TURN_USER) playableTurns += 1;
    pendingUser = null;
  }

  return playableTurns;
}

/** 두 suffix 후보 중 더 긴 쪽을 선택해 기존 provider/history 보존량을 줄이지 않는다. */
export function selectLongerHistorySuffix(
  preferred: ChatMsg[],
  coverageRequired: ChatMsg[]
): ChatMsg[] {
  if (
    process.env.NODE_ENV !== "production" &&
    !areCompatibleHistorySuffixes(preferred, coverageRequired)
  ) {
    throw new Error("History suffix candidates must share one canonical latest suffix");
  }
  return coverageRequired.length > preferred.length ? coverageRequired : preferred;
}

/** 두 후보가 동일 canonical history의 complete latest suffix인지 확인한다. */
export function areCompatibleHistorySuffixes(a: ChatMsg[], b: ChatMsg[]): boolean {
  const hasCompletePairs = (history: ChatMsg[]) =>
    history.length % 2 === 0 &&
    history.every((message, index) =>
      index % 2 === 0 ? message.role === "user" : message.role === "assistant"
    );
  if (!hasCompletePairs(a) || !hasCompletePairs(b)) return false;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  const offset = longer.length - shorter.length;
  for (let index = 0; index < shorter.length; index++) {
    const left = shorter[index]!;
    const right = longer[offset + index]!;
    if (left.role !== right.role || left.content !== right.content) return false;
  }
  return true;
}

/** 채팅 히스토리 — 토큰 예산 + 최소 턴 floor (예산 초과해도 최근 minTurnFloor턴 유지) */
export function trimHistoryToBudget(
  history: ChatMsg[],
  budget: number,
  minTurnFloor = MIN_HISTORY_TURN_FLOOR
): ChatMsg[] {
  if (history.length === 0) return [];

  // 1턴 = user+assistant 2메시지
  const floorMessages = Math.min(
    history.length,
    normalizeNonNegativeInteger(minTurnFloor) * 2
  );

  let tokens = 0;
  const kept: ChatMsg[] = [];
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i]!;
    const t = estimateTokens(msg.content);
    if (tokens + t > budget && kept.length >= Math.max(1, floorMessages)) break;
    kept.unshift(msg);
    tokens += t;
  }
  if ((history.length - kept.length) % 2 !== 0) kept.shift();
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
 * Provider RAW pool — latest N complete playable exchanges (opening greeting excluded).
 * Full canonical turns may still be loaded elsewhere for memory reconciliation.
 */
export function resolveRawRecentTurnPool(
  turns: DialogueTurn[],
  exchangeCount = RAW_HISTORY_COMPLETE_EXCHANGES
): { pool: DialogueTurn[]; firstTurn1Indexed: number } {
  const { playable } = splitOpeningPlayableTurns(turns);
  if (playable.length === 0) {
    return { pool: [], firstTurn1Indexed: 1 };
  }

  const count = Math.max(1, Math.min(exchangeCount, playable.length));
  const recentPlayable = playable.slice(-count);
  const firstTurn1Indexed = playable.length - recentPlayable.length + 1;

  return { pool: recentPlayable, firstTurn1Indexed };
}

export function rawRecentTurnsToHistory(
  turns: DialogueTurn[],
  exchangeCount = RAW_HISTORY_COMPLETE_EXCHANGES
): { role: "user" | "assistant"; content: string }[] {
  const { pool } = resolveRawRecentTurnPool(turns, exchangeCount);
  if (pool.length === 0) return [];
  return recentTurnsToHistory(pool, pool.length);
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

/**
 * Gemini Dynamic — 최근 3턴 raw history (Static cache와 분리)
 */
export function splitTurnsForGeminiCache(
  turns: DialogueTurn[],
  formatUser: (userText: string) => string,
  stripAssistant: (assistantText: string) => string = (t) => t,
  exchangeCount = RAW_HISTORY_COMPLETE_EXCHANGES
): { dynamicHistory: ChatMsg[] } {
  const { pool } = resolveRawRecentTurnPool(turns, exchangeCount);
  if (pool.length === 0) {
    return { dynamicHistory: [] };
  }

  const dynamicTurns = pool.slice(-GEMINI_DYNAMIC_RECENT_TURNS);

  const dynamicHistory: ChatMsg[] = [];
  for (const t of dynamicTurns) {
    if (t.assistantOnly) {
      if (t.assistant) {
        dynamicHistory.push({ role: "assistant", content: stripAssistant(t.assistant) });
      }
      continue;
    }
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
