import type Database from "better-sqlite3";

function tableExists(db: Database.Database, name: string): boolean {
  return Boolean(
    db
      .prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?`)
      .get(name)
  );
}

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  if (!tableExists(db, table)) return false;
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === column);
}

/** Schema objects other than chats table DDL that reference chats.memory. */
export function listBlockingChatsMemorySchemaDependencies(db: Database.Database): string[] {
  const rows = db
    .prepare(
      `SELECT type, name, tbl_name FROM sqlite_master
       WHERE sql IS NOT NULL
         AND INSTR(LOWER(sql), 'memory') > 0
         AND (
           (type IN ('index', 'trigger', 'view') AND tbl_name = 'chats')
           OR (type = 'table' AND name != 'chats' AND INSTR(LOWER(sql), 'chats') > 0)
         )
         AND INSTR(LOWER(sql), 'memory_meta') = 0
         AND INSTR(LOWER(sql), 'memory_pending') = 0
         AND INSTR(LOWER(sql), 'memory_capacity') = 0
         AND INSTR(LOWER(sql), 'memory_archived_turns') = 0
         AND (
           INSTR(LOWER(sql), '(memory)') > 0
           OR INSTR(LOWER(sql), ', memory') > 0
           OR INSTR(LOWER(sql), 'memory,') > 0
           OR INSTR(LOWER(sql), ' chats.memory') > 0
         )`
    )
    .all() as Array<{ type: string; name: string; tbl_name: string }>;
  return rows.map((row) => `${row.type}:${row.name}`);
}

/**
 * Physical retirement of chats.memory (#796 M1 carrier → M2 absent).
 * Idempotent via actual column presence. Run after convergeLegacyChatsMemoryIntoCanonical.
 */
export function dropChatsMemoryColumnOnce(db: Database.Database): void {
  if (!tableExists(db, "chats")) return;
  if (!hasColumn(db, "chats", "memory")) return;

  const tx = db.transaction(() => {
    const dependencies = listBlockingChatsMemorySchemaDependencies(db);
    if (dependencies.length > 0) {
      throw new Error(
        `Refusing to DROP chats.memory: schema dependencies ${dependencies.join(", ")}`
      );
    }

    db.exec(`ALTER TABLE chats DROP COLUMN memory`);

    if (hasColumn(db, "chats", "memory")) {
      throw new Error("chats.memory still present after DROP COLUMN");
    }
  });
  tx();
}

export {
  hasColumn as hasChatsTableColumn,
  tableExists as chatsTableExists,
};
