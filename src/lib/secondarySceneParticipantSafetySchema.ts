import type Database from "better-sqlite3";

/** Dedicated adult-safety projection. Not chat_observers.metadata_json. */
export const SCENE_SECONDARY_PARTICIPANT_SAFETY_TABLE =
  "scene_secondary_participant_safety";

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
  first_seen_turn: number | null;
  last_seen_turn: number | null;
  left_turn: number | null;
  created_at: string;
  updated_at: string;
};

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
  `);
}
