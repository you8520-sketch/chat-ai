import type Database from "better-sqlite3";
import { healthyGmProviderWallMs } from "./gmCall";
import { pendingMatchesGeneration } from "./pendingGmResult";
import type { TrpgRoundRow } from "./store";
import { TRPG_GM_MODEL } from "./types";

/** Refresh persisted GM liveness while the provider call is alive. */
export const GM_HEARTBEAT_REFRESH_INTERVAL_MS = 25_000;

/**
 * Heartbeat-backed generations: stale when no refresh within this window.
 * Tolerates ~3 missed 25s intervals plus scheduling jitter.
 */
export const GM_HEARTBEAT_STALE_MS = 90_000;

/**
 * Legacy rows without heartbeat metadata: derived from full healthy provider wall + buffer (>=420s).
 */
export const GM_LEGACY_STALE_SAFETY_BUFFER_MS = 60_000;
export const GM_LEGACY_STALE_MS = healthyGmProviderWallMs() + GM_LEGACY_STALE_SAFETY_BUFFER_MS;

const GM_ACTIVE_PHASES = [
  "ROLLING",
  "LOCKING_ACTIONS",
  "ADJUDICATING",
  "GENERATING_NARRATION",
  "APPLYING_STATE",
] as const;

export type GmLeaseStatus =
  | "inactive"
  | "healthy"
  | "stale_pending"
  | "stale_committed"
  | "stale_reroll_orphan"
  | "stale_orphan";

export type GmLeaseResolution = {
  status: GmLeaseStatus;
};

export type GmStaleOwnerDiscardReason =
  | "heartbeat"
  | "usage"
  | "pending"
  | "commit"
  | "failure";

/** Thrown when a stale generation owner attempts a fenced mutation after lease loss. */
export class StaleGmGenerationOwnerError extends Error {
  constructor(message = "stale GM generation owner") {
    super(message);
    this.name = "StaleGmGenerationOwnerError";
  }
}

type RoundLeaseRow = {
  gm_generation_id: string;
  gm_generation_heartbeat_at: string | null;
  gm_generation_started_at: string | null;
  gm_committed_generation_id: string | null;
  updated_at: string;
  process_stage: string | null;
};

function heartbeatStaleSeconds(): number {
  return Math.ceil(GM_HEARTBEAT_STALE_MS / 1000);
}

function legacyStaleSeconds(): number {
  return Math.ceil(GM_LEGACY_STALE_MS / 1000);
}

export function isGmGenerationActivePhase(phase: string): boolean {
  return (GM_ACTIVE_PHASES as readonly string[]).includes(phase);
}

function loadRoundLeaseRow(db: Database.Database, roundId: number): RoundLeaseRow | null {
  return (
    (db
      .prepare(
        `SELECT gm_generation_id, gm_generation_heartbeat_at, gm_generation_started_at,
                gm_committed_generation_id, updated_at, process_stage
         FROM trpg_rounds
         WHERE id = ?
           AND gm_generation_id IS NOT NULL
           AND phase IN ('ROLLING', 'LOCKING_ACTIONS', 'ADJUDICATING', 'GENERATING_NARRATION', 'APPLYING_STATE')`
      )
      .get(roundId) as RoundLeaseRow | undefined) ?? null
  );
}

/** Token fence: true only when this request still owns the active generation. */
export function gmGenerationOwnsToken(
  db: Database.Database,
  roundId: number,
  requestId: string
): boolean {
  const row = db
    .prepare(`SELECT gm_generation_id FROM trpg_rounds WHERE id = ?`)
    .get(roundId) as { gm_generation_id: string | null } | undefined;
  return row?.gm_generation_id === requestId;
}

export function logStaleOwnerDiscard(
  roundId: number,
  requestId: string,
  reason: GmStaleOwnerDiscardReason
): void {
  console.warn(
    JSON.stringify({
      event: "trpg_gm_stale_owner_discard",
      roundId,
      requestId,
      reason,
    })
  );
}

export function beginGmGenerationLease(db: Database.Database, roundId: number, requestId: string): void {
  db.prepare(
    `UPDATE trpg_rounds
     SET gm_generation_started_at = datetime('now'),
         gm_generation_heartbeat_at = datetime('now'),
         gm_committed_generation_id = NULL,
         updated_at = datetime('now')
     WHERE id = ?
       AND gm_generation_id = ?`
  ).run(roundId, requestId);
}

