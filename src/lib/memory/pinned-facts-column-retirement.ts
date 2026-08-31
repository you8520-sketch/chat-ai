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

function countDirtyPinnedRows(db: Database.Database): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c FROM chat_memories
       WHERE COALESCE(pinned_facts, '') <> ''`
    )
    .get() as { c: number };
  return Number(row.c);
}

/** Schema objects other than chat_memories table DDL that reference pinned_facts. */
function listBlockingPinnedFactsSchemaDependencies(db: Database.Database): string[] {
  const rows = db
    .prepare(
      `SELECT type, name, tbl_name FROM sqlite_master
       WHERE sql IS NOT NULL
         AND INSTR(LOWER(sql), 'pinned_facts') > 0
         AND NOT (type = 'table' AND name = 'chat_memories')`
    )
    .all() as Array<{ type: string; name: string; tbl_name: string }>;
  return rows.map((row) => `${row.type}:${row.name}`);
}

/**
 * Physical retirement of chat_memories.pinned_facts.
 * Idempotent via actual column presence. Fail-closed on dirty rows or blocking dependencies.
 */
export function dropPinnedFactsColumnOnce(db: Database.Database): void {
  if (!tableExists(db, "chat_memories")) return;
  if (!hasColumn(db, "chat_memories", "pinned_facts")) return;

  const tx = db.transaction(() => {
    const dirtyCount = countDirtyPinnedRows(db);
    if (dirtyCount > 0) {
      throw new Error(
        `Refusing to DROP chat_memories.pinned_facts: ${dirtyCount} dirty pinned row(s) remain`
      );
    }

    const dependencies = listBlockingPinnedFactsSchemaDependencies(db);
    if (dependencies.length > 0) {
      throw new Error(
        `Refusing to DROP chat_memories.pinned_facts: schema dependencies ${dependencies.join(", ")}`
      );
    }

    db.exec(`ALTER TABLE chat_memories DROP COLUMN pinned_facts`);

    if (hasColumn(db, "chat_memories", "pinned_facts")) {
      throw new Error("chat_memories.pinned_facts still present after DROP COLUMN");
    }
  });
  tx();
}

export {
  countDirtyPinnedRows,
  hasColumn as hasChatMemoriesColumn,
  listBlockingPinnedFactsSchemaDependencies,
  tableExists as chatMemoriesTableExists,
};
