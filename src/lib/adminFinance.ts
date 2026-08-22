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
  CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_LEGACY_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL,
  isCheaperInferenceDeepSeekV4FlashModel,
} from "@/lib/chatModels";

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

export type FinanceCategory = {
  paidRevenueKrw: number;
  freePointSpend: number;
  apiCostKrw: number;
  creatorCostKrw: number;
  netProfitKrw: number;
  marginRate: number | null;
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
    netProfitKrw: number;
    marginRate: number | null;
  }>;
  deepSeekV4Flash: {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    costBeforeTaxKrw: number;
    costWithTaxKrw: number;
  };
  creatorAccruedKrw: number;
  creatorPayoutCashKrw: number;
  railwayCostKrw: number;
  operatingCostsKrw: number;
  totalApiCostKrw: number;
  netProfitKrw: number;
  marginRate: number | null;
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
  const giftColumns = tableColumns("point_gifts");
  if (!giftColumns.has("paid_fee_amount")) {
    db.exec("ALTER TABLE point_gifts ADD COLUMN paid_fee_amount REAL NOT NULL DEFAULT 0");
  }
  if (!giftColumns.has("free_fee_amount")) {
    db.exec("ALTER TABLE point_gifts ADD COLUMN free_fee_amount REAL NOT NULL DEFAULT 0");
  }
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

