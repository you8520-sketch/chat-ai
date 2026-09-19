import { getDb } from "@/lib/db";
import { splitLorebookBlocks } from "./memory-lorebook-trim";
import { upsertSummaryRowCore } from "./memory-summary-persist";
import { rebuildLorebookFromRecords } from "./memory-turn-summary";
import { highestContiguousCompletedTurn } from "./memory-summary-integrity";
import { listMemoryRecordsForChat } from "./memory-turn-summary";

const BLOCK_HEADER = /^\[(\d+)~(\d+)턴\]\s*([\s\S]*)$/;

export type ParsedLorebookBlock = {
  turnStart: number;
  turnEnd: number;
  summary: string;
};

/** Parse `[N~M턴] body` blocks from panel whole-memory edit text. */
export function parseLorebookBlocksFromUserEdit(text: string): ParsedLorebookBlock[] {
  const blocks = splitLorebookBlocks(text);
  const parsed: ParsedLorebookBlock[] = [];
  for (const block of blocks) {
    const match = block.match(BLOCK_HEADER);
    if (!match) continue;
    const turnStart = Number(match[1]);
    const turnEnd = Number(match[2]);
    const summary = match[3]?.trim() ?? "";
    if (!Number.isFinite(turnStart) || !Number.isFinite(turnEnd) || turnStart < 1 || turnEnd < turnStart) {
      continue;
    }
    if (!summary) continue;
    parsed.push({ turnStart, turnEnd, summary });
  }
  return parsed;
}

/**
 * Whole Current Memory panel edit → canonical chat_turn_summaries rows.
 * Prior injectible rows are soft-deactivated; parsed blocks are inserted as user_edited main_canon.
 */
export function syncUserEditedLorebookToCanonicalRecords(opts: {
  chatId: number;
  lorebook: string;
  playableTurnCount: number;
}): { recordCount: number; summarizedTurnCount: number } {
  const db = getDb();
  const parsed = parseLorebookBlocksFromUserEdit(opts.lorebook);
  const fallbackBody = opts.lorebook.trim();
  const summarizedTurnCount = Math.max(
    0,
    parsed.length > 0 ? Math.max(...parsed.map((b) => b.turnEnd)) : opts.playableTurnCount
  );

  db.transaction(() => {
    db.prepare(
      `UPDATE chat_turn_summaries
       SET inactive=1, updated_at=datetime('now')
       WHERE chat_id=? AND COALESCE(inactive, 0)=0`
    ).run(opts.chatId);

    if (parsed.length > 0) {
      for (const block of parsed) {
        upsertSummaryRowCore({
          chatId: opts.chatId,
          turnStart: block.turnStart,
          turnEnd: block.turnEnd,
          assistantMessageId: null,
          summary: block.summary,
          summaryKind: "main_canon",
          userEdited: true,
          inactive: false,
        });
      }
      return;
    }

    if (!fallbackBody) return;

    const turnEnd = Math.max(1, summarizedTurnCount || 1);
    upsertSummaryRowCore({
      chatId: opts.chatId,
      turnStart: 1,
      turnEnd,
      assistantMessageId: null,
      summary: fallbackBody,
      summaryKind: "main_canon",
      userEdited: true,
      inactive: false,
    });
  }).immediate();

  const records = listMemoryRecordsForChat(opts.chatId);
  const contiguous = highestContiguousCompletedTurn(records, opts.playableTurnCount);
  return {
    recordCount: records.filter((r) => !r.inactive).length,
    summarizedTurnCount: contiguous,
  };
}

export function rebuildAfterUserLorebookEdit(chatId: number): string {
  return rebuildLorebookFromRecords(chatId);
}
