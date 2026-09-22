import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import {
  buildAdminFinanceSummary,
  ensureAdminFinanceTables,
} from "@/lib/adminFinance";
import {
  installAuditLegacyFxForTest,
  clearAuditLegacyFxForTest,
} from "@/lib/billingLiveOwnerReadinessAudit";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
  CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
  MAIN_RP_MODEL_IDS,
} from "@/lib/chatModels";
import { ensureChatBillingSettlementSchema } from "@/lib/chatBillingSettlementSchema";
import { ensureModelPricingTrackingSchema } from "@/lib/modelPricingTrackingSchema";
import { updateCheaperInferenceCatalogPricing } from "@/lib/cheaperInferenceCatalogPricing";
import {
  composeActualProductionEconomics,
  formatActualFreePointSpend,
  resolveSupplementalCostEvidence,
} from "@/lib/mainRpPricingActualEconomics";
import {
  buildMainRpPricingObservabilityProjection,
  readFinanceSummaryForControlPlane,
} from "@/lib/mainRpPricingObservability";
import { getPublishedPricing } from "@/lib/publishedModelPricing";
import {
  ensureProviderCostLedgerSchema,
  recordMainGenerationProviderCost,
} from "@/lib/providerCostLedger";
import type { Usage } from "@/lib/chatUsage";

const MONTH = "2026-09";
const NOW = new Date("2026-09-22T12:00:00.000Z");
const DEEPSEEK_MODEL = CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL;
const DEEPSEEK_LABEL = "DeepSeek V4 Pro";
const GEMINI37_MODEL = CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL;
const GEMINI37_LABEL = "Gemini 3.7 Flash";
const FX = 1560.6;
const usd = (krw: number) => krw / FX;

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
  ensureModelPricingTrackingSchema(db);
  return db;
}

function slices(paid: number, free = 0): string {
  const out: Array<{ transactionId: number; pointType: string; amount: number }> = [];
  if (paid > 0) out.push({ transactionId: 1, pointType: "PAID", amount: paid });
  if (free > 0) out.push({ transactionId: 2, pointType: "FREE", amount: free });
  return JSON.stringify(out);
}

function usageJson(model: string, modelLabel: string, extra?: Partial<Usage>): string {
  return JSON.stringify({
    model,
    modelLabel,
    provider: "cheaperinference",
    input: 1000,
    output: 500,
    cost: 100,
    ...extra,
  });
}

function insertMessage(
  db: Database.Database,
  id: number,
  opts: {
    createdAt: string;
    requestId: string;
    paid?: number;
    free?: number;
    model?: string;
    modelLabel?: string;
    usageExtra?: Partial<Usage>;
  }
): void {
  db.prepare(
    `INSERT INTO messages (id, chat_id, role, content, request_id, usage, deduction_slices, created_at, is_refunded)
     VALUES (?, 1, 'assistant', 'reply', ?, ?, ?, ?, 0)`
  ).run(
    id,
    opts.requestId,
    usageJson(opts.model ?? DEEPSEEK_MODEL, opts.modelLabel ?? DEEPSEEK_LABEL, opts.usageExtra),
    slices(opts.paid ?? 0, opts.free ?? 0),
    opts.createdAt
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
    refundedAt?: string | null;
  }
): void {
  const settled = (opts.paid ?? 0) + (opts.free ?? 0);
  db.prepare(
    `INSERT INTO chat_billing_settlements
       (user_id, chat_id, request_id, charge_kind, assistant_message_id, requested_points, settled_points,
        outcome, deduction_slices_json, reason, source, created_at, refunded_at)
     VALUES (1, 1, ?, 'chat_turn', ?, ?, ?, 'charged', ?, '', 'native', ?, ?)`
  ).run(
    opts.requestId,
    opts.assistantMessageId,
    settled,
    settled,
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
    model?: string;
    providerRequestId?: string;
  }
): void {
  recordMainGenerationProviderCost(
    {
      chatId: 1,
      assistantMessageId: opts.messageId,
      generationSequence: 0,
      generationRequestId: opts.requestId,
      provider: "cheaperinference",
      model: opts.model ?? DEEPSEEK_MODEL,
      requestKind: "main-rp",
      inputTokens: 1000,
      outputTokens: 500,
      cheaperInferenceBilledCostUsd: usd(opts.krw),
      providerRequestId: opts.providerRequestId ?? opts.requestId,
      exchangeRateKrwPerUsd: FX,
      eventTime: opts.eventTime,
      outcome: "success",
      persistInTests: true,
    },
    db
  );
}

