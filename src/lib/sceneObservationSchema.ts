import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";

/** Runtime twin of boot DDL for scene_event_observation_* tables. */
export function ensureSceneObservationSchema(
  db: Database.Database = getDb()
): void {
  try {
    db.pragma("busy_timeout = 5000");
  } catch {
    // ignore
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS scene_event_observation_runs (
      id TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL UNIQUE,
      scene_evidence_event_id TEXT NOT NULL,
      chat_id INTEGER NOT NULL,
      scene_id TEXT NOT NULL,
      resolver_version INTEGER NOT NULL,
      status TEXT NOT NULL,
      candidate_count INTEGER NOT NULL DEFAULT 0,
      observed_count INTEGER NOT NULL DEFAULT 0,
      rejected_count INTEGER NOT NULL DEFAULT 0,
      error_code TEXT,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_observation_runs_event
      ON scene_event_observation_runs(
        scene_evidence_event_id,
        resolver_version
      );

    CREATE TABLE IF NOT EXISTS scene_event_observations (
      id TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL UNIQUE,
      observation_run_id TEXT NOT NULL,
      scene_evidence_event_id TEXT NOT NULL,
      chat_id INTEGER NOT NULL,
      scene_id TEXT NOT NULL,
      turn_number INTEGER NOT NULL,
      observer_type TEXT NOT NULL,
      observer_id TEXT NOT NULL,
      modality TEXT NOT NULL,
      observation_state TEXT NOT NULL,
      reason_code TEXT NOT NULL,
      confidence INTEGER NOT NULL,
      observer_state_snapshot_json TEXT NOT NULL DEFAULT '{}',
      event_scope_snapshot_json TEXT NOT NULL DEFAULT '{}',
      resolver_version INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_scene_observations_event
      ON scene_event_observations(
        scene_evidence_event_id,
        observation_state
      );
    CREATE INDEX IF NOT EXISTS idx_scene_observations_observer
      ON scene_event_observations(
        chat_id,
        observer_type,
        observer_id,
        turn_number
      );
  `);
}
