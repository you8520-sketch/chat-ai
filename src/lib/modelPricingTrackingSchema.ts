/**
 * DB schema owner for the model pricing tracker.
 *
 * TWO canonical responsibilities:
 * - `model_pricing_tracker_runs`      = DAILY CLAIM (one KST date, one active executor,
 *   status mirrors the latest attempt for same-day retry semantics)
 * - `model_pricing_tracker_attempts`  = RUN ATTEMPT (immutable identity per actual run;
 *   failed attempt and retry attempt are different rows)
 *
 * Snapshots / events / admin events are append-only and permanently attached to
 * their attempt — a failed attempt's partial evidence is never deleted,
 * overwritten, or reused as a later attempt's previous source truth.
 *
 * Additive schema changes use idempotent CREATE TABLE / CREATE INDEX only.
 */

import type Database from "better-sqlite3";

export const MODEL_PRICE_SNAPSHOTS_TABLE = "model_price_snapshots";
export const MODEL_PRICING_TRACKER_RUNS_TABLE = "model_pricing_tracker_runs";
export const MODEL_PRICING_TRACKER_ATTEMPTS_TABLE = "model_pricing_tracker_attempts";
export const MODEL_PRICE_CHANGE_EVENTS_TABLE = "model_price_change_events";
export const MODEL_PRICING_ADMIN_EVENTS_TABLE = "model_pricing_admin_events";
export const MODEL_PRICING_CANDIDATE_RECORDS_TABLE = "model_pricing_candidate_records";

export const MODEL_PRICING_TRACKING_DDL = `
  CREATE TABLE IF NOT EXISTS model_pricing_tracker_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_date_key TEXT NOT NULL UNIQUE,
    phase TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    latest_attempt_id INTEGER
  );

  CREATE TABLE IF NOT EXISTS model_pricing_tracker_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_date_key TEXT NOT NULL,
    phase TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    snapshot_count INTEGER NOT NULL DEFAULT 0,
    event_count INTEGER NOT NULL DEFAULT 0,
    error_summary TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_model_pricing_tracker_attempts_date
    ON model_pricing_tracker_attempts(run_date_key, started_at);

  CREATE TABLE IF NOT EXISTS model_price_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    attempt_id INTEGER NOT NULL,
    provider TEXT NOT NULL,
    model_id TEXT NOT NULL,
    provider_model_id TEXT NOT NULL,
    pricing_mode TEXT NOT NULL,
    source_kind TEXT NOT NULL,
    source_url TEXT NOT NULL DEFAULT '',
    input_usd_per_million REAL,
    output_usd_per_million REAL,
    cache_read_usd_per_million REAL,
    cache_write_usd_per_million REAL,
    tier_threshold INTEGER,
    discount_percent REAL,
    raw_fingerprint TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    valid_from TEXT,
    valid_until TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (attempt_id) REFERENCES model_pricing_tracker_attempts(id)
  );
  CREATE INDEX IF NOT EXISTS idx_model_price_snapshots_model_observed
    ON model_price_snapshots(model_id, source_kind, observed_at DESC);
  CREATE INDEX IF NOT EXISTS idx_model_price_snapshots_attempt
    ON model_price_snapshots(attempt_id);

  CREATE TABLE IF NOT EXISTS model_price_change_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    attempt_id INTEGER NOT NULL,
    model_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    classification TEXT NOT NULL,
    action TEXT NOT NULL,
    decision TEXT NOT NULL,
    old_fingerprint TEXT,
    new_fingerprint TEXT,
    old_values_json TEXT NOT NULL DEFAULT '{}',
    new_values_json TEXT NOT NULL DEFAULT '{}',
    pricing_version INTEGER,
    effective_at TEXT,
    event_fingerprint TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (attempt_id) REFERENCES model_pricing_tracker_attempts(id)
  );
  CREATE INDEX IF NOT EXISTS idx_model_price_change_events_model
    ON model_price_change_events(model_id, event_type, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_model_price_change_events_attempt
    ON model_price_change_events(attempt_id);

  CREATE TABLE IF NOT EXISTS model_pricing_admin_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    attempt_id INTEGER,
    admin_event_type TEXT NOT NULL,
    model_id TEXT,
    source TEXT NOT NULL,
    classification TEXT,
    decision TEXT NOT NULL,
    old_values_json TEXT NOT NULL DEFAULT '{}',
    new_values_json TEXT NOT NULL DEFAULT '{}',
    pricing_version INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_model_pricing_admin_events_created
    ON model_pricing_admin_events(created_at DESC);


  CREATE TABLE IF NOT EXISTS model_pricing_candidate_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    model_id TEXT NOT NULL,
    candidate_fingerprint TEXT NOT NULL,
    candidate_status TEXT NOT NULL,
    candidate_direction TEXT NOT NULL,
    review_state TEXT NOT NULL
      CHECK(review_state IN ('NOT_REVIEWABLE','OPEN','APPROVED','REJECTED','SUPERSEDED')),
    base_pricing_version INTEGER NOT NULL,
    base_target_margin REAL NOT NULL,
    proposed_target_margin REAL,
    minimum_safe_target_margin REAL,
    maximum_competitive_target_margin REAL,
    live_applicability TEXT NOT NULL,
    production_billing_contract TEXT NOT NULL,
    procurement_freshness TEXT NOT NULL,
    actual_signal TEXT NOT NULL,
    actual_month_key TEXT,
    actual_margin_rate REAL,
    actual_exact INTEGER NOT NULL DEFAULT 0,
    hard_benchmark_count INTEGER NOT NULL DEFAULT 0,
    evidence_json TEXT NOT NULL DEFAULT '{}',
    first_observed_at TEXT NOT NULL,
    last_observed_at TEXT NOT NULL,
    observation_count INTEGER NOT NULL DEFAULT 1,
    reviewed_at TEXT,
    reviewed_by_user_id INTEGER,
    review_note TEXT NOT NULL DEFAULT '',
    superseded_reason TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_model_pricing_candidate_records_model
    ON model_pricing_candidate_records(model_id, id DESC);
  CREATE INDEX IF NOT EXISTS idx_model_pricing_candidate_records_review
    ON model_pricing_candidate_records(review_state, id DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_model_pricing_candidate_records_one_open
    ON model_pricing_candidate_records(model_id)
    WHERE review_state = 'OPEN';
`;

export function ensureModelPricingTrackingSchema(db: Pick<Database.Database, "exec">): void {
  db.exec(MODEL_PRICING_TRACKING_DDL);
}
