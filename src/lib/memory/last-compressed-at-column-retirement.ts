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

/** Schema objects other than chat_memories table DDL that reference last_compressed_at. */
function listBlockingLastCompressedAtSchemaDependencies(db: Database.Database): string[] {
  const rows = db
    .prepare(
      `SELECT type, name, tbl_name FROM sqlite_master
       WHERE sql IS NOT NULL
         AND INSTR(LOWER(sql), 'last_compressed_at') > 0
         AND NOT (type = 'table' AND name = 'chat_memories')`
    )
    .all() as Array<{ type: string; name: string; tbl_name: string }>;
  return rows.map((row) => `${row.type}:${row.name}`);
}

/**
 * Physical retirement of chat_memories.last_compressed_at (#789 write-only dead column).
 * Idempotent via actual column presence. Non-null historical values are discarded on DROP.
 */
export function dropLastCompressedAtColumnOnce(db: Database.Database): void {
  if (!tableExists(db, "chat_memories")) return;
  if (!hasColumn(db, "chat_memories", "last_compressed_at")) return;

  const tx = db.transaction(() => {
    const dependencies = listBlockingLastCompressedAtSchemaDependencies(db);
    if (dependencies.length > 0) {
      throw new Error(
        `Refusing to DROP chat_memories.last_compressed_at: schema dependencies ${dependencies.join(", ")}`
      );
    }

    db.exec(`ALTER TABLE chat_memories DROP COLUMN last_compressed_at`);

    if (hasColumn(db, "chat_memories", "last_compressed_at")) {
      throw new Error("chat_memories.last_compressed_at still present after DROP COLUMN");
    }
  });
  tx();
}

export {
  hasColumn as hasChatMemoriesColumn,
  listBlockingLastCompressedAtSchemaDependencies,
  tableExists as chatMemoriesTableExists,
};
