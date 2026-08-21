import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";
import {
  ensureSecondarySceneParticipantSafetySchema,
  type SceneSecondaryParticipantSafetyEventRow,
  type SceneSecondaryParticipantSafetyRow,
  type SecondaryAdultStatus,
  type SecondaryEvidenceSource,
  type SecondaryEvidenceTrust,
  type SecondaryParticipantKind,
  type SecondaryPresenceState,
  type SecondarySafetyCoverage,
  type SecondarySafetySourceRole,
} from "@/lib/secondarySceneParticipantSafetySchema";
import type { SceneParticipantEventAction } from "@/lib/secondarySceneParticipantEvidence";

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
  authoritativeAge?: number | null;
  authoritativeAdultStatus?: SecondaryAdultStatus | null;
  authoritativeIsRealPerson?: boolean | null;
  authoritativeSource?: SecondaryEvidenceSource | null;
  restrictiveAge?: number | null;
  restrictiveAdultStatus?: SecondaryAdultStatus | null;
  restrictiveIsRealPerson?: boolean | null;
  restrictiveSource?: SecondaryEvidenceSource | null;
  firstSeenTurn?: number | null;
  lastSeenTurn?: number | null;
  leftTurn?: number | null;
};

export type SecondarySafetyEventWrite = {
  sceneId: string;
  chatId: number;
  participantId: string;
  action: SceneParticipantEventAction;
  sourceRole: SecondarySafetySourceRole;
  sourceMessageId?: number | null;
  sourceTurn?: number | null;
  eventIndex: number;
  evidenceTrust: SecondaryEvidenceTrust;
  evidenceSource: SecondaryEvidenceSource;
  attachedAge?: number | null;
  restrictiveAge?: number | null;
  restrictiveAdultStatus?: string | null;
  restrictiveIsRealPerson?: boolean | null;
};

function toBoolInt(value: boolean | null | undefined): number | null {
  if (value == null) return null;
  return value ? 1 : 0;
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
       evidence_source,
       authoritative_age, authoritative_adult_status, authoritative_is_real_person,
       authoritative_source,
       restrictive_age, restrictive_adult_status, restrictive_is_real_person,
       restrictive_source,
       first_seen_turn, last_seen_turn, left_turn
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
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
       authoritative_age=excluded.authoritative_age,
       authoritative_adult_status=excluded.authoritative_adult_status,
       authoritative_is_real_person=excluded.authoritative_is_real_person,
       authoritative_source=excluded.authoritative_source,
       restrictive_age=excluded.restrictive_age,
       restrictive_adult_status=excluded.restrictive_adult_status,
       restrictive_is_real_person=excluded.restrictive_is_real_person,
       restrictive_source=excluded.restrictive_source,
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
    toBoolInt(input.isRealPerson),
    input.evidenceTrust,
    input.evidenceSource,
    input.authoritativeAge ?? null,
    input.authoritativeAdultStatus ?? null,
    toBoolInt(input.authoritativeIsRealPerson),
    input.authoritativeSource ?? null,
    input.restrictiveAge ?? null,
    input.restrictiveAdultStatus ?? null,
    toBoolInt(input.restrictiveIsRealPerson),
    input.restrictiveSource ?? null,
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
  return row ?? null;
}

export function listSecondaryParticipantSafetyForScene(
  sceneId: string,
  db: Database.Database = getDb()
): SceneSecondaryParticipantSafetyRow[] {
  ensureSecondarySceneParticipantSafetySchema(db);
  return db
    .prepare(
      `SELECT * FROM scene_secondary_participant_safety
       WHERE scene_id=?
       ORDER BY last_seen_turn ASC, created_at ASC`
    )
    .all(sceneId) as SceneSecondaryParticipantSafetyRow[];
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
  return db
    .prepare(
      `SELECT * FROM scene_secondary_participant_safety
       WHERE chat_id=? AND scene_id=?
       ORDER BY last_seen_turn ASC, created_at ASC`
    )
    .all(chatId, sceneId) as SceneSecondaryParticipantSafetyRow[];
}

