import "server-only";

import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";
import {
  ensureAdminFinanceTables,
  estimateApiCostUsd,
} from "@/lib/adminFinance";
import { resolveBillingExchangeRateSnapshot } from "@/lib/exchangeRate";
import type { ActualCostSource } from "@/lib/shadowPricing";
import type { BillingFxSnapshot } from "@/lib/billingFxSnapshot";
import { convertUsdToKrw } from "@/lib/exchangeRate";

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
  /** Physical provider attempt within one logical call (failover). Default 1. */
  physicalAttemptOrdinal?: number;
  /** Test seam — bypass NODE_TEST_CONTEXT skip. */
  persistInTests?: boolean;
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
  eventStatus: ProviderCostEventStatus;
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
  provider: string;
  model: string;
  request_kind: string;
  provider_request_id: string | null;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number | null;
  cache_read_tokens: number;
  cache_write_tokens: number;
  cheaper_inference_billed_cost_usd: number | null;
  upstream_cost_usd: number | null;
  actual_cost_usd: number | null;
  actual_cost_source: string | null;
  event_status: string | null;
  exchange_rate_krw_per_usd: number;
  cost_krw: number;
  estimated: number;
  created_at: string;
  completed_at: string | null;
};

export type ResolvedLedgerAttemptActualCost = {
  actualCostUsd?: number;
  actualCostSource: ActualCostSource | "legacy_estimated" | "incomplete";
  settled: boolean;
};

