import type Database from "better-sqlite3";

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

function chatMemoryRowExistsCore(db: Database.Database, chatId: number): boolean {
  return Boolean(
    db.prepare(`SELECT 1 AS ok FROM chat_memories WHERE chat_id=?`).get(chatId)
  );
}

export function getMemorySourceBoundaryCore(
  db: Database.Database,
  chatId: number
): MemorySourceBoundary {
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
  if (!chatMemoryRowExistsCore(db, guard.chatId)) return false;
  const current = getMemorySourceBoundaryCore(db, guard.chatId);
  if (!memoryBoundariesEqual(current, guard.snapshot)) return false;
  return (guard.sourceUserMessageIds ?? []).every((sourceUserMessageId) =>
    isMemorySourceEligible({ sourceUserMessageId, boundary: current })
  );
}

/**
 * Canonical derived-memory generation invalidation — NOT a user memory reset.
 * Bumps memory_epoch so in-flight background writes with an older snapshot fail closed.
 * Does not clear summaries, episodic facts, or canonical content.
 */
export function invalidateDerivedMemoryGenerationCore(
  db: Database.Database,
  chatId: number
): MemorySourceBoundary {
  if (!chatMemoryRowExistsCore(db, chatId)) {
    return DEFAULT_BOUNDARY;
  }
  const before = getMemorySourceBoundaryCore(db, chatId);
  const epochAfter = before.epoch + 1;
  db.prepare(
    `UPDATE chat_memories SET memory_epoch=?, updated_at=datetime('now') WHERE chat_id=?`
  ).run(epochAfter, chatId);
  return { resetAfterMessageId: before.resetAfterMessageId, epoch: epochAfter };
}

export function invalidateDerivedMemoryGeneration(chatId: number): MemorySourceBoundary {
  return invalidateDerivedMemoryGenerationCore(getDb(), chatId);
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
      (chat_id, user_id, character_id, recent_summary, archive_summary,
       membership_tier, used_chars, message_count, summarized_turn_count,
       memory_reset_after_message_id, memory_epoch)
     VALUES (?,?,?,?,?,?,?,0,0,NULL,0)`
  ).run(
    opts.chatId,
    opts.userId,
    opts.characterId,
    "",
    "",
    opts.tier,
    0
  );
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
