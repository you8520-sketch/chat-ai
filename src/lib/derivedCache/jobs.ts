import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";

export type DerivedJobKind =
  | "character_derived_refresh"
  | "world_translate"
  | "world_share_translate"
  | "trpg_sandbox_blueprint_pregen";

export type DerivedEntityType = "character" | "world" | "world_share";

export type DerivedJobStatus = "pending" | "processing" | "done" | "failed";

export type DerivedCacheJobRow = {
  id: number;
  job_kind: DerivedJobKind;
  entity_type: DerivedEntityType;
  entity_id: number;
  source_fingerprint: string;
  derivation_version: number;
  job_flags: string;
  status: DerivedJobStatus;
  attempts: number;
  run_after: string;
  locked_at: string | null;
  last_error: string;
  created_at: string;
  updated_at: string;
};

const MAX_JOB_ATTEMPTS = 8;
const LEASE_STALE_MINUTES = 15;

export function maxAttemptsForDerivedJobKind(jobKind: DerivedJobKind): number {
  switch (jobKind) {
    case "trpg_sandbox_blueprint_pregen":
      return 1;
    case "character_derived_refresh":
    case "world_translate":
    case "world_share_translate":
      return MAX_JOB_ATTEMPTS;
    default: {
      const unknownKind: never = jobKind;
      return unknownKind;
    }
  }
}

export function ensureDerivedCacheJobsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS derived_cache_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_kind TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id INTEGER NOT NULL,
      source_fingerprint TEXT NOT NULL,
      derivation_version INTEGER NOT NULL,
      job_flags TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','processing','done','failed')),
      attempts INTEGER NOT NULL DEFAULT 0,
      run_after TEXT NOT NULL DEFAULT (datetime('now')),
      locked_at TEXT,
      last_error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(job_kind, entity_type, entity_id, source_fingerprint, derivation_version)
    );
    CREATE INDEX IF NOT EXISTS idx_derived_cache_jobs_pending
      ON derived_cache_jobs(status, run_after, id);
    CREATE INDEX IF NOT EXISTS idx_derived_cache_jobs_entity
      ON derived_cache_jobs(entity_type, entity_id, job_kind);
  `);
  try {
    db.exec(`ALTER TABLE derived_cache_jobs ADD COLUMN job_flags TEXT NOT NULL DEFAULT ''`);
  } catch {
    // column already exists
  }
}

export function enqueueDerivedCacheJob(
  db: Database.Database,
  input: {
    jobKind: DerivedJobKind;
    entityType: DerivedEntityType;
    entityId: number;
    sourceFingerprint: string;
    derivationVersion: number;
    jobFlags?: string;
  }
): boolean {
  ensureDerivedCacheJobsTable(db);
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO derived_cache_jobs
        (job_kind, entity_type, entity_id, source_fingerprint, derivation_version, job_flags, status, run_after, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', datetime('now'), datetime('now'))`
    )
    .run(
      input.jobKind,
      input.entityType,
      input.entityId,
      input.sourceFingerprint,
      input.derivationVersion,
      input.jobFlags ?? ""
    );
  return result.changes > 0;
}

export type DerivedCacheJobIdentity = {
  jobKind: DerivedJobKind;
  entityType: DerivedEntityType;
  entityId: number;
  sourceFingerprint: string;
  derivationVersion: number;
  jobFlags?: string;
};

export function findDerivedCacheJobByIdentity(
  db: Database.Database,
  input: DerivedCacheJobIdentity
): DerivedCacheJobRow | null {
  ensureDerivedCacheJobsTable(db);
  return (
    (db
      .prepare(
        `SELECT * FROM derived_cache_jobs
         WHERE job_kind = ?
           AND entity_type = ?
           AND entity_id = ?
           AND source_fingerprint = ?
           AND derivation_version = ?`
      )
      .get(
        input.jobKind,
        input.entityType,
        input.entityId,
        input.sourceFingerprint,
        input.derivationVersion
      ) as DerivedCacheJobRow | undefined) ?? null
  );
}

/**
 * Atomically enqueue a pending job or reactivate a terminal done/failed row.
 * Pending/processing rows are preserved (single-flight); returns false if unchanged.
 */
export function enqueueDerivedCacheJobReplacingTerminal(
  db: Database.Database,
  input: DerivedCacheJobIdentity
): boolean {
  ensureDerivedCacheJobsTable(db);
  const result = db
    .prepare(
      `INSERT INTO derived_cache_jobs
        (job_kind, entity_type, entity_id, source_fingerprint, derivation_version, job_flags,
         status, run_after, attempts, locked_at, last_error, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', datetime('now'), 0, NULL, '', datetime('now'))
       ON CONFLICT(job_kind, entity_type, entity_id, source_fingerprint, derivation_version)
       DO UPDATE SET
         status = 'pending',
         attempts = 0,
         run_after = datetime('now'),
         locked_at = NULL,
         last_error = '',
         job_flags = excluded.job_flags,
         updated_at = datetime('now')
       WHERE derived_cache_jobs.status IN ('done', 'failed')`
    )
    .run(
      input.jobKind,
      input.entityType,
      input.entityId,
      input.sourceFingerprint,
      input.derivationVersion,
      input.jobFlags ?? ""
    );
  return result.changes > 0;
}