export function insertSecondarySafetyEvent(
  input: SecondarySafetyEventWrite,
  db: Database.Database = getDb()
): SceneSecondaryParticipantSafetyEventRow {
  ensureSecondarySceneParticipantSafetySchema(db);
  const id = randomUUID();
  db.prepare(
    `INSERT INTO scene_secondary_participant_safety_events (
       id, scene_id, chat_id, participant_id, action, source_role,
       source_message_id, source_turn, event_index, evidence_trust, evidence_source,
       attached_age, restrictive_age, restrictive_adult_status,
       restrictive_is_real_person
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    id,
    input.sceneId,
    input.chatId,
    input.participantId,
    input.action,
    input.sourceRole,
    input.sourceMessageId ?? null,
    input.sourceTurn ?? null,
    input.eventIndex,
    input.evidenceTrust,
    input.evidenceSource,
    input.attachedAge ?? null,
    input.restrictiveAge ?? null,
    input.restrictiveAdultStatus ?? null,
    toBoolInt(input.restrictiveIsRealPerson)
  );
  return db
    .prepare(`SELECT * FROM scene_secondary_participant_safety_events WHERE id=?`)
    .get(id) as SceneSecondaryParticipantSafetyEventRow;
}

export function listSecondarySafetyEventsForParticipant(
  sceneId: string,
  participantId: string,
  db: Database.Database = getDb()
): SceneSecondaryParticipantSafetyEventRow[] {
  ensureSecondarySceneParticipantSafetySchema(db);
  return db
    .prepare(
      `SELECT * FROM scene_secondary_participant_safety_events
       WHERE scene_id=? AND participant_id=?
       ORDER BY
         source_turn ASC,
         CASE source_role
           WHEN 'user' THEN 0
           WHEN 'assistant' THEN 1
           ELSE 2
         END ASC,
         source_message_id ASC,
         event_index ASC,
         id ASC`
    )
    .all(sceneId, participantId) as SceneSecondaryParticipantSafetyEventRow[];
}

export function deleteSecondarySafetyEventsForSourceMessages(opts: {
  chatId: number;
  sourceMessageIds: number[];
  sourceRole?: SecondarySafetySourceRole;
  db?: Database.Database;
}): { deleted: number; participantKeys: Array<{ sceneId: string; participantId: string }> } {
  const db = opts.db ?? getDb();
  ensureSecondarySceneParticipantSafetySchema(db);
  const ids = opts.sourceMessageIds.filter((id) => Number.isSafeInteger(id) && id > 0);
  if (ids.length === 0) {
    return { deleted: 0, participantKeys: [] };
  }
  const placeholders = ids.map(() => "?").join(",");
  const roleClause = opts.sourceRole ? " AND source_role=?" : "";
  const params: Array<string | number> = [opts.chatId, ...ids];
  if (opts.sourceRole) params.push(opts.sourceRole);
  const affected = db
    .prepare(
      `SELECT DISTINCT scene_id AS sceneId, participant_id AS participantId
       FROM scene_secondary_participant_safety_events
       WHERE chat_id=? AND source_message_id IN (${placeholders})${roleClause}`
    )
    .all(...params) as Array<{ sceneId: string; participantId: string }>;
  const result = db
    .prepare(
      `DELETE FROM scene_secondary_participant_safety_events
       WHERE chat_id=? AND source_message_id IN (${placeholders})${roleClause}`
    )
    .run(...params);
  return { deleted: result.changes, participantKeys: affected };
}

export function setSecondarySafetyCoverageCore(opts: {
  chatId: number;
  coverage: SecondarySafetyCoverage;
  reason: string;
  coveredFromTurn?: number | null;
  db: Database.Database;
}): void {
  opts.db
    .prepare(
      `INSERT INTO chat_secondary_safety_coverage (
         chat_id, coverage, reason, covered_from_turn
       ) VALUES (?,?,?,?)
       ON CONFLICT(chat_id) DO UPDATE SET
         coverage=excluded.coverage,
         reason=excluded.reason,
         covered_from_turn=excluded.covered_from_turn,
         updated_at=datetime('now')`
    )
    .run(
      opts.chatId,
      opts.coverage,
      opts.reason,
      opts.coveredFromTurn ?? null
    );
}

export function countPriorPlayableTurnsFromDb(
  chatId: number,
  db: Database.Database = getDb()
): number {
  ensureSecondarySceneParticipantSafetySchema(db);
  const row = db
    .prepare(
      `SELECT COUNT(*) AS turnCount
       FROM messages
       WHERE chat_id=? AND role='user'`
    )
    .get(chatId) as { turnCount: number };
  return row.turnCount > 0 ? row.turnCount : 0;
}

export function getStoredSecondarySafetyCoverageRow(
  chatId: number,
  db: Database.Database = getDb()
): { coverage: SecondarySafetyCoverage; reason: string } | null {
  ensureSecondarySceneParticipantSafetySchema(db);
  const row = db
    .prepare(
      `SELECT coverage, reason FROM chat_secondary_safety_coverage WHERE chat_id=?`
    )
    .get(chatId) as { coverage?: string; reason?: string } | undefined;
  if (row?.coverage === "INCOMPLETE") {
    return {
      coverage: "INCOMPLETE",
      reason: row.reason ?? "stored_incomplete",
    };
  }
  if (row?.coverage === "COMPLETE") {
    return {
      coverage: "COMPLETE",
      reason: row.reason ?? "stored_complete",
    };
  }
  return null;
}

export function resolveSecondarySafetyCoverage(opts: {
  chatId: number;
  priorPlayableTurns: number;
  sceneReset?: boolean;
  clearSceneTransition?: boolean;
  db?: Database.Database;
}): { coverage: SecondarySafetyCoverage; reason: string } {
  const db = opts.db ?? getDb();
  ensureSecondarySceneParticipantSafetySchema(db);
  if (opts.sceneReset === true) {
    return { coverage: "COMPLETE", reason: "scene_reset" };
  }
  if (opts.clearSceneTransition === true) {
    return { coverage: "COMPLETE", reason: "clear_scene_transition" };
  }
  const stored = getStoredSecondarySafetyCoverageRow(opts.chatId, db);
  if (stored) return stored;
  if (opts.priorPlayableTurns <= 0) {
    return { coverage: "COMPLETE", reason: "tracked_from_chat_start" };
  }
  return { coverage: "INCOMPLETE", reason: "legacy_history_untracked" };
}

export function getSecondarySafetyCoverage(
  chatId: number,
  db: Database.Database = getDb()
): SecondarySafetyCoverage {
  return resolveSecondarySafetyCoverage({
    chatId,
    priorPlayableTurns: countPriorPlayableTurnsFromDb(chatId, db),
    db,
  }).coverage;
}
