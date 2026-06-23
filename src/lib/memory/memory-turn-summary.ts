import { getDb } from "@/lib/db";
import { ROLLING_SUMMARY_INTERVAL } from "@/lib/hybridMemory";
import {
  ROLLING_SUMMARY_MAX_CHARS,
  ROLLING_SUMMARY_MIN_CHARS,
} from "./memory-constants";
import { clampMemoryRecordSummary } from "./memory-summary-clamp";

export const MEMORY_RECORD_MIN_CHARS = ROLLING_SUMMARY_MIN_CHARS;
export const MEMORY_RECORD_MAX_CHARS = ROLLING_SUMMARY_MAX_CHARS;

export type MemoryRecordRow = {
  id: number;
  chat_id: number;
  turn_number: number;
  assistant_message_id: number | null;
  summary: string;
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
  userEdited: boolean;
  charCount: number;
  assistantMessageId: number | null;
};

function clampRecord(text: string, max = MEMORY_RECORD_MAX_CHARS): string {
  return clampMemoryRecordSummary(text, max, ROLLING_SUMMARY_MIN_CHARS);
}

export function formatTurnRangeLabel(startTurn: number, endTurn: number): string {
  return `${startTurn}~${endTurn}턴`;
}

export function formatMemoryBlock(startTurn: number, endTurn: number, summary: string): string {
  return `[${formatTurnRangeLabel(startTurn, endTurn)}] ${summary.trim()}`;
}

/** chat_turn_summaries → 시간순(오래된 것 위) 로어북 본문 */
export function rebuildLorebookFromRecords(
  chatId: number,
  opts?: { excludeTurnStartGte?: number }
): string {
  let records = listMemoryRecordsForChat(chatId);
  const cutoff = opts?.excludeTurnStartGte;
  if (cutoff != null && cutoff > 0) {
    records = records.filter((r) => r.turnEnd < cutoff);
  }
  return records.map((r) => formatMemoryBlock(r.turnStart, r.turnEnd, r.summary)).join("\n\n");
}

export function listMemoryRecordsForChat(chatId: number): MemoryRecordView[] {
  const rows = getDb()
    .prepare(
      `SELECT id, chat_id, turn_number, assistant_message_id, summary, user_edited, created_at, updated_at
       FROM chat_turn_summaries WHERE chat_id=? ORDER BY turn_number ASC`
    )
    .all(chatId) as MemoryRecordRow[];

  return rows.map((r) => {
    const turnStart = r.turn_number;
    const turnEnd = turnStart + ROLLING_SUMMARY_INTERVAL - 1;
    return {
      id: r.id,
      turnStart,
      turnEnd,
      turnRangeLabel: formatTurnRangeLabel(turnStart, turnEnd),
      summary: r.summary,
      userEdited: r.user_edited === 1,
      charCount: r.summary.length,
      assistantMessageId: r.assistant_message_id ?? null,
    };
  });
}

/** @deprecated listMemoryRecordsForChat 사용 */
export function listTurnSummariesForChat(chatId: number): {
  id: number;
  turnNumber: number;
  summary: string;
  userEdited: boolean;
  charCount: number;
}[] {
  return listMemoryRecordsForChat(chatId).map((r) => ({
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
}): Promise<MemoryRecordView> {
  const summary = clampRecord(opts.summary);
  const db = getDb();
  const existing = db
    .prepare("SELECT id FROM chat_turn_summaries WHERE chat_id=? AND turn_number=?")
    .get(opts.chatId, opts.turnStart) as { id: number } | undefined;

  if (existing) {
    db.prepare(
      `UPDATE chat_turn_summaries SET
        summary=?, assistant_message_id=COALESCE(?, assistant_message_id),
        user_edited=?, updated_at=datetime('now')
       WHERE id=?`
    ).run(summary, opts.assistantMessageId, opts.userEdited ? 1 : 0, existing.id);
  } else {
    db.prepare(
      `INSERT INTO chat_turn_summaries
        (chat_id, turn_number, assistant_message_id, summary, user_edited)
       VALUES (?,?,?,?,?)`
    ).run(
      opts.chatId,
      opts.turnStart,
      opts.assistantMessageId,
      summary,
      opts.userEdited ? 1 : 0
    );
  }

  const row = db
    .prepare(
      `SELECT id, chat_id, turn_number, assistant_message_id, summary, user_edited, created_at, updated_at
       FROM chat_turn_summaries WHERE chat_id=? AND turn_number=?`
    )
    .get(opts.chatId, opts.turnStart) as MemoryRecordRow;

  const turnEnd = row.turn_number + ROLLING_SUMMARY_INTERVAL - 1;
  return {
    id: row.id,
    turnStart: row.turn_number,
    turnEnd,
    turnRangeLabel: formatTurnRangeLabel(row.turn_number, turnEnd),
    summary: row.summary,
    userEdited: row.user_edited === 1,
    charCount: row.summary.length,
    assistantMessageId: row.assistant_message_id ?? null,
  };
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
    .prepare("SELECT id, turn_number FROM chat_turn_summaries WHERE id=? AND chat_id=?")
    .get(recordId, chatId) as { id: number; turn_number: number } | undefined;
  if (!row) return null;

  db.prepare(
    `UPDATE chat_turn_summaries SET summary=?, user_edited=1, updated_at=datetime('now') WHERE id=?`
  ).run(text, recordId);

  const updated = db
    .prepare(
      `SELECT id, chat_id, turn_number, assistant_message_id, summary, user_edited, created_at, updated_at
       FROM chat_turn_summaries WHERE id=?`
    )
    .get(recordId) as MemoryRecordRow;

  const turnEnd = updated.turn_number + ROLLING_SUMMARY_INTERVAL - 1;
  return {
    id: updated.id,
    turnStart: updated.turn_number,
    turnEnd,
    turnRangeLabel: formatTurnRangeLabel(updated.turn_number, turnEnd),
    summary: updated.summary,
    userEdited: true,
    charCount: updated.summary.length,
    assistantMessageId: updated.assistant_message_id ?? null,
  };
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
