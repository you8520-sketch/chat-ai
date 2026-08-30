import "server-only";

import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";
import {
  ensureAdminFinanceTables,
  estimateApiCostUsd,
} from "@/lib/adminFinance";
import { resolveBillingExchangeRateSnapshot } from "@/lib/exchangeRate";
import type { ActualCostSource } from "@/lib/shadowPricing";

export type ProviderCostFamily =
  | "suggested_replies_repair"
  | "status_meta"
  | "memory_relationship"
  | "post_turn_shared_initial"
  | "status_widget_extract";

export type ProviderCostExecutionPhase =
  | "main_generation"
  | "sync_post_turn"
  | "async_post_turn";

export type ProviderCostFundingClass = "platform_funded" | "user_funded";

export type ProviderCostEventStatus =
  | "started"
  | "settled"
  | "failed_without_usage"
  | "failed_with_usage"
  | "completed_without_exact_cost";

/** Grouping/debug metadata — not the global physical attempt identity. */
export type ProviderCostLedgerContext = {
  chatId: number;
  assistantMessageId: number;
  family: ProviderCostFamily;
  fundingClass: ProviderCostFundingClass;
  executionPhase: ProviderCostExecutionPhase;
  /** Logical retry ordinal within the background job (1-based). */
  jobAttemptOrdinal: number;
  requestedProvider: string;
  requestedModel: string;
  requestKind?: string;
  /** Failover grouping ordinal within one logical call (1-based). */
  physicalAttemptOrdinal?: number;
  /** Test seam — bypass NODE_TEST_CONTEXT skip. */
  persistInTests?: boolean;
};

/** Canonical physical attempt handle — event_key owner is physicalAttemptId only. */
export type ProviderCostPhysicalAttemptHandle = {
  physicalAttemptId: string;
  context: ProviderCostLedgerContext;
};

export type ProviderCostFinalizeInput = {
  actualProvider: string;
  actualModel: string;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  cheaperInferenceBilledCostUsd?: number;
  upstreamCostUsd?: number;
  providerRequestId?: string | null;
  usageEstimated?: boolean;
  httpStatus?: number | null;
  /** Transport/product outcome — distinct from cost exactness. */
  outcome: "success" | "failed_without_usage" | "failed_with_usage";
};

export type ProviderCostLedgerRow = {
  id: number;
  event_key: string | null;
  chat_id: number | null;
  assistant_message_id: number | null;
  family: string | null;
  funding_class: string | null;
  execution_phase: string | null;
  attempt_ordinal: number | null;
  requested_provider: string | null;
  requested_model: string | null;
  /** Legacy finance columns — mirror delivered provider/model for Admin Finance readers. */
  provider: string;
  model: string;
  /** Canonical delivered provider/model for whole-turn projection. */
  actual_provider: string | null;
  actual_model: string | null;
  request_kind: string;
  provider_request_id: string | null;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number | null;
  cache_read_tokens: number;
  cache_write_tokens: number;
  cheaper_inference_billed_cost_usd: number | null;
  /** Raw provider upstream/list/reference USD — never overwritten by actual settlement. */
  upstream_cost_usd: number | null;
  actual_cost_usd: number | null;
  actual_cost_source: string | null;
  event_status: string | null;
  exchange_rate_krw_per_usd: number;
  /** Legacy Admin Finance monthly estimate at write-time billing FX. */
  cost_krw: number;
  estimated: number;
  created_at: string;
  completed_at: string | null;
};

export type ResolvedLedgerAttemptSettlement = {
  eventStatus: ProviderCostEventStatus;
  actualCostUsd?: number;
  actualCostSource: ActualCostSource | "unavailable" | "legacy_estimated";
  settled: boolean;
};

