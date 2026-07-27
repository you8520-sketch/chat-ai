import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";
import { getActiveChatScene } from "@/lib/chatScenes";
import { getChatObserver } from "@/lib/observerIdentity";
import { ensureObserverSchema } from "@/lib/observerSchema";
import type {
  AwarenessState,
  AuditoryCapability,
  PresenceState,
  SceneObserverPresenceRow,
  ScenePresenceSourceType,
  VisualCapability,
  ObserverType,
} from "@/lib/observerTypes";

export type UpsertPresenceInput = {
  sceneId: string;
  chatId: number;
  observerType: ObserverType;
  observerId: string;
  presenceState: PresenceState;
  awarenessState?: AwarenessState;
  locationKey?: string | null;
  visualCapability?: VisualCapability;
  auditoryCapability?: AuditoryCapability;
  joinedTurn?: number | null;
  leftTurn?: number | null;
  sourceType: ScenePresenceSourceType;
};

export function getScenePresence(opts: {
  sceneId: string;
  observerType: ObserverType;
  observerId: string;
  db?: Database.Database;
}): SceneObserverPresenceRow | null {
  const db = opts.db ?? getDb();
  ensureObserverSchema(db);
  const row = db
    .prepare(
      `SELECT * FROM scene_observer_presence
       WHERE scene_id=? AND observer_type=? AND observer_id=?`
    )
    .get(opts.sceneId, opts.observerType, opts.observerId) as
    | SceneObserverPresenceRow
    | undefined;
  return row ?? null;
}

export function listScenePresence(
  sceneId: string,
  db: Database.Database = getDb()
): SceneObserverPresenceRow[] {
  ensureObserverSchema(db);
  return db
    .prepare(
      `SELECT * FROM scene_observer_presence WHERE scene_id=? ORDER BY updated_at ASC`
    )
    .all(sceneId) as SceneObserverPresenceRow[];
}

export function upsertScenePresence(
  input: UpsertPresenceInput,
  db: Database.Database = getDb()
): SceneObserverPresenceRow {
  ensureObserverSchema(db);
  const existing = getScenePresence({
    sceneId: input.sceneId,
    observerType: input.observerType,
    observerId: input.observerId,
    db,
  });

  if (existing) {
    db.prepare(
      `UPDATE scene_observer_presence SET
         presence_state=?,
         awareness_state=?,
         location_key=?,
         visual_capability=?,
         auditory_capability=?,
         joined_turn=COALESCE(?, joined_turn),
         left_turn=?,
         source_type=?,
         updated_at=datetime('now')
       WHERE scene_id=? AND observer_type=? AND observer_id=?`
    ).run(
      input.presenceState,
      input.awarenessState ?? existing.awareness_state,
      input.locationKey !== undefined ? input.locationKey : existing.location_key,
      input.visualCapability ?? existing.visual_capability,
      input.auditoryCapability ?? existing.auditory_capability,
      input.joinedTurn ?? null,
      input.leftTurn !== undefined ? input.leftTurn : existing.left_turn,
      input.sourceType,
      input.sceneId,
      input.observerType,
      input.observerId
    );
  } else {
    db.prepare(
      `INSERT INTO scene_observer_presence (
         scene_id, chat_id, observer_type, observer_id,
         presence_state, awareness_state, location_key,
         visual_capability, auditory_capability,
         joined_turn, left_turn, source_type
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      input.sceneId,
      input.chatId,
      input.observerType,
      input.observerId,
      input.presenceState,
      input.awarenessState ?? "AWARE",
      input.locationKey ?? null,
      input.visualCapability ?? "NORMAL",
      input.auditoryCapability ?? "NORMAL",
      input.joinedTurn ?? null,
      input.leftTurn ?? null,
      input.sourceType
    );
  }

  return getScenePresence({
    sceneId: input.sceneId,
    observerType: input.observerType,
    observerId: input.observerId,
    db,
  })!;
}

/**
 * Conservative witness eligibility for future S4B.
 * UNKNOWN presence/awareness ≠ PRESENT/AWARE.
 * S4A does not apply discovery — this is a pure predicate only.
 */
export function isPresenceWitnessEligible(row: SceneObserverPresenceRow): boolean {
  return row.presence_state === "PRESENT" && row.awareness_state === "AWARE";
}

export function canObserveVisually(row: SceneObserverPresenceRow): boolean {
  if (!isPresenceWitnessEligible(row)) return false;
  return row.visual_capability === "NORMAL";
}

export function canObserveAuditorily(row: SceneObserverPresenceRow): boolean {
  if (!isPresenceWitnessEligible(row)) return false;
  return row.auditory_capability === "NORMAL";
}

/**
 * Require registered observer + active scene membership for presence writes.
 * Free-text names alone cannot create presence.
 */
export function requireRegisteredObserver(opts: {
  chatId: number;
  observerType: ObserverType;
  observerId: string;
  db?: Database.Database;
}): boolean {
  const obs = getChatObserver({
    chatId: opts.chatId,
    observerType: opts.observerType,
    observerId: opts.observerId,
    db: opts.db,
  });
  return Boolean(obs && obs.is_active === 1);
}

export function getActiveScenePresenceForObserver(opts: {
  chatId: number;
  observerType: ObserverType;
  observerId: string;
  db?: Database.Database;
}): SceneObserverPresenceRow | null {
  const db = opts.db ?? getDb();
  const scene = getActiveChatScene(opts.chatId, db);
  if (!scene) return null;
  return getScenePresence({
    sceneId: scene.id,
    observerType: opts.observerType,
    observerId: opts.observerId,
    db,
  });
}
