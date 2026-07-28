import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";
import { getActiveChatScene } from "@/lib/chatScenes";
import { listChatObservers } from "@/lib/observerIdentity";
import { ensureObserverSchema } from "@/lib/observerSchema";
import { listScenePresence } from "@/lib/scenePresence";
import { ensureSceneObservationSchema } from "@/lib/sceneObservationSchema";
import type { SceneEvidenceEvent } from "@/lib/sceneEvidenceTypes";
import {
  SCENE_WITNESS_RESOLVER_VERSION,
  type SceneEventObservationDecision,
  type SceneEventObservationRow,
  type SceneEventObservationRunRow,
} from "@/lib/sceneObservationTypes";
import { resolveSceneEventWitnesses } from "@/lib/sceneWitnessResolver";

export function buildObservationRunIdempotencyKey(opts: {
  sceneEvidenceEventId: string;
  resolverVersion?: number;
}): string {
  const version = opts.resolverVersion ?? SCENE_WITNESS_RESOLVER_VERSION;
  return `scene-observation-run:${opts.sceneEvidenceEventId}:${version}`;
}

export function buildObservationIdempotencyKey(opts: {
  sceneEvidenceEventId: string;
  observerType: string;
  observerId: string;
  modality: string;
  resolverVersion?: number;
}): string {
  const version = opts.resolverVersion ?? SCENE_WITNESS_RESOLVER_VERSION;
  return `scene-observation:${opts.sceneEvidenceEventId}:${opts.observerType}:${opts.observerId}:${opts.modality}:${version}`;
}

export function getObservationRunForEvent(opts: {
  sceneEvidenceEventId: string;
  resolverVersion?: number;
  db?: Database.Database;
}): SceneEventObservationRunRow | null {
  const db = opts.db ?? getDb();
  ensureSceneObservationSchema(db);
  const key = buildObservationRunIdempotencyKey({
    sceneEvidenceEventId: opts.sceneEvidenceEventId,
    resolverVersion: opts.resolverVersion,
  });
  const row = db
    .prepare(`SELECT * FROM scene_event_observation_runs WHERE idempotency_key=?`)
    .get(key) as SceneEventObservationRunRow | undefined;
  return row ?? null;
}

export function listObservationsForEvent(opts: {
  sceneEvidenceEventId: string;
  resolverVersion?: number;
  db?: Database.Database;
}): SceneEventObservationRow[] {
  const db = opts.db ?? getDb();
  ensureSceneObservationSchema(db);
  const version = opts.resolverVersion ?? SCENE_WITNESS_RESOLVER_VERSION;
  return db
    .prepare(
      `SELECT * FROM scene_event_observations
       WHERE scene_evidence_event_id=? AND resolver_version=?
       ORDER BY created_at ASC`
    )
    .all(opts.sceneEvidenceEventId, version) as SceneEventObservationRow[];
}

export function listObservedObserversForEvent(opts: {
  sceneEvidenceEventId: string;
  resolverVersion?: number;
  db?: Database.Database;
}): SceneEventObservationRow[] {
  return listObservationsForEvent(opts).filter(
    (o) => o.observation_state === "OBSERVED"
  );
}

export type ResolveAndPersistWitnessResult = {
  run: SceneEventObservationRunRow;
  observations: SceneEventObservationRow[];
  reused: boolean;
  errorCode: string | null;
};

/**
 * Resolve witnesses for one scene evidence event and persist all candidate results.
 * On retry with existing COMPLETED run: reuse rows (event-time snapshots preserved).
 */
