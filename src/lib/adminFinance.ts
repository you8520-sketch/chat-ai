import "server-only";

import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";
import { resolveBillingExchangeRateSnapshot } from "@/lib/exchangeRate";
import {
  resolveCacheReadUsdPerM,
  resolveCacheWriteUsdPerM,
  resolveOpenRouterModelRates,
} from "@/lib/openRouterModelPricing";
import {
  MAIN_RP_USER_SELECTABLE_OPTIONS,
} from "@/lib/chatModels";
import type { Usage } from "@/lib/chatUsage";
import {
  groupLedgerRowsByAssistantMessageId,
  mergeFinanceTurnCostCoverage,
  resolveMessageTurnProviderCostKrw,
  type FinanceTurnCostCoverage,
  type LedgerCostContribution,
} from "@/lib/adminFinanceTurnCost";
import {
  ensureProviderCostLedgerSchema,
  isLedgerEventCostExact,
  readLedgerPeriodCostAttribution,
  resolveLedgerCostCenter,
  type ProviderCostLedgerRow,
} from "@/lib/providerCostLedger";
import { readProviderReconciliationState } from "@/lib/providerCostReconciliation";
import { imageHasAccountingActivity } from "@/lib/adminFinanceMarginDisplay";
import { CHAT_TURN_CHARGE_KIND } from "@/lib/chatBillingSettlementSchema";
import { parseMessageVariants } from "@/lib/messageAlternates";

export type FinanceMonthlyAdjustments = {
  monthKey: string;
  railwayUsageKrw: number;
  railwayTaxKrw: number;
  paymentGatewayFeesKrw: number;
  creatorTransferFeesKrw: number;
  creatorExtraIncentivesKrw: number;
  otherCostsKrw: number;
  providerTaxRate: number;
  note: string;
};

type DeductionSlice = { pointType?: string; amount?: number };

export type FinanceMarginCoverage = FinanceTurnCostCoverage;

export type FinanceCategory = {
  paidRevenueKrw: number;
  freePointSpend: number;
  apiCostKrw: number;
  creatorCostKrw: number;
  netProfitKrw: number | null;
  marginRate: number | null;
  marginCoverage: FinanceMarginCoverage;
  realizedMarginExact: boolean;
};

export type AdminFinanceSummary = {
  monthKey: string;
  generatedAt: string;
  exchangeRateKrwPerUsd: number;
  paymentsCollectedKrw: number;
  paidPointsConsumed: number;
  freePointsConsumed: number;
  giftFeeRevenueKrw: number;
  chat: FinanceCategory;
  image: FinanceCategory;
  modelBreakdown: Array<{
    model: string;
    paidRevenueKrw: number;
    freePointSpend: number;
    apiCostKrw: number;
    netProfitKrw: number | null;
    marginRate: number | null;
    marginCoverage: FinanceMarginCoverage;
    realizedMarginExact: boolean;
  }>;
  /** Generic AI actual-cost attribution (dynamic union over the canonical ledger). */
  aiCost: {
    totalActualKrw: number;
    estimatedFallbackKrw: number;
    /** booked total (actual + estimate), consumed verbatim by the UI. */
    totalKrw: number;
    unattributedKrw: number;
    unattributedCalls: number;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    /** Settled-actual share of ledger-recognized cost; null when nothing recorded. */
    coveragePct: number | null;
    hasInexact: boolean;
    /** Latest ledger write in range ("last recorded", never "synced"). */
    lastRecordedAt: string | null;
    byCenter: Array<{
      center: string;
      calls: number;
      actualKrw: number;
      estimatedKrw: number;
      sharePct: number;
    }>;
  };
  /**
   * Union model view: messages-attributed direct rows (with revenue) plus
   * ledger-only indirect rows (cost only, contribution/margin always null).
   */
  aiModelCosts: Array<{
    model: string;
    kind: "direct" | "indirect";
    center: string | null;
    calls: number | null;
    paidRevenueKrw: number;
    actualKrw: number;
    estimatedKrw: number;
    contributionKrw: number | null;
    marginRate: number | null;
    sourceState: string;
  }>;
  /** Active registry models with zero observed usage in range. */
  zeroUseModels: Array<{ id: string; label: string }>;
  /**
   * CheaperInference usage reconciliation state (request-level settled truth
   * promoted into the canonical ledger; /usage/daily as a checksum only).
   * Null until the first sync runs.
   */
  providerReconciliation: import("@/lib/providerCostReconciliation").ProviderReconciliationResult | null;
  creatorAccruedKrw: number;
  creatorPayoutCashKrw: number;
  /**
   * Cash-withdrawal settlement attribution from APPROVED snapshots.
   * creatorTaxPayableKrw (withholding total) is a tax outflow, NOT platform
   * revenue and NOT an extra creator cost (already inside the 100% accrual).
   * creatorPlatformRetainedKrw is the stored platform_fee snapshot consumed
   * directly - the CANONICAL settlement adjustment owner: creator cost was
   * recognized at 100% when rewards accrued, so the retained portion
   * reverses into top-level net profit EXACTLY ONCE here. It is NEVER
   * added to revenue (Case A gross model - that would double-count).
   */
  creatorTaxPayableKrw: number;
  creatorPlatformRetainedKrw: number;
  railwayCostKrw: number;
  operatingCostsKrw: number;
  totalApiCostKrw: number;
  netProfitKrw: number | null;
  marginRate: number | null;
  marginCoverage: FinanceMarginCoverage;
  realizedMarginExact: boolean;
  adjustments: FinanceMonthlyAdjustments;
};

