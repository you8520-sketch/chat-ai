const CREATE_SQL = `
CREATE TABLE IF NOT EXISTS memory_summary_migrations (
  chat_id INTEGER NOT NULL,
  migration_version TEXT NOT NULL,
  status TEXT NOT NULL,
  source_completed_turns INTEGER,
  target_summarized_through INTEGER,
  batches_total INTEGER,
  batches_completed INTEGER,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error_code TEXT,
  started_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  PRIMARY KEY (chat_id, migration_version)
);
CREATE INDEX IF NOT EXISTS idx_memory_summary_migrations_status
  ON memory_summary_migrations(status, migration_version);
`;

export function ensureMemorySummaryMigrationsTable(
  db: { exec: (sql: string) => unknown }
): void {
  db.exec(CREATE_SQL);
}
