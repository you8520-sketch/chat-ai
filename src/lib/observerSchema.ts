import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";

/** Runtime twin of boot DDL for observer/scene tables (PR-S4A). */
export function ensureObserverSchema(db: Database.Database = getDb()): void {
  try {
    db.pragma("busy_timeout = 5000");
  } catch {
    // ignore
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_observers (
      chat_id INTEGER NOT NULL,
      observer_type TEXT NOT NULL,
      observer_id TEXT NOT NULL,
      canonical_source_type TEXT NOT NULL,
      canonical_source_id TEXT,
      display_name TEXT NOT NULL DEFAULT '',
      entity_scope TEXT NOT NULL DEFAULT 'CHAT',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_turn INTEGER,
      retired_turn INTEGER,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (chat_id, observer_type, observer_id)
    );
    CREATE INDEX IF NOT EXISTS idx_chat_observers_active
      ON chat_observers(chat_id, is_active);

    CREATE TABLE IF NOT EXISTS chat_scenes (
      id TEXT PRIMARY KEY,
      chat_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      location_key TEXT,
      started_turn INTEGER NOT NULL,
      ended_turn INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_chat_scenes_active
      ON chat_scenes(chat_id, status);

    CREATE TABLE IF NOT EXISTS scene_observer_presence (
      scene_id TEXT NOT NULL,
      chat_id INTEGER NOT NULL,
      observer_type TEXT NOT NULL,
      observer_id TEXT NOT NULL,
      presence_state TEXT NOT NULL,
      awareness_state TEXT NOT NULL,
      location_key TEXT,
      visual_capability TEXT NOT NULL DEFAULT 'NORMAL',
      auditory_capability TEXT NOT NULL DEFAULT 'NORMAL',
      joined_turn INTEGER,
      left_turn INTEGER,
      source_type TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (scene_id, observer_type, observer_id)
    );
    CREATE INDEX IF NOT EXISTS idx_scene_presence_chat
      ON scene_observer_presence(chat_id, presence_state);
  `);
}
