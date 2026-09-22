/**
 * Persistence helpers for the model pricing tracker.
 *
 * Canonical ownership:
 * - claimTrackerRun  = the single atomic DAILY CLAIM owner (per KST date).
 *   Daily claim AND run attempt identity are created together here; a failed
 *   attempt never reuses its run identity — a same-day retry gets a new
 *   immutable attempt id.
 * - finishTrackerRun = the single attempt-completion owner; counters are
 *   recomputed from the persisted rows so stored metadata can never drift
 *   from reality.
 * - readLatestSnapshot = previous SOURCE TRUTH reads only trust snapshots from
 *   COMPLETED attempts; failed/crashed partial evidence is never a baseline.
 *
 * Single-statement SQLite ops only — no multi-statement transaction — so the
 * same semantics hold on the local file DB and on remote libSQL/Turso.
 */

import type Database from "better-sqlite3";
import { ensureModelPricingTrackingSchema } from "@/lib/modelPricingTrackingSchema";
import type { ClassifiedPriceChange } from "@/lib/modelPriceChangeClassifier";
import type { ModelPriceSnapshotRecord } from "@/lib/modelPriceSnapshot";

export type TrackerRunRow = {
  id: number;
  run_date_key: string;
  phase: string;
  status: string;
};

export type TrackerAttemptRow = {
  id: number;
  run_date_key: string;
  phase: string;
  status: string;
  snapshot_count: number;
  event_count: number;
  error_summary: string;
};

export function ensureTrackerSchema(db: Database.Database): void {
  ensureModelPricingTrackingSchema(db);
}

export function findTrackerRunByDateKey(
  db: Database.Database,
  runDateKey: string
): TrackerRunRow | null {
  const row = db
    .prepare(
      `SELECT id, run_date_key, phase, status
       FROM model_pricing_tracker_runs
       WHERE run_date_key = ?`
    )
    .get(runDateKey) as TrackerRunRow | undefined;
  return row ?? null;
}

export type TrackerRunClaim =
  | { outcome: "CLAIMED"; runId: number; attemptId: number; reclaimed: boolean }
  | { outcome: "SKIPPED_DUPLICATE"; runId: number; existingStatus: string };

/**
 * Atomic daily-run claim owner. Single-statement SQLite ops only:
 * - no row            -> INSERT OR IGNORE claims (exactly one replica wins), then a
 *                        fresh immutable RUN ATTEMPT is created for the actual run.
 * - existing RUNNING  -> SKIPPED_DUPLICATE
 * - existing COMPLETED-> SKIPPED_DUPLICATE
 * - existing FAILED   -> conditional UPDATE reclaims the DAILY claim
 *                        (WHERE status='failed' guard makes two racing replicas
 *                        exactly one winner) and opens a NEW attempt.
 */
export function claimTrackerRun(
  db: Database.Database,
  params: { runDateKey: string; phase: string; startedAt: string }
): TrackerRunClaim {
  const claim = claimDailyRun(db, params);
  if (claim.outcome === "SKIPPED_DUPLICATE") return claim;
  const attemptId = insertTrackerAttempt(db, {
    runDateKey: params.runDateKey,
    phase: params.phase,
    startedAt: params.startedAt,
  });
  db.prepare(
    `UPDATE model_pricing_tracker_runs SET latest_attempt_id = ? WHERE id = ?`
  ).run(attemptId, claim.runId);
  return { outcome: "CLAIMED", runId: claim.runId, attemptId, reclaimed: claim.reclaimed };
}

function insertTrackerAttempt(
  db: Database.Database,
  params: { runDateKey: string; phase: string; startedAt: string }
): number {
  const result = db
    .prepare(
      `INSERT INTO model_pricing_tracker_attempts (run_date_key, phase, status, started_at)
       VALUES (?, ?, 'running', ?)`
    )
    .run(params.runDateKey, params.phase, params.startedAt);
  return Number(result.lastInsertRowid);
}

