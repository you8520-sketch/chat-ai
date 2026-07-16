import { getDb } from "@/lib/db";
import { ROLLING_SUMMARY_INTERVAL } from "@/lib/hybridMemory";
import {
  ROLLING_SUMMARY_MAX_CHARS,
  ROLLING_SUMMARY_MIN_CHARS,
} from "./memory-constants";
import { clampMemoryRecordSummary } from "./memory-summary-clamp";
import {
  isOocOnlySummaryKind,
  type SummaryKind,
} from "./memory-summary-integrity";

export const MEMORY_RECORD_MIN_CHARS = ROLLING_SUMMARY_MIN_CHARS;
export const MEMORY_RECORD_MAX_CHARS = ROLLING_SUMMARY_MAX_CHARS;

export type MemoryRecordRow = {
  id: number;
  chat_id: number;
  turn_number: number;
  assistant_message_id: number | null;
  summary: string;
  summary_kind?: string | null;
  user_edited: number;
  created_at: string;
  updated_at: string;
};

export type MemoryRecordView = {
  id: number;
  turnStart: number;
  turnEnd: number;
  turnRangeLabel: string;
  summary: string;
  summaryKind: SummaryKind;
  userEdited: boolean;
  charCount: number;
  assistantMessageId: number | null;
};

function clampRecord(text: string, max = MEMORY_RECORD_MAX_CHARS): string {
  return clampMemoryRecordSummary(text, max, ROLLING_SUMMARY_MIN_CHARS);
}

function normalizeSummaryKind(raw: string | null | undefined): SummaryKind {
  return isOocOnlySummaryKind(raw) ? "ooc_only" : "narrative";
}

function rowToView(r: MemoryRecordRow): MemoryRecordView {
  const turnStart = r.turn_number;
  const turnEnd = turnStart + ROLLING_SUMMARY_INTERVAL - 1;
  return {
    id: r.id,
    turnStart,
    turnEnd,
    turnRangeLabel: formatTurnRangeLabel(turnStart, turnEnd),
    summary: r.summary,
    summaryKind: normalizeSummaryKind(r.summary_kind),
    userEdited: r.user_edited === 1,
    charCount: r.summary.length,
    assistantMessageId: r.assistant_message_id ?? null,
  };
}

export function formatTurnRangeLabel(startTurn: number, endTurn: number): string {
  return `${startTurn}~${endTurn}턴`;
}

export function formatMemoryBlock(startTurn: number, endTurn: number, summary: string): string {
  return `[${formatTurnRangeLabel(startTurn, endTurn)}] ${summary.trim()}`;
}

/** Narrative rows only — ooc_only placeholders never enter recent_summary / prompt lorebook. */
export function rebuildLorebookFromRecords(
  chatId: number,
  opts?: { excludeTurnStartGte?: number }
): string {
  let records = listMemoryRecordsForChat(chatId).filter((r) => r.summaryKind === "narrative");
  const cutoff = opts?.excludeTurnStartGte;
  if (cutoff != null && cutoff > 0) {
    records = records.filter((r) => r.turnEnd < cutoff);
  }
  return records.map((r) => formatMemoryBlock(r.turnStart, r.turnEnd, r.summary)).join("\n\n");
}

/** Rows shown in memory history UI (excludes ooc_only placeholders). */
export function listVisibleMemoryRecordsForChat(chatId: number): MemoryRecordView[] {
  return listMemoryRecordsForChat(chatId).filter((r) => r.summaryKind === "narrative");
}

export function listMemoryRecordsForChat(chatId: number): MemoryRecordView[] {
  const rows = getDb()
    .prepare(
      `SELECT id, chat_id, turn_number, assistant_message_id, summary,
              COALESCE(summary_kind, 'narrative') AS summary_kind,
              user_edited, created_at, updated_at
       FROM chat_turn_summaries WHERE chat_id=? ORDER BY turn_number ASC`
    )
    .all(chatId) as MemoryRecordRow[];

  return rows.map(rowToView);
}

/** @deprecated listMemoryRecordsForChat 사용 */
export function listTurnSummariesForChat(chatId: number): {
  id: number;
  turnNumber: number;
  summary: string;
  userEdited: boolean;
  charCount: number;
}[] {
  return listVisibleMemoryRecordsForChat(chatId).map((r) => ({
    id: r.id,
    turnNumber: r.turnStart,
    summary: r.summary,
    userEdited: r.userEdited,
    charCount: r.charCount,
  }));
}

