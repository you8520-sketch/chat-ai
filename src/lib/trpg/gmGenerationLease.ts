import type Database from "better-sqlite3";
import { healthyGmProviderWallMs } from "./gmCall";
import type { TrpgRoundRow } from "./store";
import { TRPG_GM_MODEL } from "./types";

/** Refresh persisted GM liveness while the provider call is alive. */
export const GM_HEARTBEAT_REFRESH_INTERVAL_MS = 25_000;

/**
 * Buffer beyond the healthy two-attempt provider wall for post-provider commit,
 * billing, and modest clock skew. Keeps mid-call generations from being reclaimed.
 */
export const GM_STALE_SAFETY_BUFFER_MS = 60_000;

export const GM_STALE_THRESHOLD_MS = healthyGmProviderWallMs() + GM_STALE_SAFETY_BUFFER_MS;

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
  | "stale_message"
  | "stale_orphan";

export type GmLeaseResolution = {
  status: GmLeaseStatus;
};

function staleThresholdSeconds(): number {
  return Math.ceil(GM_STALE_THRESHOLD_MS / 1000);
}

export function isGmGenerationActivePhase(phase: string): boolean {
  return (GM_ACTIVE_PHASES as readonly string[]).includes(phase);
}

export function beginGmGenerationLease(db: Database.Database, roundId: number, requestId: string): void {
  db.prepare(
    `UPDATE trpg_rounds
     SET gm_generation_started_at = datetime('now'),
         gm_generation_heartbeat_at = datetime('now'),
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
  const row = db
    .prepare(
      `SELECT gm_generation_id, gm_generation_heartbeat_at
       FROM trpg_rounds
       WHERE id = ?
         AND gm_generation_id IS NOT NULL
         AND phase IN ('ROLLING', 'LOCKING_ACTIONS', 'ADJUDICATING', 'GENERATING_NARRATION', 'APPLYING_STATE')`
    )
    .get(roundId) as { gm_generation_id: string; gm_generation_heartbeat_at: string | null } | undefined;
  if (!row) return false;
  if (!row.gm_generation_heartbeat_at) return true;
  const stale = db
    .prepare(
      `SELECT 1
       FROM trpg_rounds
       WHERE id = ?
         AND datetime(gm_generation_heartbeat_at) < datetime('now', ?)`
    )
    .get(roundId, `-${staleThresholdSeconds()} seconds`);
  return Boolean(stale);
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
  return (
    resolution.status === "stale_pending" ||
    resolution.status === "stale_message" ||
    resolution.status === "stale_orphan"
  );
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
  const hasPending = db
    .prepare(
      `SELECT 1
       FROM trpg_rounds
       WHERE id = ?
         AND pending_gm_result_json IS NOT NULL
         AND trim(pending_gm_result_json) != ''`
    )
    .get(roundId);
  if (hasPending) return { status: "stale_pending" };
  const hasMessage = db
    .prepare(`SELECT 1 FROM trpg_gm_messages WHERE round_id = ? LIMIT 1`)
    .get(roundId);
  if (hasMessage) return { status: "stale_message" };
  return { status: "stale_orphan" };
}

export function buildTrpgOrphanGenerationErrorJson(): string {
  return JSON.stringify({
    class: "B",
    error: "GM generation lease expired without completing (orphan generation)",
    kind: "orphan_generation",
    model: TRPG_GM_MODEL,
    elapsedMs: null,
    trueOffRequested: true,
    httpStatus: null,
    reasoningTokens: "unavailable",
  });
}

/** CAS orphan terminalization: never calls the provider. Exactly one reclaim wins. */
export function tryTerminalizeStaleOrphan(db: Database.Database, roundId: number): boolean {
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
         AND gm_generation_id IS NOT NULL
         AND phase IN ('ROLLING', 'LOCKING_ACTIONS', 'ADJUDICATING', 'GENERATING_NARRATION', 'APPLYING_STATE')
         AND datetime(COALESCE(gm_generation_heartbeat_at, '1970-01-01')) < datetime('now', ?)
         AND NOT EXISTS (SELECT 1 FROM trpg_gm_messages g WHERE g.round_id = trpg_rounds.id)
         AND (pending_gm_result_json IS NULL OR trim(pending_gm_result_json) = '')`
    )
    .run(buildTrpgOrphanGenerationErrorJson(), roundId, `-${staleThresholdSeconds()} seconds`);
  return info.changes === 1;
}

export function isRerollGmGeneration(db: Database.Database, roundId: number): boolean {
  const row = db
    .prepare(`SELECT process_stage FROM trpg_rounds WHERE id = ?`)
    .get(roundId) as { process_stage: string | null } | undefined;
  return row?.process_stage === "reroll";
}

/** Revert a stale narration reroll without calling the provider again. */
export function reconcileStaleRerollGeneration(db: Database.Database, roundId: number): void {
  db.prepare(
    `UPDATE trpg_rounds
     SET phase = 'ROUND_COMPLETE',
         lock_holder_request_id = NULL,
         gm_generation_id = NULL,
         gm_generation_started_at = NULL,
         gm_generation_heartbeat_at = NULL,
         updated_at = datetime('now')
     WHERE id = ?`
  ).run(roundId);
}