export function recordApiCost(input: {
  provider: string;
  model: string;
  requestKind?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  upstreamCostUsd?: number;
  estimated?: boolean;
}) {
  // Unit tests frequently replace global fetch and assert a single provider request.
  // Cost-ledger persistence is an operational side effect, not part of that contract.
  if (process.env.NODE_TEST_CONTEXT) return;
  const db = getDb();
  ensureAdminFinanceTables(db);
  const exchange = resolveBillingExchangeRateSnapshot();
  const estimatedUsd = estimateApiCostUsd(input);
  const upstreamCostUsd =
    finiteNonNegative(input.upstreamCostUsd) || estimatedUsd;
  const costKrw = upstreamCostUsd * exchange.effectiveKrwPerUsd;
  db.prepare(
    `INSERT INTO api_cost_ledger
      (provider, model, request_kind, input_tokens, output_tokens,
       cache_read_tokens, cache_write_tokens, upstream_cost_usd,
       exchange_rate_krw_per_usd, cost_krw, estimated)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.provider,
    input.model,
    input.requestKind?.slice(0, 120) ?? "",
    Math.max(0, Math.trunc(input.inputTokens)),
    Math.max(0, Math.trunc(input.outputTokens)),
    Math.max(0, Math.trunc(input.cacheReadTokens ?? 0)),
    Math.max(0, Math.trunc(input.cacheWriteTokens ?? 0)),
    upstreamCostUsd,
    exchange.effectiveKrwPerUsd,
    costKrw,
    input.estimated || !finiteNonNegative(input.upstreamCostUsd) ? 1 : 0
  );
}

function monthRange(monthKey: string): { start: string; end: string } {
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
  monthRange(clean.monthKey);
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

function category(
  paidRevenueKrw: number,
  freePointSpend: number,
  apiCostKrw: number,
  creatorCostKrw = 0
): FinanceCategory {
  const netProfitKrw = paidRevenueKrw - apiCostKrw - creatorCostKrw;
  return {
    paidRevenueKrw: round1(paidRevenueKrw),
    freePointSpend: round1(freePointSpend),
    apiCostKrw: round1(apiCostKrw),
    creatorCostKrw: round1(creatorCostKrw),
    netProfitKrw: round1(netProfitKrw),
    marginRate: paidRevenueKrw > 0 ? netProfitKrw / paidRevenueKrw : null,
  };
}

export function buildAdminFinanceSummary(
  db: Database.Database = getDb(),
  monthKey = currentKstMonthKey()
): AdminFinanceSummary {
  ensureAdminFinanceTables(db);
  const { start, end } = monthRange(monthKey);
  const adjustments = getFinanceAdjustments(db, monthKey);
  const exchange = resolveBillingExchangeRateSnapshot();

  const messageRows = db
    .prepare(
      `SELECT usage, deduction_slices
       FROM messages
       WHERE role='assistant' AND created_at>=? AND created_at<?
         AND COALESCE(is_refunded, 0)=0`
    )
    .all(start, end) as { usage: string | null; deduction_slices: string | null }[];

  let chatPaid = 0;
  let chatFree = 0;
  let chatApiCost = 0;
  const modelMap = new Map<
    string,
    { paidRevenueKrw: number; freePointSpend: number; apiCostKrw: number }
  >();
  for (const row of messageRows) {
    const slices = sliceTotals(row.deduction_slices);
    chatPaid += slices.paid;
    chatFree += slices.free;
    let model = "알 수 없음";
    let rowApiCost = 0;
    try {
      const usage = JSON.parse(row.usage ?? "{}") as {
        model?: string;
        modelLabel?: string;
        apiRawCostKrw?: number;
      };
      model = usage.modelLabel?.trim() || usage.model?.trim() || model;
      const isLedgeredDeepSeekFlash = isCheaperInferenceDeepSeekV4FlashModel(
        usage.model ?? ""
      );
      rowApiCost = isLedgeredDeepSeekFlash
        ? 0
        : finiteNonNegative(usage.apiRawCostKrw);
      chatApiCost += rowApiCost;
    } catch {
      // Legacy rows without a valid receipt remain visible as revenue but not guessed as cost.
    }
    const current = modelMap.get(model) ?? {
      paidRevenueKrw: 0,
      freePointSpend: 0,
      apiCostKrw: 0,
    };
    current.paidRevenueKrw += slices.paid;
    current.freePointSpend += slices.free;
    current.apiCostKrw += rowApiCost * (1 + adjustments.providerTaxRate);
    modelMap.set(model, current);
  }

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

  const background = db
    .prepare(
      `SELECT COUNT(*) AS calls,
              COALESCE(SUM(input_tokens),0) AS input_tokens,
              COALESCE(SUM(output_tokens),0) AS output_tokens,
              COALESCE(SUM(cache_read_tokens),0) AS cache_read_tokens,
              COALESCE(SUM(cost_krw),0) AS cost_krw
       FROM api_cost_ledger
       WHERE created_at>=? AND created_at<? AND lower(model) IN (?, ?)`
    )
    .get(
      start,
      end,
      CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_LEGACY_MODEL,
      CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL
    ) as Record<string, number>;
  const backgroundCost = finiteNonNegative(background.cost_krw);
  const backgroundWithTax = backgroundCost * (1 + adjustments.providerTaxRate);
  if (backgroundWithTax > 0) {
    const flash = modelMap.get("DeepSeek V4 Flash · 백그라운드") ?? {
      paidRevenueKrw: 0,
      freePointSpend: 0,
      apiCostKrw: 0,
    };
    flash.apiCostKrw += backgroundWithTax;
    modelMap.set("DeepSeek V4 Flash · 백그라운드", flash);
  }

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

  const chat = category(
    chatPaid,
    chatFree,
    chatApiCost * (1 + adjustments.providerTaxRate) + backgroundWithTax,
    creatorForChat
  );
  const image = category(imagePaid, imageFree, imageApiCost * (1 + adjustments.providerTaxRate));
  const railwayCostKrw = adjustments.railwayUsageKrw + adjustments.railwayTaxKrw;
  const operatingCostsKrw =
    railwayCostKrw +
    adjustments.paymentGatewayFeesKrw +
    adjustments.creatorTransferFeesKrw +
    adjustments.creatorExtraIncentivesKrw +
    adjustments.otherCostsKrw;
  const paidRevenue = chat.paidRevenueKrw + image.paidRevenueKrw + giftFeeRevenueKrw;
  const totalApiCostKrw = chat.apiCostKrw + image.apiCostKrw;
  const netProfitKrw =
    paidRevenue - totalApiCostKrw - creatorForChat - operatingCostsKrw;

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
        const netProfitKrw = values.paidRevenueKrw - values.apiCostKrw;
        return {
          model,
          paidRevenueKrw: round1(values.paidRevenueKrw),
          freePointSpend: round1(values.freePointSpend),
          apiCostKrw: round1(values.apiCostKrw),
          netProfitKrw: round1(netProfitKrw),
          marginRate:
            values.paidRevenueKrw > 0 ? netProfitKrw / values.paidRevenueKrw : null,
        };
      })
      .sort((a, b) => b.paidRevenueKrw - a.paidRevenueKrw),
    deepSeekV4Flash: {
      calls: Number(background.calls ?? 0),
      inputTokens: Number(background.input_tokens ?? 0),
      outputTokens: Number(background.output_tokens ?? 0),
      cacheReadTokens: Number(background.cache_read_tokens ?? 0),
      costBeforeTaxKrw: round1(backgroundCost),
      costWithTaxKrw: round1(backgroundWithTax),
    },
    creatorAccruedKrw: round1(creatorAccrued),
    creatorPayoutCashKrw: round1(creatorPayoutCash),
    railwayCostKrw: round1(railwayCostKrw),
    operatingCostsKrw: round1(operatingCostsKrw),
    totalApiCostKrw: round1(totalApiCostKrw),
    netProfitKrw: round1(netProfitKrw),
    marginRate: paidRevenue > 0 ? netProfitKrw / paidRevenue : null,
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
