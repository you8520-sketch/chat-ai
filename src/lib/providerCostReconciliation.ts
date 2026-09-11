import "server-only";

import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";
import {
  fetchAllUsageRequests,
  fetchUsageDaily,
  type CheaperInferenceUsageRequest,
} from "@/lib/cheaperInferenceUsage";
import {
  ensureProviderCostLedgerSchema,
  toMicroUsd,
  upsertReconciledProviderCost,
} from "@/lib/providerCostLedger";

/**
 * Canonical CheaperInference usage reconciliation owner.
 * /usage/requests promotes/creates request-level settled actuals in the ONE
 * canonical ledger; /usage/daily is a completeness checksum only (never an
 * additive cost owner). New AI features that forget ledger wiring surface as
 * a daily delta instead of silently losing cost.
 */

export type ProviderReconciliationStatus =
  | "matched"
  | "mismatch"
  | "pending"
  | "provider_unavailable"
  | "not_configured";

export type ProviderReconciliationResult = {
  status: ProviderReconciliationStatus;
  provider: "cheaperinference";
  ranAt: string;
  windowStart: string;
  windowEnd: string;
  pages: number;
  providerRequests: number;
  settledMicroUsd: number;
  localReconciledMicroUsd: number;
  dailyMicroUsd: number | null;
  dailyDeltaMicroUsd: number | null;
  unreconciledProviderMicroUsd: number;
  inserted: number;
  promoted: number;
  matched: number;
  superseded: number;
  skipped: number;
  message: string;
};

type ReconciliationDeps = {
  fetchRequests?: typeof fetchAllUsageRequests;
  fetchDaily?: typeof fetchUsageDaily;
  now?: () => number;
  persistInTests?: boolean;
};

/** Cutover marker for remote-only insertion: first canonical main-ledger row. */
function resolveMainLedgerCutover(db: Database.Database): string | null {
  const row = db
    .prepare(
      "SELECT MIN(created_at) AS cutover FROM api_cost_ledger WHERE execution_phase = 'main_generation'"
    )
    .get() as { cutover: string | null } | undefined;
  return row?.cutover ?? null;
}

function identityExists(db: Database.Database, requestId: string): boolean {
  const row = db
    .prepare(
      "SELECT 1 AS ok FROM api_cost_ledger WHERE provider = 'cheaperinference' AND provider_request_id = ? LIMIT 1"
    )
    .get(requestId) as { ok: number } | undefined;
  return row != null;
}

/** Sum settled actual provider cost (micro-USD) for the window. */
export function readLocalReconciledMicroUsd(
  db: Database.Database,
  startAt: string,
  endAt: string
): number {
  const rows = db
    .prepare(
      `SELECT actual_cost_usd, actual_cost_source, event_status
         FROM api_cost_ledger
        WHERE provider = 'cheaperinference'
          AND created_at >= ? AND created_at < ?`
    )
    .all(startAt, endAt) as Array<{
    actual_cost_usd: number | null;
    actual_cost_source: string | null;
    event_status: string | null;
  }>;
  let micro = 0;
  for (const row of rows) {
    if (
      row.event_status === "started" ||
      row.event_status === "failed_without_usage" ||
      row.event_status === "completed_without_exact_cost"
    ) {
      continue;
    }
    const exact =
      row.actual_cost_source === "cheaper_inference_billed" ||
      row.actual_cost_source === "provider_reported" ||
      row.actual_cost_source === "cheaper_inference_usage_api";
    if (!exact) continue;
    micro += toMicroUsd(row.actual_cost_usd);
  }
  return micro;
}

export function ensureProviderReconciliationStateTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS provider_cost_reconciliation_state (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      status TEXT NOT NULL DEFAULT 'pending',
      ran_at TEXT NOT NULL DEFAULT (datetime('now')),
      window_start TEXT NOT NULL DEFAULT '',
      window_end TEXT NOT NULL DEFAULT '',
      provider_requests INTEGER NOT NULL DEFAULT 0,
      settled_micro_usd INTEGER NOT NULL DEFAULT 0,
      local_micro_usd INTEGER NOT NULL DEFAULT 0,
      daily_micro_usd INTEGER,
      daily_delta_micro_usd INTEGER,
      unreconciled_micro_usd INTEGER NOT NULL DEFAULT 0,
      message TEXT NOT NULL DEFAULT ''
    );
  `);
}

export function readProviderReconciliationState(
  db: Database.Database = getDb()
): ProviderReconciliationResult | null {
  ensureProviderReconciliationStateTable(db);
  const row = db
    .prepare("SELECT * FROM provider_cost_reconciliation_state WHERE id = 1")
    .get() as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    status: (row.status as ProviderReconciliationStatus) ?? "pending",
    provider: "cheaperinference",
    ranAt: String(row.ran_at ?? ""),
    windowStart: String(row.window_start ?? ""),
    windowEnd: String(row.window_end ?? ""),
    pages: 0,
    providerRequests: Number(row.provider_requests ?? 0),
    settledMicroUsd: Number(row.settled_micro_usd ?? 0),
    localReconciledMicroUsd: Number(row.local_micro_usd ?? 0),
    dailyMicroUsd: row.daily_micro_usd == null ? null : Number(row.daily_micro_usd),
    dailyDeltaMicroUsd:
      row.daily_delta_micro_usd == null ? null : Number(row.daily_delta_micro_usd),
    unreconciledProviderMicroUsd: Number(row.unreconciled_micro_usd ?? 0),
    inserted: 0,
    promoted: 0,
    matched: 0,
    superseded: 0,
    skipped: 0,
    message: String(row.message ?? ""),
  };
}

function writeProviderReconciliationState(
  db: Database.Database,
  result: ProviderReconciliationResult
): void {
  ensureProviderReconciliationStateTable(db);
  db.prepare(
    `INSERT INTO provider_cost_reconciliation_state
       (id, status, ran_at, window_start, window_end, provider_requests,
        settled_micro_usd, local_micro_usd, daily_micro_usd, daily_delta_micro_usd,
        unreconciled_micro_usd, message)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       status=excluded.status, ran_at=excluded.ran_at,
       window_start=excluded.window_start, window_end=excluded.window_end,
       provider_requests=excluded.provider_requests,
       settled_micro_usd=excluded.settled_micro_usd,
       local_micro_usd=excluded.local_micro_usd,
       daily_micro_usd=excluded.daily_micro_usd,
       daily_delta_micro_usd=excluded.daily_delta_micro_usd,
       unreconciled_micro_usd=excluded.unreconciled_micro_usd,
       message=excluded.message`
  ).run(
    result.status,
    result.ranAt,
    result.windowStart,
    result.windowEnd,
    result.providerRequests,
    result.settledMicroUsd,
    result.localReconciledMicroUsd,
    result.dailyMicroUsd,
    result.dailyDeltaMicroUsd,
    result.unreconciledProviderMicroUsd,
    result.message
  );
}

function baseResult(
  windowStart: string,
  windowEnd: string,
  ranAt: string
): ProviderReconciliationResult {
  return {
    status: "pending",
    provider: "cheaperinference",
    ranAt,
    windowStart,
    windowEnd,
    pages: 0,
    providerRequests: 0,
    settledMicroUsd: 0,
    localReconciledMicroUsd: 0,
    dailyMicroUsd: null,
    dailyDeltaMicroUsd: null,
    unreconciledProviderMicroUsd: 0,
    inserted: 0,
    promoted: 0,
    matched: 0,
    superseded: 0,
    skipped: 0,
    message: "",
  };
}

export type ReconcileOptions = {
  windowStart: string;
  windowEnd: string;
  db?: Database.Database;
  deps?: ReconciliationDeps;
};

/** Local ledger timestamps are SQL datetimes; the provider expects ISO 8601. */
function sqlDateTimeToIso(value: string): string {
  const trimmed = value.trim();
  if (trimmed.includes("T")) return trimmed;
  return `${trimmed.replace(" ", "T")}Z`;
}

/**
 * Reconcile request-level settled provider truth into the canonical ledger.
 * Never additive on /usage/daily; stale state is preserved on failure.
 */
export async function reconcileCheaperInferenceUsage(
  opts: ReconcileOptions
): Promise<ProviderReconciliationResult> {
  const db = opts.db ?? getDb();
  ensureProviderCostLedgerSchema(db);
  ensureProviderReconciliationStateTable(db);
  const deps = opts.deps ?? {};
  const ranAt = new Date((deps.now ?? Date.now)()).toISOString().slice(0, 19).replace("T", " ");
  const fetchRequests = deps.fetchRequests ?? fetchAllUsageRequests;
  const fetchDaily = deps.fetchDaily ?? fetchUsageDaily;

  const result = baseResult(opts.windowStart, opts.windowEnd, ranAt);

  const requestsResult = await fetchRequests({
    startAt: sqlDateTimeToIso(opts.windowStart),
    endAt: sqlDateTimeToIso(opts.windowEnd),
  });
  if (!requestsResult.ok) {
    result.status =
      requestsResult.reason === "no_key"
        ? "not_configured"
        : requestsResult.reason === "incomplete"
          ? "pending"
          : "provider_unavailable";
    result.message = requestsResult.message;
    // Preserve last known good numbers; only restamp status/message.
    const previous = readProviderReconciliationState(db);
    if (previous) {
      result.localReconciledMicroUsd = previous.localReconciledMicroUsd;
      result.settledMicroUsd = previous.settledMicroUsd;
      result.dailyMicroUsd = previous.dailyMicroUsd;
      result.dailyDeltaMicroUsd = previous.dailyDeltaMicroUsd;
      result.unreconciledProviderMicroUsd = previous.unreconciledProviderMicroUsd;
    }
    writeProviderReconciliationState(db, result);
    return result;
  }

  const requests: CheaperInferenceUsageRequest[] = requestsResult.value.requests;
  result.pages = requestsResult.value.pages;
  result.providerRequests = requests.length;

  const cutover = resolveMainLedgerCutover(db);
  let settledMicroUsd = 0;

  for (const request of requests) {
    if (!request.settled || request.billedMicroUsd <= 0) {
      result.skipped += 1;
      continue;
    }
    settledMicroUsd += request.billedMicroUsd;
    const existsLocally = identityExists(db, request.requestId);
    if (!existsLocally) {
      // Remote-only. Blind historical insertion is forbidden: only requests
      // at/after the canonical main-ledger cutover may be recorded, because
      // before it the same charge may already live in messages.usage.
      const afterCutover =
        cutover != null && request.createdAt != null && request.createdAt >= cutover;
      if (!afterCutover) {
        result.unreconciledProviderMicroUsd += request.billedMicroUsd;
        result.skipped += 1;
        continue;
      }
    }
    const outcome = upsertReconciledProviderCost(
      {
        provider: "cheaperinference",
        providerRequestId: request.requestId,
        model: request.model ?? "(unknown)",
        billedCostUsd: request.billedMicroUsd / 1_000_000,
        requestKind: "usage-reconciliation",
        costCenter: "other",
        eventTime: request.createdAt,
        persistInTests: deps.persistInTests,
      },
      db
    );
    switch (outcome.outcome) {
      case "inserted":
        result.inserted += 1;
        break;
      case "promoted":
        result.promoted += 1;
        break;
      case "superseded":
        result.superseded += 1;
        break;
      case "matched":
        result.matched += 1;
        break;
      default:
        result.skipped += 1;
        break;
    }
  }

  result.settledMicroUsd = settledMicroUsd;
  result.localReconciledMicroUsd = readLocalReconciledMicroUsd(db, opts.windowStart, opts.windowEnd);

  const dailyResult = await fetchDaily({
    startAt: sqlDateTimeToIso(opts.windowStart),
    endAt: sqlDateTimeToIso(opts.windowEnd),
  });
  if (dailyResult.ok) {
    result.dailyMicroUsd = dailyResult.value.settledMicroUsd;
    result.dailyDeltaMicroUsd = dailyResult.value.settledMicroUsd - result.localReconciledMicroUsd;
    result.status =
      result.dailyDeltaMicroUsd === 0
        ? "matched"
        : Math.abs(result.dailyDeltaMicroUsd) <= 1
          ? "matched"
          : "mismatch";
  } else {
    result.dailyMicroUsd = null;
    result.dailyDeltaMicroUsd = null;
    result.status = dailyResult.reason === "no_key" ? "not_configured" : "provider_unavailable";
    result.message = dailyResult.message;
  }

  writeProviderReconciliationState(db, result);
  return result;
}
