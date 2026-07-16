/**
 * Atomic 6-turn summary persistence — row + counter + recent_summary in one transaction.
 */
import { getDb } from "@/lib/db";
import { ROLLING_SUMMARY_INTERVAL } from "@/lib/hybridMemory";
import { calcUsedChars, getOrCreateChatMemory } from "./memory-db";
import type { MemoryTier } from "./memory-types";
import {
  formatMemoryBlock,
  formatTurnRangeLabel,
  listMemoryRecordsForChat,
  rebuildLorebookFromRecords,
  type MemoryRecordView,
} from "./memory-turn-summary";
import {
  highestContiguousCompletedTurn,
  type SummaryReasonCode,
  validateSummaryNarrative,
} from "./memory-summary-integrity";
import {
  encodeScopePayload,
  isEmptyOocScope,
  normalizeSummaryScope,
  type BranchStatus,
  type MemorySummaryScope,
  type ScopePayloadV1,
  type SummaryKind,
} from "./memory-summary-scope";

function syncChatLongTermMemory(chatId: number, summary: string): void {
  getDb().prepare("UPDATE chats SET current_summary=? WHERE id=?").run(summary.trim(), chatId);
}
export type PersistSummaryBatchResult =
  | { ok: true; reason: "SUMMARY_SUCCESS"; record: MemoryRecordView; summarizedTurnCount: number }
  | { ok: false; reason: SummaryReasonCode; error?: string };