function claimDailyRun(
  db: Database.Database,
  params: { runDateKey: string; phase: string; startedAt: string }
): { outcome: "CLAIMED"; runId: number; reclaimed: boolean } | { outcome: "SKIPPED_DUPLICATE"; runId: number; existingStatus: string } {
  const inserted = db
    .prepare(
      `INSERT OR IGNORE INTO model_pricing_tracker_runs (run_date_key, phase, status, started_at)
       VALUES (?, ?, 'running', ?)`
    )
    .run(params.runDateKey, params.phase, params.startedAt);
  if (Number(inserted.changes) > 0) {
    const claimed = findTrackerRunByDateKey(db, params.runDateKey);
    return { outcome: "CLAIMED", runId: Number(claimed?.id), reclaimed: false };
  }

  const existing = findTrackerRunByDateKey(db, params.runDateKey);
  if (!existing) {
    return claimDailyRun(db, params);
  }
  if (existing.status !== "failed") {
    return { outcome: "SKIPPED_DUPLICATE", runId: existing.id, existingStatus: existing.status };
  }

  const reclaimed = db
    .prepare(
      `UPDATE model_pricing_tracker_runs
       SET status = 'running', phase = ?, started_at = ?, finished_at = NULL
       WHERE run_date_key = ? AND status = 'failed'`
    )
    .run(params.phase, params.startedAt, params.runDateKey);
  if (Number(reclaimed.changes) > 0) {
    return { outcome: "CLAIMED", runId: existing.id, reclaimed: true };
  }
  const winner = findTrackerRunByDateKey(db, params.runDateKey);
  return { outcome: "SKIPPED_DUPLICATE", runId: winner?.id ?? existing.id, existingStatus: winner?.status ?? "running" };
}

/**
 * Attempt completion owner. Counters are recomputed from the persisted rows so
 * stored attempt metadata always matches reality (append-only evidence keeps
 * failed partial rows counted on their own attempt).
 * The DAILY claim row mirrors the attempt status for same-day retry semantics.
 */
export function finishTrackerRun(
  db: Database.Database,
  params: { attemptId: number; status: "completed" | "failed"; finishedAt: string; errorSummary?: string }
): void {
  db.prepare(
    `UPDATE model_pricing_tracker_attempts
     SET status = ?, finished_at = ?,
         snapshot_count = (SELECT COUNT(*) FROM model_price_snapshots WHERE attempt_id = ?),
         event_count = (SELECT COUNT(*) FROM model_price_change_events WHERE attempt_id = ?),
         error_summary = ?
     WHERE id = ?`
  ).run(params.status, params.finishedAt, params.attemptId, params.attemptId, params.errorSummary ?? "", params.attemptId);
  db.prepare(
    `UPDATE model_pricing_tracker_runs
     SET status = ?, finished_at = ?
     WHERE latest_attempt_id = ?`
  ).run(params.status, params.finishedAt, params.attemptId);
}

export function findTrackerAttemptById(
  db: Database.Database,
  attemptId: number
): TrackerAttemptRow | null {
  const row = db
    .prepare(
      `SELECT id, run_date_key, phase, status, snapshot_count, event_count, error_summary
       FROM model_pricing_tracker_attempts
       WHERE id = ?`
    )
    .get(attemptId) as TrackerAttemptRow | undefined;
  return row ?? null;
}

