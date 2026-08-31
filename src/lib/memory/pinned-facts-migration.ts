import type Database from "better-sqlite3";
import { computeLegacyPinnedFold } from "./pinned-facts-fold";

const PINNED_FACTS_FOLDED_FLAG = "pinned_facts_folded_v1";

type LegacyPinnedRow = {
  chat_id: number;
  pinned_facts: string;
  recent_summary: string;
  archive_summary: string;
};

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

function ensureSchemaFlagsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _schema_flags (
      key TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

function pinnedFactsFoldFlagExists(db: Database.Database): boolean {
  ensureSchemaFlagsTable(db);
  return Boolean(
    db
      .prepare(`SELECT 1 AS ok FROM _schema_flags WHERE key=?`)
      .get(PINNED_FACTS_FOLDED_FLAG)
  );
}

function listLegacyPinnedRows(db: Database.Database): LegacyPinnedRow[] {
  if (!tableExists(db, "chat_memories")) return [];
  if (!hasColumn(db, "chat_memories", "pinned_facts")) return [];
  return db
    .prepare(
      `SELECT chat_id, pinned_facts, recent_summary, archive_summary
       FROM chat_memories
       WHERE COALESCE(pinned_facts, '') <> ''`
    )
    .all() as LegacyPinnedRow[];
}

/** Global deterministic fold of legacy chat_memories.pinned_facts into recent_summary. */
export function migrateLegacyPinnedFactsIntoRecentSummary(db: Database.Database): void {
  if (!tableExists(db, "chat_memories")) return;
  if (!hasColumn(db, "chat_memories", "pinned_facts")) return;

  const updateStmt = db.prepare(
    `UPDATE chat_memories SET
       pinned_facts='',
       recent_summary=?,
       used_chars=?,
       updated_at=datetime('now')
     WHERE chat_id=?`
  );

  const tx = db.transaction(() => {
    ensureSchemaFlagsTable(db);
    const flagExists = Boolean(
      db
        .prepare(`SELECT 1 AS ok FROM _schema_flags WHERE key=?`)
        .get(PINNED_FACTS_FOLDED_FLAG)
    );
    const candidates = listLegacyPinnedRows(db);

    if (flagExists && candidates.length === 0) return;

    for (const row of candidates) {
      const folded = computeLegacyPinnedFold(row);
      if (!folded) continue;
      updateStmt.run(folded.recent_summary, folded.used_chars, row.chat_id);
    }

    db.prepare(`INSERT OR IGNORE INTO _schema_flags (key) VALUES (?)`).run(
      PINNED_FACTS_FOLDED_FLAG
    );
  });
  tx();
}

export { PINNED_FACTS_FOLDED_FLAG, pinnedFactsFoldFlagExists, listLegacyPinnedRows };
