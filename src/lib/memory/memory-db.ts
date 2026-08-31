import { getDb } from "@/lib/db";
import {
  clearChatsMemoryColumnIfPresent,
} from "@/lib/memory/chats-memory-column-compat";
import {
  migrateLegacyCurrentSummaryIntoCanonical,
} from "@/lib/memory/chats-memory-convergence";
import type { ChatMemoryRow, MemoryTier } from "./memory-types";
import { calcUsedChars } from "./memory-used-chars";

export { calcUsedChars } from "./memory-used-chars";

const CHAT_MEMORY_SELECT = `SELECT id, chat_id, user_id, character_id, recent_summary, archive_summary,
              membership_tier, used_chars, message_count, summarized_turn_count,
              memory_reset_after_message_id, memory_epoch,
              created_at, updated_at
       FROM chat_memories WHERE chat_id=?`;

export function getOrCreateChatMemory(
  chatId: number,
  userId: number,
  characterId: number,
  tier: MemoryTier
): ChatMemoryRow {
  const db = getDb();
  let row = db.prepare(CHAT_MEMORY_SELECT).get(chatId) as ChatMemoryRow | undefined;

  if (!row) {
    migrateLegacyCurrentSummaryIntoCanonical(db, chatId, userId, characterId, tier);
    row = db.prepare(CHAT_MEMORY_SELECT).get(chatId) as ChatMemoryRow | undefined;
    if (!row) {
      db.prepare(
        `INSERT INTO chat_memories
          (chat_id, user_id, character_id, recent_summary, archive_summary, membership_tier, used_chars, summarized_turn_count)
         VALUES (?,?,?,?,?,?,?,0)`
      ).run(chatId, userId, characterId, "", "", tier, 0);
      row = db.prepare(CHAT_MEMORY_SELECT).get(chatId) as ChatMemoryRow;
    }
  } else if (row.membership_tier !== tier) {
    db.prepare(
      `UPDATE chat_memories SET membership_tier=?, updated_at=datetime('now') WHERE chat_id=?`
    ).run(tier, chatId);
    row = { ...row, membership_tier: tier };
  }

  if (row && row.summarized_turn_count == null) {
    row = { ...row, summarized_turn_count: 0 };
  }

  return row;
}

/** Read-only fetch — never inserts, migrates, or updates chat_memories. */
export function getChatMemoryRow(chatId: number): ChatMemoryRow | null {
  const row = getDb().prepare(CHAT_MEMORY_SELECT).get(chatId) as ChatMemoryRow | undefined;
  return row ?? null;
}

export function updateChatMemory(
  chatId: number,
  userId: number,
  characterId: number,
  patch: Partial<
    Pick<
      ChatMemoryRow,
      | "recent_summary"
      | "archive_summary"
      | "membership_tier"
      | "message_count"
      | "summarized_turn_count"
    >
  >
): ChatMemoryRow {
  const db = getDb();
  const current = getOrCreateChatMemory(chatId, userId, characterId, patch.membership_tier ?? "free");

  const recent = patch.recent_summary ?? current.recent_summary;
  const archive = patch.archive_summary ?? current.archive_summary;
  const tier = patch.membership_tier ?? current.membership_tier;
  const used = calcUsedChars({ recent_summary: recent, archive_summary: archive });

  db.prepare(
    `UPDATE chat_memories SET
      recent_summary=?, archive_summary=?,
      membership_tier=?, used_chars=?, message_count=COALESCE(?, message_count),
      summarized_turn_count=COALESCE(?, summarized_turn_count),
      updated_at=datetime('now')
     WHERE chat_id=?`
  ).run(
    recent,
    archive,
    tier,
    used,
    patch.message_count ?? null,
    patch.summarized_turn_count ?? null,
    chatId
  );

  return getOrCreateChatMemory(chatId, userId, characterId, tier);
}

export function clearChatMemory(chatId: number, userId: number, characterId: number, tier: MemoryTier): void {
  const db = getDb();
  db.prepare(
    `UPDATE chat_memories SET
      recent_summary='', archive_summary='',
      used_chars=0, message_count=0, summarized_turn_count=0, updated_at=datetime('now')
     WHERE chat_id=?`
  ).run(chatId);
  db.prepare(`UPDATE chats SET current_summary='' WHERE id=? AND user_id=?`).run(chatId, userId);
  clearChatsMemoryColumnIfPresent(db, chatId, userId);
  getOrCreateChatMemory(chatId, userId, characterId, tier);
}
export function upgradeTierForUser(userId: number, tier: MemoryTier): void {
  const db = getDb();
  db.prepare(
    `UPDATE chat_memories SET membership_tier=?, updated_at=datetime('now') WHERE user_id=?`
  ).run(tier, userId);
}
