import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";
import { SCENE_EVIDENCE_EXTRACTOR_VERSION } from "@/lib/sceneEvidenceCatalog";
import { buildSceneEvidenceIdempotencyKey } from "@/lib/sceneEvidenceIdempotency";
import { ensureSceneEvidenceSchema } from "@/lib/sceneEvidenceSchema";
import type {
  SceneEvidenceDraft,
  SceneEvidenceEvent,
  SceneEvidencePersistResult,
} from "@/lib/sceneEvidenceTypes";
import {
  rowToSceneEvidenceEvent,
  validateSceneEvidenceDraft,
} from "@/lib/sceneEvidenceValidate";

type SceneEvidenceRow = {
  id: string;
  idempotency_key: string;
  chat_id: number;
  turn_number: number;
  source_message_id: number | null;
  event_type: string;
  subject_type: string;
  subject_id: string;
  actor_type: string | null;
  actor_id: string | null;
  source_type: string;
  confidence: number;
  attributes_json: string;
  visibility_json: string;
  extractor_version: number;
};

/**
 * Append-only persist with INSERT OR IGNORE on idempotency_key.
 * Invalid drafts are skipped (not stored). All-or-nothing per batch via transaction.
 */
export function persistSceneEvidenceEvents(
  drafts: SceneEvidenceDraft[],
  db: Database.Database = getDb()
): SceneEvidencePersistResult {
  ensureSceneEvidenceSchema(db);
  const inserted: SceneEvidenceEvent[] = [];
  const reused: SceneEvidenceEvent[] = [];

  const tx = db.transaction(() => {
    for (const draft of drafts) {
      const validated = validateSceneEvidenceDraft(draft);
      if (!validated.ok) continue;

      const extractorVersion =
        draft.extractorVersion ?? SCENE_EVIDENCE_EXTRACTOR_VERSION;
      const idempotencyKey = buildSceneEvidenceIdempotencyKey({
        chatId: validated.event.chatId,
        sourceMessageId: validated.event.sourceMessageId,
        turnNumber: validated.event.turnNumber,
        eventType: validated.event.eventType,
        attributes: validated.event.attributes,
        extractorVersion,
      });

      const existing = db
        .prepare(
          `SELECT * FROM scene_evidence_events WHERE idempotency_key=?`
        )
        .get(idempotencyKey) as SceneEvidenceRow | undefined;
      if (existing) {
        reused.push(rowToSceneEvidenceEvent(existing));
        continue;
      }

      const id = randomUUID();
      const info = db
        .prepare(
          `INSERT OR IGNORE INTO scene_evidence_events (
             id, idempotency_key, chat_id, turn_number, source_message_id,
             event_type, subject_type, subject_id, actor_type, actor_id,
             source_type, confidence, attributes_json, visibility_json,
             extractor_version
           ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
        )
        .run(
          id,
          idempotencyKey,
          validated.event.chatId,
          validated.event.turnNumber,
          validated.event.sourceMessageId ?? null,
          validated.event.eventType,
          validated.event.subjectType,
          validated.event.subjectId,
          validated.event.actorType ?? null,
          validated.event.actorId ?? null,
          validated.event.sourceType,
          validated.event.confidence,
          JSON.stringify(validated.event.attributes),
          JSON.stringify(validated.event.visibility),
          extractorVersion
        );

      if (info.changes === 0) {
        const again = db
          .prepare(
            `SELECT * FROM scene_evidence_events WHERE idempotency_key=?`
          )
          .get(idempotencyKey) as SceneEvidenceRow | undefined;
        if (again) reused.push(rowToSceneEvidenceEvent(again));
        continue;
      }

      inserted.push({
        id,
        idempotencyKey,
        chatId: validated.event.chatId,
        turnNumber: validated.event.turnNumber,
        sourceMessageId: validated.event.sourceMessageId ?? null,
        eventType: validated.event.eventType,
        subjectType: validated.event.subjectType,
        subjectId: validated.event.subjectId,
        actorType: validated.event.actorType ?? null,
        actorId: validated.event.actorId ?? null,
        sourceType: validated.event.sourceType,
        confidence: validated.event.confidence,
        attributes: validated.event.attributes,
        visibility: validated.event.visibility,
        extractorVersion,
      });
    }
  });

  tx();
  return { inserted, reused };
}

export function listSceneEvidenceEventsForChatTurn(opts: {
  chatId: number;
  turnNumber: number;
  db?: Database.Database;
}): SceneEvidenceEvent[] {
  const db = opts.db ?? getDb();
  ensureSceneEvidenceSchema(db);
  const rows = db
    .prepare(
      `SELECT * FROM scene_evidence_events
       WHERE chat_id=? AND turn_number=?
       ORDER BY created_at ASC`
    )
    .all(opts.chatId, opts.turnNumber) as SceneEvidenceRow[];
  return rows.map(rowToSceneEvidenceEvent);
}

export function countSceneEvidenceEventsForChat(
  chatId: number,
  db: Database.Database = getDb()
): number {
  ensureSceneEvidenceSchema(db);
  const row = db
    .prepare(`SELECT COUNT(*) AS c FROM scene_evidence_events WHERE chat_id=?`)
    .get(chatId) as { c: number };
  return row.c;
}