function deepseekRow(db: Database.Database) {
  const projection = buildMainRpPricingObservabilityProjection({ db, now: NOW });
  return projection.models.find((row) => row.modelId === DEEPSEEK_MODEL)!;
}

describe("mainRpPricingObservability B2B actual production economics", () => {
  beforeEach(() => installAuditLegacyFxForTest());
  afterEach(() => clearAuditLegacyFxForTest());

  it("A — exact: paid 100 / exact cost 60 → actual margin 40%", () => {
    const db = financeDb();
    insertMessage(db, 1, {
      createdAt: "2026-09-10 10:00:00",
      requestId: "req-exact",
      paid: 0,
    });
    insertSettlement(db, {
      requestId: "req-exact",
      assistantMessageId: 1,
      createdAt: "2026-09-10 10:00:00",
      paid: 100,
    });
    mainLedger(db, {
      messageId: 1,
      requestId: "req-exact",
      eventTime: "2026-09-10 10:00:00",
      krw: 60,
    });
    const summary = buildAdminFinanceSummary(db, MONTH);
    const actual = composeActualProductionEconomics(DEEPSEEK_MODEL, summary);
    assert.equal(actual.paidRevenueKrw, 100);
    assert.equal(actual.apiCostKrw, 60);
    assert.equal(actual.realizedMarginExact, true);
    assert.equal(actual.marginRate, 0.4);
    assert.match(actual.marginDisplay, /40\.0%/);
    const row = deepseekRow(db);
    assert.equal(row.actual.marginRate, 0.4);
    assert.equal(row.actual.apiCostKrw, 60);
    assert.equal(row.actual.costEvidence.actualKrw, 60);
    assert.equal(row.actual.apiCostKrw, row.actual.costEvidence.actualKrw);
  });

  it("B — estimated cost blocks exact actual margin display", () => {
    const db = financeDb();
    insertMessage(db, 2, {
      createdAt: "2026-09-11 10:00:00",
      requestId: "req-est",
      paid: 100,
      usageExtra: {
        mainApiRawCostKrw: 60,
        apiRawCostKrw: 60,
        shadowPricing: {
          actualCostSource: "live_catalog_estimated",
          actualTurnCostCoverage: "partial",
          actualProviderCostKrw: 60,
          actualCostUsd: usd(60),
          provider: "cheaperinference",
          modelId: DEEPSEEK_MODEL,
          fxSnapshot: { effectiveKrwPerUsd: FX },
        },
      } as Partial<Usage>,
    });
    const summary = buildAdminFinanceSummary(db, MONTH);
    const actual = composeActualProductionEconomics(DEEPSEEK_MODEL, summary);
    assert.equal(actual.paidRevenueKrw, 100);
    assert.equal(actual.realizedMarginExact, false);
    assert.equal(actual.marginRate, null);
    assert.match(actual.marginDisplay, /unavailable/i);
    assert.doesNotMatch(actual.marginDisplay, /margin \d/);
  });

  it("C — free-only: paid 0 / free > 0 → margin null", () => {
    const db = financeDb();
    insertMessage(db, 3, {
      createdAt: "2026-09-12 10:00:00",
      requestId: "req-free",
      free: 80,
    });
    insertSettlement(db, {
      requestId: "req-free",
      assistantMessageId: 3,
      createdAt: "2026-09-12 10:00:00",
      free: 80,
    });
    const summary = buildAdminFinanceSummary(db, MONTH);
    const actual = composeActualProductionEconomics(DEEPSEEK_MODEL, summary);
    assert.equal(actual.paidRevenueKrw, 0);
    assert.equal(actual.freePointSpend, 80);
    assert.equal(actual.marginRate, null);
    assert.match(actual.marginDisplay, /free-only/i);
  });

  it("D — refunded charge excluded from actual revenue/margin", () => {
    const db = financeDb();
    insertMessage(db, 4, {
      createdAt: "2026-09-13 10:00:00",
      requestId: "req-refund",
      paid: 0,
    });
    insertSettlement(db, {
      requestId: "req-refund",
      assistantMessageId: 4,
      createdAt: "2026-09-13 10:00:00",
      paid: 100,
      refundedAt: "2026-09-13 11:00:00",
    });
    mainLedger(db, {
      messageId: 4,
      requestId: "req-refund",
      eventTime: "2026-09-13 10:00:00",
      krw: 60,
    });
    const summary = buildAdminFinanceSummary(db, MONTH);
    const breakdown = summary.modelBreakdown.find((row) => row.model === DEEPSEEK_LABEL);
    assert.equal(breakdown?.paidRevenueKrw ?? 0, 0);
    const actual = composeActualProductionEconomics(DEEPSEEK_MODEL, summary);
    assert.equal(actual.paidRevenueKrw, 0);
    assert.equal(actual.marginRate, null);
  });

  it("E — duplicate provider request does not double-count cost", () => {
    const db = financeDb();
    insertMessage(db, 5, {
      createdAt: "2026-09-14 10:00:00",
      requestId: "req-dup",
      paid: 100,
    });
    insertSettlement(db, {
      requestId: "req-dup",
      assistantMessageId: 5,
      createdAt: "2026-09-14 10:00:00",
      paid: 100,
    });
    const providerRequestId = "ci-req-once";
    mainLedger(db, {
      messageId: 5,
      requestId: "req-dup",
      eventTime: "2026-09-14 10:00:00",
      krw: 60,
      providerRequestId,
    });
    mainLedger(db, {
      messageId: 5,
      requestId: "req-dup",
      eventTime: "2026-09-14 10:00:01",
      krw: 60,
      providerRequestId,
    });
    const summary = buildAdminFinanceSummary(db, MONTH);
    const actual = composeActualProductionEconomics(DEEPSEEK_MODEL, summary);
    assert.equal(actual.apiCostKrw, 60);
    assert.equal(summary.totalApiCostKrw, 60);
  });

  it("F — settled ledger cost (83) is canonical over local estimate path", () => {
    const db = financeDb();
    insertMessage(db, 6, {
      createdAt: "2026-09-15 10:00:00",
      requestId: "req-settled",
      paid: 100,
      usageExtra: {
        mainApiRawCostKrw: 90,
        apiRawCostKrw: 90,
        shadowPricing: {
          actualCostSource: "live_catalog_estimated",
          actualTurnCostCoverage: "partial",
          actualProviderCostKrw: 90,
          actualCostUsd: usd(90),
          provider: "cheaperinference",
          modelId: DEEPSEEK_MODEL,
          fxSnapshot: { effectiveKrwPerUsd: FX },
        },
      } as Partial<Usage>,
    });
    insertSettlement(db, {
      requestId: "req-settled",
      assistantMessageId: 6,
      createdAt: "2026-09-15 10:00:00",
      paid: 100,
    });
    mainLedger(db, {
      messageId: 6,
      requestId: "req-settled",
      eventTime: "2026-09-15 10:00:00",
      krw: 83,
    });
    const summary = buildAdminFinanceSummary(db, MONTH);
    const actual = composeActualProductionEconomics(DEEPSEEK_MODEL, summary);
    assert.equal(actual.apiCostKrw, 83);
    assert.equal(actual.costEvidence.actualKrw, 83);
  });

  it("G — regeneration keeps immutable generation model attribution", () => {
    const db = financeDb();
    insertMessage(db, 7, {
      createdAt: "2026-09-16 10:00:00",
      requestId: "req-gen-a",
      paid: 0,
      model: DEEPSEEK_MODEL,
      modelLabel: DEEPSEEK_LABEL,
    });
    insertSettlement(db, {
      requestId: "req-gen-a",
      assistantMessageId: 7,
      createdAt: "2026-09-16 10:00:00",
      paid: 100,
    });
    mainLedger(db, {
      messageId: 7,
      requestId: "req-gen-a",
      eventTime: "2026-09-16 10:00:00",
      krw: 40,
      model: DEEPSEEK_MODEL,
    });
    db.prepare(
      `UPDATE messages SET request_id = ?, usage = ?, deduction_slices = ? WHERE id = 7`
    ).run(
      "req-gen-b",
      usageJson(GEMINI37_MODEL, GEMINI37_LABEL),
      slices(200)
    );
    insertSettlement(db, {
      requestId: "req-gen-b",
      assistantMessageId: 7,
      createdAt: "2026-09-17 10:00:00",
      paid: 200,
    });
    mainLedger(db, {
      messageId: 7,
      requestId: "req-gen-b",
      eventTime: "2026-09-17 10:00:00",
      krw: 80,
      model: GEMINI37_MODEL,
    });
    const summary = buildAdminFinanceSummary(db, MONTH);
    const deepseek = composeActualProductionEconomics(DEEPSEEK_MODEL, summary);
    const gemini = composeActualProductionEconomics(GEMINI37_MODEL, summary);
    assert.equal(deepseek.paidRevenueKrw, 100);
    assert.equal(deepseek.apiCostKrw, 40);
    assert.equal(gemini.paidRevenueKrw, 200);
    assert.equal(gemini.apiCostKrw, 80);
  });

  it("H — provider-delivered generation model owns finance attribution", () => {
    const db = financeDb();
    insertMessage(db, 8, {
      createdAt: "2026-09-18 10:00:00",
      requestId: "req-fallback",
      paid: 0,
      model: GEMINI37_MODEL,
      modelLabel: GEMINI37_LABEL,
    });
    insertSettlement(db, {
      requestId: "req-fallback",
      assistantMessageId: 8,
      createdAt: "2026-09-18 10:00:00",
      paid: 150,
    });
    mainLedger(db, {
      messageId: 8,
      requestId: "req-fallback",
      eventTime: "2026-09-18 10:00:00",
      krw: 70,
      model: DEEPSEEK_MODEL,
    });
    const summary = buildAdminFinanceSummary(db, MONTH);
    const gemini = composeActualProductionEconomics(GEMINI37_MODEL, summary);
    const deepseek = composeActualProductionEconomics(DEEPSEEK_MODEL, summary);
    assert.equal(deepseek.paidRevenueKrw, 150);
    assert.equal(deepseek.apiCostKrw, 70);
    assert.equal(gemini.paidRevenueKrw, 0);
    assert.equal(gemini.apiCostKrw, 0);
  });

  it("I — zero-use model row exists with NO_USAGE", () => {
    const db = financeDb();
    insertMessage(db, 9, {
      createdAt: "2026-09-19 10:00:00",
      requestId: "req-other",
      paid: 100,
      model: DEEPSEEK_MODEL,
      modelLabel: DEEPSEEK_LABEL,
    });
    insertSettlement(db, {
      requestId: "req-other",
      assistantMessageId: 9,
      createdAt: "2026-09-19 10:00:00",
      paid: 100,
    });
    mainLedger(db, {
      messageId: 9,
      requestId: "req-other",
      eventTime: "2026-09-19 10:00:00",
      krw: 50,
    });
    const projection = buildMainRpPricingObservabilityProjection({ db, now: NOW });
    assert.equal(projection.models.length, MAIN_RP_MODEL_IDS.length);
    const terra = projection.models.find(
      (row) => row.modelId === CHEAPER_INFERENCE_GPT_56_TERRA_MODEL
    )!;
    assert.equal(terra.actual.usageState, "NO_USAGE");
    assert.equal(terra.actual.marginDisplay, "NO_USAGE");
    assert.equal(terra.actual.marginRate, null);
  });

  it("J — representative estimate and actual monthly margin stay separate", () => {
    updateCheaperInferenceCatalogPricing({
      modelId: DEEPSEEK_MODEL,
      inputUsdPerMillion: 0.66,
      outputUsdPerMillion: 1.98,
      cacheReadUsdPerMillion: 0.066,
      cacheWriteUsdPerMillion: 0.66,
      fetchedAt: Date.now(),
    });
    const db = financeDb();
    insertMessage(db, 10, {
      createdAt: "2026-09-20 10:00:00",
      requestId: "req-split",
      paid: 100,
    });
    insertSettlement(db, {
      requestId: "req-split",
      assistantMessageId: 10,
      createdAt: "2026-09-20 10:00:00",
      paid: 100,
    });
    mainLedger(db, {
      messageId: 10,
      requestId: "req-split",
      eventTime: "2026-09-20 10:00:00",
      krw: 60,
    });
    const row = deepseekRow(db);
    assert.equal(row.representative.domain, "REPRESENTATIVE");
    assert.equal(row.actual.domain, "ACTUAL_PRODUCTION");
    assert.equal(row.actual.marginRate, 0.4);
    assert.equal(row.actual.realizedMarginExact, true);
    assert.ok(row.representative.representativeMarginEstimate != null);
    assert.notEqual(row.representative.representativeMarginRevenueUnit, "published_krw");
  });

  it("K — projection build does not mutate pricing, billing, or ledger rows", () => {
    const db = financeDb();
    insertMessage(db, 11, {
      createdAt: "2026-09-21 10:00:00",
      requestId: "req-no-mut",
      paid: 100,
    });
    insertSettlement(db, {
      requestId: "req-no-mut",
      assistantMessageId: 11,
      createdAt: "2026-09-21 10:00:00",
      paid: 100,
    });
    mainLedger(db, {
      messageId: 11,
      requestId: "req-no-mut",
      eventTime: "2026-09-21 10:00:00",
      krw: 55,
    });
    const pricingBefore = new Map(
      MAIN_RP_MODEL_IDS.map((modelId) => [modelId, getPublishedPricing(modelId).pricingVersion])
    );
    const settlementsBefore = (
      db.prepare("SELECT COUNT(*) AS c FROM chat_billing_settlements").get() as { c: number }
    ).c;
    const ledgerBefore = (
      db.prepare("SELECT COUNT(*) AS c FROM api_cost_ledger").get() as { c: number }
    ).c;
    const financeBefore = buildAdminFinanceSummary(db, MONTH);
    buildMainRpPricingObservabilityProjection({ db, now: NOW });
    const financeAfter = buildAdminFinanceSummary(db, MONTH);
    assert.equal(
      (
        db.prepare("SELECT COUNT(*) AS c FROM chat_billing_settlements").get() as { c: number }
      ).c,
      settlementsBefore
    );
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS c FROM api_cost_ledger").get() as { c: number }).c,
      ledgerBefore
    );
    assert.deepEqual(
      financeBefore.modelBreakdown.map((row) => row.paidRevenueKrw),
      financeAfter.modelBreakdown.map((row) => row.paidRevenueKrw)
    );
    for (const modelId of MAIN_RP_MODEL_IDS) {
      assert.equal(getPublishedPricing(modelId).pricingVersion, pricingBefore.get(modelId));
    }
  });

  it("freePointSpend renders as points (P), not KRW", () => {
    assert.equal(formatActualFreePointSpend(80), "80P");
    assert.doesNotMatch(formatActualFreePointSpend(80), /KRW/i);
    const db = financeDb();
    insertMessage(db, 13, {
      createdAt: "2026-09-22 10:00:00",
      requestId: "req-free-unit",
      free: 80,
    });
    insertSettlement(db, {
      requestId: "req-free-unit",
      assistantMessageId: 13,
      createdAt: "2026-09-22 10:00:00",
      free: 80,
    });
    const actual = composeActualProductionEconomics(
      DEEPSEEK_MODEL,
      buildAdminFinanceSummary(db, MONTH)
    );
    assert.equal(actual.freePointSpend, 80);
    assert.equal(formatActualFreePointSpend(actual.freePointSpend), "80P");
  });

  it("legacy usage-fallback cost omits contradictory zero ledger split", () => {
    const db = financeDb();
    insertMessage(db, 14, {
      createdAt: "2026-09-22 11:00:00",
      requestId: "req-legacy-fallback",
      paid: 100,
      usageExtra: {
        mainApiRawCostKrw: 60,
        apiRawCostKrw: 60,
        shadowPricing: {
          actualCostSource: "cheaper_inference_billed",
          actualTurnCostCoverage: "complete",
          actualProviderCostKrw: 60,
          actualCostUsd: usd(60),
          provider: "cheaperinference",
          modelId: DEEPSEEK_MODEL,
          fxSnapshot: { effectiveKrwPerUsd: FX },
        },
      } as Partial<Usage>,
    });
    const summary = buildAdminFinanceSummary(db, MONTH);
    const actual = composeActualProductionEconomics(DEEPSEEK_MODEL, summary);
    const ai = summary.aiModelCosts.find((row) => row.model === DEEPSEEK_LABEL)!;
    assert.equal(actual.apiCostKrw, 60);
    assert.equal(ai.actualKrw, 0);
    assert.equal(ai.estimatedKrw, 0);
    assert.equal(actual.costEvidence.sourceState, null);
    assert.equal(actual.costEvidence.actualKrw, null);
    assert.equal(actual.costEvidence.estimatedKrw, null);
    assert.deepEqual(
      resolveSupplementalCostEvidence(ai, actual.apiCostKrw),
      actual.costEvidence
    );
  });

  it("finance prerequisite absent → FINANCE_UNAVAILABLE without throwing", () => {
    const db = new Database(":memory:");
    ensureModelPricingTrackingSchema(db);
    assert.equal(readFinanceSummaryForControlPlane(db, NOW), null);
    const row = buildMainRpPricingObservabilityProjection({ db, now: NOW }).models[0];
    assert.equal(row.actual.usageState, "FINANCE_UNAVAILABLE");
  });

  it("finance path present but broken schema → error is not swallowed", () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE messages (id INTEGER PRIMARY KEY)");
    assert.throws(() => readFinanceSummaryForControlPlane(db, NOW), /no such column/i);
  });

  it("does not double-count apiCostKrw with aiModelCosts actualKrw", () => {
    const db = financeDb();
    insertMessage(db, 12, {
      createdAt: "2026-09-21 12:00:00",
      requestId: "req-nodbl",
      paid: 0,
    });
    insertSettlement(db, {
      requestId: "req-nodbl",
      assistantMessageId: 12,
      createdAt: "2026-09-21 12:00:00",
      paid: 100,
    });
    mainLedger(db, {
      messageId: 12,
      requestId: "req-nodbl",
      eventTime: "2026-09-21 12:00:00",
      krw: 60,
    });
    const summary = buildAdminFinanceSummary(db, MONTH);
    const actual = composeActualProductionEconomics(DEEPSEEK_MODEL, summary);
    const ai = summary.aiModelCosts.find((row) => row.model === DEEPSEEK_LABEL)!;
    assert.equal(actual.apiCostKrw, 60);
    assert.equal(ai.actualKrw, 60);
    assert.notEqual(actual.apiCostKrw, ai.actualKrw + actual.apiCostKrw);
  });
});
