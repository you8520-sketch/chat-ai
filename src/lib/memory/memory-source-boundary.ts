import type Database from "better-sqlite3";

import { EMPTY_MEMORY_META } from "@/lib/chatMemory";
import { getDb } from "@/lib/db";
import type { MemoryTier } from "./memory-types";

export type MemorySourceBoundary = {
  resetAfterMessageId: number | null;
  epoch: number;
};

export type MemoryWriteGuard = {
  chatId: number;
  snapshot: MemorySourceBoundary;
  sourceUserMessageIds?: readonly (number | null | undefined)[];
};

const DEFAULT_BOUNDARY: MemorySourceBoundary = {
  resetAfterMessageId: null,
  epoch: 0,
};

function positiveInt(value: unknown): number | null {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

export function getMemorySourceBoundaryCore(
  db: Database.Database,
  chatId: number
): MemorySourceBoundary {
  try {
    const row = db
      .prepare(
        `SELECT memory_reset_after_message_id, memory_epoch
         FROM chat_memories WHERE chat_id=?`
      )
      .get(chatId) as
      | { memory_reset_after_message_id: number | null; memory_epoch: number | null }
      | undefined;
    if (!row) return DEFAULT_BOUNDARY;
    return {
      resetAfterMessageId: positiveInt(row.memory_reset_after_message_id),
      epoch: Math.max(0, Math.floor(Number(row.memory_epoch) || 0)),
    };
  } catch {
    // Isolated legacy tests may intentionally create only a subset of tables.
    return DEFAULT_BOUNDARY;
  }
}

export function getMemorySourceBoundary(chatId: number): MemorySourceBoundary {
  return getMemorySourceBoundaryCore(getDb(), chatId);
}

export function memoryBoundariesEqual(
  a: MemorySourceBoundary,
  b: MemorySourceBoundary
): boolean {
  return a.resetAfterMessageId === b.resetAfterMessageId && a.epoch === b.epoch;
}

export function isMemorySourceEligible(opts: {
  sourceUserMessageId: number | null | undefined;
  boundary: MemorySourceBoundary;
}): boolean {
  const sourceId = positiveInt(opts.sourceUserMessageId);
  if (opts.boundary.resetAfterMessageId == null) return true;
  return sourceId != null && sourceId > opts.boundary.resetAfterMessageId;
}

export function isMemoryWriteGuardCurrentCore(
  db: Database.Database,
  guard: MemoryWriteGuard
): boolean {
  const current = getMemorySourceBoundaryCore(db, guard.chatId);
  if (!memoryBoundariesEqual(current, guard.snapshot)) return false;
  return (guard.sourceUserMessageIds ?? []).every((sourceUserMessageId) =>
    isMemorySourceEligible({ sourceUserMessageId, boundary: current })
  );
}

export function resolveCanonicalSourceUserMessageIdCore(
  db: Database.Database,
  opts: { chatId: number; assistantMessageId: number }
): number | null {
  const assistant = db
    .prepare(
      `SELECT id, user_message_id FROM messages
       WHERE id=? AND chat_id=? AND role='assistant'`
    )
    .get(opts.assistantMessageId, opts.chatId) as
    | { id: number; user_message_id: number | null }
    | undefined;
  if (!assistant) return null;

  const linkedId = positiveInt(assistant.user_message_id);
  if (linkedId != null) {
    const linked = db
      .prepare(`SELECT id FROM messages WHERE id=? AND chat_id=? AND role='user'`)
      .get(linkedId, opts.chatId) as { id: number } | undefined;
    if (linked) return linked.id;
  }

  const fallback = db
    .prepare(
      `SELECT id FROM messages
       WHERE chat_id=? AND role='user' AND id < ?
       ORDER BY id DESC LIMIT 1`
    )
    .get(opts.chatId, opts.assistantMessageId) as { id: number } | undefined;
  return fallback?.id ?? null;
}

export function resolveCanonicalSourceUserMessageId(opts: {
  chatId: number;
  assistantMessageId: number;
}): number | null {
  return resolveCanonicalSourceUserMessageIdCore(getDb(), opts);
}

export function ensureChatMemoryRowCore(
  db: Database.Database,
  opts: {
    chatId: number;
    userId: number;
    characterId: number;
    tier: MemoryTier;
  }
): void {
  db.prepare(
    `INSERT OR IGNORE INTO chat_memories
      (chat_id, user_id, character_id, pinned_facts, recent_summary, archive_summary,
       membership_tier, used_chars, message_count, summarized_turn_count,
       memory_reset_after_message_id, memory_epoch)
     VALUES (?,?,?,?,?,?,?,?,0,0,NULL,0)`
  ).run(
    opts.chatId,
    opts.userId,
    opts.characterId,
    "",
    "",
    "",
    opts.tier,
    0
  );
}

export type AtomicMemoryResetResult = {
  boundaryBefore: number | null;
  boundaryAfter: number | null;
  epochBefore: number;
  epochAfter: number;
};

export function executeAtomicMemoryResetCore(
  db: Database.Database,
  opts: {
    chatId: number;
    userId: number;
    characterId: number;
    tier: MemoryTier;
  }
): AtomicMemoryResetResult {
  ensureChatMemoryRowCore(db, opts);
  const before = getMemorySourceBoundaryCore(db, opts.chatId);
  const tip = db
    .prepare(`SELECT MAX(id) AS max_id FROM messages WHERE chat_id=?`)
    .get(opts.chatId) as { max_id: number | null };
  const currentMax = positiveInt(tip?.max_id);
  const boundaryAfter = Math.max(
    before.resetAfterMessageId ?? 0,
    currentMax ?? 0
  ) || null;
  const epochAfter = before.epoch + 1;

  db.prepare(
    `UPDATE chat_memories SET
       pinned_facts='', recent_summary='', archive_summary='', used_chars=0,
       message_count=0, summarized_turn_count=0, last_compressed_at=NULL,
       memory_reset_after_message_id=?, memory_epoch=?, updated_at=datetime('now')
     WHERE chat_id=?`
  ).run(boundaryAfter, epochAfter, opts.chatId);
  db.prepare(`DELETE FROM memory_buffer WHERE chat_id=?`).run(opts.chatId);
  db.prepare(`DELETE FROM chat_turn_summaries WHERE chat_id=?`).run(opts.chatId);
  db.prepare(`DELETE FROM episodic_memory_facts WHERE chat_id=?`).run(opts.chatId);
  db.prepare(
    `UPDATE chats SET
       current_summary='', memory='', memory_meta=?,
       memory_pending='[]', memory_archived_turns=0
     WHERE id=? AND user_id=?`
  ).run(JSON.stringify(EMPTY_MEMORY_META), opts.chatId, opts.userId);

  return {
    boundaryBefore: before.resetAfterMessageId,
    boundaryAfter,
    epochBefore: before.epoch,
    epochAfter,
  };
}

export function executeAtomicMemoryReset(opts: {
  chatId: number;
  userId: number;
  characterId: number;
  tier: MemoryTier;
}): AtomicMemoryResetResult {
  const db = getDb();
  const result = db.transaction(() => executeAtomicMemoryResetCore(db, opts)).immediate();
  console.info("MEMORY_RESET_COMMITTED", {
    chat_id: opts.chatId,
    epoch_before: result.epochBefore,
    epoch_after: result.epochAfter,
    boundary_before: result.boundaryBefore,
    boundary_after: result.boundaryAfter,
  });
  return result;
}

export function initializeForkMemoryBoundaryCore(
  db: Database.Database,
  opts: {
    chatId: number;
    userId: number;
    characterId: number;
    tier: MemoryTier;
    resetAfterMessageId: number | null;
  }
): void {
  ensureChatMemoryRowCore(db, opts);
  db.prepare(
    `UPDATE chat_memories SET
       memory_reset_after_message_id=?, memory_epoch=0, updated_at=datetime('now')
     WHERE chat_id=?`
  ).run(opts.resetAfterMessageId, opts.chatId);
}
