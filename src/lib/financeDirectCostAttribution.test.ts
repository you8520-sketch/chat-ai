/**
 * Gemini direct-cost alarm — charge linkage vs platform spend.
 *
 * The anomaly reads Admin Finance model economics. Provider slugs and
 * platform-funded auxiliary cost must not look like a missing user charge,
 * and a user-funded generation with no settlement must still alarm.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import { buildAdminFinanceSummary, ensureAdminFinanceTables } from "@/lib/adminFinance";
import {
  clearAuditLegacyFxForTest,
  installAuditLegacyFxForTest,
} from "@/lib/billingLiveOwnerReadinessAudit";
import { ensureChatBillingSettlementSchema } from "@/lib/chatBillingSettlementSchema";
import {
  GEMINI_38_FLASH_DISPLAY_NAME,
  GEMINI_38_FLASH_MODEL,
  GEMINI_37_FLASH_DISPLAY_NAME,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
  OPENROUTER_GEMINI_38_FLASH_MODEL,
} from "@/lib/chatModels";
import { buildFinanceAnomalyReport } from "@/lib/financeAnomalyRadar";
import { composeActualProductionEconomics } from "@/lib/mainRpPricingActualEconomics";
import type { MainRpPricingObservabilityProjection } from "@/lib/mainRpPricingObservability";
import {
  buildPlatformAsyncTurnLedgerContext,
  ensureProviderCostLedgerSchema,
  finalizeProviderCostAttempt,
  recordMainGenerationProviderCost,
  startProviderCostAttempt,
} from "@/lib/providerCostLedger";
import type { Usage } from "@/lib/chatUsage";

const MONTH = "2026-10";
const FX = 1560.6;
const GEMINI38 = GEMINI_38_FLASH_MODEL;
const GEMINI38_LABEL = GEMINI_38_FLASH_DISPLAY_NAME;
const GEMINI38_SLUG = OPENROUTER_GEMINI_38_FLASH_MODEL;
const GEMINI37 = CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL;
const GEMINI37_LABEL = GEMINI_37_FLASH_DISPLAY_NAME;

function usd(krw: number): number {
  return krw / FX;
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
      model TEXT NOT NULL DEFAULT '',
      alternates TEXT NOT NULL DEFAULT '[]',
      active_variant INTEGER NOT NULL DEFAULT 0,
      generation_status TEXT NOT NULL DEFAULT 'completed',
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
      processed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
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
  ensureChatBillingSettlementSchema(db);
  return db;
}

function slices(paid: number, free = 0): string {
  const out: Array<{ transactionId: number; pointType: string; amount: number }> = [];
  if (paid > 0) out.push({ transactionId: 1, pointType: "PAID", amount: paid });
  if (free > 0) out.push({ transactionId: 2, pointType: "FREE", amount: free });
  return JSON.stringify(out);
}

function syncExtract(krw: number): NonNullable<Usage["statusWidgetExtract"]> {
  return {
    model: "gpt-6-luna",
    modelLabel: "GPT-6 Luna",
    input: 80,
    output: 20,
    apiRawCostKrw: krw,
    callCount: 1,
    actualProviderCostUsd: usd(krw),
    actualProviderCostKrw: krw,
    actualCostSource: "cheaper_inference_billed",
    actualCostCoverage: "complete",
  };
}

function usageJson(opts: {
  model: string;
  modelLabel: string;
  syncKrw?: number;
}): string {
  const syncKrw = opts.syncKrw ?? 0;
  const usage: Usage = {
    model: opts.model,
    modelLabel: opts.modelLabel,
    provider: "openrouter",
    input: 1000,
    output: 200,
    cost: 100,
    mainApiRawCostKrw: 0,
    apiRawCostKrw: syncKrw,
    ...(syncKrw > 0 ? { statusWidgetExtract: syncExtract(syncKrw) } : {}),
    shadowPricing: {
      pricingVersion: 1,
      billingReferenceInputUsdPerMillion: 0.375,
      billingReferenceOutputUsdPerMillion: 1.875,
      billingReferenceCostKrw: 0,
      billingReferenceCostUsd: 0,
      fxSnapshot: {
        dateKey: "2026-10-03",
        source: "api_daily",
        baseUsdKrw: 1560,
        overseasFeeRate: 0.02,
        effectiveKrwPerUsd: FX,
      },
      providerListCostStatus: "complete",
      reserveStatus: "complete",
      actualTurnCostCoverage: "complete",
      actualProviderCostKrw: 0,
      actualCostUsd: 0,
      actualCostSource: "cheaper_inference_billed",
      providerListCostKrw: 0,
      inputCostKrw: 0,
      outputCostKrw: 0,
      reasoningCostKrw: 0,
      cacheReadCostKrw: 0,
      cacheWriteCostKrw: 0,
      targetMargin: 0.55,
      minimumMarginFloor: 0.5,
      standardUserChargeKrw: 0,
      promoPercent: 0,
      finalShadowChargeKrw: 0,
      finalShadowPoints: 0,
      providerSavingsKrw: null,
      providerOverrunKrw: null,
      promoGivebackKrw: 0,
      netPricingBufferDeltaKrw: null,
      actualGrossProfitKrw: 0,
      actualRealizedMargin: null,
      worstCasePromoMargin: null,
      marginFloorViolated: null,
      modelId: opts.model,
      provider: "openrouter",
    },
  };
  return JSON.stringify(usage);
}

function insertMessage(
  db: Database.Database,
  id: number,
  opts: {
    createdAt: string;
    requestId: string;
    model: string;
    modelLabel: string;
    paid?: number;
    free?: number;
    syncKrw?: number;
    refunded?: boolean;
  }
): void {
  db.prepare(
    `INSERT INTO messages
       (id, chat_id, role, content, request_id, usage, deduction_slices, created_at, is_refunded)
     VALUES (?, 1, 'assistant', 'reply', ?, ?, ?, ?, ?)`
  ).run(
    id,
    opts.requestId,
    usageJson(opts),
    slices(opts.paid ?? 0, opts.free ?? 0),
    opts.createdAt,
    opts.refunded ? 1 : 0
  );
}

function insertSettlement(
  db: Database.Database,
  opts: {
    requestId: string;
    assistantMessageId: number;
    createdAt: string;
    paid?: number;
    free?: number;
    outcome?: string;
    refundedAt?: string | null;
  }
): void {
  const settled = (opts.paid ?? 0) + (opts.free ?? 0);
  db.prepare(
    `INSERT INTO chat_billing_settlements
       (user_id, chat_id, request_id, charge_kind, assistant_message_id, requested_points,
        settled_points, outcome, deduction_slices_json, reason, source, created_at, refunded_at)
     VALUES (1, 1, ?, 'chat_turn', ?, ?, ?, ?, ?, '', 'native', ?, ?)`
  ).run(
    opts.requestId,
    opts.assistantMessageId,
    settled,
    settled,
    opts.outcome ?? (settled > 0 ? "charged" : "waived"),
    slices(opts.paid ?? 0, opts.free ?? 0),
    opts.createdAt,
    opts.refundedAt ?? null
  );
}

function mainLedger(
  db: Database.Database,
  opts: {
    messageId: number;
    requestId: string;
    eventTime: string;
    krw: number;
    model: string;
    outcome?: "success" | "failed_with_usage" | "failed_without_usage";
    providerRequestId?: string;
  }
): void {
  recordMainGenerationProviderCost(
    {
      chatId: 1,
      assistantMessageId: opts.messageId,
      generationSequence: 0,
      generationRequestId: opts.requestId,
      provider: "openrouter",
      model: opts.model,
      requestKind: "main-rp",
      inputTokens: opts.outcome === "failed_without_usage" ? 0 : 1000,
      outputTokens: opts.outcome === "failed_without_usage" ? 0 : 200,
      ...(opts.outcome === "failed_without_usage"
        ? {}
        : { upstreamCostUsd: usd(opts.krw) }),
      providerRequestId: opts.providerRequestId ?? opts.requestId,
      exchangeRateKrwPerUsd: FX,
      eventTime: opts.eventTime,
      outcome: opts.outcome ?? "success",
      persistInTests: true,
    },
    db
  );
}

function platformLedger(
  db: Database.Database,
  opts: {
    messageId: number;
    requestId: string;
    eventTime: string;
    krw: number;
    model: string;
    providerRequestId: string;
  }
): void {
  const attempt = startProviderCostAttempt(
    {
      ...buildPlatformAsyncTurnLedgerContext({
        chatId: 1,
        assistantMessageId: opts.messageId,
        generationSequence: 0,
        generationRequestId: opts.requestId,
        family: "status_meta",
        jobAttemptOrdinal: 1,
        requestedModel: opts.model,
      }),
      eventTime: opts.eventTime,
      providerRequestId: opts.providerRequestId,
      persistInTests: true,
    },
    db
  );
  finalizeProviderCostAttempt(
    attempt,
    {
      actualProvider: "openrouter",
      actualModel: opts.model,
      upstreamCostUsd: usd(opts.krw),
      providerRequestId: opts.providerRequestId,
      exchangeRateKrwPerUsd: FX,
      outcome: "success",
    },
    db
  );
}

function observe(db: Database.Database, modelId: string, month = MONTH) {
  const summary = buildAdminFinanceSummary(db, month);
  const actual = composeActualProductionEconomics(modelId, summary);
  const pricing = {
    generatedAt: "2026-10-03T07:29:00.000Z",
    models: [
      {
        modelId,
        actual,
        representative: {
          minimumMarginFloor: 0.5,
          status: "healthy",
          procurementCostFreshness: "ABSENT",
          representativeWorkloadLabel: "fixture",
        },
      },
    ],
  } as unknown as MainRpPricingObservabilityProjection;
  const report = buildFinanceAnomalyReport({ summary, pricing });
  const miss = report.anomalies.find((row) => row.code === "DIRECT_COST_WITHOUT_USER_BILLING");
  return { summary, actual, report, miss };
}

function near(actual: number, expected: number): void {
  assert.ok(
    Math.abs(actual - expected) < 0.05,
    `expected ${expected} KRW, got ${actual}`
  );
}

describe("gemini direct-cost attribution", () => {
  beforeEach(() => installAuditLegacyFxForTest());
  afterEach(() => clearAuditLegacyFxForTest());

  it("merges a billed OpenRouter slug with platform sync cost on the Gemini label", () => {
    const db = financeDb();
    insertMessage(db, 1, {
      createdAt: "2026-10-03 07:00:00",
      requestId: "req-paid",
      model: GEMINI38,
      modelLabel: GEMINI38_LABEL,
      paid: 100,
      syncKrw: 1,
    });
    insertSettlement(db, {
      requestId: "req-paid",
      assistantMessageId: 1,
      createdAt: "2026-10-03 07:00:00",
      paid: 100,
    });
    mainLedger(db, {
      messageId: 1,
      requestId: "req-paid",
      eventTime: "2026-10-03 07:00:00",
      krw: 40,
      model: GEMINI38_SLUG,
    });

    const { summary, actual, miss } = observe(db, GEMINI38);
    assert.equal(miss, undefined);
    near(actual.paidRevenueKrw, 100);
    near(actual.apiCostKrw, 41);
    near(actual.directCostAttribution?.userFundedChargedKrw ?? 0, 40);
    near(actual.directCostAttribution?.platformFundedKrw ?? 0, 1);
    near(actual.directCostAttribution?.userFundedUnlinkedKrw ?? 0, 0);
    near(summary.chat.apiCostKrw, 41);
    assert.equal(
      summary.modelBreakdown.some((row) => row.model === GEMINI38_SLUG),
      false
    );
    db.close();
  });

  it("treats free-point spend as linked billing, not revenue and not a miss", () => {
    const db = financeDb();
    insertMessage(db, 1, {
      createdAt: "2026-10-03 08:00:00",
      requestId: "req-free",
      model: GEMINI38,
      modelLabel: GEMINI38_LABEL,
      free: 80,
    });
    insertSettlement(db, {
      requestId: "req-free",
      assistantMessageId: 1,
      createdAt: "2026-10-03 08:00:00",
      free: 80,
    });
    mainLedger(db, {
      messageId: 1,
      requestId: "req-free",
      eventTime: "2026-10-03 08:00:00",
      krw: 10,
      model: GEMINI38,
    });
    const { actual, miss } = observe(db, GEMINI38);
    assert.equal(miss, undefined);
    near(actual.paidRevenueKrw, 0);
    near(actual.freePointSpend, 80);
    near(actual.apiCostKrw, 10);
    db.close();
  });

  it("keeps platform-only Gemini cost in the loss and out of the billing-miss alarm", () => {
    const db = financeDb();
    insertMessage(db, 1, {
      createdAt: "2026-10-03 09:00:00",
      requestId: "req-other",
      model: GEMINI37,
      modelLabel: GEMINI37_LABEL,
      paid: 70,
    });
    insertSettlement(db, {
      requestId: "req-other",
      assistantMessageId: 1,
      createdAt: "2026-10-03 09:00:00",
      paid: 70,
    });
    mainLedger(db, {
      messageId: 1,
      requestId: "req-other",
      eventTime: "2026-10-03 09:00:00",
      krw: 20,
      model: GEMINI37,
    });
    platformLedger(db, {
      messageId: 1,
      requestId: "req-other",
      eventTime: "2026-10-03 09:00:01",
      krw: 1,
      model: GEMINI38,
      providerRequestId: "req-other-aux",
    });

    const gemini = observe(db, GEMINI38);
    const other = observe(db, GEMINI37);
    assert.equal(gemini.miss, undefined);
    assert.equal(other.miss, undefined);
    near(gemini.actual.paidRevenueKrw, 0);
    near(gemini.actual.freePointSpend, 0);
    near(gemini.actual.apiCostKrw, 1);
    near(gemini.actual.directCostAttribution?.platformFundedKrw ?? 0, 1);
    assert.equal(gemini.actual.netProfitKrw, -1);
    near(other.actual.paidRevenueKrw, 70);
    near(gemini.summary.chat.apiCostKrw, 21);
    near(gemini.summary.totalApiCostKrw, 21);
    db.close();
  });

  it("still alarms when a user-funded Gemini generation has no settlement", () => {
    const db = financeDb();
    insertMessage(db, 1, {
      createdAt: "2026-10-03 10:00:00",
      requestId: "req-miss",
      model: GEMINI38,
      modelLabel: GEMINI38_LABEL,
      syncKrw: 1,
    });
    mainLedger(db, {
      messageId: 1,
      requestId: "req-miss",
      eventTime: "2026-10-03 10:00:00",
      krw: 40,
      model: GEMINI38_SLUG,
    });
    const { actual, miss, summary } = observe(db, GEMINI38);
    assert.equal(miss?.severity, "critical");
    near(actual.paidRevenueKrw, 0);
    near(actual.freePointSpend, 0);
    near(actual.directCostAttribution?.userFundedUnlinkedKrw ?? 0, 40);
    near(actual.directCostAttribution?.platformFundedKrw ?? 0, 1);
    near(actual.apiCostKrw, 41);
    near(summary.chat.apiCostKrw, 41);
    assert.match(miss?.summary ?? "", /40 KRW/);
    db.close();
  });

  it("keeps a failed call with a waived settlement out of the miss alarm", () => {
    const db = financeDb();
    insertMessage(db, 1, {
      createdAt: "2026-10-03 11:00:00",
      requestId: "req-waive",
      model: GEMINI38,
      modelLabel: GEMINI38_LABEL,
    });
    insertSettlement(db, {
      requestId: "req-waive",
      assistantMessageId: 1,
      createdAt: "2026-10-03 11:00:00",
      outcome: "waived",
    });
    mainLedger(db, {
      messageId: 1,
      requestId: "req-waive",
      eventTime: "2026-10-03 11:00:00",
      krw: 8,
      model: GEMINI38,
      outcome: "failed_with_usage",
    });
    const waived = observe(db, GEMINI38);
    assert.equal(waived.miss, undefined);
    near(waived.actual.apiCostKrw, 8);
    near(waived.actual.directCostAttribution?.userFundedWaivedKrw ?? 0, 8);
    near(waived.summary.chat.apiCostKrw, 8);
    db.close();

    const missed = financeDb();
    insertMessage(missed, 1, {
      createdAt: "2026-10-03 11:30:00",
      requestId: "req-failed-open",
      model: GEMINI38,
      modelLabel: GEMINI38_LABEL,
    });
    mainLedger(missed, {
      messageId: 1,
      requestId: "req-failed-open",
      eventTime: "2026-10-03 11:30:00",
      krw: 8,
      model: GEMINI38,
      outcome: "failed_with_usage",
    });
    const open = observe(missed, GEMINI38);
    assert.equal(open.miss?.severity, "critical");
    near(open.actual.directCostAttribution?.userFundedUnlinkedKrw ?? 0, 8);
    missed.close();
  });

  it("does not count a failed call that recorded no usage as provider spend", () => {
    const db = financeDb();
    insertMessage(db, 1, {
      createdAt: "2026-10-03 12:00:00",
      requestId: "req-empty-fail",
      model: GEMINI38,
      modelLabel: GEMINI38_LABEL,
    });
    mainLedger(db, {
      messageId: 1,
      requestId: "req-empty-fail",
      eventTime: "2026-10-03 12:00:00",
      krw: 0,
      model: GEMINI38,
      outcome: "failed_without_usage",
    });
    const { actual, miss, summary } = observe(db, GEMINI38);
    assert.equal(miss, undefined);
    near(actual.apiCostKrw, 0);
    near(summary.chat.apiCostKrw, 0);
    db.close();
  });

  it("keeps refunded provider cost in the loss without calling it a billing miss", () => {
    const db = financeDb();
    insertMessage(db, 1, {
      createdAt: "2026-10-03 13:00:00",
      requestId: "req-refund",
      model: GEMINI38,
      modelLabel: GEMINI38_LABEL,
      paid: 100,
    });
    insertSettlement(db, {
      requestId: "req-refund",
      assistantMessageId: 1,
      createdAt: "2026-10-03 13:00:00",
      paid: 100,
      refundedAt: "2026-10-03 13:05:00",
    });
    mainLedger(db, {
      messageId: 1,
      requestId: "req-refund",
      eventTime: "2026-10-03 13:00:00",
      krw: 15,
      model: GEMINI38,
    });
    const { actual, miss, summary } = observe(db, GEMINI38);
    assert.equal(miss, undefined);
    near(actual.paidRevenueKrw, 0);
    near(actual.apiCostKrw, 15);
    near(actual.directCostAttribution?.userFundedRefundedKrw ?? 0, 15);
    near(summary.chat.apiCostKrw, 15);
    assert.equal(actual.netProfitKrw, -15);
    db.close();
  });

  it("attributes a regeneration to the delivered model of each generation", () => {
    const db = financeDb();
    insertMessage(db, 1, {
      createdAt: "2026-10-02 10:00:00",
      requestId: "req-first",
      model: GEMINI38,
      modelLabel: GEMINI38_LABEL,
      paid: 30,
    });
    insertSettlement(db, {
      requestId: "req-first",
      assistantMessageId: 1,
      createdAt: "2026-10-02 10:00:00",
      paid: 30,
    });
    mainLedger(db, {
      messageId: 1,
      requestId: "req-first",
      eventTime: "2026-10-02 10:00:00",
      krw: 10,
      model: GEMINI38_SLUG,
      providerRequestId: "prov-first",
    });
    db.prepare(
      `UPDATE messages SET request_id = ?, usage = ?, deduction_slices = ? WHERE id = 1`
    ).run(
      "req-second",
      usageJson({ model: GEMINI37, modelLabel: GEMINI37_LABEL }),
      slices(40)
    );
    insertSettlement(db, {
      requestId: "req-second",
      assistantMessageId: 1,
      createdAt: "2026-10-04 10:00:00",
      paid: 40,
    });
    mainLedger(db, {
      messageId: 1,
      requestId: "req-second",
      eventTime: "2026-10-04 10:00:00",
      krw: 12,
      model: GEMINI37,
      providerRequestId: "prov-second",
    });

    const first = observe(db, GEMINI38);
    const second = observe(db, GEMINI37);
    assert.equal(first.miss, undefined);
    assert.equal(second.miss, undefined);
    near(first.actual.paidRevenueKrw, 30);
    near(first.actual.apiCostKrw, 10);
    near(second.actual.paidRevenueKrw, 40);
    near(second.actual.apiCostKrw, 12);
    near(first.summary.chat.paidRevenueKrw, 70);
    near(first.summary.chat.apiCostKrw, 22);
    db.close();
  });

  it("follows the delivered model when it differs from the requested message model", () => {
    const db = financeDb();
    insertMessage(db, 1, {
      createdAt: "2026-10-03 14:00:00",
      requestId: "req-switch",
      model: GEMINI37,
      modelLabel: GEMINI37_LABEL,
      paid: 90,
    });
    insertSettlement(db, {
      requestId: "req-switch",
      assistantMessageId: 1,
      createdAt: "2026-10-03 14:00:00",
      paid: 90,
    });
    mainLedger(db, {
      messageId: 1,
      requestId: "req-switch",
      eventTime: "2026-10-03 14:00:00",
      krw: 25,
      model: GEMINI38_SLUG,
    });
    const delivered = observe(db, GEMINI38);
    const requested = observe(db, GEMINI37);
    assert.equal(delivered.miss, undefined);
    near(delivered.actual.paidRevenueKrw, 90);
    near(delivered.actual.apiCostKrw, 25);
    near(requested.actual.apiCostKrw, 0);
    near(requested.actual.paidRevenueKrw, 0);
    db.close();
  });

  it("does not treat a late settled cost as a miss when the charge is in another month", () => {
    const db = financeDb();
    insertMessage(db, 1, {
      createdAt: "2026-09-28 10:00:00",
      requestId: "req-late",
      model: GEMINI38,
      modelLabel: GEMINI38_LABEL,
      paid: 100,
    });
    insertSettlement(db, {
      requestId: "req-late",
      assistantMessageId: 1,
      createdAt: "2026-09-28 10:00:00",
      paid: 100,
    });
    mainLedger(db, {
      messageId: 1,
      requestId: "req-late",
      eventTime: "2026-10-03 07:29:00",
      krw: 7,
      model: GEMINI38_SLUG,
    });
    const october = observe(db, GEMINI38, "2026-10");
    const september = observe(db, GEMINI38, "2026-09");
    assert.equal(october.miss, undefined);
    near(october.actual.paidRevenueKrw, 0);
    near(october.actual.apiCostKrw, 7);
    near(october.actual.directCostAttribution?.userFundedChargedKrw ?? 0, 7);
    near(october.summary.chat.apiCostKrw, 7);
    assert.equal(september.miss, undefined);
    near(september.actual.paidRevenueKrw, 100);
    near(september.actual.apiCostKrw, 0);
    db.close();
  });

  it("alarms on a sub-1 KRW unlinked user cost without rounding it away", () => {
    const db = financeDb();
    insertMessage(db, 1, {
      createdAt: "2026-10-03 15:00:00",
      requestId: "req-dust",
      model: GEMINI38,
      modelLabel: GEMINI38_LABEL,
    });
    mainLedger(db, {
      messageId: 1,
      requestId: "req-dust",
      eventTime: "2026-10-03 15:00:00",
      krw: 0.4,
      model: GEMINI38,
    });
    const { actual, miss } = observe(db, GEMINI38);
    assert.equal(miss?.severity, "critical");
    near(actual.apiCostKrw, 0.4);
    assert.match(miss?.summary ?? "", /0\.4 KRW/);
    db.close();
  });

  it("counts paid points consumed this month even when they were bought earlier", () => {
    const db = financeDb();
    insertMessage(db, 1, {
      createdAt: "2026-10-03 16:00:00",
      requestId: "req-prior-points",
      model: GEMINI38,
      modelLabel: GEMINI38_LABEL,
      paid: 55,
    });
    insertSettlement(db, {
      requestId: "req-prior-points",
      assistantMessageId: 1,
      createdAt: "2026-10-03 16:00:00",
      paid: 55,
    });
    mainLedger(db, {
      messageId: 1,
      requestId: "req-prior-points",
      eventTime: "2026-10-03 16:00:00",
      krw: 9,
      model: GEMINI38,
    });
    const { actual, miss } = observe(db, GEMINI38);
    assert.equal(miss, undefined);
    near(actual.paidRevenueKrw, 55);
    near(actual.apiCostKrw, 9);
    db.close();
  });
});
