import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";

/** Runtime twin of boot DDL for investigation_* tables. */
export function ensureInvestigationSchema(
  db: Database.Database = getDb()
): void {
  try {
    db.pragma("busy_timeout = 5000");
  } catch {
    // ignore
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS investigation_targets (
      id TEXT PRIMARY KEY,
      owner_scope TEXT NOT NULL,
      owner_id TEXT,
      target_type TEXT NOT NULL,
      target_key TEXT NOT NULL,
      display_label TEXT NOT NULL DEFAULT '',
      required_access_json TEXT NOT NULL DEFAULT '{}',
      result_payload_json TEXT NOT NULL DEFAULT '{}',
      is_active INTEGER NOT NULL DEFAULT 1,
      revision INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(owner_scope, owner_id, target_key)
    );
    CREATE INDEX IF NOT EXISTS idx_investigation_targets_scope
      ON investigation_targets(owner_scope, owner_id, is_active);

    CREATE TABLE IF NOT EXISTS investigation_attempts (
      id TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL UNIQUE,
      chat_id INTEGER NOT NULL,
      turn_number INTEGER NOT NULL,
      source_message_id INTEGER,
      actor_type TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      target_id TEXT,
      target_type TEXT NOT NULL,
      target_key TEXT NOT NULL,
      action_type TEXT NOT NULL,
      source_type TEXT NOT NULL,
      request_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL,
      failure_code TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_investigation_attempts_chat
      ON investigation_attempts(chat_id, turn_number);

    CREATE TABLE IF NOT EXISTS investigation_results (
      id TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL UNIQUE,
      attempt_id TEXT NOT NULL,
      chat_id INTEGER NOT NULL,
      turn_number INTEGER NOT NULL,
      target_id TEXT,
      result_type TEXT NOT NULL,
      result_state TEXT NOT NULL,
      result_tags_json TEXT NOT NULL DEFAULT '[]',
      observable_facts_json TEXT NOT NULL DEFAULT '[]',
      observer_type TEXT NOT NULL,
      observer_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      confidence INTEGER NOT NULL DEFAULT 100,
      resolver_version INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_investigation_results_chat
      ON investigation_results(chat_id, turn_number);
  `);
}