function finiteNonNegative(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function positiveOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function shouldSkipPersistence(ctx?: Pick<ProviderCostLedgerContext, "persistInTests">): boolean {
  if (ctx?.persistInTests) return false;
  return Boolean(process.env.NODE_TEST_CONTEXT);
}

function tableColumns(db: Database.Database, table: string): Set<string> {
  return new Set(
    (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
      (column) => column.name
    )
  );
}

/** Canonical schema extension owner for api_cost_ledger turn-attributable columns. */
export function ensureProviderCostLedgerSchema(db: Database.Database = getDb()): void {
  ensureAdminFinanceTables(db);
  const columns = tableColumns(db, "api_cost_ledger");
  const addColumn = (name: string, ddl: string) => {
    if (!columns.has(name)) {
      db.exec(`ALTER TABLE api_cost_ledger ADD COLUMN ${ddl}`);
      columns.add(name);
    }
  };

  addColumn("event_key", "event_key TEXT");
  addColumn("chat_id", "chat_id INTEGER");
  addColumn("assistant_message_id", "assistant_message_id INTEGER");
  addColumn("family", "family TEXT");
  addColumn("funding_class", "funding_class TEXT");
  addColumn("execution_phase", "execution_phase TEXT");
  addColumn("attempt_ordinal", "attempt_ordinal INTEGER");
  addColumn("requested_provider", "requested_provider TEXT");
  addColumn("requested_model", "requested_model TEXT");
  addColumn("actual_provider", "actual_provider TEXT");
  addColumn("actual_model", "actual_model TEXT");
  addColumn("provider_request_id", "provider_request_id TEXT");
  addColumn("reasoning_tokens", "reasoning_tokens INTEGER");
  addColumn("cheaper_inference_billed_cost_usd", "cheaper_inference_billed_cost_usd REAL");
  addColumn("actual_cost_usd", "actual_cost_usd REAL");
  addColumn("actual_cost_source", "actual_cost_source TEXT");
  addColumn("event_status", "event_status TEXT");
  addColumn("completed_at", "completed_at TEXT");

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_api_cost_ledger_event_key
      ON api_cost_ledger(event_key);
    CREATE INDEX IF NOT EXISTS idx_api_cost_ledger_assistant_message
      ON api_cost_ledger(assistant_message_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_api_cost_ledger_chat_created
      ON api_cost_ledger(chat_id, created_at);
  `);
}

/**
 * Canonical settlement + event_status owner.
 * Callers must not duplicate hasExactUsage / settled heuristics.
 */
export function resolveLedgerAttemptSettlement(input: {
  actualProvider: string;
  cheaperInferenceBilledCostUsd?: number;
  upstreamCostUsd?: number;
  usageEstimated?: boolean;
  outcome: ProviderCostFinalizeInput["outcome"];
}): ResolvedLedgerAttemptSettlement {
  const ciBilled = finiteNonNegative(input.cheaperInferenceBilledCostUsd);
  const provider = input.actualProvider.trim().toLowerCase();
  const upstream = finiteNonNegative(input.upstreamCostUsd);

  if (input.outcome === "failed_without_usage") {
    return {
      eventStatus: "failed_without_usage",
      actualCostSource: "unavailable",
      settled: false,
    };
  }

  if (ciBilled > 0) {
    return {
      eventStatus:
        input.outcome === "success" ? "settled" : "failed_with_usage",
      actualCostUsd: ciBilled,
      actualCostSource: "cheaper_inference_billed",
      settled: true,
    };
  }

  if (provider === "cheaperinference") {
    return {
      eventStatus:
        input.outcome === "success"
          ? "completed_without_exact_cost"
          : input.outcome === "failed_with_usage"
            ? "failed_with_usage"
            : "failed_without_usage",
      actualCostSource: "unavailable",
      settled: false,
    };
  }

  if (upstream > 0 && input.usageEstimated !== true) {
    return {
      eventStatus:
        input.outcome === "success" ? "settled" : "failed_with_usage",
      actualCostUsd: upstream,
      actualCostSource: "provider_reported",
      settled: true,
    };
  }

  if (input.outcome === "failed_with_usage") {
    return {
      eventStatus: "failed_with_usage",
      actualCostSource: "unavailable",
      settled: false,
    };
  }

  return {
    eventStatus: "completed_without_exact_cost",
    actualCostSource: "unavailable",
    settled: false,
  };
}

export function isLedgerEventCostExact(
  row: Pick<
    ProviderCostLedgerRow,
    "actual_cost_usd" | "actual_cost_source" | "event_status"
  >
): boolean {
  if (row.event_status === "started") return false;
  return (
    (row.actual_cost_source === "cheaper_inference_billed" ||
      row.actual_cost_source === "provider_reported") &&
    finiteNonNegative(row.actual_cost_usd) > 0
  );
}

export function isLedgerEventCostCoverageIncomplete(
  row: Pick<
    ProviderCostLedgerRow,
    "event_status" | "actual_cost_usd" | "actual_cost_source"
  >
): boolean {
  if (row.event_status === "started") return true;
  if (row.event_status === "failed_without_usage") return true;
  if (row.event_status === "completed_without_exact_cost") return true;
  if (row.event_status === "failed_with_usage" && !isLedgerEventCostExact(row)) {
    return true;
  }
  return false;
}

export function buildPlatformAsyncTurnLedgerContext(input: {
  chatId: number;
  assistantMessageId: number;
  family: ProviderCostFamily;
  jobAttemptOrdinal: number;
  requestedModel?: string;
  requestedProvider?: string;
  requestKind?: string;
}): ProviderCostLedgerContext {
  return {
    chatId: input.chatId,
    assistantMessageId: input.assistantMessageId,
    family: input.family,
    fundingClass: "platform_funded",
    executionPhase: "async_post_turn",
    jobAttemptOrdinal: input.jobAttemptOrdinal,
    requestedProvider: input.requestedProvider ?? "cheaperinference",
    requestedModel: input.requestedModel ?? "",
    requestKind: input.requestKind,
  };
}

export function buildPlatformSyncTurnLedgerContext(input: {
  chatId: number;
  assistantMessageId: number;
  family: ProviderCostFamily;
  requestedModel?: string;
  requestedProvider?: string;
  requestKind?: string;
}): ProviderCostLedgerContext {
  return {
    chatId: input.chatId,
    assistantMessageId: input.assistantMessageId,
    family: input.family,
    fundingClass: "platform_funded",
    executionPhase: "sync_post_turn",
    jobAttemptOrdinal: 1,
    requestedProvider: input.requestedProvider ?? "cheaperinference",
    requestedModel: input.requestedModel ?? "",
    requestKind: input.requestKind,
  };
}

export function startProviderCostAttempt(
  ctx: ProviderCostLedgerContext,
  db: Database.Database = getDb()
): ProviderCostPhysicalAttemptHandle {
  const physicalAttemptId = randomUUID();
  if (shouldSkipPersistence(ctx)) {
    return { physicalAttemptId, context: ctx };
  }

  ensureProviderCostLedgerSchema(db);
  db.prepare(
    `INSERT INTO api_cost_ledger
      (event_key, chat_id, assistant_message_id, family, funding_class, execution_phase,
       attempt_ordinal, requested_provider, requested_model, provider, model, request_kind,
       event_status, exchange_rate_krw_per_usd, cost_krw, estimated, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'started', 0, 0, 1, datetime('now'))`
  ).run(
    physicalAttemptId,
    ctx.chatId,
    ctx.assistantMessageId,
    ctx.family,
    ctx.fundingClass,
    ctx.executionPhase,
    ctx.jobAttemptOrdinal,
    ctx.requestedProvider,
    ctx.requestedModel,
    ctx.requestedProvider,
    ctx.requestedModel,
    ctx.requestKind?.slice(0, 120) ?? ""
  );

  return { physicalAttemptId, context: ctx };
}

export function finalizeProviderCostAttempt(
  attempt: ProviderCostPhysicalAttemptHandle,
  input: ProviderCostFinalizeInput,
  db: Database.Database = getDb()
): { eventKey: string; updated: boolean; rowId?: number } {
  const eventKey = attempt.physicalAttemptId;
  if (shouldSkipPersistence(attempt.context)) {
    return { eventKey, updated: false };
  }

  ensureProviderCostLedgerSchema(db);
  const exchange = resolveBillingExchangeRateSnapshot();

  const inputTokens = Math.max(0, Math.trunc(input.inputTokens ?? 0));
  const outputTokens = Math.max(0, Math.trunc(input.outputTokens ?? 0));
  const cacheReadTokens = Math.max(0, Math.trunc(input.cacheReadTokens ?? 0));
  const cacheWriteTokens = Math.max(0, Math.trunc(input.cacheWriteTokens ?? 0));
  const reasoningTokens = Math.max(0, Math.trunc(input.reasoningTokens ?? 0));

  const settlement = resolveLedgerAttemptSettlement({
    actualProvider: input.actualProvider,
    cheaperInferenceBilledCostUsd: input.cheaperInferenceBilledCostUsd,
    upstreamCostUsd: input.upstreamCostUsd,
    usageEstimated: input.usageEstimated,
    outcome: input.outcome,
  });

  const estimatedUsd = estimateApiCostUsd({
    model: input.actualModel,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
  });

  const rawUpstreamUsd = positiveOrNull(input.upstreamCostUsd);
  const legacyAccountingCostUsd =
    settlement.settled && settlement.actualCostUsd
      ? settlement.actualCostUsd
      : rawUpstreamUsd ?? estimatedUsd;
  const legacyCostKrw = legacyAccountingCostUsd * exchange.effectiveKrwPerUsd;
  const legacyEstimated = settlement.settled ? 0 : rawUpstreamUsd == null ? 1 : 0;

  const result = db
    .prepare(
      `UPDATE api_cost_ledger SET
         provider = ?,
         model = ?,
         actual_provider = ?,
         actual_model = ?,
         request_kind = COALESCE(NULLIF(?, ''), request_kind),
         provider_request_id = COALESCE(?, provider_request_id),
         input_tokens = ?,
         output_tokens = ?,
         reasoning_tokens = ?,
         cache_read_tokens = ?,
         cache_write_tokens = ?,
         cheaper_inference_billed_cost_usd = ?,
         upstream_cost_usd = ?,
         actual_cost_usd = ?,
         actual_cost_source = ?,
         event_status = ?,
         exchange_rate_krw_per_usd = ?,
         cost_krw = ?,
         estimated = ?,
         completed_at = datetime('now')
       WHERE event_key = ?
         AND (event_status IS NULL OR event_status = 'started' OR event_status = 'failed_without_usage' OR event_status = 'failed_with_usage' OR event_status = 'completed_without_exact_cost')`
    )
    .run(
      input.actualProvider,
      input.actualModel,
      input.actualProvider,
      input.actualModel,
      attempt.context.requestKind?.slice(0, 120) ?? "",
      input.providerRequestId ?? null,
      inputTokens,
      outputTokens,
      reasoningTokens,
      cacheReadTokens,
      cacheWriteTokens,
      positiveOrNull(input.cheaperInferenceBilledCostUsd),
      rawUpstreamUsd,
      settlement.actualCostUsd ?? null,
      settlement.actualCostSource,
      settlement.eventStatus,
      exchange.effectiveKrwPerUsd,
      legacyCostKrw,
      legacyEstimated,
      eventKey
    );

  if (result.changes === 0) {
    const existing = db
      .prepare("SELECT id, event_status FROM api_cost_ledger WHERE event_key = ?")
      .get(eventKey) as { id: number; event_status: string | null } | undefined;
    return {
      eventKey,
      updated: false,
      rowId: existing?.id,
    };
  }

  const row = db
    .prepare("SELECT id FROM api_cost_ledger WHERE event_key = ?")
    .get(eventKey) as { id: number };
  return { eventKey, updated: true, rowId: row.id };
}

export function listProviderCostEventsForAssistantMessage(
  assistantMessageId: number,
  db: Database.Database = getDb()
): ProviderCostLedgerRow[] {
  ensureProviderCostLedgerSchema(db);
  return db
    .prepare(
      `SELECT * FROM api_cost_ledger
       WHERE assistant_message_id = ?
       ORDER BY id ASC`
    )
    .all(assistantMessageId) as ProviderCostLedgerRow[];
}

export function readProviderCostEventByKey(
  eventKey: string,
  db: Database.Database = getDb()
): ProviderCostLedgerRow | null {
  ensureProviderCostLedgerSchema(db);
  const row = db
    .prepare("SELECT * FROM api_cost_ledger WHERE event_key = ?")
    .get(eventKey) as ProviderCostLedgerRow | undefined;
  return row ?? null;
}