export function insertPriceSnapshot(
  db: Database.Database,
  attemptId: number,
  snapshot: ModelPriceSnapshotRecord
): void {
  db.prepare(
    `INSERT INTO model_price_snapshots (
      attempt_id, provider, model_id, provider_model_id, pricing_mode, source_kind, source_url,
      input_usd_per_million, output_usd_per_million, cache_read_usd_per_million,
      cache_write_usd_per_million, tier_threshold, discount_percent,
      raw_fingerprint, observed_at, valid_from, valid_until
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    attemptId,
    snapshot.provider,
    snapshot.modelId,
    snapshot.providerModelId,
    snapshot.pricingMode,
    snapshot.sourceKind,
    snapshot.sourceUrl,
    snapshot.rates.inputUsdPerMillion,
    snapshot.rates.outputUsdPerMillion,
    snapshot.rates.cacheReadUsdPerMillion,
    snapshot.rates.cacheWriteUsdPerMillion,
    snapshot.rates.tierThreshold,
    snapshot.rates.discountPercent,
    snapshot.rawFingerprint,
    snapshot.observedAt,
    snapshot.validFrom,
    snapshot.validUntil
  );
}

/**
 * Previous SOURCE TRUTH owner: only snapshots from COMPLETED attempts may be
 * consumed as a previous observation. Failed or crashed attempts leave their
 * partial rows in place (append-only) but they are never previous truth.
 */
export function readLatestSnapshot(
  db: Database.Database,
  modelId: string,
  sourceKind: string
): ModelPriceSnapshotRecord | null {
  const row = db
    .prepare(
      `SELECT s.provider, s.model_id, s.provider_model_id, s.pricing_mode, s.source_kind, s.source_url,
              s.input_usd_per_million, s.output_usd_per_million, s.cache_read_usd_per_million,
              s.cache_write_usd_per_million, s.tier_threshold, s.discount_percent,
              s.raw_fingerprint, s.observed_at, s.valid_from, s.valid_until
       FROM model_price_snapshots s
       JOIN model_pricing_tracker_attempts a ON a.id = s.attempt_id
       WHERE s.model_id = ? AND s.source_kind = ? AND a.status = 'completed'
       ORDER BY s.id DESC
       LIMIT 1`
    )
    .get(modelId, sourceKind) as
    | {
        provider: string;
        model_id: string;
        provider_model_id: string;
        pricing_mode: ModelPriceSnapshotRecord["pricingMode"];
        source_kind: ModelPriceSnapshotRecord["sourceKind"];
        source_url: string;
        input_usd_per_million: number | null;
        output_usd_per_million: number | null;
        cache_read_usd_per_million: number | null;
        cache_write_usd_per_million: number | null;
        tier_threshold: number | null;
        discount_percent: number | null;
        raw_fingerprint: string;
        observed_at: string;
        valid_from: string | null;
        valid_until: string | null;
      }
    | undefined;

  if (!row) return null;
  return {
    provider: row.provider,
    modelId: row.model_id,
    providerModelId: row.provider_model_id,
    pricingMode: row.pricing_mode,
    sourceKind: row.source_kind,
    sourceUrl: row.source_url,
    rates: {
      inputUsdPerMillion: row.input_usd_per_million,
      outputUsdPerMillion: row.output_usd_per_million,
      cacheReadUsdPerMillion: row.cache_read_usd_per_million,
      cacheWriteUsdPerMillion: row.cache_write_usd_per_million,
      tierThreshold: row.tier_threshold,
      discountPercent: row.discount_percent,
    },
    rawFingerprint: row.raw_fingerprint,
    observedAt: row.observed_at,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
  };
}

export function insertClassifiedEvent(
  db: Database.Database,
  attemptId: number,
  modelId: string,
  event: ClassifiedPriceChange,
  pricingVersion: number | null
): boolean {
  try {
    db.prepare(
      `INSERT INTO model_price_change_events (
        attempt_id, model_id, event_type, classification, action, decision,
        old_fingerprint, new_fingerprint, old_values_json, new_values_json,
        pricing_version, effective_at, event_fingerprint
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      attemptId,
      modelId,
      event.eventType,
      event.classification,
      event.action,
      event.decision,
      event.oldFingerprint,
      event.newFingerprint,
      JSON.stringify(event.oldValues),
      JSON.stringify(event.newValues),
      pricingVersion,
      event.effectiveAt,
      event.eventFingerprint
    );
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
      return false;
    }
    throw error;
  }
}

export function insertAdminEvent(
  db: Database.Database,
  params: {
    attemptId: number | null;
    adminEventType: string;
    modelId: string | null;
    source: string;
    classification: string | null;
    decision: string;
    oldValues?: Record<string, unknown>;
    newValues?: Record<string, unknown>;
    pricingVersion?: number | null;
  }
): void {
  db.prepare(
    `INSERT INTO model_pricing_admin_events (
      attempt_id, admin_event_type, model_id, source, classification, decision,
      old_values_json, new_values_json, pricing_version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    params.attemptId,
    params.adminEventType,
    params.modelId,
    params.source,
    params.classification,
    params.decision,
    JSON.stringify(params.oldValues ?? {}),
    JSON.stringify(params.newValues ?? {}),
    params.pricingVersion ?? null
  );
}

export function countSnapshotsForAttempt(db: Database.Database, attemptId: number): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS c FROM model_price_snapshots WHERE attempt_id = ?`)
    .get(attemptId) as { c: number };
  return row.c;
}

export function countEventsForAttempt(db: Database.Database, attemptId: number): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS c FROM model_price_change_events WHERE attempt_id = ?`)
    .get(attemptId) as { c: number };
  return row.c;
}
