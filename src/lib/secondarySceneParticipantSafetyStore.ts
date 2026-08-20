import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";
import {
  ensureSecondarySceneParticipantSafetySchema,
  type SceneSecondaryParticipantSafetyRow,
  type SecondaryAdultStatus,
  type SecondaryEvidenceSource,
  type SecondaryEvidenceTrust,
  type SecondaryParticipantKind,
  type SecondaryPresenceState,
} from "@/lib/secondarySceneParticipantSafetySchema";

export type SecondaryParticipantSafetyWrite = {
  sceneId: string;
  chatId: number;
  participantId: string;
  displayName: string;
  participantKind: SecondaryParticipantKind;
  presenceState: SecondaryPresenceState;
  age?: number | null;
  adultStatus?: SecondaryAdultStatus | null;
  isRealPerson?: boolean | null;
  evidenceTrust: SecondaryEvidenceTrust;
  evidenceSource: SecondaryEvidenceSource;
  firstSeenTurn?: number | null;
  lastSeenTurn?: number | null;
  leftTurn?: number | null;
};

function toRow(
  raw: SceneSecondaryParticipantSafetyRow
): SceneSecondaryParticipantSafetyRow {
  return raw;
}

export function upsertSecondaryParticipantSafety(
  input: SecondaryParticipantSafetyWrite,
  db: Database.Database = getDb()
): SceneSecondaryParticipantSafetyRow {
  ensureSecondarySceneParticipantSafetySchema(db);
  const existing = getSecondaryParticipantSafety(
    input.sceneId,
    input.participantId,
    db
  );
  const firstSeen =
    existing?.first_seen_turn ??
    input.firstSeenTurn ??
    input.lastSeenTurn ??
    null;
  db.prepare(
    `INSERT INTO scene_secondary_participant_safety (
       scene_id, chat_id, participant_id, display_name, participant_kind,
       presence_state, age, adult_status, is_real_person, evidence_trust,
       evidence_source, first_seen_turn, last_seen_turn, left_turn
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(scene_id, participant_id) DO UPDATE SET
       chat_id=excluded.chat_id,
       display_name=excluded.display_name,
       participant_kind=excluded.participant_kind,
       presence_state=excluded.presence_state,
       age=excluded.age,
       adult_status=excluded.adult_status,
       is_real_person=excluded.is_real_person,
       evidence_trust=excluded.evidence_trust,
       evidence_source=excluded.evidence_source,
       first_seen_turn=excluded.first_seen_turn,
       last_seen_turn=excluded.last_seen_turn,
       left_turn=excluded.left_turn,
       updated_at=datetime('now')`
  ).run(
    input.sceneId,
    input.chatId,
    input.participantId,
    input.displayName.slice(0, 120),
    input.participantKind,
    input.presenceState,
    input.age ?? null,
    input.adultStatus ?? null,
    input.isRealPerson == null ? null : input.isRealPerson ? 1 : 0,
    input.evidenceTrust,
    input.evidenceSource,
    firstSeen,
    input.lastSeenTurn ?? existing?.last_seen_turn ?? null,
    input.leftTurn ?? null
  );
  return getSecondaryParticipantSafety(input.sceneId, input.participantId, db)!;
}

export function getSecondaryParticipantSafety(
  sceneId: string,
  participantId: string,
  db: Database.Database = getDb()
): SceneSecondaryParticipantSafetyRow | null {
  ensureSecondarySceneParticipantSafetySchema(db);
  const row = db
    .prepare(
      `SELECT * FROM scene_secondary_participant_safety
       WHERE scene_id=? AND participant_id=?`
    )
    .get(sceneId, participantId) as SceneSecondaryParticipantSafetyRow | undefined;
  return row ? toRow(row) : null;
}

export function listSecondaryParticipantSafetyForScene(
  sceneId: string,
  db: Database.Database = getDb()
): SceneSecondaryParticipantSafetyRow[] {
  ensureSecondarySceneParticipantSafetySchema(db);
  return (
    db
      .prepare(
        `SELECT * FROM scene_secondary_participant_safety
         WHERE scene_id=?
         ORDER BY last_seen_turn ASC, created_at ASC`
      )
      .all(sceneId) as SceneSecondaryParticipantSafetyRow[]
  ).map(toRow);
}

export function listPresentSecondaryParticipants(
  sceneId: string,
  db: Database.Database = getDb()
): SceneSecondaryParticipantSafetyRow[] {
  return listSecondaryParticipantSafetyForScene(sceneId, db).filter(
    (row) => row.presence_state === "PRESENT"
  );
}

export function listSecondaryParticipantSafetyForChatScene(
  chatId: number,
  sceneId: string,
  db: Database.Database = getDb()
): SceneSecondaryParticipantSafetyRow[] {
  ensureSecondarySceneParticipantSafetySchema(db);
  return (
    db
      .prepare(
        `SELECT * FROM scene_secondary_participant_safety
         WHERE chat_id=? AND scene_id=?
         ORDER BY last_seen_turn ASC, created_at ASC`
      )
      .all(chatId, sceneId) as SceneSecondaryParticipantSafetyRow[]
  ).map(toRow);
}