function upsertRowInTx(opts: {
  chatId: number;
  turnStart: number;
  assistantMessageId: number | null;
  summary: string;
  summaryKind: MemorySummaryScope;
  userEdited: boolean;
  scopePayload?: ScopePayloadV1 | null;
  branchId?: string | null;
  branchStatus?: BranchStatus | null;
  promotedBy?: string | null;
  promotedAt?: string | null;
  inactive?: boolean;
}): void {
  const db = getDb();
  const existing = db
    .prepare("SELECT id, summary_kind FROM chat_turn_summaries WHERE chat_id=? AND turn_number=?")
    .get(opts.chatId, opts.turnStart) as { id: number; summary_kind?: string } | undefined;

  const payloadJson = opts.scopePayload ? encodeScopePayload(opts.scopePayload) : null;

  if (existing) {
    const prevEmpty = isEmptyOocScope(existing.summary_kind);
    if (prevEmpty && opts.summaryKind === "empty_ooc" && !opts.userEdited) {
      db.prepare(
        `UPDATE chat_turn_summaries SET
          assistant_message_id=COALESCE(?, assistant_message_id),
          updated_at=datetime('now')
         WHERE id=?`
      ).run(opts.assistantMessageId, existing.id);
      return;
    }
    db.prepare(
      `UPDATE chat_turn_summaries SET
        summary=?, summary_kind=?, assistant_message_id=COALESCE(?, assistant_message_id),
        scope_payload=?, branch_id=?, branch_status=?, promoted_by=?, promoted_at=?,
        inactive=?, user_edited=?, updated_at=datetime('now')
       WHERE id=?`
    ).run(
      opts.summary,
      opts.summaryKind,
      opts.assistantMessageId,
      payloadJson,
      opts.branchId ?? null,
      opts.branchStatus ?? null,
      opts.promotedBy ?? null,
      opts.promotedAt ?? null,
      opts.inactive ? 1 : 0,
      opts.userEdited ? 1 : 0,
      existing.id
    );
  } else {
    db.prepare(
      `INSERT INTO chat_turn_summaries
        (chat_id, turn_number, assistant_message_id, summary, summary_kind, user_edited,
         scope_payload, branch_id, branch_status, promoted_by, promoted_at, inactive)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      opts.chatId,
      opts.turnStart,
      opts.assistantMessageId,
      opts.summary,
      opts.summaryKind,
      opts.userEdited ? 1 : 0,
      payloadJson,
      opts.branchId ?? null,
      opts.branchStatus ?? null,
      opts.promotedBy ?? null,
      opts.promotedAt ?? null,
      opts.inactive ? 1 : 0
    );
  }
}

/**
 * Validate + insert batch row + set summarized_turn_count from contiguous table + recent_summary.
 * empty_ooc / noncanon complete contiguous progress; only injectible scopes enter recent_summary.
 */
export function persistValidatedSummaryBatch(opts: {
  chatId: number;
  userId: number;
  characterId: number;
  tier: MemoryTier;
  turnStart: number;
  assistantMessageId: number | null;
  summary: string;
  summaryKind?: SummaryKind | MemorySummaryScope;
  userEdited?: boolean;
  scopePayload?: ScopePayloadV1 | null;
  branchId?: string | null;
  branchStatus?: BranchStatus | null;
  promotedBy?: string | null;
  promotedAt?: string | null;
  inactive?: boolean;
  /** When set, used as recent_summary instead of rebuild (e.g. after compact). */
  recentSummaryOverride?: string;
  playableTurnCount: number;
  /** @internal test-only — throw after upsert to verify full txn rollback */
  __testThrowAfterUpsert?: boolean;
}): PersistSummaryBatchResult {
  const kind = normalizeSummaryScope(opts.summaryKind);
  const validated = validateSummaryNarrative(opts.summary, kind);
  if (!validated.ok) {
    return { ok: false, reason: validated.reason };
  }

  const turnEnd = opts.turnStart + ROLLING_SUMMARY_INTERVAL - 1;
  if ((opts.turnStart - 1) % ROLLING_SUMMARY_INTERVAL !== 0 || opts.turnStart < 1) {
    return { ok: false, reason: "SUMMARY_INVALID" };
  }

  const db = getDb();
  getOrCreateChatMemory(opts.chatId, opts.userId, opts.characterId, opts.tier);

  try {
    const run = db.transaction(() => {
      const before = listMemoryRecordsForChat(opts.chatId);
      const contiguousBefore = highestContiguousCompletedTurn(before, opts.playableTurnCount);
      const expectedNextStart = contiguousBefore === 0 ? 1 : contiguousBefore + 1;
      const existingSame = before.find((r) => r.turnStart === opts.turnStart);

      if (!existingSame && opts.turnStart !== expectedNextStart) {
        throw Object.assign(new Error("SUMMARY_BATCH_GAP"), { code: "SUMMARY_BATCH_GAP" as const });
      }

      upsertRowInTx({
        chatId: opts.chatId,
        turnStart: opts.turnStart,
        assistantMessageId: opts.assistantMessageId,
        summary: validated.text,
        summaryKind: validated.kind,
        userEdited: !!opts.userEdited,
        scopePayload: opts.scopePayload,
        branchId: opts.branchId,
        branchStatus: opts.branchStatus,
        promotedBy: opts.promotedBy,
        promotedAt: opts.promotedAt,
        inactive: opts.inactive,
      });

      if (opts.__testThrowAfterUpsert) {
        throw Object.assign(new Error("test forced failure after upsert"), {
          code: "SUMMARY_SAVE_FAILED" as const,
        });
      }

      const after = listMemoryRecordsForChat(opts.chatId);
      const contiguous = highestContiguousCompletedTurn(after, opts.playableTurnCount);
      const recent =
        opts.recentSummaryOverride?.trim() ||
        rebuildLorebookFromRecords(opts.chatId) ||
        "";

      const current = getOrCreateChatMemory(
        opts.chatId,
        opts.userId,
        opts.characterId,
        opts.tier
      );
      const used = calcUsedChars({
        pinned_facts: current.pinned_facts,
        recent_summary: recent,
        archive_summary: current.archive_summary,
      });

      db.prepare(
        `UPDATE chat_memories SET
          recent_summary=?,
          used_chars=?,
          summarized_turn_count=?,
          last_compressed_at=?,
          updated_at=datetime('now')
         WHERE chat_id=?`
      ).run(recent, used, contiguous, new Date().toISOString(), opts.chatId);

      syncChatLongTermMemory(opts.chatId, recent);

      const row = after.find((r) => r.turnStart === opts.turnStart);
      if (!row) {
        throw Object.assign(new Error("row missing after upsert"), {
          code: "SUMMARY_SAVE_FAILED" as const,
        });
      }

      return {
        record: {
          ...row,
          turnEnd,
          turnRangeLabel: formatTurnRangeLabel(opts.turnStart, turnEnd),
          summary: validated.text,
          summaryKind: validated.kind,
          userEdited: !!opts.userEdited,
          charCount: validated.text.length,
          assistantMessageId: opts.assistantMessageId,
        } satisfies MemoryRecordView,
        summarizedTurnCount: contiguous,
      };
    });

    const out = run();
    return {
      ok: true,
      reason: "SUMMARY_SUCCESS",
      record: out.record,
      summarizedTurnCount: out.summarizedTurnCount,
    };
  } catch (e) {
    const code = (e as { code?: SummaryReasonCode }).code;
    if (code === "SUMMARY_BATCH_GAP") {
      return { ok: false, reason: "SUMMARY_BATCH_GAP", error: (e as Error).message };
    }
    if (code === "SUMMARY_SAVE_FAILED") {
      return { ok: false, reason: "SUMMARY_SAVE_FAILED", error: (e as Error).message };
    }
    return {
      ok: false,
      reason: "SUMMARY_TRANSACTION_ROLLBACK",
      error: (e as Error).message,
    };
  }
}

/** Reconcile summarized_turn_count downward/upward to highest contiguous persisted batch. */
export function reconcileSummarizedTurnCountFromTable(opts: {
  chatId: number;
  userId: number;
  characterId: number;
  tier: MemoryTier;
  playableTurnCount: number;
}): number {
  const db = getDb();
  getOrCreateChatMemory(opts.chatId, opts.userId, opts.characterId, opts.tier);
  const records = listMemoryRecordsForChat(opts.chatId);
  const contiguous = highestContiguousCompletedTurn(records, opts.playableTurnCount);
  const recent = rebuildLorebookFromRecords(opts.chatId);
  const current = getOrCreateChatMemory(opts.chatId, opts.userId, opts.characterId, opts.tier);
  const used = calcUsedChars({
    pinned_facts: current.pinned_facts,
    recent_summary: recent,
    archive_summary: current.archive_summary,
  });

  db.transaction(() => {
    db.prepare(
      `UPDATE chat_memories SET
        recent_summary=?,
        used_chars=?,
        summarized_turn_count=?,
        updated_at=datetime('now')
       WHERE chat_id=?`
    ).run(recent, used, contiguous, opts.chatId);
    syncChatLongTermMemory(opts.chatId, recent);
  })();

  return contiguous;
}

export { formatMemoryBlock };