/** Explicit force requeue — used for regenerate_appearance and manual refresh only. */
export function forceRequeueDerivedCacheJob(
  db: Database.Database,
  input: {
    jobKind: DerivedJobKind;
    entityType: DerivedEntityType;
    entityId: number;
    sourceFingerprint: string;
    derivationVersion: number;
    jobFlags?: string;
  }
): void {
  ensureDerivedCacheJobsTable(db);
  db.prepare(
    `INSERT INTO derived_cache_jobs
      (job_kind, entity_type, entity_id, source_fingerprint, derivation_version, job_flags, status, run_after, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', datetime('now'), datetime('now'))
     ON CONFLICT(job_kind, entity_type, entity_id, source_fingerprint, derivation_version)
     DO UPDATE SET
       status = CASE
         WHEN derived_cache_jobs.status = 'processing' THEN derived_cache_jobs.status
         ELSE 'pending'
       END,
       run_after = CASE
         WHEN derived_cache_jobs.status = 'processing' THEN derived_cache_jobs.run_after
         ELSE datetime('now')
       END,
       job_flags = excluded.job_flags,
       updated_at = datetime('now')`
  ).run(
    input.jobKind,
    input.entityType,
    input.entityId,
    input.sourceFingerprint,
    input.derivationVersion,
    input.jobFlags ?? ""
  );
}

export function recoverStaleDerivedCacheLeases(db: Database.Database): void {
  ensureDerivedCacheJobsTable(db);
  db.prepare(
    `UPDATE derived_cache_jobs
     SET status = 'pending', locked_at = NULL, updated_at = datetime('now')
     WHERE status = 'processing'
       AND locked_at IS NOT NULL
       AND datetime(locked_at) < datetime('now', ?)`
  ).run(`-${LEASE_STALE_MINUTES} minutes`);
}

export function claimNextDerivedCacheJob(db: Database.Database): DerivedCacheJobRow | null {
  ensureDerivedCacheJobsTable(db);
  recoverStaleDerivedCacheLeases(db);
  const candidate = db
    .prepare(
      `SELECT id FROM derived_cache_jobs
       WHERE status = 'pending'
         AND datetime(run_after) <= datetime('now')
       ORDER BY id ASC
       LIMIT 1`
    )
    .get() as { id: number } | undefined;
  if (!candidate) return null;

  const claimed = db
    .prepare(
      `UPDATE derived_cache_jobs
       SET status = 'processing',
           locked_at = datetime('now'),
           attempts = attempts + 1,
           updated_at = datetime('now')
       WHERE id = ? AND status = 'pending'`
    )
    .run(candidate.id);
  if (claimed.changes === 0) return null;

  return db
    .prepare(`SELECT * FROM derived_cache_jobs WHERE id = ?`)
    .get(candidate.id) as DerivedCacheJobRow;
}

function backoffMinutes(attempts: number): number {
  return Math.min(60, Math.pow(2, Math.max(0, attempts - 1)));
}

/** Remove a job row so its derivation identity can be enqueued again. */
export function discardDerivedCacheJob(db: Database.Database, jobId: number): void {
  db.prepare(`DELETE FROM derived_cache_jobs WHERE id = ?`).run(jobId);
}

export function completeDerivedCacheJob(
  db: Database.Database,
  jobId: number,
  outcome: { ok: true } | { ok: false; error: string; retryable?: boolean }
): void {
  if (outcome.ok) {
    db.prepare(
      `UPDATE derived_cache_jobs
       SET status = 'done', locked_at = NULL, last_error = '', updated_at = datetime('now')
       WHERE id = ?`
    ).run(jobId);
    return;
  }

  const row = db
    .prepare(`SELECT attempts, job_kind FROM derived_cache_jobs WHERE id = ?`)
    .get(jobId) as { attempts: number; job_kind: DerivedJobKind } | undefined;
  const attempts = row?.attempts ?? MAX_JOB_ATTEMPTS;
  const maxAttempts = row ? maxAttemptsForDerivedJobKind(row.job_kind) : MAX_JOB_ATTEMPTS;
  const retryable = outcome.retryable !== false && attempts < maxAttempts;
  const err = outcome.error.slice(0, 240);
  if (retryable) {
    db.prepare(
      `UPDATE derived_cache_jobs
       SET status = 'pending',
           locked_at = NULL,
           last_error = ?,
           run_after = datetime('now', ?),
           updated_at = datetime('now')
       WHERE id = ?`
    ).run(err, `+${backoffMinutes(attempts)} minutes`, jobId);
  } else {
    db.prepare(
      `UPDATE derived_cache_jobs
       SET status = 'failed', locked_at = NULL, last_error = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).run(err, jobId);
  }
}

/** Best-effort post-response kick — durability owner is SQLite queue, not this call. */
export function kickDerivedCacheWorker(maxJobs = 3): void {
  if (process.env.DISABLE_DERIVED_CACHE_WORKER === "1") return;
  void drainDerivedCacheJobs(maxJobs).catch((err) => {
    console.warn(
      "[derivedCache] worker kick failed:",
      err instanceof Error ? err.message.slice(0, 160) : String(err).slice(0, 160)
    );
  });
}

export async function drainDerivedCacheJobs(maxJobs = 3): Promise<number> {
  const { processDerivedCacheJob } = await import("@/lib/derivedCache/worker");
  const db = getDb();
  let processed = 0;
  for (let i = 0; i < maxJobs; i++) {
    const job = claimNextDerivedCacheJob(db);
    if (!job) break;
    await processDerivedCacheJob(db, job);
    processed++;
  }
  return processed;
}