export function resolveAndPersistSceneEventWitnesses(opts: {
  event: SceneEvidenceEvent;
  currentCharacterId: string;
  db?: Database.Database;
}): ResolveAndPersistWitnessResult {
  const db = opts.db ?? getDb();
  ensureObserverSchema(db);
  ensureSceneObservationSchema(db);

  const existingRun = getObservationRunForEvent({
    sceneEvidenceEventId: opts.event.id,
    db,
  });
  if (existingRun?.status === "COMPLETED") {
    return {
      run: existingRun,
      observations: listObservationsForEvent({
        sceneEvidenceEventId: opts.event.id,
        db,
      }),
      reused: true,
      errorCode: null,
    };
  }

  const activeScene = getActiveChatScene(opts.event.chatId, db);
  if (!activeScene) {
    const runId = randomUUID();
    const runKey = buildObservationRunIdempotencyKey({
      sceneEvidenceEventId: opts.event.id,
    });
    db.prepare(
      `INSERT OR IGNORE INTO scene_event_observation_runs (
         id, idempotency_key, scene_evidence_event_id, chat_id, scene_id,
         resolver_version, status, candidate_count, observed_count, rejected_count,
         error_code, completed_at
       ) VALUES (?,?,?,?,?,?, 'FAILED', 0, 0, 0, 'NO_ACTIVE_SCENE', datetime('now'))`
    ).run(
      runId,
      runKey,
      opts.event.id,
      opts.event.chatId,
      "none",
      SCENE_WITNESS_RESOLVER_VERSION
    );
    const run = getObservationRunForEvent({
      sceneEvidenceEventId: opts.event.id,
      db,
    })!;
    return { run, observations: [], reused: false, errorCode: "NO_ACTIVE_SCENE" };
  }

  const presenceRows = listScenePresence(activeScene.id, db);
  const registeredObservers = listChatObservers(opts.event.chatId, db);

  const decisions = resolveSceneEventWitnesses({
    event: opts.event,
    activeScene,
    presenceRows,
    registeredObservers,
    currentCharacterId: opts.currentCharacterId,
  });

  let runRow: SceneEventObservationRunRow | null = null;
  let observationRows: SceneEventObservationRow[] = [];

  const tx = db.transaction(() => {
    const runKey = buildObservationRunIdempotencyKey({
      sceneEvidenceEventId: opts.event.id,
    });
    const again = db
      .prepare(`SELECT * FROM scene_event_observation_runs WHERE idempotency_key=?`)
      .get(runKey) as SceneEventObservationRunRow | undefined;
    if (again?.status === "COMPLETED") {
      runRow = again;
      observationRows = listObservationsForEvent({
        sceneEvidenceEventId: opts.event.id,
        db,
      });
      return;
    }

    const runId = again?.id ?? randomUUID();
    if (!again) {
      db.prepare(
        `INSERT INTO scene_event_observation_runs (
           id, idempotency_key, scene_evidence_event_id, chat_id, scene_id,
           resolver_version, status, candidate_count, observed_count, rejected_count
         ) VALUES (?,?,?,?,?,?, 'STARTED', 0, 0, 0)`
      ).run(
        runId,
        runKey,
        opts.event.id,
        opts.event.chatId,
        activeScene.id,
        SCENE_WITNESS_RESOLVER_VERSION
      );
    }

    for (const d of decisions) {
      persistDecision(db, runId, opts.event, activeScene.id, d);
    }

    const observed = decisions.filter((d) => d.observationState === "OBSERVED").length;
    const rejected = decisions.length - observed;
    db.prepare(
      `UPDATE scene_event_observation_runs SET
         status='COMPLETED',
         candidate_count=?,
         observed_count=?,
         rejected_count=?,
         error_code=NULL,
         completed_at=datetime('now')
       WHERE id=?`
    ).run(decisions.length, observed, rejected, runId);

    runRow = db
      .prepare(`SELECT * FROM scene_event_observation_runs WHERE id=?`)
      .get(runId) as SceneEventObservationRunRow;
    observationRows = listObservationsForEvent({
      sceneEvidenceEventId: opts.event.id,
      db,
    });
  });
  tx();

  return {
    run: runRow!,
    observations: observationRows,
    reused: false,
    errorCode: null,
  };
}

function persistDecision(
  db: Database.Database,
  runId: string,
  event: SceneEvidenceEvent,
  sceneId: string,
  decision: SceneEventObservationDecision
): void {
  const idempotencyKey = buildObservationIdempotencyKey({
    sceneEvidenceEventId: event.id,
    observerType: decision.observerType,
    observerId: decision.observerId,
    modality: decision.modality,
  });
  const existing = db
    .prepare(`SELECT id FROM scene_event_observations WHERE idempotency_key=?`)
    .get(idempotencyKey) as { id: string } | undefined;
  if (existing) return;

  db.prepare(
    `INSERT INTO scene_event_observations (
       id, idempotency_key, observation_run_id, scene_evidence_event_id,
       chat_id, scene_id, turn_number,
       observer_type, observer_id, modality, observation_state, reason_code,
       confidence, observer_state_snapshot_json, event_scope_snapshot_json,
       resolver_version
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    randomUUID(),
    idempotencyKey,
    runId,
    event.id,
    event.chatId,
    sceneId,
    event.turnNumber,
    decision.observerType,
    decision.observerId,
    decision.modality,
    decision.observationState,
    decision.reasonCode,
    decision.confidence,
    JSON.stringify(decision.observerStateSnapshot),
    JSON.stringify(decision.eventScopeSnapshot),
    SCENE_WITNESS_RESOLVER_VERSION
  );
}