export function refreshGmGenerationHeartbeat(
  db: Database.Database,
  roundId: number,
  requestId: string
): boolean {
  const info = db
    .prepare(
      `UPDATE trpg_rounds
       SET gm_generation_heartbeat_at = datetime('now'),
           updated_at = datetime('now')
       WHERE id = ?
         AND phase IN ('ROLLING', 'LOCKING_ACTIONS', 'ADJUDICATING', 'GENERATING_NARRATION', 'APPLYING_STATE')
         AND gm_generation_id = ?`
    )
    .run(roundId, requestId);
  return info.changes === 1;
}

export function clearGmGenerationLease(
  db: Database.Database,
  roundId: number,
  requestId?: string | null
): void {
  if (requestId) {
    db.prepare(
      `UPDATE trpg_rounds
       SET gm_generation_id = NULL,
           lock_holder_request_id = CASE WHEN lock_holder_request_id = ? THEN NULL ELSE lock_holder_request_id END,
           gm_generation_started_at = NULL,
           gm_generation_heartbeat_at = NULL,
           updated_at = datetime('now')
       WHERE id = ?
         AND gm_generation_id = ?`
    ).run(requestId, roundId, requestId);
    return;
  }
  db.prepare(
    `UPDATE trpg_rounds
     SET gm_generation_id = NULL,
         gm_generation_started_at = NULL,
         gm_generation_heartbeat_at = NULL,
         updated_at = datetime('now')
     WHERE id = ?`
  ).run(roundId);
}

export function isGmGenerationLeaseStaleOnDb(db: Database.Database, roundId: number): boolean {
  const row = loadRoundLeaseRow(db, roundId);
  if (!row) return false;

  if (row.gm_generation_heartbeat_at) {
    const stale = db
      .prepare(
        `SELECT 1
         FROM trpg_rounds
         WHERE id = ?
           AND datetime(gm_generation_heartbeat_at) < datetime('now', ?)`
      )
      .get(roundId, `-${heartbeatStaleSeconds()} seconds`);
    return Boolean(stale);
  }

  // Legacy pre-migration / pre-heartbeat row: use updated_at with full provider grace.
  const legacyStale = db
    .prepare(
      `SELECT 1
       FROM trpg_rounds
       WHERE id = ?
         AND datetime(updated_at) < datetime('now', ?)`
    )
    .get(roundId, `-${legacyStaleSeconds()} seconds`);
  return Boolean(legacyStale);
}

/** True only while a healthy GM generation lease is active (not stale). */
export function gmGenerationInFlight(
  db: Database.Database,
  round: Pick<
    TrpgRoundRow,
    "id" | "phase" | "gm_generation_id" | "gm_generation_heartbeat_at"
  >
): boolean {
  if (!round.gm_generation_id) return false;
  if (!isGmGenerationActivePhase(round.phase)) return false;
  return !isGmGenerationLeaseStaleOnDb(db, round.id);
}

export function gmStaleReclaimEligible(
  db: Database.Database,
  roundId: number,
  phase: string,
  gmGenerationId: string | null
): boolean {
  const resolution = resolveGmLeaseState(db, roundId, phase, gmGenerationId);
  return resolution.status !== "inactive" && resolution.status !== "healthy";
}

export function currentGenerationCommitted(
  db: Database.Database,
  roundId: number,
  generationId: string
): boolean {
  const row = db
    .prepare(`SELECT gm_committed_generation_id FROM trpg_rounds WHERE id = ?`)
    .get(roundId) as { gm_committed_generation_id: string | null } | undefined;
  return row?.gm_committed_generation_id === generationId;
}

export function resolveGmLeaseState(
  db: Database.Database,
  roundId: number,
  phase: string,
  gmGenerationId: string | null
): GmLeaseResolution {
  if (!gmGenerationId || !isGmGenerationActivePhase(phase)) {
    return { status: "inactive" };
  }
  if (!isGmGenerationLeaseStaleOnDb(db, roundId)) {
    return { status: "healthy" };
  }

  if (pendingMatchesGeneration(db, roundId, gmGenerationId)) {
    return { status: "stale_pending" };
  }

  if (currentGenerationCommitted(db, roundId, gmGenerationId)) {
    return { status: "stale_committed" };
  }

  const row = loadRoundLeaseRow(db, roundId);
  if (row?.process_stage === "reroll") {
    return { status: "stale_reroll_orphan" };
  }

  return { status: "stale_orphan" };
}

