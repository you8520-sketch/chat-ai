import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";

/** Runtime twin of boot DDL for scene_evidence_events. */
export function ensureSceneEvidenceSchema(
  db: Database.Database = getDb()
): void {
  try {
    db.pragma("busy_timeout = 5000");
  } catch {
    // ignore — some test doubles may not support pragma
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS scene_evidence_events (
      id TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL UNIQUE,
      chat_id INTEGER NOT NULL,
      turn_number INTEGER NOT NULL,
      source_message_id INTEGER,
      event_type TEXT NOT NULL,
      subject_type TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      actor_type TEXT,
      actor_id TEXT,
      source_type TEXT NOT NULL,
      confidence INTEGER NOT NULL,
      attributes_json TEXT NOT NULL DEFAULT '{}',
      visibility_json TEXT NOT NULL DEFAULT '{}',
      extractor_version INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_scene_evidence_chat_turn
      ON scene_evidence_events(chat_id, turn_number);
    CREATE INDEX IF NOT EXISTS idx_scene_evidence_type
      ON scene_evidence_events(chat_id, event_type);
  `);
}
