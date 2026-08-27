import type Database from "better-sqlite3";
import { healthyGmProviderWallMs } from "./gmCall";
import { hasPendingGmResult, loadPendingProvenanceGenerationId, pendingMatchesGeneration } from "./pendingGmResult";
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

const GM_ACTIVE_PHASE_SQL = `('ROLLING', 'LOCKING_ACTIONS', 'ADJUDICATING', 'GENERATING_NARRATION', 'APPLYING_STATE')`;

export type GmLeaseStatus =
  | "inactive"
  | "healthy"
  | "stale_pending"
  | "stale_committed"
  | "stale_reroll_orphan"
  | "stale_orphan";

export type GmLeaseResolution =
  | { status: "inactive" | "healthy" | "stale_orphan" | "stale_reroll_orphan" }
  | {
      status: "stale_pending" | "stale_committed";
      leaseOwnerId: string;
      provenanceGenerationId: string;
    };

export type GmStaleOwnerDiscardReason =
  | "heartbeat"
  | "usage"
  | "pending"
  | "draft"
  | "commit"
  | "failure"
  | "finalize"
  | "billing";

export type StaleRecoveryKind = "pending" | "committed" | "applying_state";

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
  phase: string;
};

function heartbeatStaleSeconds(): number {
  return Math.ceil(GM_HEARTBEAT_STALE_MS / 1000);
}

function legacyStaleSeconds(): number {
  return Math.ceil(GM_LEGACY_STALE_MS / 1000);
}

/** SQL fragment: row heartbeat/updated_at proves lease is stale at write time. */
function staleAtWriteSql(alias = ""): string {
  const p = alias ? `${alias}.` : "";
  return `(
    (${p}gm_generation_heartbeat_at IS NOT NULL
      AND datetime(${p}gm_generation_heartbeat_at) < datetime('now', '-${heartbeatStaleSeconds()} seconds'))
    OR (${p}gm_generation_heartbeat_at IS NULL
      AND datetime(${p}updated_at) < datetime('now', '-${legacyStaleSeconds()} seconds'))
  )`;
}

/** SQL fragment: heartbeat is fresh (reclaim must lose). */
export function freshHeartbeatSql(alias = ""): string {
  const p = alias ? `${alias}.` : "";
  return `(
    ${p}gm_generation_heartbeat_at IS NOT NULL
    AND datetime(${p}gm_generation_heartbeat_at) >= datetime('now', '-${heartbeatStaleSeconds()} seconds')
  )`;
}

export function isGmGenerationActivePhase(phase: string): boolean {
  return (GM_ACTIVE_PHASES as readonly string[]).includes(phase);
}

