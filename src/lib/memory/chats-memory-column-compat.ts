import type Database from "better-sqlite3";

function tableExists(db: Database.Database, name: string): boolean {
  return Boolean(
    db
      .prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?`)
      .get(name)
  );
}

export function hasChatsMemoryColumn(db: Database.Database): boolean {
  if (!tableExists(db, "chats")) return false;
  const rows = db.prepare(`PRAGMA table_info(chats)`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === "memory");
}

/** M1/M2 rollback-safe: clear legacy carrier only when column still exists. */
export function clearChatsMemoryColumnIfPresent(
  db: Database.Database,
  chatId: number,
  userId?: number
): void {
  if (!hasChatsMemoryColumn(db)) return;
  if (userId != null) {
    db.prepare(`UPDATE chats SET memory='' WHERE id=? AND user_id=?`).run(chatId, userId);
    return;
  }
  db.prepare(`UPDATE chats SET memory='' WHERE id=?`).run(chatId);
}