export async function upsertMemoryRecord(opts: {
  chatId: number;
  turnStart: number;
  assistantMessageId: number | null;
  summary: string;
  userEdited?: boolean;
  summaryKind?: SummaryKind;
}): Promise<MemoryRecordView> {
  const kind: SummaryKind = opts.summaryKind === "ooc_only" ? "ooc_only" : "narrative";
  const summary = kind === "ooc_only" ? opts.summary.trim() : clampRecord(opts.summary);
  const db = getDb();
  const existing = db
    .prepare("SELECT id, summary_kind FROM chat_turn_summaries WHERE chat_id=? AND turn_number=?")
    .get(opts.chatId, opts.turnStart) as { id: number; summary_kind?: string } | undefined;

  if (existing) {
    db.prepare(
      `UPDATE chat_turn_summaries SET
        summary=?, summary_kind=?, assistant_message_id=COALESCE(?, assistant_message_id),
        user_edited=?, updated_at=datetime('now')
       WHERE id=?`
    ).run(summary, kind, opts.assistantMessageId, opts.userEdited ? 1 : 0, existing.id);
  } else {
    db.prepare(
      `INSERT INTO chat_turn_summaries
        (chat_id, turn_number, assistant_message_id, summary, summary_kind, user_edited)
       VALUES (?,?,?,?,?,?)`
    ).run(
      opts.chatId,
      opts.turnStart,
      opts.assistantMessageId,
      summary,
      kind,
      opts.userEdited ? 1 : 0
    );
  }

  const row = db
    .prepare(
      `SELECT id, chat_id, turn_number, assistant_message_id, summary,
              COALESCE(summary_kind, 'narrative') AS summary_kind,
              user_edited, created_at, updated_at
       FROM chat_turn_summaries WHERE chat_id=? AND turn_number=?`
    )
    .get(opts.chatId, opts.turnStart) as MemoryRecordRow;

  return rowToView(row);
}

export function updateMemoryRecordById(
  chatId: number,
  recordId: number,
  summary: string
): MemoryRecordView | null {
  const text = clampRecord(summary);
  if (!text.trim() || text.length < MEMORY_RECORD_MIN_CHARS) return null;

  const db = getDb();
  const row = db
    .prepare("SELECT id, turn_number, summary_kind FROM chat_turn_summaries WHERE id=? AND chat_id=?")
    .get(recordId, chatId) as { id: number; turn_number: number; summary_kind?: string } | undefined;
  if (!row) return null;
  // User edits always become narrative content
  db.prepare(
    `UPDATE chat_turn_summaries SET summary=?, summary_kind='narrative', user_edited=1, updated_at=datetime('now') WHERE id=?`
  ).run(text, recordId);

  const updated = db
    .prepare(
      `SELECT id, chat_id, turn_number, assistant_message_id, summary,
              COALESCE(summary_kind, 'narrative') AS summary_kind,
              user_edited, created_at, updated_at
       FROM chat_turn_summaries WHERE id=?`
    )
    .get(recordId) as MemoryRecordRow;

  return rowToView(updated);
}

/** @deprecated updateMemoryRecordById 사용 */
export function updateTurnSummaryById(chatId: number, summaryId: number, summary: string) {
  const updated = updateMemoryRecordById(chatId, summaryId, summary);
  if (!updated) return null;
  return {
    id: updated.id,
    turnNumber: updated.turnStart,
    summary: updated.summary,
    userEdited: updated.userEdited,
    assistantMessageId: null as number | null,
    charCount: updated.charCount,
  };
}

export function clearMemoryRecordsForChat(chatId: number): void {
  getDb().prepare(`DELETE FROM chat_turn_summaries WHERE chat_id=?`).run(chatId);
}

/** @deprecated clearMemoryRecordsForChat(chatId) 사용 */
export function clearTurnSummariesForChat(chatId: number): void {
  clearMemoryRecordsForChat(chatId);
}

export { loadChatTurnsWithMessageIds, countChatTurns } from "./memory-turn-loader";
