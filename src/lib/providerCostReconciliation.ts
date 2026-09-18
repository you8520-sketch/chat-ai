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
  recordMainGenerationProviderCost,
  toMicroUsd,
  upsertReconciledProviderCost,
  type ReconciledProviderCostOutcome,
} from "@/lib/providerCostLedger";
import { resolveActiveAssistantGenerationScopeFromRow } from "@/lib/assistantGenerationScope";

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

function identityExists(db: Database.Database, requestId: string): boolean {
  const row = db
    .prepare(
      "SELECT 1 AS ok FROM api_cost_ledger WHERE provider = 'cheaperinference' AND provider_request_id = ? LIMIT 1"
    )
    .get(requestId) as { ok: number } | undefined;
  return row != null;
}

/**
 * Deterministic local identity for a provider request: the main physical
 * request id persisted on the assistant message/generation (usage.stages),
 * with the request-time FX event snapshot. This is metadata, NOT a cost
 * owner — it only links a remote settled request to its assistant turn so
 * the canonical ledger can be recovered after a local ledger write failure.
 */
type MessageProviderIdentity = {
  chatId: number;
  assistantMessageId: number;
  generationSequence: number;
  model: string | null;
  requestFx: number | null;
};

function readRequestFx(usage: Record<string, unknown>): number | null {
  const shadow = usage.shadowPricing as { fxSnapshot?: { effectiveKrwPerUsd?: unknown } } | undefined;
  const fromShadow = Number(shadow?.fxSnapshot?.effectiveKrwPerUsd);
  if (Number.isFinite(fromShadow) && fromShadow > 0) return fromShadow;
  const top = Number(usage.exchangeRateKrwPerUsd);
  if (Number.isFinite(top) && top > 0) return top;
  return null;
}