function finiteNonNegative(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function currentKstMonthKey(now = Date.now()): string {
  return new Date(now + 9 * 60 * 60 * 1000).toISOString().slice(0, 7);
}

export function ensureAdminFinanceTables(db: Database.Database = getDb()) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS api_cost_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      request_kind TEXT NOT NULL DEFAULT '',
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_write_tokens INTEGER NOT NULL DEFAULT 0,
      upstream_cost_usd REAL,
      exchange_rate_krw_per_usd REAL NOT NULL,
      cost_krw REAL NOT NULL,
      estimated INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_api_cost_ledger_month_model
      ON api_cost_ledger(created_at, model);

    CREATE TABLE IF NOT EXISTS finance_monthly_adjustments (
      month_key TEXT PRIMARY KEY,
      railway_usage_krw REAL NOT NULL DEFAULT 0,
      railway_tax_krw REAL NOT NULL DEFAULT 0,
      payment_gateway_fees_krw REAL NOT NULL DEFAULT 0,
      creator_transfer_fees_krw REAL NOT NULL DEFAULT 0,
      creator_extra_incentives_krw REAL NOT NULL DEFAULT 0,
      other_costs_krw REAL NOT NULL DEFAULT 0,
      provider_tax_rate REAL NOT NULL DEFAULT 0,
      note TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS finance_daily_snapshots (
      snapshot_date TEXT PRIMARY KEY,
      month_key TEXT NOT NULL,
      summary_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  const tableColumns = (table: string) =>
    new Set(
      (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
        (column) => column.name
      )
    );
  const imageTable = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='chat_image_generations'")
    .get();
  if (imageTable) {
    const columns = tableColumns("chat_image_generations");
    if (!columns.has("deduction_slices")) {
      db.exec("ALTER TABLE chat_image_generations ADD COLUMN deduction_slices TEXT");
    }
    if (!columns.has("exchange_rate_krw_per_usd")) {
      db.exec(
        "ALTER TABLE chat_image_generations ADD COLUMN exchange_rate_krw_per_usd REAL"
      );
    }
  }
  // Gift breakdown columns (paid/free fee + gross) are owned by the central
  // migration in db.ts — never mutated from this request-adjacent ensure path.
}

export function estimateApiCostUsd(input: {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}): number {
  const rates = resolveOpenRouterModelRates(input.model);
  const cacheRead = Math.min(input.inputTokens, Math.max(0, input.cacheReadTokens ?? 0));
  const cacheWrite = Math.max(0, input.cacheWriteTokens ?? 0);
  const standardInput = Math.max(0, input.inputTokens - cacheRead);
  return (
    (standardInput * rates.inputUsdPerM +
      cacheRead * resolveCacheReadUsdPerM(rates) +
      cacheWrite * resolveCacheWriteUsdPerM(rates) +
      Math.max(0, input.outputTokens) * rates.outputUsdPerM) /
    1_000_000
  );
}

export function monthRangeSql(monthKey: string): { start: string; end: string } {
  if (!/^\d{4}-\d{2}$/.test(monthKey)) throw new Error("잘못된 월 형식입니다.");
  const [year, month] = monthKey.split("-").map(Number);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return {
    start: `${monthKey}-01 00:00:00`,
    end: `${nextYear}-${String(nextMonth).padStart(2, "0")}-01 00:00:00`,
  };
}

export function getFinanceAdjustments(
  db: Database.Database,
  monthKey: string
): FinanceMonthlyAdjustments {
  ensureAdminFinanceTables(db);
  const row = db
    .prepare("SELECT * FROM finance_monthly_adjustments WHERE month_key=?")
    .get(monthKey) as Record<string, unknown> | undefined;
  return {
    monthKey,
    railwayUsageKrw: finiteNonNegative(row?.railway_usage_krw),
    railwayTaxKrw: finiteNonNegative(row?.railway_tax_krw),
    paymentGatewayFeesKrw: finiteNonNegative(row?.payment_gateway_fees_krw),
    creatorTransferFeesKrw: finiteNonNegative(row?.creator_transfer_fees_krw),
    creatorExtraIncentivesKrw: finiteNonNegative(row?.creator_extra_incentives_krw),
    otherCostsKrw: finiteNonNegative(row?.other_costs_krw),
    providerTaxRate: Math.min(1, finiteNonNegative(row?.provider_tax_rate)),
    note: typeof row?.note === "string" ? row.note : "",
  };
}

export function saveFinanceAdjustments(
  db: Database.Database,
  input: FinanceMonthlyAdjustments
): FinanceMonthlyAdjustments {
  ensureAdminFinanceTables(db);
  const clean: FinanceMonthlyAdjustments = {
    monthKey: input.monthKey,
    railwayUsageKrw: finiteNonNegative(input.railwayUsageKrw),
    railwayTaxKrw: finiteNonNegative(input.railwayTaxKrw),
    paymentGatewayFeesKrw: finiteNonNegative(input.paymentGatewayFeesKrw),
    creatorTransferFeesKrw: finiteNonNegative(input.creatorTransferFeesKrw),
    creatorExtraIncentivesKrw: finiteNonNegative(input.creatorExtraIncentivesKrw),
    otherCostsKrw: finiteNonNegative(input.otherCostsKrw),
    providerTaxRate: Math.min(1, finiteNonNegative(input.providerTaxRate)),
    note: input.note.trim().slice(0, 2000),
  };
  monthRangeSql(clean.monthKey);
  db.prepare(
    `INSERT INTO finance_monthly_adjustments
      (month_key, railway_usage_krw, railway_tax_krw, payment_gateway_fees_krw,
       creator_transfer_fees_krw, creator_extra_incentives_krw, other_costs_krw,
       provider_tax_rate, note, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(month_key) DO UPDATE SET
       railway_usage_krw=excluded.railway_usage_krw,
       railway_tax_krw=excluded.railway_tax_krw,
       payment_gateway_fees_krw=excluded.payment_gateway_fees_krw,
       creator_transfer_fees_krw=excluded.creator_transfer_fees_krw,
       creator_extra_incentives_krw=excluded.creator_extra_incentives_krw,
       other_costs_krw=excluded.other_costs_krw,
       provider_tax_rate=excluded.provider_tax_rate,
       note=excluded.note,
       updated_at=datetime('now')`
  ).run(
    clean.monthKey,
    clean.railwayUsageKrw,
    clean.railwayTaxKrw,
    clean.paymentGatewayFeesKrw,
    clean.creatorTransferFeesKrw,
    clean.creatorExtraIncentivesKrw,
    clean.otherCostsKrw,
    clean.providerTaxRate,
    clean.note
  );
  return clean;
}

function parseSlices(raw: unknown): DeductionSlice[] {
  if (typeof raw !== "string" || !raw) return [];
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function sliceTotals(raw: unknown): { paid: number; free: number } {
  let paid = 0;
  let free = 0;
  for (const slice of parseSlices(raw)) {
    const amount = finiteNonNegative(slice.amount);
    if (slice.pointType === "PAID") paid += amount;
    else if (slice.pointType === "FREE") free += amount;
  }
  return { paid, free };
}

function usageModelLabel(usage: Usage | null | undefined): string {
  if (!usage) return "알 수 없음";
  const typed = usage as Usage & { modelLabel?: string };
  return typed.modelLabel?.trim() || typed.model?.trim() || "알 수 없음";
}

function messageModelLabel(rawUsage: string | null): string {
  try {
    return usageModelLabel(JSON.parse(rawUsage ?? "{}") as Usage);
  } catch {
    return "알 수 없음";
  }
}

/** Immutable per-generation model from a stored variant matched by request id. */
function variantModelForRequest(rawAlternates: string | null, requestId: string): string | null {
  if (!requestId) return null;
  for (const variant of parseMessageVariants(rawAlternates)) {
    if (variant.requestId && variant.requestId === requestId) {
      return variant.model?.trim() || usageModelLabel(variant.usage);
    }
  }
  return null;
}

type MonthlyChargeEvent = {
  /** Immutable generation identity (settlement.request_id). */
  requestId: string;
  assistantMessageId: number | null;
  paid: number;
  free: number;
};

type MessageProvenance = {
  requestId: string | null;
  usage: string | null;
  alternates: string | null;
};

function chatBillingSettlementTableExists(db: Database.Database): boolean {
  return Boolean(
    db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='chat_billing_settlements'"
      )
      .get()
  );
}

function tableColumnSet(db: Database.Database, table: string): Set<string> {
  return new Set(
    (
      db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
    ).map((column) => column.name)
  );
}

/**
 * ONE USER CHARGE EVENT = ONE REVENUE EVENT. Only NATIVE chat_turn settlements
 * are monthly charge events (owned by their created_at period; PAID/FREE from
 * the stored slices). The legacy bridge source
 * (legacy_message_deduction_slices) is bookkeeping materialized later, NOT a
 * charge event, so its insertion time is never used as an event period.
 * Other charge kinds are excluded from chat revenue by construction.
 */
function readMonthlyChargeEvents(
  db: Database.Database,
  start: string,
  end: string
): MonthlyChargeEvent[] {
  if (!chatBillingSettlementTableExists(db)) return [];
  const rows = db
    .prepare(
      `SELECT request_id, assistant_message_id, deduction_slices_json
       FROM chat_billing_settlements
       WHERE created_at >= ? AND created_at < ?
         AND charge_kind = ?
         AND source = 'native'`
    )
    .all(start, end, CHAT_TURN_CHARGE_KIND) as Array<{
    request_id: string;
    assistant_message_id: number | null;
    deduction_slices_json: string | null;
  }>;
  return rows.map((row) => {
    const totals = sliceTotals(row.deduction_slices_json);
    return {
      requestId: typeof row.request_id === "string" ? row.request_id : "",
      assistantMessageId:
        row.assistant_message_id != null && Number.isFinite(row.assistant_message_id)
          ? Number(row.assistant_message_id)
          : null,
      paid: totals.paid,
      free: totals.free,
    };
  });
}

/**
 * Assistant messages that have a NATIVE chat_turn settlement in ANY period.
 * Their revenue must come from settlement events (period-owned), never from the
 * regeneration-overwritten messages.deduction_slices. A legacy bridge does NOT
 * block the message fallback: its slices duplicate the original legacy charge,
 * whose period is the message's own chronology.
 */
function readCanonicallySettledMessageIds(db: Database.Database): Set<number> {
  const ids = new Set<number>();
  if (!chatBillingSettlementTableExists(db)) return ids;
  const rows = db
    .prepare(
      `SELECT DISTINCT assistant_message_id FROM chat_billing_settlements
       WHERE assistant_message_id IS NOT NULL
         AND charge_kind = ?
         AND source = 'native'`
    )
    .all(CHAT_TURN_CHARGE_KIND) as Array<{ assistant_message_id: number }>;
  for (const row of rows) {
    if (Number.isFinite(row.assistant_message_id)) ids.add(Number(row.assistant_message_id));
  }
  return ids;
}

/** Display label for a ledger model id, aligned with message modelLabel values. */
function ledgerModelLabel(model: string): string {
  const trimmed = model.trim();
  if (!trimmed) return "알 수 없음";
  const key = trimmed.toLowerCase();
  const option = MAIN_RP_USER_SELECTABLE_OPTIONS.find(
    (candidate) => candidate.id.toLowerCase() === key
  );
  return option?.label ?? trimmed;
}

/**
 * Immutable generation→model provenance: settlement.request_id
 * is the same client request id stored as api_cost_ledger.generation_request_id
 * by the main-RP writer. First writer wins deterministically per generation.
 */
function readLedgerModelByGenerationRequestId(db: Database.Database): Map<string, string> {
  const map = new Map<string, string>();
  const rows = db
    .prepare(
      `SELECT generation_request_id, actual_model, model
       FROM api_cost_ledger
       WHERE generation_request_id IS NOT NULL AND generation_request_id != ''
       ORDER BY id ASC`
    )
    .all() as Array<{
    generation_request_id: string;
    actual_model: string | null;
    model: string | null;
  }>;
  for (const row of rows) {
    const requestId = row.generation_request_id;
    if (map.has(requestId)) continue;
    const model = (row.actual_model ?? "").trim() || (row.model ?? "").trim();
    if (!model) continue;
    map.set(requestId, ledgerModelLabel(model));
  }
  return map;
}

function category(
  paidRevenueKrw: number,
  freePointSpend: number,
  apiCostKrw: number,
  creatorCostKrw = 0,
  marginCoverage: FinanceMarginCoverage = "complete",
  realizedMarginExact = true
): FinanceCategory {
  const netProfitKrw = paidRevenueKrw - apiCostKrw - creatorCostKrw;
  const marginEligible = realizedMarginExact && paidRevenueKrw > 0;
  return {
    paidRevenueKrw: round1(paidRevenueKrw),
    freePointSpend: round1(freePointSpend),
    apiCostKrw: round1(apiCostKrw),
    creatorCostKrw: round1(creatorCostKrw),
    netProfitKrw: marginEligible ? round1(netProfitKrw) : null,
    marginRate: marginEligible ? netProfitKrw / paidRevenueKrw : null,
    marginCoverage,
    realizedMarginExact,
  };
}

export function buildAdminFinanceSummary(
  db: Database.Database = getDb(),
  monthKey = currentKstMonthKey()
): AdminFinanceSummary {
  ensureAdminFinanceTables(db);
  ensureProviderCostLedgerSchema(db);
  const { start, end } = monthRangeSql(monthKey);
  const adjustments = getFinanceAdjustments(db, monthKey);
  const exchange = resolveBillingExchangeRateSnapshot();

  // Provenance columns are read only when the live messages schema has them
  // (minimal legacy/fixture schemas omit request_id/alternates).
  const messageColumns = tableColumnSet(db, "messages");
  const requestIdExpr = messageColumns.has("request_id")
    ? "request_id"
    : "NULL AS request_id";
  const alternatesExpr = messageColumns.has("alternates")
    ? "alternates"
    : "NULL AS alternates";

  const messageRows = db
    .prepare(
      `SELECT id, ${requestIdExpr}, usage, deduction_slices, ${alternatesExpr}
       FROM messages
       WHERE role='assistant' AND created_at>=? AND created_at<?
         AND COALESCE(is_refunded, 0)=0`
    )
    .all(start, end) as {
    id: number;
    request_id: string | null;
    usage: string | null;
    deduction_slices: string | null;
    alternates: string | null;
  }[];

  const inPeriodAssistantIds = new Set(messageRows.map((row) => row.id));
  // Immutable generation model provenance. The mutable current message model is
  // consulted ONLY when the generation request id matches exactly.
  const ledgerModelByRequest = readLedgerModelByGenerationRequestId(db);
  const provenanceByMessageId = new Map<number, MessageProvenance>();
  for (const row of messageRows) {
    provenanceByMessageId.set(row.id, {
      requestId: row.request_id,
      usage: row.usage,
      alternates: row.alternates,
    });
  }

  // --- Canonical monthly user-charge events (chat_billing_settlements) ---
  // ONE USER CHARGE EVENT = ONE REVENUE EVENT. Revenue is owned by the
  // settlement row's created_at period — never by messages.created_at (which a
  // regeneration never moves) nor the latest (regeneration-overwritten)
  // messages.deduction_slices. Legacy message slices are a fallback ONLY for
  // turns that have no canonical settlement in any period.
  const chargeEvents = readMonthlyChargeEvents(db, start, end);
  const settledMessageIds = readCanonicallySettledMessageIds(db);
  // Resolve provenance for charge events that reference out-of-period messages
  // (regeneration reuses the original assistant row).
  const chargeProvenanceIds = [
    ...new Set(
      chargeEvents
        .map((event) => event.assistantMessageId)
        .filter((id): id is number => id != null && !provenanceByMessageId.has(id))
    ),
  ];
  if (chargeProvenanceIds.length > 0) {
    const placeholders = chargeProvenanceIds.map(() => "?").join(",");
    const rows = db
      .prepare(
        `SELECT id, ${requestIdExpr}, usage, ${alternatesExpr} FROM messages WHERE id IN (${placeholders})`
      )
      .all(...chargeProvenanceIds) as Array<{
      id: number;
      request_id: string | null;
      usage: string | null;
      alternates: string | null;
    }>;
    for (const row of rows) {
      provenanceByMessageId.set(row.id, {
        requestId: row.request_id,
        usage: row.usage,
        alternates: row.alternates,
      });
    }
  }

  // Generation-model resolution (never "latest message model"):
  //   1. settlement.request_id ↔ ledger.generation_request_id model
  //   2. message.request_id === settlement.request_id → current message usage
  //   3. stored variant matched by request id
  //   4. otherwise unknown (no timestamp/token/model guessing)
  const resolveChargeEventModel = (event: MonthlyChargeEvent): string => {
    if (event.assistantMessageId == null) return "알 수 없음";
    const provenance = provenanceByMessageId.get(event.assistantMessageId);
    if (!provenance) return "알 수 없음";
    const ledgerModel = event.requestId
      ? ledgerModelByRequest.get(event.requestId)
      : undefined;
    if (ledgerModel) return ledgerModel;
    if (event.requestId && provenance.requestId === event.requestId) {
      return messageModelLabel(provenance.usage);
    }
    const variantModel = variantModelForRequest(provenance.alternates, event.requestId);
    if (variantModel) return variantModel;
    return "알 수 없음";
  };

  const assistantIds = [...inPeriodAssistantIds];
  let ledgerByAssistant = new Map<number, ProviderCostLedgerRow[]>();
  if (assistantIds.length > 0) {
    const placeholders = assistantIds.map(() => "?").join(",");
    // Period-scoped: a ledger physical event is folded into a message turn ONLY
    // when it belongs to the requested period. A cross-month regeneration leaves
    // the original message in its own month, so unrelated period events can no
    // longer retroactively move an earlier month's cost.
    const ledgerRows = db
      .prepare(
        `SELECT * FROM api_cost_ledger
         WHERE assistant_message_id IN (${placeholders})
           AND created_at >= ? AND created_at < ?`
      )
      .all(...assistantIds, start, end);
    ledgerByAssistant = groupLedgerRowsByAssistantMessageId(
      ledgerRows as ProviderCostLedgerRow[]
    );
  }

  let chatPaid = 0;
  let chatFree = 0;
  let chatApiCost = 0;
  let chatMarginCoverage: FinanceMarginCoverage = "complete";
  let chatRealizedMarginExact = true;
  const modelMap = new Map<
    string,
    {
      paidRevenueKrw: number;
      freePointSpend: number;
      apiCostKrw: number;
      marginCoverage: FinanceMarginCoverage;
      realizedMarginExact: boolean;
    }
  >();
  // Canonical charge-event revenue (period owner).
  for (const event of chargeEvents) {
    chatPaid += event.paid;
    chatFree += event.free;
  }

  const modelEntry = (model: string) =>
    modelMap.get(model) ?? {
      paidRevenueKrw: 0,
      freePointSpend: 0,
      apiCostKrw: 0,
      marginCoverage: "complete" as FinanceMarginCoverage,
      realizedMarginExact: true,
    };

  for (const row of messageRows) {
    // Fallback revenue ONLY when this turn has no canonical settlement in any
    // period (never summed with settlement revenue — one economic event, one
    // owner).
    const slices = settledMessageIds.has(row.id)
      ? { paid: 0, free: 0 }
      : sliceTotals(row.deduction_slices);
    chatPaid += slices.paid;
    chatFree += slices.free;
    let model = "알 수 없음";
    let rowApiCost = 0;
    let rowMarginCoverage: FinanceMarginCoverage = "unavailable";
    let rowRealizedMarginExact = false;
    let ledgerContributions: LedgerCostContribution[] = [];
    let usageCostKrw = 0;
    try {
      const usage = JSON.parse(row.usage ?? "{}") as Usage & {
        modelLabel?: string;
      };
      const typedUsage = usage as Usage & { modelLabel?: string };
      model = typedUsage.modelLabel?.trim() || typedUsage.model?.trim() || model;
      // No model-specific cost branches: every message goes through the
      // generic canonical turn-cost owner (settled actuals win inside it).
      const ledgerRows = ledgerByAssistant.get(row.id) ?? [];
      const turnCost = resolveMessageTurnProviderCostKrw(usage, ledgerRows);
      rowApiCost = turnCost.knownApiCostKrw;
      rowMarginCoverage = turnCost.coverage;
      rowRealizedMarginExact = turnCost.realizedMarginExact;
      ledgerContributions = turnCost.ledgerCostContributions;
      usageCostKrw = turnCost.usageFallbackKrw;
      chatApiCost += rowApiCost;
      chatMarginCoverage = mergeFinanceTurnCostCoverage(
        chatMarginCoverage,
        rowMarginCoverage
      );
      if (!rowRealizedMarginExact) {
        chatRealizedMarginExact = false;
      }
    } catch {
      // Legacy rows without a valid receipt remain visible as revenue but not guessed as cost.
      chatMarginCoverage = mergeFinanceTurnCostCoverage(chatMarginCoverage, "partial");
      chatRealizedMarginExact = false;
    }
    const taxFactor = 1 + adjustments.providerTaxRate;
    const applyModelCost = (modelName: string, preTaxKrw: number) => {
      if (preTaxKrw <= 0) return;
      const entry = modelEntry(modelName);
      entry.apiCostKrw += preTaxKrw * taxFactor;
      entry.marginCoverage = mergeFinanceTurnCostCoverage(
        entry.marginCoverage,
        rowMarginCoverage
      );
      if (!rowRealizedMarginExact) entry.realizedMarginExact = false;
      modelMap.set(modelName, entry);
    };
    // Revenue fallback (legacy only) belongs to the current message model.
    if (slices.paid > 0 || slices.free > 0) {
      const revenueEntry = modelEntry(model);
      revenueEntry.paidRevenueKrw += slices.paid;
      revenueEntry.freePointSpend += slices.free;
      modelMap.set(model, revenueEntry);
    }
    // Provider cost is attributed by GENERATION provenance, not the latest
    // message model: each ledger physical event carries its own delivered model.
    for (const contribution of ledgerContributions) {
      applyModelCost(ledgerModelLabel(contribution.model), contribution.krw);
    }
    // Usage-snapshot cost (no canonical ledger owner) stays on the message model.
    applyModelCost(model, usageCostKrw);
  }

  // Attribute canonical charge-event revenue to the generation's model.
  for (const event of chargeEvents) {
    if (event.paid === 0 && event.free === 0) continue;
    const model = resolveChargeEventModel(event);
    const current = modelEntry(model);
    current.paidRevenueKrw += event.paid;
    current.freePointSpend += event.free;
    modelMap.set(model, current);
  }

  // --- Canonical period provider expense (api_cost_ledger.created_at) ---
  // A ledger row folds into a message turn only when that message is in the
  // period. Every other period row — unlinked background OR linked to an
  // out-of-period regeneration message — is added directly, exactly once, by
  // its own physical-event period. Linked vs unlinked no longer decides period
  // inclusion, so a cross-month regeneration can neither drift the earlier
  // month nor be dropped from its own month.
  let orphanApiKrw = 0;
  let orphanChatApiKrw = 0;
  let orphanHasInexact = false;
  const periodLedgerRows = db
    .prepare(
      `SELECT * FROM api_cost_ledger WHERE created_at >= ? AND created_at < ?`
    )
    .all(start, end) as ProviderCostLedgerRow[];
  for (const row of periodLedgerRows) {
    if (row.event_status === "started" || row.event_status === "failed_without_usage") {
      orphanHasInexact = true;
      continue;
    }
    if (
      row.assistant_message_id != null &&
      inPeriodAssistantIds.has(row.assistant_message_id)
    ) {
      continue; // already folded into the in-period message's turn cost
    }
    const exact = isLedgerEventCostExact(row);
    const fx = finiteNonNegative(row.exchange_rate_krw_per_usd);
    const rowKrw = exact
      ? round1(finiteNonNegative(row.actual_cost_usd) * fx)
      : round1(finiteNonNegative(row.cost_krw));
    if (!exact) orphanHasInexact = true;
    // Chat-turn expenses join the chat category (same event-period semantics);
    // background/other centers stay a separate top-level slice. Model comes from
    // the physical event itself (immutable), never the current message model.
    if (resolveLedgerCostCenter(row) === "chat_turn") {
      orphanChatApiKrw = round1(orphanChatApiKrw + rowKrw);
      const ledgerModelRaw =
        (row.actual_model ?? "").trim() || (row.model ?? "").trim() || "";
      const model = ledgerModelLabel(ledgerModelRaw);
      const current = modelEntry(model);
      current.apiCostKrw += rowKrw * (1 + adjustments.providerTaxRate);
      modelMap.set(model, current);
    } else {
      orphanApiKrw = round1(orphanApiKrw + rowKrw);
    }
  }
  // Category-level chat cost uses the same event-period owner as the total.
  chatApiCost += orphanChatApiKrw;


  let imagePaid = 0;
  let imageFree = 0;
  let imageApiCost = 0;
  const imageTable = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='chat_image_generations'")
    .get();
  if (imageTable) {
    const imageRows = db
      .prepare(
        `SELECT upstream_cost_usd, deduction_slices, exchange_rate_krw_per_usd
         FROM chat_image_generations WHERE created_at>=? AND created_at<?`
      )
      .all(start, end) as {
        upstream_cost_usd: number | null;
        deduction_slices: string | null;
        exchange_rate_krw_per_usd: number | null;
      }[];
    for (const row of imageRows) {
      const slices = sliceTotals(row.deduction_slices);
      imagePaid += slices.paid;
      imageFree += slices.free;
      imageApiCost +=
        finiteNonNegative(row.upstream_cost_usd) *
        (finiteNonNegative(row.exchange_rate_krw_per_usd) || exchange.effectiveKrwPerUsd);
    }
  }

  // Generic AI-cost attribution over the canonical ledger (single owner).
  // The top-level totals add ONLY the period rows that are not already folded
  // into an in-period message's turn cost (orphanApiKrw above). This keeps
  // totalApiCostKrw and aiCost.totalKrw on the SAME physical-event set: every
  // period ledger row is counted exactly once, regardless of linked/unlinked.
  const ledgerAttribution = readLedgerPeriodCostAttribution(db, start, end);

  const creatorAccrued = finiteNonNegative(
    (
      db
        .prepare(
          `SELECT COALESCE(SUM(reward_amount),0) AS amount
           FROM creator_earnings
           WHERE reversed=0 AND created_at>=? AND created_at<?`
        )
        .get(start, end) as { amount: number }
    ).amount
  );
  const creatorPayoutCash = finiteNonNegative(
    (
      db
        .prepare(
          `SELECT COALESCE(SUM(payout_amount),0) AS amount
           FROM withdrawal_requests
           WHERE status='APPROVED' AND processed_at>=? AND processed_at<?`
        )
        .get(start, end) as { amount: number }
    ).amount
  );
  // Canonical snapshot consumption: APPROVED rows carry a request-time
  // locked platform_fee. Finance reads that stored field directly - it never
  // recomputes retained from other snapshot fields or current rates.
  // (Period = processed_at; accrual lives in the created_at month, so a
  // cross-month settlement reverses in the settlement month by design - no
  // liability ledger in this scope.)
  // Neither value enters revenue or costs here; the retained portion is
  // added back EXACTLY ONCE in top-level net profit below (no revenue leg -
  // recognizing both legs would double-count the same economics).
  const creatorWithdrawalAttribution = db
    .prepare(
      `SELECT COALESCE(SUM(tax_amount),0) AS tax,
              COALESCE(SUM(platform_fee),0) AS retained
       FROM withdrawal_requests
       WHERE status='APPROVED' AND processed_at>=? AND processed_at<?`
    )
    .get(start, end) as { tax: number; retained: number };
  const creatorTaxPayableKrw = finiteNonNegative(creatorWithdrawalAttribution.tax);
  const creatorPlatformRetainedKrw = finiteNonNegative(creatorWithdrawalAttribution.retained);
  const creatorForChat = creatorAccrued;

  const portoneTable = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='portone_checkouts'")
    .get();
  const paymentsCollected = portoneTable
    ? finiteNonNegative(
        (
          db
            .prepare(
              `SELECT COALESCE(SUM(amount),0) AS amount
               FROM portone_checkouts
               WHERE status='paid' AND paid_at>=? AND paid_at<?`
            )
            .get(start, end) as { amount: number }
        ).amount
      )
    : 0;
  const giftFees = db
    .prepare(
      `SELECT COALESCE(SUM(paid_fee_amount),0) AS paid_fee
       FROM point_gifts WHERE created_at>=? AND created_at<?`
    )
    .get(start, end) as { paid_fee: number };
  const giftFeeRevenueKrw = finiteNonNegative(giftFees.paid_fee);

  const imageApiCostBeforeTax = imageApiCost;
  const imageHasActivity = imageHasAccountingActivity(
    imagePaid,
    imageFree,
    imageApiCostBeforeTax
  );
  const imageMarginCoverage: FinanceMarginCoverage = imageHasActivity
    ? "estimated"
    : "complete";
  const imageRealizedMarginExact = !imageHasActivity;

  const chat = category(
    chatPaid,
    chatFree,
    chatApiCost * (1 + adjustments.providerTaxRate),
    creatorForChat,
    chatMarginCoverage,
    chatRealizedMarginExact
  );
  const image = category(
    imagePaid,
    imageFree,
    imageApiCost * (1 + adjustments.providerTaxRate),
    0,
    imageMarginCoverage,
    imageRealizedMarginExact
  );
  const railwayCostKrw = adjustments.railwayUsageKrw + adjustments.railwayTaxKrw;
  const operatingCostsKrw =
    railwayCostKrw +
    adjustments.paymentGatewayFeesKrw +
    adjustments.creatorTransferFeesKrw +
    adjustments.creatorExtraIncentivesKrw +
    adjustments.otherCostsKrw;
  const paidRevenue = chat.paidRevenueKrw + image.paidRevenueKrw + giftFeeRevenueKrw;
  const totalApiCostKrw = round1(chat.apiCostKrw + image.apiCostKrw + orphanApiKrw);
  const summaryMarginCoverage = mergeFinanceTurnCostCoverage(
    chat.marginCoverage,
    image.marginCoverage
  );
  const summaryRealizedMarginExact =
    chat.realizedMarginExact &&
    image.realizedMarginExact &&
    !orphanHasInexact;
  // Top-level P&L only: creator cost was recognized at 100% on accrual, so
  // the APPROVED-withdrawal retained portion reverses here exactly once.
  // Category-level profits are untouched; revenue legs are never added.
  const netProfitKrw = summaryRealizedMarginExact
    ? paidRevenue -
      totalApiCostKrw -
      creatorForChat +
      creatorPlatformRetainedKrw -
      operatingCostsKrw
    : null;

  // --- Generic AI actual-cost attribution (dynamic; no model hardcoding) ---
  const ledgerTotals = ledgerAttribution.totals;
  const ledgerCostBase = ledgerTotals.actualKrw + ledgerTotals.estimatedKrw;
  const aiCoveragePct =
    ledgerCostBase > 0 ? round1((ledgerTotals.actualKrw / ledgerCostBase) * 100) : null;
  const aiCost = {
    totalActualKrw: round1(ledgerTotals.actualKrw),
    estimatedFallbackKrw: round1(ledgerTotals.estimatedKrw),
    totalKrw: round1(ledgerTotals.actualKrw + ledgerTotals.estimatedKrw),
    unattributedKrw: round1(ledgerTotals.unattributedKrw),
    unattributedCalls: ledgerTotals.unattributedCalls,
    calls: ledgerTotals.calls,
    inputTokens: ledgerTotals.inputTokens,
    outputTokens: ledgerTotals.outputTokens,
    // Share of ledger-recognized cost that is settled actual (definition is
    // documented next to the UI coverage label; null when nothing recorded).
    coveragePct: aiCoveragePct,
    hasInexact: ledgerTotals.hasInexact,
    // Honest freshness: latest ledger write in range, never "synced".
    lastRecordedAt: ledgerAttribution.lastRecordedAt,
    byCenter: (
      Object.entries(ledgerAttribution.byCenter) as Array<
        [string, (typeof ledgerAttribution.byCenter)[keyof typeof ledgerAttribution.byCenter]]
      >
    ).map(([center, agg]) => ({
      center,
      calls: agg.calls,
      actualKrw: round1(agg.actualKrw),
      estimatedKrw: round1(agg.estimatedKrw),
      sharePct:
        ledgerCostBase > 0
          ? round1(((agg.actualKrw + agg.estimatedKrw) / ledgerCostBase) * 100)
          : 0,
    })),
  };

  // Union model view: messages-attributed (direct, with revenue) plus
  // ledger-only models (indirect cost, never a fabricated margin).
  // NOTE: In-period message-linked ledger exacts are already folded into the
  // messages-based apiCostKrw via the canonical turn-cost owner, so direct-row
  // contribution never subtracts ledger amounts again (that would
  // double-count). Ledger direct splits merge into the messages row by model
  // identity; indirect splits always stay separate rows. Ledger model ids are
  // normalized to the registry label so a period-owned direct event merges with
  // the settlement-revenue row even when its message is out of period.
  const ledgerDirectIndex = new Map(
    ledgerAttribution.byModel
      .filter((entry) => entry.kind === "direct")
      .flatMap((entry) => {
        const label = ledgerModelLabel(entry.model);
        const pairs: Array<[string, typeof entry]> = [
          [entry.model.toLowerCase(), entry],
        ];
        if (label.toLowerCase() !== entry.model.toLowerCase()) {
          pairs.push([label.toLowerCase(), entry]);
        }
        return pairs;
      })
  );
  const seenLedgerModels = new Set<string>();
  const aiModelCosts: Array<{
    model: string;
    kind: "direct" | "indirect";
    center: string | null;
    calls: number | null;
    paidRevenueKrw: number;
    actualKrw: number;
    estimatedKrw: number;
    contributionKrw: number | null;
    marginRate: number | null;
    sourceState: string;
  }> = [...modelMap.entries()].map(([model, values]) => {
    const ledger = ledgerDirectIndex.get(model.toLowerCase());
    if (ledger) {
      seenLedgerModels.add(ledger.model.toLowerCase());
      seenLedgerModels.add(ledgerModelLabel(ledger.model).toLowerCase());
    }
    const contribution = values.paidRevenueKrw - values.apiCostKrw;
    const eligible = values.realizedMarginExact && values.paidRevenueKrw > 0;
    return {
      model,
      kind: "direct" as const,
      center: "chat_turn",
      calls: ledger?.calls ?? null,
      paidRevenueKrw: round1(values.paidRevenueKrw),
      actualKrw: round1(ledger?.actualKrw ?? 0),
      estimatedKrw: round1(ledger?.estimatedKrw ?? 0),
      contributionKrw: eligible ? round1(contribution) : null,
      marginRate: eligible && values.paidRevenueKrw > 0 ? contribution / values.paidRevenueKrw : null,
      sourceState: ledger
        ? ledger.sourceState
        : values.realizedMarginExact
          ? "actual_auto"
          : "unavailable",
    };
  });
  for (const entry of ledgerAttribution.byModel) {
    // Direct splits merge into the messages row above; indirect splits
    // always stay separate. Seen-tracking is per split, never per model, and
    // uses the normalized label identity.
    const labelKey = ledgerModelLabel(entry.model).toLowerCase();
    if (entry.kind === "direct") {
      if (seenLedgerModels.has(entry.model.toLowerCase()) || seenLedgerModels.has(labelKey)) {
        continue;
      }
      seenLedgerModels.add(entry.model.toLowerCase());
      seenLedgerModels.add(labelKey);
    }
    aiModelCosts.push({
      model: ledgerModelLabel(entry.model),
      kind: entry.kind,
      center: entry.center,
      calls: entry.calls,
      paidRevenueKrw: 0,
      actualKrw: round1(entry.actualKrw),
      estimatedKrw: round1(entry.estimatedKrw),
      contributionKrw: null,
      marginRate: null,
      sourceState: entry.sourceState,
    });
  }
  aiModelCosts.sort(
    (a, b) => b.actualKrw + b.estimatedKrw + b.paidRevenueKrw - (a.actualKrw + a.estimatedKrw + a.paidRevenueKrw)
  );

  // Active registry models with zero observed usage in range (compact UX data).
  const observedModels = new Set<string>();
  for (const key of modelMap.keys()) observedModels.add(key.toLowerCase());
  for (const entry of ledgerAttribution.byModel) {
    observedModels.add(entry.model.toLowerCase());
    observedModels.add(ledgerModelLabel(entry.model).toLowerCase());
  }
  const zeroUseModels = MAIN_RP_USER_SELECTABLE_OPTIONS.filter(
    (option) =>
      !observedModels.has(option.id.toLowerCase()) &&
      !observedModels.has(option.label.toLowerCase())
  ).map((option) => ({ id: option.id, label: option.label }));

  return {
    monthKey,
    generatedAt: new Date().toISOString(),
    exchangeRateKrwPerUsd: exchange.effectiveKrwPerUsd,
    paymentsCollectedKrw: round1(paymentsCollected),
    paidPointsConsumed: round1(chatPaid + imagePaid),
    freePointsConsumed: round1(chatFree + imageFree),
    giftFeeRevenueKrw: round1(giftFeeRevenueKrw),
    chat,
    image,
    modelBreakdown: [...modelMap.entries()]
      .map(([model, values]) => {
        const modelNetProfitKrw = values.paidRevenueKrw - values.apiCostKrw;
        const marginEligible =
          values.realizedMarginExact && values.paidRevenueKrw > 0;
        return {
          model,
          paidRevenueKrw: round1(values.paidRevenueKrw),
          freePointSpend: round1(values.freePointSpend),
          apiCostKrw: round1(values.apiCostKrw),
          netProfitKrw: marginEligible ? round1(modelNetProfitKrw) : null,
          marginRate: marginEligible ? modelNetProfitKrw / values.paidRevenueKrw : null,
          marginCoverage: values.marginCoverage,
          realizedMarginExact: values.realizedMarginExact,
        };
      })
      .sort((a, b) => b.paidRevenueKrw - a.paidRevenueKrw),
    aiCost: {
      totalActualKrw: aiCost.totalActualKrw,
      estimatedFallbackKrw: aiCost.estimatedFallbackKrw,
      totalKrw: aiCost.totalKrw,
      unattributedKrw: aiCost.unattributedKrw,
      unattributedCalls: aiCost.unattributedCalls,
      calls: aiCost.calls,
      inputTokens: aiCost.inputTokens,
      outputTokens: aiCost.outputTokens,
      coveragePct: aiCost.coveragePct,
      hasInexact: aiCost.hasInexact,
      lastRecordedAt: aiCost.lastRecordedAt,
      byCenter: aiCost.byCenter,
    },
    aiModelCosts,
    zeroUseModels,
    providerReconciliation: readProviderReconciliationState(db),
    creatorAccruedKrw: round1(creatorAccrued),
    creatorPayoutCashKrw: round1(creatorPayoutCash),
    creatorTaxPayableKrw: round1(creatorTaxPayableKrw),
    creatorPlatformRetainedKrw: round1(creatorPlatformRetainedKrw),
    railwayCostKrw: round1(railwayCostKrw),
    operatingCostsKrw: round1(operatingCostsKrw),
    totalApiCostKrw: round1(totalApiCostKrw),
    netProfitKrw: netProfitKrw == null ? null : round1(netProfitKrw),
    marginRate:
      summaryRealizedMarginExact && paidRevenue > 0 && netProfitKrw != null
        ? netProfitKrw / paidRevenue
        : null,
    marginCoverage: summaryMarginCoverage,
    realizedMarginExact: summaryRealizedMarginExact,
    adjustments,
  };
}

export function saveDailyFinanceSnapshot(db: Database.Database = getDb()) {
  const summary = buildAdminFinanceSummary(db);
  const snapshotDate = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  db.prepare(
    `INSERT INTO finance_daily_snapshots
       (snapshot_date, month_key, summary_json, created_at, updated_at)
     VALUES (?, ?, ?, datetime('now'), datetime('now'))
     ON CONFLICT(snapshot_date) DO UPDATE SET
       month_key=excluded.month_key,
       summary_json=excluded.summary_json,
       updated_at=datetime('now')`
  ).run(snapshotDate, summary.monthKey, JSON.stringify(summary));
  return summary;
}
