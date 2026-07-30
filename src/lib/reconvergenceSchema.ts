import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";

/**
 * Schema for SceneDirective V2 reconvergence.
 * production: chat_reconvergence_state
 * shadow: chat_reconvergence_shadow_state (never read by ON inject path)
 */
export function ensureReconvergenceSchema(db: Database.Database = getDb()): void {
  try {
    db.pragma("busy_timeout = 5000");
  } catch {
    // ignore
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_reconvergence_state (
      chat_id INTEGER NOT NULL,
      character_id INTEGER NOT NULL,
      state TEXT NOT NULL,
      separation_turn INTEGER,
      reconvergence_due_turn INTEGER,
      last_shared_location_key TEXT,
      unresolved_hooks_json TEXT NOT NULL DEFAULT '[]',
      last_method TEXT,
      method_cooldown_until_turn INTEGER,
      offered_turn INTEGER,
      version INTEGER NOT NULL DEFAULT 0,
      last_transition_request_id TEXT,
      last_assistant_message_id INTEGER,
      last_generation_sequence INTEGER,
      last_source_turn INTEGER,
      trigger_defer_count INTEGER NOT NULL DEFAULT 0,
      no_contact_kind TEXT,
      deadline_missed_due_to_trigger INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (chat_id, character_id)
    );
    CREATE INDEX IF NOT EXISTS idx_chat_reconvergence_due
      ON chat_reconvergence_state(chat_id, reconvergence_due_turn);

    CREATE TABLE IF NOT EXISTS chat_reconvergence_shadow_state (
      chat_id INTEGER NOT NULL,
      character_id INTEGER NOT NULL,
      state TEXT NOT NULL,
      separation_turn INTEGER,
      reconvergence_due_turn INTEGER,
      last_shared_location_key TEXT,
      unresolved_hooks_json TEXT NOT NULL DEFAULT '[]',
      last_method TEXT,
      method_cooldown_until_turn INTEGER,
      offered_turn INTEGER,
      version INTEGER NOT NULL DEFAULT 0,
      last_transition_request_id TEXT,
      last_assistant_message_id INTEGER,
      last_generation_sequence INTEGER,
      last_source_turn INTEGER,
      trigger_defer_count INTEGER NOT NULL DEFAULT 0,
      no_contact_kind TEXT,
      deadline_missed_due_to_trigger INTEGER NOT NULL DEFAULT 0,
      hook_type TEXT,
      reason_codes_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (chat_id, character_id)
    );
    CREATE INDEX IF NOT EXISTS idx_chat_reconvergence_shadow_due
      ON chat_reconvergence_shadow_state(chat_id, reconvergence_due_turn);

    CREATE TABLE IF NOT EXISTS chat_reconvergence_transition_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      namespace TEXT NOT NULL,
      chat_id INTEGER NOT NULL,
      character_id INTEGER NOT NULL,
      request_id TEXT NOT NULL,
      assistant_message_id INTEGER,
      generation_sequence INTEGER,
      source_turn INTEGER,
      from_state TEXT,
      to_state TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(namespace, chat_id, character_id, request_id, source_turn, generation_sequence)
    );
  `);

  // Additive columns for DBs that already had the v1 reconvergence table.
  const addColumn = (table: string, col: string, def: string) => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!cols.some((c) => c.name === col)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
    }
  };
  for (const table of ["chat_reconvergence_state", "chat_reconvergence_shadow_state"]) {
    const exists = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
      .get(table);
    if (!exists) continue;
    addColumn(table, "version", "INTEGER NOT NULL DEFAULT 0");
    addColumn(table, "last_transition_request_id", "TEXT");
    addColumn(table, "last_assistant_message_id", "INTEGER");
    addColumn(table, "last_generation_sequence", "INTEGER");
    addColumn(table, "last_source_turn", "INTEGER");
    addColumn(table, "trigger_defer_count", "INTEGER NOT NULL DEFAULT 0");
    addColumn(table, "no_contact_kind", "TEXT");
    addColumn(table, "deadline_missed_due_to_trigger", "INTEGER NOT NULL DEFAULT 0");
  }
  addColumn("chat_reconvergence_shadow_state", "hook_type", "TEXT");
  addColumn("chat_reconvergence_shadow_state", "reason_codes_json", "TEXT NOT NULL DEFAULT '[]'");
}
