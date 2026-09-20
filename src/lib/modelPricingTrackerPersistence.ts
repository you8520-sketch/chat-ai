/**
 * Persistence helpers for model pricing tracker — append-only snapshots and idempotent runs.
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

export function insertTrackerRun(
  db: Database.Database,
  params: { runDateKey: string; phase: string; startedAt: string }
): number {
  const result = db
    .prepare(
      `INSERT INTO model_pricing_tracker_runs (run_date_key, phase, status, started_at)
       VALUES (?, ?, 'running', ?)`
    )
    .run(params.runDateKey, params.phase, params.startedAt);
  return Number(result.lastInsertRowid);
}

export function finishTrackerRun(
  db: Database.Database,
  params: {
    runId: number;
    status: "completed" | "failed" | "skipped_duplicate";
    finishedAt: string;
    snapshotCount: number;
    eventCount: number;
    errorSummary?: string;
  }
): void {
  db.prepare(
    `UPDATE model_pricing_tracker_runs
     SET status = ?, finished_at = ?, snapshot_count = ?, event_count = ?, error_summary = ?
     WHERE id = ?`
  ).run(
    params.status,
    params.finishedAt,
    params.snapshotCount,
    params.eventCount,
    params.errorSummary ?? "",
    params.runId
  );
}

export function insertPriceSnapshot(
  db: Database.Database,
  runId: number,
  snapshot: ModelPriceSnapshotRecord
): void {
  db.prepare(
    `INSERT INTO model_price_snapshots (
      run_id, provider, model_id, provider_model_id, pricing_mode, source_kind, source_url,
      input_usd_per_million, output_usd_per_million, cache_read_usd_per_million,
      cache_write_usd_per_million, tier_threshold, discount_percent,
      raw_fingerprint, observed_at, valid_from, valid_until
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    runId,
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

export function readLatestSnapshot(
  db: Database.Database,
  modelId: string,
  sourceKind: string
): ModelPriceSnapshotRecord | null {
  const row = db
    .prepare(
      `SELECT provider, model_id, provider_model_id, pricing_mode, source_kind, source_url,
              input_usd_per_million, output_usd_per_million, cache_read_usd_per_million,
              cache_write_usd_per_million, tier_threshold, discount_percent,
              raw_fingerprint, observed_at, valid_from, valid_until
       FROM model_price_snapshots
       WHERE model_id = ? AND source_kind = ?
       ORDER BY id DESC
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
  runId: number,
  modelId: string,
  event: ClassifiedPriceChange,
  pricingVersion: number | null
): boolean {
  try {
    db.prepare(
      `INSERT INTO model_price_change_events (
        run_id, model_id, event_type, classification, action, decision,
        old_fingerprint, new_fingerprint, old_values_json, new_values_json,
        pricing_version, effective_at, event_fingerprint
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      runId,
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
    runId: number | null;
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
      run_id, admin_event_type, model_id, source, classification, decision,
      old_values_json, new_values_json, pricing_version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    params.runId,
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

export function countSnapshotsForRun(db: Database.Database, runId: number): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS c FROM model_price_snapshots WHERE run_id = ?`)
    .get(runId) as { c: number };
  return row.c;
}

export function countEventsForRun(db: Database.Database, runId: number): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS c FROM model_price_change_events WHERE run_id = ?`)
    .get(runId) as { c: number };
  return row.c;
}