function loadRoundLeaseRow(db: Database.Database, roundId: number): RoundLeaseRow | null {
  return (
    (db
      .prepare(
        `SELECT gm_generation_id, gm_generation_heartbeat_at, gm_generation_started_at,
                gm_committed_generation_id, updated_at, process_stage, phase
         FROM trpg_rounds
         WHERE id = ?
           AND gm_generation_id IS NOT NULL
           AND phase IN ${GM_ACTIVE_PHASE_SQL}`
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
         gm_reroll_billed_generation_id = NULL,
         gm_reroll_usage_json = NULL,
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
         AND phase IN ${GM_ACTIVE_PHASE_SQL}
         AND gm_generation_id = ?`
    )
    .run(roundId, requestId);
  return info.changes === 1;
}

/** Token-scoped lease clear. Unscoped clear is forbidden for active generation flows. */
export function clearGmGenerationLease(
  db: Database.Database,
  roundId: number,
  requestId: string
): boolean {
  const info = db
    .prepare(
      `UPDATE trpg_rounds
       SET gm_generation_id = NULL,
           lock_holder_request_id = CASE WHEN lock_holder_request_id = ? THEN NULL ELSE lock_holder_request_id END,
           gm_generation_started_at = NULL,
           gm_generation_heartbeat_at = NULL,
           updated_at = datetime('now')
       WHERE id = ?
         AND gm_generation_id = ?`
    )
    .run(requestId, roundId, requestId);
  return info.changes === 1;
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

/** Committed result provenance, independent of current lease owner. */
export function loadCommittedProvenanceGenerationId(
  db: Database.Database,
  roundId: number
): string | null {
  const row = db
    .prepare(`SELECT gm_committed_generation_id FROM trpg_rounds WHERE id = ?`)
    .get(roundId) as { gm_committed_generation_id: string | null } | undefined;
  return row?.gm_committed_generation_id ?? null;
}

export function isRerollGenerationBilled(
  db: Database.Database,
  roundId: number,
  provenanceGenerationId: string
): boolean {
  const row = db
    .prepare(`SELECT gm_reroll_billed_generation_id FROM trpg_rounds WHERE id = ?`)
    .get(roundId) as { gm_reroll_billed_generation_id: string | null } | undefined;
  return row?.gm_reroll_billed_generation_id === provenanceGenerationId;
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

  const leaseOwnerId = gmGenerationId;

  if (hasPendingGmResult(db, roundId)) {
    const pendingProvenance = loadPendingProvenanceGenerationId(db, roundId) ?? leaseOwnerId;
    return {
      status: "stale_pending",
      leaseOwnerId,
      provenanceGenerationId: pendingProvenance,
    };
  }

  const committedProvenance = loadCommittedProvenanceGenerationId(db, roundId);
  if (committedProvenance) {
    return {
      status: "stale_committed",
      leaseOwnerId,
      provenanceGenerationId: committedProvenance,
    };
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

/**
 * CAS reclaim stale lease to a NEW recovery owner, revoking stale lease holder.
 * Result provenance (pending/committed) remains on provenanceGenerationId.
 */
export function tryClaimStaleGmRecovery(
  db: Database.Database,
  roundId: number,
  staleLeaseOwnerId: string,
  provenanceGenerationId: string,
  recoveryOwnerId: string,
  kind: StaleRecoveryKind
): boolean {
  return db.transaction(() => {
    if (kind === "pending") {
      const pendingProv = loadPendingProvenanceGenerationId(db, roundId);
      if (!hasPendingGmResult(db, roundId)) return false;
      const effectiveProv = pendingProv ?? staleLeaseOwnerId;
      if (effectiveProv !== provenanceGenerationId) return false;
    } else if (
      (kind === "committed" || kind === "applying_state") &&
      loadCommittedProvenanceGenerationId(db, roundId) !== provenanceGenerationId
    ) {
      return false;
    }

    let extra = "";
    const params: Array<string | number> = [
      recoveryOwnerId,
      recoveryOwnerId,
      roundId,
      staleLeaseOwnerId,
    ];

    if (kind === "pending") {
      extra = `AND pending_gm_result_json IS NOT NULL`;
    } else if (kind === "committed" || kind === "applying_state") {
      extra = `AND gm_committed_generation_id = ?`;
      params.push(provenanceGenerationId);
      if (kind === "applying_state") {
        extra += ` AND phase = 'APPLYING_STATE'`;
      }
    }

    const info = db
      .prepare(
        `UPDATE trpg_rounds
         SET gm_generation_id = ?,
             lock_holder_request_id = ?,
             gm_generation_started_at = datetime('now'),
             gm_generation_heartbeat_at = datetime('now'),
             updated_at = datetime('now')
         WHERE id = ?
           AND gm_generation_id = ?
           AND phase IN ${GM_ACTIVE_PHASE_SQL}
           AND ${staleAtWriteSql()}
           ${extra}`
      )
      .run(...params);
    return info.changes === 1;
  })();
}

/** CAS orphan terminalization with stale/pending/commit guards in the UPDATE itself. */
export function tryTerminalizeStaleOrphan(db: Database.Database, roundId: number): boolean {
  const row = loadRoundLeaseRow(db, roundId);
  if (!row) return false;

  const staleOwnerId = row.gm_generation_id;
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
         AND phase IN ${GM_ACTIVE_PHASE_SQL}
         AND ${staleAtWriteSql()}
         AND gm_committed_generation_id IS NULL
         AND pending_gm_result_json IS NULL`
    )
    .run(buildTrpgOrphanGenerationErrorJson(), roundId, staleOwnerId);
  return info.changes === 1;
}

/** Failure persistence fenced by generation token. Preserves salvage authority when pending exists. */
export function tryPersistGmRoundFailure(
  db: Database.Database,
  roundId: number,
  requestId: string,
  errorJson: string
): boolean {
  const preserveSalvage = pendingMatchesGeneration(db, roundId, requestId);
  if (preserveSalvage) {
    const info = db
      .prepare(
        `UPDATE trpg_rounds
         SET phase = 'ERROR_RECOVERY',
             error_json = ?,
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

/** One-time legacy ERROR_RECOVERY pending salvage claim when gm_generation_id was cleared. */
export function tryClaimLegacyErrorRecoverySalvage(
  db: Database.Database,
  roundId: number,
  recoveryOwnerId: string
): boolean {
  const info = db
    .prepare(
      `UPDATE trpg_rounds
       SET gm_generation_id = ?,
           lock_holder_request_id = ?,
           gm_generation_started_at = NULL,
           gm_generation_heartbeat_at = NULL,
           updated_at = datetime('now')
       WHERE id = ?
         AND phase = 'ERROR_RECOVERY'
         AND pending_gm_result_json IS NOT NULL
         AND gm_generation_id IS NULL`
    )
    .run(recoveryOwnerId, recoveryOwnerId, roundId);
  return info.changes === 1;
}

/**
 * Mark canonical commit provenance (may differ from lease owner during recovery).
 * Sets gm_committed_generation_id = provenanceGenerationId while leaseOwnerId holds the lease.
 */
export function markGmGenerationCommitted(
  db: Database.Database,
  roundId: number,
  leaseOwnerId: string,
  provenanceGenerationId: string
): boolean {
  const info = db
    .prepare(
      `UPDATE trpg_rounds
       SET gm_committed_generation_id = ?,
           updated_at = datetime('now')
       WHERE id = ?
         AND gm_generation_id = ?
         AND (gm_committed_generation_id IS NULL OR gm_committed_generation_id = ?)`
    )
    .run(provenanceGenerationId, roundId, leaseOwnerId, provenanceGenerationId);
  return info.changes === 1;
}

export type FinalizeGmRoundOpts = {
  campaignId: number;
  roundId: number;
  roundNumber: number;
  leaseOwnerId: string;
  committedGenerationId: string;
  campaignFinished: boolean;
};

/**
 * Atomically terminalize a committed GM generation: verify owner + provenance,
 * complete round, clear lease, and create next round or finish campaign.
 */
export function finalizeGmRoundForGeneration(db: Database.Database, opts: FinalizeGmRoundOpts): boolean {
  return db.transaction(() => {
    if (opts.campaignFinished) {
      const info = db
        .prepare(
          `UPDATE trpg_rounds
           SET phase = 'ROUND_COMPLETE',
               gm_generation_id = NULL,
               lock_holder_request_id = NULL,
               gm_generation_started_at = NULL,
               gm_generation_heartbeat_at = NULL,
               updated_at = datetime('now')
           WHERE id = ?
             AND gm_generation_id = ?
             AND gm_committed_generation_id = ?
             AND phase IN ${GM_ACTIVE_PHASE_SQL}`
        )
        .run(opts.roundId, opts.leaseOwnerId, opts.committedGenerationId);
      if (info.changes !== 1) return false;
      db.prepare(`UPDATE trpg_campaigns SET status='CAMPAIGN_COMPLETE', updated_at=datetime('now') WHERE id=?`).run(
        opts.campaignId
      );
      return true;
    }

    const info = db
      .prepare(
        `UPDATE trpg_rounds
         SET phase = 'ROUND_COMPLETE',
             gm_generation_id = NULL,
             lock_holder_request_id = NULL,
             gm_generation_started_at = NULL,
             gm_generation_heartbeat_at = NULL,
             updated_at = datetime('now')
         WHERE id = ?
           AND gm_generation_id = ?
           AND gm_committed_generation_id = ?
           AND phase IN ${GM_ACTIVE_PHASE_SQL}`
      )
      .run(opts.roundId, opts.leaseOwnerId, opts.committedGenerationId);
    if (info.changes !== 1) return false;

    db.prepare(`INSERT INTO trpg_rounds (campaign_id, round_number, phase) VALUES (?, ?, 'ACTION_INPUT')`).run(
      opts.campaignId,
      opts.roundNumber + 1
    );
    db.prepare(`UPDATE trpg_campaigns SET status='ACTION_INPUT', updated_at=datetime('now') WHERE id=?`).run(
      opts.campaignId
    );
    return true;
  })();
}

/** Atomically finish a successful narration reroll after canonical commit. */
export function finalizeRerollForGeneration(
  db: Database.Database,
  roundId: number,
  leaseOwnerId: string,
  committedGenerationId: string
): boolean {
  const info = db
    .prepare(
      `UPDATE trpg_rounds
       SET phase = 'ROUND_COMPLETE',
           lock_holder_request_id = NULL,
           gm_generation_id = NULL,
           gm_generation_started_at = NULL,
           gm_generation_heartbeat_at = NULL,
           pending_gm_result_json = NULL,
           updated_at = datetime('now')
       WHERE id = ?
         AND gm_generation_id = ?
         AND gm_committed_generation_id = ?
         AND process_stage = 'reroll'`
    )
    .run(roundId, leaseOwnerId, committedGenerationId);
  return info.changes === 1;
}

export function isRerollGmGeneration(db: Database.Database, roundId: number): boolean {
  const row = db
    .prepare(`SELECT process_stage FROM trpg_rounds WHERE id = ?`)
    .get(roundId) as { process_stage: string | null } | undefined;
  return row?.process_stage === "reroll";
}

/** CAS revert stale narration reroll; preserves old GM message. */
export function tryRevertStaleRerollGeneration(
  db: Database.Database,
  roundId: number,
  staleOwnerId: string
): boolean {
  const errorJson = JSON.stringify({
    class: "B",
    error: "Narration reroll lease expired (old scene preserved)",
    kind: "gm_generation_orphan_reclaimed",
    model: TRPG_GM_MODEL,
    elapsedMs: null,
    trueOffRequested: true,
    httpStatus: null,
    reasoningTokens: "unavailable",
  });

  const info = db
    .prepare(
      `UPDATE trpg_rounds
       SET phase = 'ROUND_COMPLETE',
           lock_holder_request_id = NULL,
           gm_generation_id = NULL,
           gm_generation_started_at = NULL,
           gm_generation_heartbeat_at = NULL,
           pending_gm_result_json = NULL,
           error_json = COALESCE(error_json, ?),
           updated_at = datetime('now')
       WHERE id = ?
         AND gm_generation_id = ?
         AND process_stage = 'reroll'
         AND phase IN ${GM_ACTIVE_PHASE_SQL}
         AND ${staleAtWriteSql()}
         AND gm_committed_generation_id IS NULL
         AND pending_gm_result_json IS NULL`
    )
    .run(errorJson, roundId, staleOwnerId);
  return info.changes === 1;
}

/** @deprecated Use tryRevertStaleRerollGeneration */
export function reconcileStaleRerollGeneration(db: Database.Database, roundId: number): void {
  const row = db
    .prepare(`SELECT gm_generation_id FROM trpg_rounds WHERE id = ?`)
    .get(roundId) as { gm_generation_id: string | null } | undefined;
  if (row?.gm_generation_id) {
    tryRevertStaleRerollGeneration(db, roundId, row.gm_generation_id);
  }
}