function buildMessageProviderIdentityIndex(
  db: Database.Database,
  windowStart: string,
  windowEnd: string
): Map<string, MessageProviderIdentity> {
  const rows = db
    .prepare(
      `SELECT id, chat_id, content, model, usage, alternates, active_variant, request_id, generation_status
         FROM messages
        WHERE role = 'assistant' AND created_at >= ? AND created_at < ?
          AND usage LIKE '%"providerRequestId"%'`
    )
    .all(windowStart, windowEnd) as Array<{
    id: number;
    chat_id: number;
    content: string;
    model: string;
    usage: string | null;
    alternates: string | null;
    active_variant: number | null;
    request_id: string | null;
    generation_status: string | null;
  }>;

  const index = new Map<string, MessageProviderIdentity>();
  for (const row of rows) {
    let usage: Record<string, unknown>;
    try {
      usage = JSON.parse(row.usage ?? "{}") as Record<string, unknown>;
    } catch {
      continue;
    }
    const stages = Array.isArray(usage.stages) ? (usage.stages as unknown[]) : [];
    const requestFx = readRequestFx(usage);
    const scope = resolveActiveAssistantGenerationScopeFromRow(row);
    if (!scope) continue;
    for (const raw of stages) {
      if (!raw || typeof raw !== "object") continue;
      const stage = raw as Record<string, unknown>;
      const requestId = typeof stage.providerRequestId === "string" ? stage.providerRequestId.trim() : "";
      if (!requestId || index.has(requestId)) continue;
      index.set(requestId, {
        chatId: row.chat_id,
        assistantMessageId: scope.assistantMessageId,
        generationSequence: scope.generationSequence,
        model: typeof stage.model === "string" ? stage.model : row.model || null,
        requestFx,
      });
    }
  }
  return index;
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

function finiteNonNegative(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function normalizeProvider(provider: string): string {
  return provider.trim().toLowerCase();
}

function buildTargetedUsageLookupWindow(
  requestStartedAtMs: number,
  nowMs: number
): {
  windowStartIso: string;
  windowEndIso: string;
} {
  const startMs = Math.max(0, requestStartedAtMs - 2 * 60_000);
  const endMs = nowMs + 60_000;
  return {
    windowStartIso: new Date(startMs).toISOString(),
    windowEndIso: new Date(endMs).toISOString(),
  };
}

type ApplySettledRequestOpts = {
  persistInTests?: boolean;
  requestKind?: string;
};

type ApplySettledRequestResult =
  | { kind: "skipped" }
  | { kind: "unreconciled"; billedMicroUsd: number }
  | { kind: "inserted" }
  | { kind: "promoted" }
  | { kind: "matched" }
  | { kind: "superseded" };

/** Shared settled-request → ledger semantics for window and targeted reconciliation. */
function applySettledCheaperInferenceRequest(
  db: Database.Database,
  request: CheaperInferenceUsageRequest,
  messageIdentity: Map<string, MessageProviderIdentity>,
  opts: ApplySettledRequestOpts
): ApplySettledRequestResult {
  const existsLocally = identityExists(db, request.requestId);
  if (!existsLocally) {
    const identity = messageIdentity.get(request.requestId);
    if (!identity) {
      return { kind: "unreconciled", billedMicroUsd: request.billedMicroUsd };
    }
    const recovery = recordMainGenerationProviderCost(
      {
        chatId: identity.chatId,
        assistantMessageId: identity.assistantMessageId,
        generationSequence: identity.generationSequence,
        provider: "cheaperinference",
        model: request.model ?? identity.model ?? "(unknown)",
        requestKind: "usage-reconciliation-recovery",
        cheaperInferenceBilledCostUsd: request.billedMicroUsd / 1_000_000,
        providerRequestId: request.requestId,
        exchangeRateKrwPerUsd: identity.requestFx ?? undefined,
        eventTime: request.createdAt,
        outcome: "success",
        persistInTests: opts.persistInTests,
      },
      db
    );
    return recovery.recorded ? { kind: "inserted" } : { kind: "matched" };
  }

  const outcome = upsertReconciledProviderCost(
    {
      provider: "cheaperinference",
      providerRequestId: request.requestId,
      model: request.model ?? "(unknown)",
      billedCostUsd: request.billedMicroUsd / 1_000_000,
      requestKind: opts.requestKind ?? "usage-reconciliation",
      costCenter: "other",
      eventTime: request.createdAt,
      persistInTests: opts.persistInTests,
    },
    db
  );
  switch (outcome.outcome) {
    case "inserted":
      return { kind: "inserted" };
    case "promoted":
      return { kind: "promoted" };
    case "superseded":
      return { kind: "superseded" };
    case "matched":
      return { kind: "matched" };
    default:
      return { kind: "skipped" };
  }
}

export type TargetedRequestReconcileInput = {
  provider: string;
  providerRequestId?: string | null;
  streamBilledCostUsd?: number | null;
  outcome: "success" | "failed_without_usage" | "failed_with_usage";
  requestStartedAtMs: number;
  requestKind?: string;
  db?: Database.Database;
  deps?: ReconciliationDeps;
};

export type TargetedRequestReconcileResult = {
  attempted: boolean;
  skippedReason?: string;
  lookupOk: boolean;
  requestFound: boolean;
  requestStatus?: string;
  billedCostUsd?: number;
  ledgerOutcome?: ReconciledProviderCostOutcome;
  message?: string;
};

export function shouldTargetReconcileMainGeneration(
  input: Pick<
    TargetedRequestReconcileInput,
    "provider" | "providerRequestId" | "streamBilledCostUsd" | "outcome"
  >
): boolean {
  if (input.outcome !== "success") return false;
  if (normalizeProvider(input.provider) !== "cheaperinference") return false;
  const requestId = input.providerRequestId?.trim();
  if (!requestId) return false;
  if (finiteNonNegative(input.streamBilledCostUsd) > 0) return false;
  return true;
}

/**
 * Targeted post-turn reconciliation for one provider request id.
 * Reuses the same settled → ledger promotion path as full-window reconciliation.
 */
export async function reconcileCheaperInferenceRequestById(
  input: TargetedRequestReconcileInput
): Promise<TargetedRequestReconcileResult> {
  if (!shouldTargetReconcileMainGeneration(input)) {
    return {
      attempted: false,
      skippedReason: "stream_exact_or_ineligible",
      lookupOk: false,
      requestFound: false,
    };
  }

  const providerRequestId = input.providerRequestId!.trim();
  const db = input.db ?? getDb();
  ensureProviderCostLedgerSchema(db);
  const deps = input.deps ?? {};
  const nowMs = (deps.now ?? Date.now)();
  const fetchRequests = deps.fetchRequests ?? fetchAllUsageRequests;
  const { windowStartIso, windowEndIso } = buildTargetedUsageLookupWindow(
    input.requestStartedAtMs,
    nowMs
  );

  const page = await fetchRequests({
    startAt: windowStartIso,
    endAt: windowEndIso,
    maxPages: 5,
  });

  if (!page.ok) {
    return {
      attempted: true,
      lookupOk: false,
      requestFound: false,
      message: page.message,
    };
  }

  const match = page.value.requests.find((r) => r.requestId === providerRequestId);
  if (!match) {
    return {
      attempted: true,
      lookupOk: true,
      requestFound: false,
      message: "provider request not in usage window",
    };
  }

  if (!match.settled || match.billedMicroUsd <= 0) {
    return {
      attempted: true,
      lookupOk: true,
      requestFound: true,
      requestStatus: match.status,
      message: "provider request not settled",
    };
  }

  const applied = applySettledCheaperInferenceRequest(db, match, new Map(), {
    persistInTests: deps.persistInTests,
    requestKind: input.requestKind ?? "main-rp-targeted-reconcile",
  });

  const billedCostUsd = match.billedMicroUsd / 1_000_000;
  if (applied.kind === "unreconciled") {
    return {
      attempted: true,
      lookupOk: true,
      requestFound: true,
      requestStatus: match.status,
      message: "no local ledger row for provider request id",
    };
  }
  if (applied.kind === "skipped") {
    return {
      attempted: true,
      lookupOk: true,
      requestFound: true,
      requestStatus: match.status,
      billedCostUsd,
      message: "ledger promotion skipped",
    };
  }

  const ledgerOutcome: ReconciledProviderCostOutcome =
    applied.kind === "inserted"
      ? "inserted"
      : applied.kind === "promoted"
        ? "promoted"
        : applied.kind === "superseded"
          ? "superseded"
          : "matched";

  return {
    attempted: true,
    lookupOk: true,
    requestFound: true,
    requestStatus: match.status,
    billedCostUsd,
    ledgerOutcome,
  };
}

/** Fire-and-forget post-turn targeted reconcile — never blocks stream completion. */
export function scheduleTargetedCheaperInferenceRequestReconciliation(
  input: TargetedRequestReconcileInput
): void {
  if (!shouldTargetReconcileMainGeneration(input)) return;
  void reconcileCheaperInferenceRequestById(input).catch((error) => {
    console.warn(
      "[provider-cost-reconciliation] targeted request reconcile failed:",
      (error as Error).message
    );
  });
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

  const messageIdentity = buildMessageProviderIdentityIndex(
    db,
    opts.windowStart,
    opts.windowEnd
  );
  let settledMicroUsd = 0;

  for (const request of requests) {
    if (!request.settled || request.billedMicroUsd <= 0) {
      result.skipped += 1;
      continue;
    }
    settledMicroUsd += request.billedMicroUsd;
    const applied = applySettledCheaperInferenceRequest(db, request, messageIdentity, {
      persistInTests: deps.persistInTests,
      requestKind: "usage-reconciliation",
    });
    switch (applied.kind) {
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
      case "unreconciled":
        result.unreconciledProviderMicroUsd += applied.billedMicroUsd;
        result.skipped += 1;
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
