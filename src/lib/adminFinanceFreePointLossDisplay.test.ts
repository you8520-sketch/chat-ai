import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, it } from "node:test";
import { buildAdminFinanceSummary, ensureAdminFinanceTables } from "@/lib/adminFinance";
import {
  canClaimRecordedCostLossFloor,
  formatFinanceMarginRate,
  formatFinanceNetProfit,
  formatRecordedActualAiCostKrw,
  formatRecordedAiCostMetricLabel,
} from "@/lib/adminFinanceMarginDisplay";
import type { Usage } from "@/lib/chatUsage";
import {
  clearAuditLegacyFxForTest,
  installAuditLegacyFxForTest,
} from "@/lib/billingLiveOwnerReadinessAudit";
import {
  buildPlatformAsyncTurnLedgerContext,
  ensureProviderCostLedgerSchema,
  finalizeProviderCostAttempt,
  recordBackgroundProviderCost,
  startProviderCostAttempt,
} from "@/lib/providerCostLedger";

const FX = {
  dateKey: "2026-08-30",
  source: "api_daily" as const,
  baseUsdKrw: 1560,
  overseasFeeRate: 0.02,
  effectiveKrwPerUsd: 1560.6,
};

function usdForKrw(krw: number): number {
  return krw / FX.effectiveKrwPerUsd;
}

function mainUsage(overrides: Partial<Usage> = {}): Usage {
  return {
    input: 1000,
    output: 500,
    model: "deepseek/deepseek-v4-pro",
    modelLabel: "DeepSeek V4 Pro",
    provider: "cheaperinference",
    route: "nsfw",
    cost: 100,
    baseCost: 100,
    breakdown: [],
    mainApiRawCostKrw: 40,
    apiRawCostKrw: 40,
    shadowPricing: {
      pricingVersion: 1,
      billingReferenceInputUsdPerMillion: 1,
      billingReferenceOutputUsdPerMillion: 2,
      billingReferenceCostKrw: 10,
      billingReferenceCostUsd: 0.01,
      fxSnapshot: FX,
      providerListCostStatus: "complete",
      reserveStatus: "complete",
      actualTurnCostCoverage: "complete",
      actualProviderCostKrw: 40,
      actualCostUsd: usdForKrw(40),
      actualCostSource: "cheaper_inference_billed",
      providerListCostKrw: 35,
      inputCostKrw: 5,
      outputCostKrw: 5,
      reasoningCostKrw: 0,
      cacheReadCostKrw: 0,
      cacheWriteCostKrw: 0,
      targetMargin: 0.5,
      minimumMarginFloor: 0.3,
      standardUserChargeKrw: 100,
      promoPercent: 0,
      finalShadowChargeKrw: 100,
      finalShadowPoints: 100,
      providerSavingsKrw: null,
      providerOverrunKrw: null,
      promoGivebackKrw: 0,
      netPricingBufferDeltaKrw: null,
      actualGrossProfitKrw: 60,
      actualRealizedMargin: 0.6,
      worstCasePromoMargin: null,
      marginFloorViolated: null,
      modelId: "deepseek/deepseek-v4-pro",
      provider: "cheaperinference",
    },
    ...overrides,
  };
}

function financeDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY,
      chat_id INTEGER NOT NULL DEFAULT 1,
      role TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      request_id TEXT,
      usage TEXT,
      deduction_slices TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      is_refunded INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE point_gifts (
      id INTEGER PRIMARY KEY,
      paid_fee_amount REAL NOT NULL DEFAULT 0,
      free_fee_amount REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE creator_earnings (
      id INTEGER PRIMARY KEY,
      reward_amount REAL NOT NULL DEFAULT 0,
      reversed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE withdrawal_requests (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL DEFAULT 0,
      requested_cp REAL NOT NULL DEFAULT 0,
      tax_amount REAL NOT NULL DEFAULT 0,
      platform_fee REAL NOT NULL DEFAULT 0,
      payout_amount REAL NOT NULL DEFAULT 0,
      account_info TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'PENDING',
      processed_at TEXT
    );
    CREATE TABLE portone_checkouts (
      id INTEGER PRIMARY KEY,
      amount REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      paid_at TEXT
    );
    CREATE TABLE chat_image_generations (
      id INTEGER PRIMARY KEY,
      upstream_cost_usd REAL,
      deduction_slices TEXT,
      exchange_rate_krw_per_usd REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  ensureAdminFinanceTables(db);
  ensureProviderCostLedgerSchema(db);
  return db;
}

function insertAssistant(
  db: Database.Database,
  id: number,
  usage: Usage,
  slices: Array<{ pointType: string; amount: number }>,
  opts: { refunded?: boolean } = {}
) {
  db.prepare(
    `INSERT INTO messages (id, chat_id, role, usage, deduction_slices, created_at, is_refunded)
     VALUES (?, 1, 'assistant', ?, ?, datetime('now'), ?)`
  ).run(id, JSON.stringify(usage), JSON.stringify(slices), opts.refunded ? 1 : 0);
}

function recognizedRevenue(summary: ReturnType<typeof buildAdminFinanceSummary>): number {
  return summary.chat.paidRevenueKrw + summary.image.paidRevenueKrw + summary.giftFeeRevenueKrw;
}

function displayBundle(summary: ReturnType<typeof buildAdminFinanceSummary>) {
  const revenue = recognizedRevenue(summary);
  const claim = canClaimRecordedCostLossFloor({
    recognizedRevenueKrw: revenue,
    paymentsCollectedKrw: summary.paymentsCollectedKrw,
    creatorPlatformRetainedKrw: summary.creatorPlatformRetainedKrw,
    recordedActualAiCostKrw: summary.aiCost.totalActualKrw,
  });
  return {
    profitLabel: formatFinanceNetProfit(summary.netProfitKrw, summary.marginCoverage, revenue),
    marginLabel: formatFinanceMarginRate(summary.marginRate, summary.marginCoverage, revenue),
    recordedLabel: formatRecordedAiCostMetricLabel(claim),
    recordedValue: formatRecordedActualAiCostKrw(summary.aiCost.totalActualKrw),
    claim,
  };
}

describe("admin finance free-point recorded-cost display (#1351)", () => {
  beforeEach(() => installAuditLegacyFxForTest());
  afterEach(() => clearAuditLegacyFxForTest());

  it("exact free-only usage shows negative category profit and undefined margin", () => {
    const db = financeDb();
    try {
      insertAssistant(db, 1, mainUsage(), [{ pointType: "FREE", amount: 120 }]);
      const summary = buildAdminFinanceSummary(db);
      assert.equal(summary.paymentsCollectedKrw, 0);
      assert.equal(summary.paidPointsConsumed, 0);
      assert.equal(summary.giftFeeRevenueKrw, 0);
      assert.equal(summary.chat.paidRevenueKrw, 0);
      assert.equal(summary.chat.freePointSpend, 120);
      assert.equal(summary.chat.realizedMarginExact, true);
      assert.ok((summary.chat.apiCostKrw ?? 0) > 0);
      assert.equal(summary.chat.netProfitKrw, -summary.chat.apiCostKrw);
      assert.ok((summary.chat.netProfitKrw ?? 0) < 0);
      assert.equal(summary.chat.marginRate, null);
      assert.equal(summary.marginRate, null);
      const view = displayBundle(summary);
      assert.match(view.profitLabel, /원$/);
      assert.notEqual(view.profitLabel, "부분 집계 · 미확정");
      assert.equal(view.marginLabel, "매출 없음 · 수익률 해당 없음");
    } finally {
      db.close();
    }
  });

  it("partial cost keeps exact profit null and still shows recorded actual AI spend", () => {
    const db = financeDb();
    try {
      insertAssistant(db, 2, mainUsage(), [{ pointType: "FREE", amount: 80 }]);
      const incomplete = {
        ...buildPlatformAsyncTurnLedgerContext({
          chatId: 1,
          assistantMessageId: 2,
          generationSequence: 0,
          family: "status_meta",
          jobAttemptOrdinal: 1,
        }),
        persistInTests: true,
      };
      const attempt = startProviderCostAttempt(incomplete, db);
      finalizeProviderCostAttempt(
        attempt,
        {
          actualProvider: "cheaperinference",
          actualModel: "deepseek-v4-flash",
          upstreamCostUsd: 0.002,
          usageEstimated: false,
          outcome: "success",
        },
        db
      );
      recordBackgroundProviderCost(
        {
          provider: "cheaperinference",
          outcome: "success",
          persistInTests: true,
          model: "memory-model-x",
          cheaperInferenceBilledCostUsd: 0.01,
          requestKind: "background-memory-extract",
          costCenter: "memory",
          providerRequestId: "bg-exact-1",
        },
        db
      );
      const summary = buildAdminFinanceSummary(db);
      assert.equal(summary.realizedMarginExact, false);
      assert.equal(summary.netProfitKrw, null);
      assert.ok(summary.aiCost.totalActualKrw > 0);
      const view = displayBundle(summary);
      assert.equal(view.profitLabel, "부분 집계 · 미확정");
      assert.equal(view.marginLabel, "매출 없음 · 수익률 해당 없음");
      assert.equal(view.claim, true);
      assert.equal(view.recordedLabel, "현재 기록 기준 최소 손실");
      assert.equal(view.recordedValue, formatRecordedActualAiCostKrw(summary.aiCost.totalActualKrw));
    } finally {
      db.close();
    }
  });

  it("zero revenue and zero recorded cost does not invent a loss", () => {
    const db = financeDb();
    try {
      const summary = buildAdminFinanceSummary(db);
      assert.equal(summary.chat.paidRevenueKrw, 0);
      assert.equal(summary.aiCost.totalActualKrw, 0);
      assert.equal(summary.chat.netProfitKrw, 0);
      assert.equal(summary.netProfitKrw, 0);
      assert.equal(summary.marginRate, null);
      const view = displayBundle(summary);
      assert.equal(view.claim, false);
      assert.equal(view.recordedLabel, "내부 원장에 기록된 실제 AI 비용");
      assert.equal(view.recordedValue, "0원");
      assert.equal(view.marginLabel, "매출 없음 · 수익률 해당 없음");
    } finally {
      db.close();
    }
  });

  it("historic paid-point spend this month is revenue even with no current PortOne inflow", () => {
    const db = financeDb();
    try {
      insertAssistant(db, 3, mainUsage(), [{ pointType: "PAID", amount: 100 }]);
      const summary = buildAdminFinanceSummary(db);
      assert.equal(summary.paymentsCollectedKrw, 0);
      assert.equal(summary.chat.paidRevenueKrw, 100);
      assert.equal(summary.chat.realizedMarginExact, true);
      assert.ok((summary.chat.netProfitKrw ?? 0) > 0);
      assert.ok((summary.chat.marginRate ?? 0) > 0);
      const view = displayBundle(summary);
      assert.equal(view.claim, false);
      assert.equal(view.recordedLabel, "내부 원장에 기록된 실제 AI 비용");
      assert.notEqual(view.marginLabel, "매출 없음 · 수익률 해당 없음");
    } finally {
      db.close();
    }
  });

  it("mixed paid and free keeps only paid slices as revenue", () => {
    const db = financeDb();
    try {
      insertAssistant(db, 4, mainUsage(), [
        { pointType: "PAID", amount: 60 },
        { pointType: "FREE", amount: 40 },
      ]);
      const summary = buildAdminFinanceSummary(db);
      assert.equal(summary.chat.paidRevenueKrw, 60);
      assert.equal(summary.chat.freePointSpend, 40);
      assert.equal(summary.paidPointsConsumed, 60);
      assert.equal(summary.freePointsConsumed, 40);
      const view = displayBundle(summary);
      assert.equal(view.claim, false);
    } finally {
      db.close();
    }
  });

  it("gift fee revenue blocks the recorded-cost loss-floor label", () => {
    const db = financeDb();
    try {
      insertAssistant(db, 5, mainUsage(), [{ pointType: "FREE", amount: 50 }]);
      db.prepare(
        "INSERT INTO point_gifts (paid_fee_amount, free_fee_amount, created_at) VALUES (25, 0, datetime('now'))"
      ).run();
      const summary = buildAdminFinanceSummary(db);
      assert.equal(summary.giftFeeRevenueKrw, 25);
      assert.equal(summary.chat.paidRevenueKrw, 0);
      const view = displayBundle(summary);
      assert.equal(view.claim, false);
      assert.equal(view.recordedLabel, "내부 원장에 기록된 실제 AI 비용");
    } finally {
      db.close();
    }
  });

  it("reviewer KG test paid checkouts are not cash inflow or revenue", () => {
    const db = financeDb();
    try {
      insertAssistant(db, 8, mainUsage(), [{ pointType: "FREE", amount: 50 }]);
      db.exec(`ALTER TABLE portone_checkouts ADD COLUMN checkout_kind TEXT NOT NULL DEFAULT 'standard'`);
      db.prepare(
        "INSERT INTO portone_checkouts (amount, status, paid_at, checkout_kind) VALUES (10000, 'paid', datetime('now'), 'reviewer_kg_test')"
      ).run();
      db.prepare(
        "INSERT INTO portone_checkouts (amount, status, paid_at, checkout_kind) VALUES (7000, 'paid', datetime('now'), 'standard')"
      ).run();
      const summary = buildAdminFinanceSummary(db);
      assert.equal(summary.paymentsCollectedKrw, 7000);
      assert.equal(summary.chat.paidRevenueKrw, 0);
    } finally {
      db.close();
    }
  });

  it("same-month PortOne cash inflow blocks the loss-floor label without becoming revenue", () => {
    const db = financeDb();
    try {
      insertAssistant(db, 6, mainUsage(), [{ pointType: "FREE", amount: 50 }]);
      db.prepare(
        "INSERT INTO portone_checkouts (amount, status, paid_at) VALUES (10000, 'paid', datetime('now'))"
      ).run();
      const summary = buildAdminFinanceSummary(db);
      assert.equal(summary.paymentsCollectedKrw, 10000);
      assert.equal(summary.chat.paidRevenueKrw, 0);
      const view = displayBundle(summary);
      assert.equal(view.claim, false);
    } finally {
      db.close();
    }
  });

  it("refunded free-point turns do not create revenue or hide remaining recorded cost", () => {
    const db = financeDb();
    try {
      insertAssistant(db, 7, mainUsage(), [{ pointType: "FREE", amount: 90 }], { refunded: true });
      recordBackgroundProviderCost(
        {
          provider: "cheaperinference",
          outcome: "success",
          persistInTests: true,
          model: "memory-model-x",
          cheaperInferenceBilledCostUsd: 0.004,
          requestKind: "background-memory-extract",
          costCenter: "memory",
          providerRequestId: "bg-refund-1",
        },
        db
      );
      const summary = buildAdminFinanceSummary(db);
      assert.equal(summary.chat.paidRevenueKrw, 0);
      assert.equal(summary.chat.freePointSpend, 0);
      assert.ok(summary.aiCost.totalActualKrw > 0);
      const view = displayBundle(summary);
      assert.equal(view.claim, true);
    } finally {
      db.close();
    }
  });
});
