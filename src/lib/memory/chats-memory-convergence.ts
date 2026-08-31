import type Database from "better-sqlite3";
import type { MemoryTier } from "./memory-types";
import {
  clearChatsMemoryColumnIfPresent,
  hasChatsMemoryColumn,
} from "./chats-memory-column-compat";

const DEFAULT_GLOBAL_CONVERGENCE_TIER: MemoryTier = "free";

type OrphanLegacyChatRow = {
  id: number;
  user_id: number;
  character_id: number;
  current_summary: string | null;
  memory?: string | null;
};

function chatMemoriesRowExists(db: Database.Database, chatId: number): boolean {
  return Boolean(
    db.prepare(`SELECT 1 AS ok FROM chat_memories WHERE chat_id=?`).get(chatId)
  );
}

function selectLegacyText(row: OrphanLegacyChatRow, hasMemoryCol: boolean): string {
  const currentSummary = row.current_summary?.trim() ?? "";
  if (currentSummary) return currentSummary;
  if (!hasMemoryCol) return "";
  return row.memory?.trim() ?? "";
}

function insertCanonicalFromLegacy(
  db: Database.Database,
  row: OrphanLegacyChatRow,
  text: string,
  tier: MemoryTier
): void {
  db.prepare(
    `INSERT INTO chat_memories
      (chat_id, user_id, character_id, recent_summary, archive_summary, membership_tier, used_chars, summarized_turn_count)
     VALUES (?,?,?,?,?,?,?,0)`
  ).run(row.id, row.user_id, row.character_id, text, "", tier, text.length);
}

/**
 * Global M1 — converge legacy chats.current_summary / chats.memory into chat_memories.
 * Precedence: existing chat_memories row > current_summary > memory.
 * Idempotent via row existence + legacy emptiness.
 */
export function convergeLegacyChatsMemoryIntoCanonical(db: Database.Database): void {
  if (!tableExists(db, "chats")) return;

  const hasMemoryCol = hasChatsMemoryColumn(db);

  const tx = db.transaction(() => {
    const orphanRows = db
      .prepare(
        hasMemoryCol
          ? `SELECT c.id, c.user_id, c.character_id, c.current_summary, c.memory
             FROM chats c
             LEFT JOIN chat_memories cm ON cm.chat_id = c.id
             WHERE cm.chat_id IS NULL`
          : `SELECT c.id, c.user_id, c.character_id, c.current_summary
             FROM chats c
             LEFT JOIN chat_memories cm ON cm.chat_id = c.id
             WHERE cm.chat_id IS NULL`
      )
      .all() as OrphanLegacyChatRow[];

    for (const row of orphanRows) {
      const text = selectLegacyText(row, hasMemoryCol);
      if (!text) continue;

      insertCanonicalFromLegacy(db, row, text, DEFAULT_GLOBAL_CONVERGENCE_TIER);

      const currentSummary = row.current_summary?.trim() ?? "";
      const memoryOnly = hasMemoryCol && !currentSummary && Boolean(row.memory?.trim());
      if (memoryOnly) {
        db.prepare(`UPDATE chats SET current_summary=? WHERE id=?`).run(text, row.id);
      }

      clearChatsMemoryColumnIfPresent(db, row.id);
    }

    if (hasMemoryCol) {
      db.exec(`
        UPDATE chats
        SET memory=''
        WHERE TRIM(COALESCE(memory, '')) <> ''
          AND id IN (SELECT chat_id FROM chat_memories)
      `);
    }
  });
  tx();
}

function tableExists(db: Database.Database, name: string): boolean {
  return Boolean(
    db
      .prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?`)
      .get(name)
  );
}

/** Shared lazy/on-access bootstrap — current_summary only (memory never read). */
export function migrateLegacyCurrentSummaryIntoCanonical(
  db: Database.Database,
  chatId: number,
  userId: number,
  characterId: number,
  tier: MemoryTier
): void {
  if (chatMemoriesRowExists(db, chatId)) return;

  const legacy = db
    .prepare(
      `SELECT current_summary FROM chats
       WHERE id=? AND user_id=? AND character_id=?
         AND current_summary IS NOT NULL AND TRIM(current_summary) <> ''`
    )
    .get(chatId, userId, characterId) as { current_summary?: string } | undefined;

  if (!legacy) return;
  const text = legacy.current_summary?.trim() ?? "";
  if (!text) return;

  db.prepare(
    `INSERT INTO chat_memories
      (chat_id, user_id, character_id, recent_summary, archive_summary, membership_tier, used_chars, summarized_turn_count)
     VALUES (?,?,?,?,?,?,?,0)`
  ).run(chatId, userId, characterId, text, "", tier, text.length);
}
