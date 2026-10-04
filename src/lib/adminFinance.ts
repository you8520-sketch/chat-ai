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
  selectedAILabel,
} from "@/lib/chatModels";
import { canonicalizePublishedModelId } from "@/lib/publishedModelAliases";
import type { Usage } from "@/lib/chatUsage";
import {
  groupLedgerRowsByAssistantMessageId,
  ledgerCostFundingClass,
  mergeFinanceTurnCostCoverage,
  resolveMessageTurnProviderCostKrw,
  type FinanceTurnCostCoverage,
  type LedgerCostContribution,
  type LedgerCostFundingClass,
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
import { parseDeductionSlicesJson } from "@/lib/chatBillingSettlement";
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

/**
 * How model-level provider cost relates to an existing user-charge event.
 * This is provenance on the canonical model cost, not a second cost total.
 */
export type ModelDirectCostAttribution = {
  platformFundedKrw: number;
  userFundedChargedKrw: number;
  userFundedWaivedKrw: number;
  userFundedRefundedKrw: number;
  /** User-funded generation with a durable under_recovered settlement (0P user charge). */
  userFundedUnderRecoveredKrw: number;
  /** User-funded generation cost with no chat_turn settlement for that generation. */
  userFundedUnlinkedKrw: number;
  /** Cost whose billing owner cannot be proven from the ledger linkage. */
  unknownKrw: number;
};

export function emptyModelDirectCostAttribution(): ModelDirectCostAttribution {
  return {
    platformFundedKrw: 0,
    userFundedChargedKrw: 0,
    userFundedWaivedKrw: 0,
    userFundedRefundedKrw: 0,
    userFundedUnderRecoveredKrw: 0,
    userFundedUnlinkedKrw: 0,
    unknownKrw: 0,
  };
}

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
    directCostAttribution: ModelDirectCostAttribution;
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

/** Naive calendar month as SQL datetimes. The reconciler treats these as UTC. */
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
 * Refund projection for a charge event (single owner for native + bridge).
 *  - settlement.refunded_at marks the exact generation reversed by the
 *    canonical refund core, so it survives later regeneration.
 *  - unmarked historical refund fallback: is_refunded=1 means no regeneration
 *    happened after the refund, so the current message request id IS the
 *    refunded generation. Never an assistant-wide blind filter.
 */
function isChargeEventRefunded(row: {
  request_id: string;
  refunded_at: string | null;
  message_is_refunded: number | null;
  message_request_id: string | null;
}): boolean {
  if (row.refunded_at) return true;
  return (
    Number(row.message_is_refunded) === 1 &&
    (row.message_request_id ?? "") === row.request_id
  );
}

/**
 * ONE USER CHARGE EVENT = ONE REVENUE EVENT. Only NATIVE chat_turn settlements
 * are monthly charge events (owned by their created_at period; PAID/FREE from
 * the stored slices). Refunded charge events are excluded by isChargeEventRefunded.
 * The legacy bridge source (legacy_message_deduction_slices) is bookkeeping
 * materialized later, NOT a charge event, so its insertion time is never used
 * as an event period. Other charge kinds are excluded from chat revenue.
 */
function readMonthlyChargeEvents(
  db: Database.Database,
  start: string,
  end: string
): MonthlyChargeEvent[] {
  if (!chatBillingSettlementTableExists(db)) return [];
  const rows = db
    .prepare(
      `SELECT s.request_id, s.assistant_message_id, s.deduction_slices_json,
              s.refunded_at,
              m.is_refunded AS message_is_refunded,
              m.request_id AS message_request_id
       FROM chat_billing_settlements s
       LEFT JOIN messages m ON m.id = s.assistant_message_id
       WHERE s.created_at >= ? AND s.created_at < ?
         AND s.charge_kind = ?
         AND s.source = 'native'`
    )
    .all(start, end, CHAT_TURN_CHARGE_KIND) as Array<{
    request_id: string;
    assistant_message_id: number | null;
    deduction_slices_json: string | null;
    refunded_at: string | null;
    message_is_refunded: number | null;
    message_request_id: string | null;
  }>;
  return rows
    .filter((row) => !isChargeEventRefunded(row))
    .map((row) => {
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
 * Legacy bridge revenue ownership. The bridge is materialized later as
 * bookkeeping, so its created_at must NOT be used as the economic period. Its
 * immutable deduction_slices_json is the original legacy charge snapshot, and
 * the original assistant row's created_at is the historical period owner. A
 * bridge event is therefore included only in the month of the referenced
 * message's created_at — never in its materialization month.
 */
function readMonthlyLegacyBridgeEvents(
  db: Database.Database,
  start: string,
  end: string
): MonthlyChargeEvent[] {
  if (!chatBillingSettlementTableExists(db)) return [];
  const rows = db
    .prepare(
      `SELECT s.request_id, s.assistant_message_id, s.deduction_slices_json,
              s.refunded_at,
              m.is_refunded AS message_is_refunded,
              m.request_id AS message_request_id
       FROM chat_billing_settlements s
       JOIN messages m ON m.id = s.assistant_message_id
       WHERE s.charge_kind = ?
         AND s.source = 'legacy_message_deduction_slices'
         AND m.created_at >= ? AND m.created_at < ?`
    )
    .all(CHAT_TURN_CHARGE_KIND, start, end) as Array<{
    request_id: string;
    assistant_message_id: number | null;
    deduction_slices_json: string | null;
    refunded_at: string | null;
    message_is_refunded: number | null;
    message_request_id: string | null;
  }>;
  return rows
    .filter((row) => !isChargeEventRefunded(row))
    .map((row) => {
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
 * Assistant messages that already have a canonical charge owner in ANY period:
 * a native chat_turn settlement OR a legacy bridge snapshot. Raw
 * messages.deduction_slices are only a valid legacy fallback while the row has
 * never been regenerated/settled/bridged (regeneration overwrites them). This
 * is a raw-fallback safety guard, NOT an event owner: the actual economics come
 * from the native settlement (own period) or the bridge snapshot (message
 * chronology).
 */
function readOwnedMessageIds(db: Database.Database): Set<number> {
  const ids = new Set<number>();
  if (!chatBillingSettlementTableExists(db)) return ids;
  const rows = db
    .prepare(
      `SELECT DISTINCT assistant_message_id FROM chat_billing_settlements
       WHERE assistant_message_id IS NOT NULL
         AND charge_kind = ?
         AND source IN ('native', 'legacy_message_deduction_slices')`
    )
    .all(CHAT_TURN_CHARGE_KIND) as Array<{ assistant_message_id: number }>;
  for (const row of rows) {
    if (Number.isFinite(row.assistant_message_id)) ids.add(Number(row.assistant_message_id));
  }
  return ids;
}

/**
 * Display label for a ledger model id, aligned with message modelLabel values.
 * Provider slugs canonicalize through the published alias owner first so
 * `google/gemini-3.8-flash` and `gemini-3.8-flash` share one finance row.
 */
function ledgerModelLabel(model: string): string {
  const trimmed = model.trim();
  if (!trimmed) return "알 수 없음";
  const canonical = canonicalizePublishedModelId(trimmed);
  const canonicalLabel = selectedAILabel(canonical);
  if (canonicalLabel.trim().toLowerCase() !== canonical.toLowerCase()) {
    return canonicalLabel;
  }
  return selectedAILabel(trimmed);
}

/**
 * Immutable generation→model provenance. The canonical generation identity is
 * (assistant_message_id, generation_request_id), because a raw request id is
 * NOT globally unique (settlement UNIQUE is per user/chat/request/kind). Only
 * the main physical event (`execution_phase='main_generation'`) may own the
 * generation model, so an auxiliary row sharing the request id can never
 * hijack it. First main writer wins deterministically per generation.
 */
function generationModelKey(assistantMessageId: number | null, requestId: string): string {
  return `${assistantMessageId ?? "null"}::${requestId}`;
}

function readMainGenerationModelByRequest(db: Database.Database): Map<string, string> {
  const map = new Map<string, string>();
  const rows = db
    .prepare(
      `SELECT assistant_message_id, generation_request_id, actual_model, model
       FROM api_cost_ledger
       WHERE execution_phase = 'main_generation'
         AND assistant_message_id IS NOT NULL
         AND generation_request_id IS NOT NULL AND generation_request_id != ''
       ORDER BY id ASC`
    )
    .all() as Array<{
    assistant_message_id: number;
    generation_request_id: string;
    actual_model: string | null;
    model: string | null;
  }>;
  for (const row of rows) {
    const key = generationModelKey(Number(row.assistant_message_id), row.generation_request_id);
    if (map.has(key)) continue;
    const model = (row.actual_model ?? "").trim() || (row.model ?? "").trim();
    if (!model) continue;
    map.set(key, ledgerModelLabel(model));
  }
  return map;
}

type GenerationChargeExplanation =
  | "charged"
  | "waived"
  | "refunded"
  | "under_recovered"
  | "unknown";

type UserFundedCostLink = GenerationChargeExplanation | "unlinked";

type GenerationChargeIndex = {
  explanations: Map<string, GenerationChargeExplanation>;
  /** Current assistant request id. Regeneration overwrites this with the slices. */
  messageRequestIds: Map<number, string>;
};

const GENERATION_CHARGE_RANK: Record<GenerationChargeExplanation, number> = {
  unknown: 0,
  refunded: 1,
  waived: 2,
  under_recovered: 2,
  charged: 3,
};

function rememberGenerationCharge(
  map: Map<string, GenerationChargeExplanation>,
  key: string,
  explanation: GenerationChargeExplanation
): void {
  const current = map.get(key);
  if (current == null || GENERATION_CHARGE_RANK[explanation] > GENERATION_CHARGE_RANK[current]) {
    map.set(key, explanation);
  }
}

/** Canonical slice parser. Malformed JSON is not a zero charge. */
function canonicalSliceTotal(
  raw: string | null
): { ok: true; total: number } | { ok: false } {
  if (typeof raw !== "string") return { ok: false };
  const slices = parseDeductionSlicesJson(raw);
  if (!slices) return { ok: false };
  let total = 0;
  for (const slice of slices) {
    if (!Number.isFinite(slice.amount) || slice.amount < 0) return { ok: false };
    total += slice.amount;
  }
  return { ok: true, total };
}

/**
 * A zero slice total is a waiver only when the billing owner stored outcome
 * `waived` with settled_points 0 and a valid empty snapshot. Durable
 * `under_recovered` is a separate known 0P outcome, not a waiver or refund.
 * `legacy_malformed`, `claiming`, and inconsistent rows stay unknown.
 */
function classifySettlementExplanation(row: {
  request_id: string;
  refunded_at: string | null;
  message_is_refunded: number | null;
  message_request_id: string | null;
  settled_points: number | null;
  outcome: string | null;
  deduction_slices_json: string | null;
}): GenerationChargeExplanation {
  const outcome = typeof row.outcome === "string" ? row.outcome.trim() : "";
  const settled = Number(row.settled_points);
  const parsed = canonicalSliceTotal(
    typeof row.deduction_slices_json === "string" ? row.deduction_slices_json : null
  );
  // 0P under_recovered is not a refunded charge event. refunded_at must not
  // reclassify it; unlock/resolve is a later owner, not this column.
  if (outcome === "under_recovered" && settled === 0 && parsed.ok && parsed.total === 0) {
    return "under_recovered";
  }
  if (isChargeEventRefunded(row)) return "refunded";
  if (outcome === "waived" && settled === 0 && parsed.ok && parsed.total === 0) {
    return "waived";
  }
  if (
    (outcome === "charged" || outcome === "legacy_already_billed") &&
    Number.isFinite(settled) &&
    parsed.ok &&
    parsed.total > 0 &&
    Math.abs(settled - parsed.total) < 1e-6
  ) {
    return "charged";
  }
  return "unknown";
}

/**
 * Raw messages.deduction_slices are the same fallback the revenue owner uses:
 * valid only while this assistant row has no native or bridge settlement.
 * A positive total on the current request_id is a charge. A present but
 * unreadable snapshot is unknown. Empty snapshots are not a waiver.
 */
function classifyRawDeductionSlices(
  raw: string | null
): "charged" | "unknown" | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed === "[]" || trimmed === "null") return null;
  const parsed = canonicalSliceTotal(trimmed);
  if (parsed.ok && parsed.total > 0) return "charged";
  return "unknown";
}

/**
 * Generation → charge explanation across every period. A settlement in another
 * month, or a still-unbridged deduction_slices snapshot, explains a late
 * provider-cost row. This index never adds revenue.
 */
function readGenerationChargeExplanations(db: Database.Database): GenerationChargeIndex {
  const explanations = new Map<string, GenerationChargeExplanation>();
  const messageRequestIds = new Map<number, string>();
  const index = { explanations, messageRequestIds };
  if (chatBillingSettlementTableExists(db)) {
    const rows = db
      .prepare(
        `SELECT s.request_id, s.assistant_message_id, s.deduction_slices_json,
                s.settled_points, s.outcome, s.refunded_at,
                m.is_refunded AS message_is_refunded,
                m.request_id AS message_request_id
         FROM chat_billing_settlements s
         LEFT JOIN messages m ON m.id = s.assistant_message_id
         WHERE s.charge_kind = ?
           AND s.source IN ('native', 'legacy_message_deduction_slices')`
      )
      .all(CHAT_TURN_CHARGE_KIND) as Array<{
      request_id: string;
      assistant_message_id: number | null;
      deduction_slices_json: string | null;
      settled_points: number | null;
      outcome: string | null;
      refunded_at: string | null;
      message_is_refunded: number | null;
      message_request_id: string | null;
    }>;
    for (const row of rows) {
      if (row.assistant_message_id == null || !Number.isFinite(row.assistant_message_id)) continue;
      const requestId = typeof row.request_id === "string" ? row.request_id.trim() : "";
      if (!requestId) continue;
      rememberGenerationCharge(
        explanations,
        generationModelKey(Number(row.assistant_message_id), requestId),
        classifySettlementExplanation(row)
      );
    }
  }

  const ownedMessageIds = readOwnedMessageIds(db);
  const messageRows = db
    .prepare(
      `SELECT id, request_id, deduction_slices FROM messages WHERE role = 'assistant'`
    )
    .all() as Array<{
    id: number;
    request_id: string | null;
    deduction_slices: string | null;
  }>;
  for (const row of messageRows) {
    if (!Number.isFinite(row.id)) continue;
    const requestId = typeof row.request_id === "string" ? row.request_id.trim() : "";
    messageRequestIds.set(Number(row.id), requestId);
    if (!requestId || ownedMessageIds.has(Number(row.id))) continue;
    const raw = classifyRawDeductionSlices(row.deduction_slices);
    if (!raw) continue;
    rememberGenerationCharge(explanations, generationModelKey(Number(row.id), requestId), raw);
  }
  return index;
}

function explainUserFundedCost(
  index: GenerationChargeIndex,
  messageId: number | null,
  requestId: string | null
): UserFundedCostLink {
  const id = requestId?.trim() ?? "";
  if (messageId == null || !Number.isFinite(messageId) || !id) return "unknown";
  const explained = index.explanations.get(generationModelKey(messageId, id));
  if (explained) return explained;
  const currentRequest = index.messageRequestIds.get(messageId);
  if (currentRequest == null || currentRequest !== id) return "unknown";
  return "unlinked";
}

function userFundedAttributionBucket(
  link: UserFundedCostLink
): keyof ModelDirectCostAttribution {
  switch (link) {
    case "charged":
      return "userFundedChargedKrw";
    case "waived":
      return "userFundedWaivedKrw";
    case "refunded":
      return "userFundedRefundedKrw";
    case "under_recovered":
      return "userFundedUnderRecoveredKrw";
    case "unlinked":
      return "userFundedUnlinkedKrw";
    case "unknown":
      return "unknownKrw";
    default: {
      const _exhaustive: never = link;
      return _exhaustive;
    }
  }
}

function directCostBucket(
  fundingClass: LedgerCostFundingClass,
  index: GenerationChargeIndex,
  messageId: number | null,
  requestId: string | null
): keyof ModelDirectCostAttribution {
  if (fundingClass === "platform_funded") return "platformFundedKrw";
  const link = explainUserFundedCost(index, messageId, requestId);
  if (fundingClass === "unknown" && link === "unlinked") return "unknownKrw";
  return userFundedAttributionBucket(link);
}

function realizedProfitAndMargin(
  paidRevenueKrw: number,
  costKrw: number,
  realizedMarginExact: boolean
): { netProfitKrw: number | null; marginRate: number | null } {
  if (!realizedMarginExact) {
    return { netProfitKrw: null, marginRate: null };
  }
  const netProfitKrw = paidRevenueKrw - costKrw;
  return {
    netProfitKrw: round1(netProfitKrw),
    marginRate: paidRevenueKrw > 0 ? netProfitKrw / paidRevenueKrw : null,
  };
}

function category(
  paidRevenueKrw: number,
  freePointSpend: number,
  apiCostKrw: number,
  creatorCostKrw = 0,
  marginCoverage: FinanceMarginCoverage = "complete",
  realizedMarginExact = true
): FinanceCategory {
  const { netProfitKrw, marginRate } = realizedProfitAndMargin(
    paidRevenueKrw,
    apiCostKrw + creatorCostKrw,
    realizedMarginExact
  );
  return {
    paidRevenueKrw: round1(paidRevenueKrw),
    freePointSpend: round1(freePointSpend),
    apiCostKrw: round1(apiCostKrw),
    creatorCostKrw: round1(creatorCostKrw),
    netProfitKrw,
    marginRate,
    marginCoverage,
    realizedMarginExact,
  };
}

function sumMemberPortonePaymentsCollected(
  db: Database.Database,
  start: string,
  end: string
): number {
  const cols = db.prepare("PRAGMA table_info(portone_checkouts)").all() as { name: string }[];
  const hasKind = cols.some((col) => col.name === "checkout_kind");
  const row = hasKind
    ? (db
        .prepare(
          `SELECT COALESCE(SUM(amount),0) AS amount
           FROM portone_checkouts
           WHERE status='paid' AND paid_at>=? AND paid_at<?
             AND COALESCE(checkout_kind, 'standard') != 'reviewer_kg_test'`
        )
        .get(start, end) as { amount: number })
    : (db
        .prepare(
          `SELECT COALESCE(SUM(amount),0) AS amount
           FROM portone_checkouts
           WHERE status='paid' AND paid_at>=? AND paid_at<?`
        )
        .get(start, end) as { amount: number });
  return Number(row.amount) || 0;
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
  const mainModelByRequest = readMainGenerationModelByRequest(db);
  const provenanceByMessageId = new Map<number, MessageProvenance>();
  for (const row of messageRows) {
    provenanceByMessageId.set(row.id, {
      requestId: row.request_id,
      usage: row.usage,
      alternates: row.alternates,
    });
  }

  // --- Canonical monthly user-charge events (chat_billing_settlements) ---
  // ONE USER CHARGE EVENT = ONE REVENUE EVENT. Native settlements are owned by
  // their created_at period. Legacy bridges are owned by the referenced
  // message's created_at period (their own created_at is bookkeeping time).
  // Raw messages.deduction_slices are a fallback ONLY while the row has no
  // canonical owner (see readOwnedMessageIds).
  const chargeEvents = [
    ...readMonthlyChargeEvents(db, start, end),
    ...readMonthlyLegacyBridgeEvents(db, start, end),
  ];
  const ownedMessageIds = readOwnedMessageIds(db);
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
  //   1. (assistant_message_id, request_id) ↔ main ledger generation model
  //   2. message.request_id === settlement.request_id → current message usage
  //   3. stored variant matched by request id
  //   4. otherwise unknown (no timestamp/token/model guessing)
  const resolveChargeEventModel = (event: MonthlyChargeEvent): string => {
    if (event.assistantMessageId == null) return "알 수 없음";
    const provenance = provenanceByMessageId.get(event.assistantMessageId);
    if (!provenance) return "알 수 없음";
    const ledgerModel = event.requestId
      ? mainModelByRequest.get(generationModelKey(event.assistantMessageId, event.requestId))
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
      directCostAttribution: ModelDirectCostAttribution;
    }
  >();
  // Canonical charge-event revenue (period owner).
  for (const event of chargeEvents) {
    chatPaid += event.paid;
    chatFree += event.free;
  }
  const chargeExplanations = readGenerationChargeExplanations(db);

  const modelEntry = (model: string) =>
    modelMap.get(model) ?? {
      paidRevenueKrw: 0,
      freePointSpend: 0,
      apiCostKrw: 0,
      marginCoverage: "complete" as FinanceMarginCoverage,
      realizedMarginExact: true,
      directCostAttribution: emptyModelDirectCostAttribution(),
    };

  for (const row of messageRows) {
    // Fallback revenue ONLY when this turn has no canonical charge owner in any
    // period (never summed with settlement/bridge revenue — one economic event,
    // one owner).
    const slices = ownedMessageIds.has(row.id)
      ? { paid: 0, free: 0 }
      : sliceTotals(row.deduction_slices);
    chatPaid += slices.paid;
    chatFree += slices.free;
    let model = "알 수 없음";
    let rowApiCost = 0;
    let rowMarginCoverage: FinanceMarginCoverage = "unavailable";
    let rowRealizedMarginExact = false;
    let ledgerContributions: LedgerCostContribution[] = [];
    let mainUsageFallbackKrw = 0;
    let syncUsageFallbackKrw = 0;
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
      mainUsageFallbackKrw = turnCost.mainUsageFallbackKrw;
      syncUsageFallbackKrw = turnCost.syncUsageFallbackKrw;
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
    const applyModelCost = (
      modelName: string,
      preTaxKrw: number,
      bucket: keyof ModelDirectCostAttribution
    ) => {
      if (preTaxKrw <= 0) return;
      const taxed = preTaxKrw * taxFactor;
      const entry = modelEntry(modelName);
      entry.apiCostKrw += taxed;
      entry.directCostAttribution[bucket] += taxed;
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
      applyModelCost(
        ledgerModelLabel(contribution.model),
        contribution.krw,
        directCostBucket(
          contribution.fundingClass,
          chargeExplanations,
          contribution.assistantMessageId,
          contribution.generationRequestId
        )
      );
    }
    // Usage-snapshot main cost (no canonical ledger owner) stays on the message model.
    applyModelCost(
      model,
      mainUsageFallbackKrw,
      directCostBucket("user_funded", chargeExplanations, row.id, row.request_id)
    );
    // Sync extract persisted on the usage snapshot is platform spend. Its KRW
    // stays on the message model, but it is not a user-charge miss.
    applyModelCost(model, syncUsageFallbackKrw, "platformFundedKrw");
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
      const taxed = rowKrw * (1 + adjustments.providerTaxRate);
      const current = modelEntry(model);
      current.apiCostKrw += taxed;
      const bucket = directCostBucket(
        ledgerCostFundingClass(row),
        chargeExplanations,
        row.assistant_message_id != null && Number.isFinite(Number(row.assistant_message_id))
          ? Number(row.assistant_message_id)
          : null,
        row.generation_request_id
      );
      current.directCostAttribution[bucket] += taxed;
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
    ? finiteNonNegative(sumMemberPortonePaymentsCollected(db, start, end))
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
    const { netProfitKrw: contributionKrw, marginRate } = realizedProfitAndMargin(
      values.paidRevenueKrw,
      values.apiCostKrw,
      values.realizedMarginExact
    );
    return {
      model,
      kind: "direct" as const,
      center: "chat_turn",
      calls: ledger?.calls ?? null,
      paidRevenueKrw: round1(values.paidRevenueKrw),
      actualKrw: round1(ledger?.actualKrw ?? 0),
      estimatedKrw: round1(ledger?.estimatedKrw ?? 0),
      contributionKrw,
      marginRate,
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
        const { netProfitKrw, marginRate } = realizedProfitAndMargin(
          values.paidRevenueKrw,
          values.apiCostKrw,
          values.realizedMarginExact
        );
        const attribution = values.directCostAttribution;
        return {
          model,
          paidRevenueKrw: round1(values.paidRevenueKrw),
          freePointSpend: round1(values.freePointSpend),
          apiCostKrw: round1(values.apiCostKrw),
          netProfitKrw,
          marginRate,
          marginCoverage: values.marginCoverage,
          realizedMarginExact: values.realizedMarginExact,
          directCostAttribution: {
            platformFundedKrw: round1(attribution.platformFundedKrw),
            userFundedChargedKrw: round1(attribution.userFundedChargedKrw),
            userFundedWaivedKrw: round1(attribution.userFundedWaivedKrw),
            userFundedRefundedKrw: round1(attribution.userFundedRefundedKrw),
            userFundedUnderRecoveredKrw: round1(attribution.userFundedUnderRecoveredKrw),
            userFundedUnlinkedKrw: round1(attribution.userFundedUnlinkedKrw),
            unknownKrw: round1(attribution.unknownKrw),
          },
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

export function saveDailyFinanceSnapshot(
  db: Database.Database = getDb(),
  snapshotDateOverride?: string
) {
  const snapshotDate =
    snapshotDateOverride ??
    new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const monthKey = snapshotDate.slice(0, 7);
  const summary = buildAdminFinanceSummary(db, monthKey);
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
