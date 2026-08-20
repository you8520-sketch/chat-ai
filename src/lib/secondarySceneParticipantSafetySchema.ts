import type Database from "better-sqlite3";

/** Dedicated adult-safety projection. Not chat_observers.metadata_json. */
export const SCENE_SECONDARY_PARTICIPANT_SAFETY_TABLE =
  "scene_secondary_participant_safety";

export const SCENE_SECONDARY_PARTICIPANT_SAFETY_EVENTS_TABLE =
  "scene_secondary_participant_safety_events";

export type SecondaryParticipantKind =
  | "dynamic"
  | "group"
  | "creator_npc"
  | "server_npc"
  | "party_character"
  | "trusted_cast";

export type SecondaryPresenceState = "PRESENT" | "ABSENT" | "UNKNOWN";

export type SecondaryEvidenceTrust =
  | "AUTHORITATIVE"
  | "RESTRICTIVE_ONLY"
  | "UNKNOWN";

export type SecondaryEvidenceSource =
  | "USER_PROSE"
  | "ASSISTANT_PROSE"
  | "CREATOR_NPC"
  | "SERVER_NPC"
  | "PARTY_CHARACTER"
  | "TRUSTED_CAST_PROFILE"
  | "AUTHORITATIVE_SCENE_PRESENCE";

export type SecondarySafetySourceRole = "user" | "assistant" | "authoritative";

export type SecondaryAdultStatus =
  | "unknown"
  | "confirmed"
  | "minor"
  | "conflict"
  | "real_person";

export type SceneSecondaryParticipantSafetyRow = {
  scene_id: string;
  chat_id: number;
  participant_id: string;
  display_name: string;
  participant_kind: SecondaryParticipantKind;
  presence_state: SecondaryPresenceState;
  age: number | null;
  adult_status: SecondaryAdultStatus | null;
  is_real_person: number | null;
  evidence_trust: SecondaryEvidenceTrust;
  evidence_source: SecondaryEvidenceSource;
  authoritative_age: number | null;
  authoritative_adult_status: SecondaryAdultStatus | null;
  authoritative_is_real_person: number | null;
  authoritative_source: SecondaryEvidenceSource | null;
  restrictive_age: number | null;
  restrictive_adult_status: SecondaryAdultStatus | null;
  restrictive_is_real_person: number | null;
  restrictive_source: SecondaryEvidenceSource | null;
  first_seen_turn: number | null;
  last_seen_turn: number | null;
  left_turn: number | null;
  created_at: string;
  updated_at: string;
};

export type SceneSecondaryParticipantSafetyEventRow = {
  id: string;
  scene_id: string;
  chat_id: number;
  participant_id: string;
  action: "ENTER" | "PRESENT" | "LEAVE";
  source_role: SecondarySafetySourceRole;
  source_message_id: number | null;
  source_turn: number | null;
  evidence_trust: SecondaryEvidenceTrust;
  evidence_source: SecondaryEvidenceSource;
  attached_age: number | null;
  restrictive_age: number | null;
  restrictive_adult_status: string | null;
  restrictive_is_real_person: number | null;
  created_at: string;
};

function addColumnIfMissing(
  db: Database.Database,
  table: string,
  column: string,
  def: string
): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
  }>;
  if (!cols.some((col) => col.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
  }
}

/** Runtime twin of boot DDL for secondary-scene participant safety. */
export function ensureSecondarySceneParticipantSafetySchema(
  db: Database.Database
): void {
  try {
    db.pragma("busy_timeout = 5000");
  } catch {
    // ignore — some test doubles may not support pragma
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS scene_secondary_participant_safety (
      scene_id TEXT NOT NULL,
      chat_id INTEGER NOT NULL,
      participant_id TEXT NOT NULL,
      display_name TEXT NOT NULL DEFAULT '',
      participant_kind TEXT NOT NULL,
      presence_state TEXT NOT NULL,
      age INTEGER,
      adult_status TEXT,
      is_real_person INTEGER,
      evidence_trust TEXT NOT NULL,
      evidence_source TEXT NOT NULL,
      authoritative_age INTEGER,
      authoritative_adult_status TEXT,
      authoritative_is_real_person INTEGER,
      authoritative_source TEXT,
      restrictive_age INTEGER,
      restrictive_adult_status TEXT,
      restrictive_is_real_person INTEGER,
      restrictive_source TEXT,
      first_seen_turn INTEGER,
      last_seen_turn INTEGER,
      left_turn INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (scene_id, participant_id)
    );
    CREATE INDEX IF NOT EXISTS idx_ssps_scene_presence
      ON scene_secondary_participant_safety(scene_id, presence_state);
    CREATE INDEX IF NOT EXISTS idx_ssps_chat_scene
      ON scene_secondary_participant_safety(chat_id, scene_id);

    CREATE TABLE IF NOT EXISTS scene_secondary_participant_safety_events (
      id TEXT PRIMARY KEY,
      scene_id TEXT NOT NULL,
      chat_id INTEGER NOT NULL,
      participant_id TEXT NOT NULL,
      action TEXT NOT NULL,
      source_role TEXT NOT NULL,
      source_message_id INTEGER,
      source_turn INTEGER,
      evidence_trust TEXT NOT NULL,
      evidence_source TEXT NOT NULL,
      attached_age INTEGER,
      restrictive_age INTEGER,
      restrictive_adult_status TEXT,
      restrictive_is_real_person INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ssps_events_scene_part
      ON scene_secondary_participant_safety_events(scene_id, participant_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_ssps_events_source_msg
      ON scene_secondary_participant_safety_events(chat_id, source_message_id);
  `);
  addColumnIfMissing(db, "scene_secondary_participant_safety", "authoritative_age", "INTEGER");
  addColumnIfMissing(
    db,
    "scene_secondary_participant_safety",
    "authoritative_adult_status",
    "TEXT"
  );
  addColumnIfMissing(
    db,
    "scene_secondary_participant_safety",
    "authoritative_is_real_person",
    "INTEGER"
  );
  addColumnIfMissing(
    db,
    "scene_secondary_participant_safety",
    "authoritative_source",
    "TEXT"
  );
  addColumnIfMissing(db, "scene_secondary_participant_safety", "restrictive_age", "INTEGER");
  addColumnIfMissing(
    db,
    "scene_secondary_participant_safety",
    "restrictive_adult_status",
    "TEXT"
  );
  addColumnIfMissing(
    db,
    "scene_secondary_participant_safety",
    "restrictive_is_real_person",
    "INTEGER"
  );
  addColumnIfMissing(
    db,
    "scene_secondary_participant_safety",
    "restrictive_source",
    "TEXT"
  );
}
