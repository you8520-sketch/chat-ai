import type Database from "better-sqlite3";
import type { MemoryTier } from "./memory-types";
import {
  clearChatsMemoryColumnIfPresent,
  hasChatsCurrentSummaryColumn,
  hasChatsMemoryColumn,
} from "./chats-memory-column-compat";

const DEFAULT_GLOBAL_CONVERGENCE_TIER: MemoryTier = "free";

type OrphanLegacyChatRow = {
  id: number;
  user_id: number;
  character_id: number;
  current_summary?: string | null;
  memory?: string | null;
};

function tableExists(db: Database.Database, name: string): boolean {
  return Boolean(
    db
      .prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?`)
      .get(name)
  );
}

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

function listOrphanLegacyChatRows(
  db: Database.Database,
  hasMemoryCol: boolean,
  hasCurrentSummaryCol: boolean
): OrphanLegacyChatRow[] {
  if (!hasMemoryCol && !hasCurrentSummaryCol) return [];

  const selectCols = ["c.id", "c.user_id", "c.character_id"];
  if (hasCurrentSummaryCol) selectCols.push("c.current_summary");
  if (hasMemoryCol) selectCols.push("c.memory");

  return db
    .prepare(
      `SELECT ${selectCols.join(", ")}
       FROM chats c
       LEFT JOIN chat_memories cm ON cm.chat_id = c.id
       WHERE cm.chat_id IS NULL`
    )
    .all() as OrphanLegacyChatRow[];
}

function clearAllCurrentSummaryContent(db: Database.Database): void {
  if (!hasChatsCurrentSummaryColumn(db)) return;
  db.exec(`
    UPDATE chats
    SET current_summary=''
    WHERE TRIM(COALESCE(current_summary,'')) <> ''
  `);
}

/**
 * Global convergence — recover legacy chats.current_summary / chats.memory into chat_memories,
 * then zero current_summary carrier content. Precedence: existing chat_memories row >
 * current_summary > memory. Idempotent.
 */
export function convergeLegacyChatsMemoryIntoCanonical(db: Database.Database): void {
  if (!tableExists(db, "chats")) return;
  if (!tableExists(db, "chat_memories")) return;

  const hasMemoryCol = hasChatsMemoryColumn(db);
  const hasCurrentSummaryCol = hasChatsCurrentSummaryColumn(db);

  const tx = db.transaction(() => {
    for (const row of listOrphanLegacyChatRows(db, hasMemoryCol, hasCurrentSummaryCol)) {
      const text = selectLegacyText(row, hasMemoryCol);
      if (!text) continue;

      insertCanonicalFromLegacy(db, row, text, DEFAULT_GLOBAL_CONVERGENCE_TIER);
      clearChatsMemoryColumnIfPresent(db, row.id);
    }

    clearAllCurrentSummaryContent(db);

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