function finiteNonNegative(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
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

/** Stable physical-attempt identity — retries and failovers must not collide. */
export function buildProviderCostEventKey(ctx: ProviderCostLedgerContext): string {
  const physical = ctx.physicalAttemptOrdinal ?? 1;
  return [
    ctx.executionPhase,
    ctx.family,
    `c${ctx.chatId}`,
    `m${ctx.assistantMessageId}`,
    `j${ctx.jobAttemptOrdinal}`,
    `p${physical}`,
    `${ctx.requestedProvider}:${ctx.requestedModel}`,
  ].join("|");
}

export function resolveLedgerAttemptActualCost(input: {
  actualProvider: string;
  cheaperInferenceBilledCostUsd?: number;
  upstreamCostUsd?: number;
  usageEstimated?: boolean;
  eventStatus: ProviderCostEventStatus;
}): ResolvedLedgerAttemptActualCost {
  if (input.eventStatus === "started") {
    return { actualCostSource: "incomplete", settled: false };
  }
  if (
    input.eventStatus === "failed_without_usage" ||
    input.eventStatus === "completed_without_exact_cost"
  ) {
    return { actualCostSource: "incomplete", settled: false };
  }

  const ciBilled = finiteNonNegative(input.cheaperInferenceBilledCostUsd);
  if (ciBilled > 0) {
    return {
      actualCostUsd: ciBilled,
      actualCostSource: "cheaper_inference_billed",
      settled: true,
    };
  }

  const provider = input.actualProvider.trim().toLowerCase();
  const upstream = finiteNonNegative(input.upstreamCostUsd);
  if (provider === "cheaperinference") {
    return { actualCostSource: "incomplete", settled: false };
  }

  if (upstream > 0 && input.usageEstimated !== true && input.eventStatus === "settled") {
    return {
      actualCostUsd: upstream,
      actualCostSource: "provider_reported",
      settled: true,
    };
  }

  if (input.eventStatus === "failed_with_usage") {
    return { actualCostSource: "incomplete", settled: false };
  }

  return { actualCostSource: "legacy_estimated", settled: false };
}

export function isLedgerEventExact(
  row: Pick<ProviderCostLedgerRow, "actual_cost_usd" | "actual_cost_source" | "event_status">
): boolean {
  if (row.event_status === "started") return false;
  return (
    row.actual_cost_source === "cheaper_inference_billed" ||
    row.actual_cost_source === "provider_reported"
  ) && finiteNonNegative(row.actual_cost_usd) > 0;
}

export function isLedgerEventCoverageIncomplete(
  row: Pick<ProviderCostLedgerRow, "event_status">
): boolean {
  return row.event_status === "started";
}

/** Future whole-turn projection — parent turn FX only; never re-fetch FX here. */
export function projectAsyncLedgerUsdToTurnKrw(
  actualUsd: number,
  parentFxSnapshot: BillingFxSnapshot | null | undefined
): number | null {
  if (!parentFxSnapshot) return null;
  const effective = finiteNonNegative(parentFxSnapshot.effectiveKrwPerUsd);
  if (effective <= 0) return null;
  return Math.round(convertUsdToKrw(actualUsd, effective) * 10) / 10;
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
): { eventKey: string; inserted: boolean } {
  if (shouldSkipPersistence(ctx)) {
    return { eventKey: buildProviderCostEventKey(ctx), inserted: false };
  }

  ensureProviderCostLedgerSchema(db);
  const eventKey = buildProviderCostEventKey(ctx);
  const physical = ctx.physicalAttemptOrdinal ?? 1;

  const result = db
    .prepare(
      `INSERT INTO api_cost_ledger
        (event_key, chat_id, assistant_message_id, family, funding_class, execution_phase,
         attempt_ordinal, requested_provider, requested_model, provider, model, request_kind,
         event_status, exchange_rate_krw_per_usd, cost_krw, estimated, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'started', 0, 0, 1, datetime('now'))
       ON CONFLICT(event_key) DO NOTHING`
    )
    .run(
      eventKey,
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

  return { eventKey, inserted: result.changes > 0 };
}

export function finalizeProviderCostAttempt(
  ctx: ProviderCostLedgerContext,
  input: ProviderCostFinalizeInput,
  db: Database.Database = getDb()
): { eventKey: string; updated: boolean; rowId?: number } {
  if (shouldSkipPersistence(ctx)) {
    return { eventKey: buildProviderCostEventKey(ctx), updated: false };
  }

  ensureProviderCostLedgerSchema(db);
  const eventKey = buildProviderCostEventKey(ctx);
  const exchange = resolveBillingExchangeRateSnapshot();

  const inputTokens = Math.max(0, Math.trunc(input.inputTokens ?? 0));
  const outputTokens = Math.max(0, Math.trunc(input.outputTokens ?? 0));
  const cacheReadTokens = Math.max(0, Math.trunc(input.cacheReadTokens ?? 0));
  const cacheWriteTokens = Math.max(0, Math.trunc(input.cacheWriteTokens ?? 0));
  const reasoningTokens = Math.max(0, Math.trunc(input.reasoningTokens ?? 0));

  const resolved = resolveLedgerAttemptActualCost({
    actualProvider: input.actualProvider,
    cheaperInferenceBilledCostUsd: input.cheaperInferenceBilledCostUsd,
    upstreamCostUsd: input.upstreamCostUsd,
    usageEstimated: input.usageEstimated,
    eventStatus: input.eventStatus,
  });

  const estimatedUsd = estimateApiCostUsd({
    model: input.actualModel,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
  });

  const legacyUpstreamUsd = resolved.settled && resolved.actualCostUsd
    ? resolved.actualCostUsd
    : finiteNonNegative(input.upstreamCostUsd) || estimatedUsd;

  const legacyCostKrw = legacyUpstreamUsd * exchange.effectiveKrwPerUsd;
  const legacyEstimated =
    resolved.settled ? 0 : input.usageEstimated === true || !finiteNonNegative(input.upstreamCostUsd) ? 1 : 0;

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
      ctx.requestKind?.slice(0, 120) ?? "",
      input.providerRequestId ?? null,
      inputTokens,
      outputTokens,
      reasoningTokens,
      cacheReadTokens,
      cacheWriteTokens,
      finiteNonNegative(input.cheaperInferenceBilledCostUsd) || null,
      legacyUpstreamUsd,
      resolved.actualCostUsd ?? null,
      resolved.actualCostSource === "incomplete" ? "unavailable" : resolved.actualCostSource,
      input.eventStatus,
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