export function buildTrpgOrphanGenerationErrorJson(): string {
  return JSON.stringify({
    class: "B",
    error: "GM generation lease expired without completing (orphan generation reclaimed)",
    kind: "gm_generation_orphan_reclaimed",
    model: TRPG_GM_MODEL,
    elapsedMs: null,
    trueOffRequested: true,
    httpStatus: null,
    reasoningTokens: "unavailable",
  });
}

/** CAS orphan terminalization: never calls the provider. Exactly one reclaim wins. */
export function tryTerminalizeStaleOrphan(db: Database.Database, roundId: number): boolean {
  const row = loadRoundLeaseRow(db, roundId);
  if (!row || !isGmGenerationLeaseStaleOnDb(db, roundId)) return false;

  const info = db
    .prepare(
      `UPDATE trpg_rounds
       SET phase = 'ERROR_RECOVERY',
           error_json = ?,
           gm_generation_id = NULL,
           lock_holder_request_id = NULL,
           gm_generation_started_at = NULL,
           gm_generation_heartbeat_at = NULL,
           updated_at = datetime('now')
       WHERE id = ?
         AND gm_generation_id = ?
         AND phase IN ('ROLLING', 'LOCKING_ACTIONS', 'ADJUDICATING', 'GENERATING_NARRATION', 'APPLYING_STATE')`
    )
    .run(buildTrpgOrphanGenerationErrorJson(), roundId, row.gm_generation_id);
  return info.changes === 1;
}

/** Failure persistence fenced by generation token. Returns false when owner lost. */
export function tryPersistGmRoundFailure(
  db: Database.Database,
  roundId: number,
  requestId: string,
  errorJson: string
): boolean {
  const info = db
    .prepare(
      `UPDATE trpg_rounds
       SET phase = 'ERROR_RECOVERY',
           error_json = ?,
           gm_generation_id = NULL,
           lock_holder_request_id = NULL,
           gm_generation_started_at = NULL,
           gm_generation_heartbeat_at = NULL,
           updated_at = datetime('now')
       WHERE id = ?
         AND gm_generation_id = ?`
    )
    .run(errorJson, roundId, requestId);
  return info.changes === 1;
}

/** Mark canonical commit ownership for the current generation (inside commit transaction). */
export function markGmGenerationCommitted(
  db: Database.Database,
  roundId: number,
  requestId: string
): boolean {
  const info = db
    .prepare(
      `UPDATE trpg_rounds
       SET gm_committed_generation_id = ?,
           updated_at = datetime('now')
       WHERE id = ?
         AND gm_generation_id = ?`
    )
    .run(requestId, roundId, requestId);
  return info.changes === 1;
}

export function isRerollGmGeneration(db: Database.Database, roundId: number): boolean {
  const row = db
    .prepare(`SELECT process_stage FROM trpg_rounds WHERE id = ?`)
    .get(roundId) as { process_stage: string | null } | undefined;
  return row?.process_stage === "reroll";
}

/** Revert a stale narration reroll without calling the provider again. Preserves old GM message. */
export function reconcileStaleRerollGeneration(db: Database.Database, roundId: number): void {
  db.prepare(
    `UPDATE trpg_rounds
     SET phase = 'ROUND_COMPLETE',
         lock_holder_request_id = NULL,
         gm_generation_id = NULL,
         gm_generation_started_at = NULL,
         gm_generation_heartbeat_at = NULL,
         pending_gm_result_json = NULL,
         error_json = COALESCE(error_json, ?),
         updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    JSON.stringify({
      class: "B",
      error: "Narration reroll lease expired (old scene preserved)",
      kind: "gm_generation_orphan_reclaimed",
      model: TRPG_GM_MODEL,
      elapsedMs: null,
      trueOffRequested: true,
      httpStatus: null,
      reasoningTokens: "unavailable",
    }),
    roundId
  );
}
