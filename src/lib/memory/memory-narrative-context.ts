import { ROLLING_SUMMARY_INTERVAL } from "@/lib/hybridMemory";
import { resolveStaticStoredSummaryLimit } from "@/lib/contextTrack";
import { listMemoryRecordsForChat, type MemoryRecordView } from "./memory-turn-summary";

export const RECENT_NARRATIVE_CONTEXT_LIMIT = 3;

/** 현재 턴 기준 요약 구간의 상대적 시점 라벨 (예: "11~15턴 전", "최근 0~5턴 전") */
export function formatSummaryRecencyLabel(
  turnStart: number,
  turnEnd: number,
  currentTurn: number
): string {
  if (currentTurn <= 0) {
    return `${turnStart}~${turnEnd}턴`;
  }
  const agoEnd = Math.max(0, currentTurn - turnEnd);
  const agoStart = Math.max(agoEnd, currentTurn - turnStart + 1);
  if (agoEnd === 0) {
    return `최근 ${agoEnd}~${Math.min(ROLLING_SUMMARY_INTERVAL, agoStart)}턴 전`;
  }
  return `${agoEnd}~${agoStart}턴 전`;
}

/**
 * chat_turn_summaries(유저 수정 가능 히스토리)에서 최신 N개만 읽어 프롬프트 블록 생성.
 * 요약 생성·수정 로직은 건드리지 않음 — read-only injection 전용.
 */
export function buildRecentNarrativeContextBlock(
  chatId: number,
  currentTurn: number,
  limit = RECENT_NARRATIVE_CONTEXT_LIMIT,
  minLimit = 0,
  excludeAssistantMessageId?: number | null
): string {
  let records = listMemoryRecordsForChat(chatId);
  records = records.filter((r) => r.summaryKind === "narrative");
  if (excludeAssistantMessageId != null) {
    records = records.filter((r) => r.assistantMessageId !== excludeAssistantMessageId);
  }
  if (records.length === 0) return "";

  let effectiveLimit = Math.min(limit, records.length);
  if (minLimit > 0 && records.length >= minLimit) {
    effectiveLimit = Math.max(minLimit, effectiveLimit);
  }
  const recent = records.slice(-effectiveLimit);
  const lines = recent.map((record, index) => formatNarrativeContextLine(record, index + 1, currentTurn));

  return `[RECENT NARRATIVE CONTEXT]\n${lines.join("\n")}`;
}

/**
 * Static cache 6순위 — chat_turn_summaries(5턴마다 저장) 최신 생성순 1~15개.
 * read-only, 유저 수정 반영(summary 그대로).
 */
export function buildStoredHistoryStaticBlock(
  chatId: number,
  currentTurn: number,
  limit?: number,
  modelId?: string | null,
  provider?: "gemini" | "openrouter"
): string {
  const records = listMemoryRecordsForChat(chatId).filter((r) => r.summaryKind === "narrative");
  if (records.length === 0) return "";

  const maxCap = resolveStaticStoredSummaryLimit(modelId, provider);
  const effectiveLimit = limit ?? maxCap;
  const cap = Math.min(Math.max(1, effectiveLimit), maxCap, records.length);
  const recentNewestFirst = records.slice(-cap).reverse();

  const blocks = recentNewestFirst.map((record) => formatStoredHistoryBlock(record, currentTurn));
  return blocks.join("\n\n");
}

function formatStoredHistoryBlock(record: MemoryRecordView, currentTurn: number): string {
  const recency = formatSummaryRecencyLabel(record.turnStart, record.turnEnd, currentTurn);
  const summary = record.summary.trim();
  const edited = record.userEdited ? " · 유저 수정" : "";
  return `[Stored history · ${record.turnRangeLabel} · ${recency}${edited}]\n${summary}`;
}

function formatNarrativeContextLine(
  record: MemoryRecordView,
  ordinal: number,
  currentTurn: number
): string {
  const recency = formatSummaryRecencyLabel(record.turnStart, record.turnEnd, currentTurn);
  const summary = record.summary.trim().replace(/\s+/g, " ");
  return `- 요약본 ${ordinal} (${recency}): "${summary}"`;
}
