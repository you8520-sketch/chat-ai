import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { describe, it, beforeEach, afterEach } from "node:test";
import {
  buildAdminFinanceSummary,
  ensureAdminFinanceTables,
} from "@/lib/adminFinance";
import {
  resolveMessageTurnProviderCostKrw,
  resolveReceiptV3ExactProviderSpendKrw,
} from "@/lib/adminFinanceTurnCost";
import {
  auditAdminFinanceCostScope,
  adminFinanceRealizedMarginReady,
  evaluateAdminFinanceCostScopeFromFixtures,
} from "@/lib/adminFinanceCostScopeAudit";
import {
  ensureProviderCostLedgerSchema,
  finalizeProviderCostAttempt,
  startProviderCostAttempt,
  buildPlatformAsyncTurnLedgerContext,
  buildPlatformSyncTurnLedgerContext,
} from "@/lib/providerCostLedger";
import type { Usage } from "@/lib/chatUsage";
import {
  installAuditLegacyFxForTest,
  clearAuditLegacyFxForTest,
} from "@/lib/billingLiveOwnerReadinessAudit";

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

function syncExtractUsage(krw: number, postTurnSharedInitial = false): Partial<Usage> {
  const usd = usdForKrw(krw);
  return {
    mainApiRawCostKrw: 40,
    apiRawCostKrw: 40 + krw,
    statusWidgetExtract: {
      model: "deepseek-v4-flash",
      modelLabel: "DeepSeek V4 Flash (상태창 추출)",
      input: 100,
      output: 50,
      apiRawCostKrw: krw,
      callCount: 1,
      actualProviderCostUsd: usd,
      actualProviderCostKrw: krw,
      actualCostSource: "cheaper_inference_billed",
      actualCostCoverage: "complete",
      ...(postTurnSharedInitial ? { postTurnSharedInitial: true } : {}),
    },
  };
}

function createFinanceDb(): Database.Database {
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
      payout_amount REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'PENDING',
      processed_at TEXT
    );
    CREATE TABLE portone_checkouts (
      id INTEGER PRIMARY KEY,
      amount REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      paid_at TEXT
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
  ).run(
    id,
    JSON.stringify(usage),
    JSON.stringify(slices),
    opts.refunded ? 1 : 0
  );
}

function ledgerRow(
  db: Database.Database,
  assistantMessageId: number,
  family:
    | "suggested_replies_repair"
    | "status_meta"
    | "memory_relationship"
    | "post_turn_shared_initial"
    | "status_widget_extract",
  phase: "async_post_turn" | "sync_post_turn",
  krw: number
) {
  const usd = usdForKrw(krw);
  const ctx =
    phase === "async_post_turn"
      ? {
          ...buildPlatformAsyncTurnLedgerContext({
            chatId: 1,
            assistantMessageId,
            generationSequence: 0,
            family,
            jobAttemptOrdinal: 1,
          }),
          persistInTests: true,
        }
      : {
          ...buildPlatformSyncTurnLedgerContext({
            chatId: 1,
            assistantMessageId,
            family,
          }),
          persistInTests: true,
        };
  const attempt = startProviderCostAttempt(ctx, db);
  finalizeProviderCostAttempt(
    attempt,
    {
      actualProvider: "cheaperinference",
      actualModel: "deepseek-v4-flash",
      cheaperInferenceBilledCostUsd: usd,
      outcome: "success",
    },
    db
  );
}

function ledgerRowIncomplete(
  db: Database.Database,
  assistantMessageId: number,
  family: "suggested_replies_repair" | "status_meta" | "memory_relationship"
) {
  const ctx = {
    ...buildPlatformAsyncTurnLedgerContext({
      chatId: 1,
      assistantMessageId,
      generationSequence: 0,
      family,
      jobAttemptOrdinal: 1,
    }),
    persistInTests: true,
  };
  const attempt = startProviderCostAttempt(ctx, db);
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
}

describe("adminFinanceTurnCost — exactness fail-closed (F8–F11)", () => {
  beforeEach(() => installAuditLegacyFxForTest());
  afterEach(() => clearAuditLegacyFxForTest());

  it("F8 — async incomplete only: known 40, coverage partial, margin not exact", () => {
    const db = createFinanceDb();
    insertAssistant(db, 8, mainUsage(), [{ pointType: "PAID", amount: 100 }]);
    ledgerRowIncomplete(db, 8, "status_meta");
    const summary = buildAdminFinanceSummary(db);
    const ledgerRows = db
      .prepare("SELECT * FROM api_cost_ledger WHERE assistant_message_id=8")
      .all() as Parameters<typeof resolveMessageTurnProviderCostKrw>[1];
    const turn = resolveMessageTurnProviderCostKrw(mainUsage(), ledgerRows);
    assert.equal(turn.knownApiCostKrw, 40);
    assert.notEqual(turn.coverage, "complete");
    assert.equal(turn.realizedMarginExact, false);
    assert.equal(turn.hasIncompleteProviderCost, true);
    assert.equal(turn.exactApiCostKrw, null);
    assert.equal(summary.chat.apiCostKrw, 40);
    assert.equal(summary.chat.realizedMarginExact, false);
    assert.equal(summary.chat.marginRate, null);
    assert.equal(summary.chat.netProfitKrw, null);
  });

  it("F9 — mixed async exact + incomplete: known 43, whole-turn exact null", () => {
    const db = createFinanceDb();
    insertAssistant(db, 9, mainUsage(), [{ pointType: "PAID", amount: 100 }]);
    ledgerRow(db, 9, "suggested_replies_repair", "async_post_turn", 3);
    ledgerRowIncomplete(db, 9, "status_meta");
    const ledgerRows = db
      .prepare("SELECT * FROM api_cost_ledger WHERE assistant_message_id=9")
      .all() as Parameters<typeof resolveMessageTurnProviderCostKrw>[1];
    const turn = resolveMessageTurnProviderCostKrw(mainUsage(), ledgerRows);
    assert.equal(turn.knownApiCostKrw, 43);
    assert.equal(turn.exactApiCostKrw, null);
    assert.equal(turn.realizedMarginExact, false);
    assert.equal(resolveReceiptV3ExactProviderSpendKrw(mainUsage(), ledgerRows), null);
    const summary = buildAdminFinanceSummary(db);
    assert.equal(summary.chat.apiCostKrw, 43);
    assert.equal(summary.realizedMarginExact, false);
  });

  it("F10 — main estimated fallback is not exact realized margin", () => {
    const estimatedUsage = mainUsage({
      shadowPricing: {
        ...mainUsage().shadowPricing!,
        actualCostSource: "live_catalog_estimated",
        actualTurnCostCoverage: "partial",
      },
      mainApiRawCostKrw: 55,
      apiRawCostKrw: 55,
    });
    const turn = resolveMessageTurnProviderCostKrw(estimatedUsage, []);
    assert.equal(turn.knownApiCostKrw, 55);
    assert.notEqual(turn.coverage, "complete");
    assert.equal(turn.realizedMarginExact, false);
    assert.equal(turn.hasEstimatedProviderCost, true);
    const db = createFinanceDb();
    insertAssistant(db, 10, estimatedUsage, [{ pointType: "PAID", amount: 100 }]);
    const summary = buildAdminFinanceSummary(db);
    assert.equal(summary.chat.apiCostKrw, 55);
    assert.equal(summary.chat.realizedMarginExact, false);
    assert.equal(summary.chat.marginRate, null);
  });

  it("F11 — all exact like F4: coverage complete, realized margin exact", () => {
    const db = createFinanceDb();
    insertAssistant(
      db,
      11,
      mainUsage(syncExtractUsage(5, true)),
      [{ pointType: "PAID", amount: 100 }]
    );
    ledgerRow(db, 11, "suggested_replies_repair", "async_post_turn", 3);
    ledgerRow(db, 11, "status_meta", "async_post_turn", 2);
    ledgerRow(db, 11, "memory_relationship", "async_post_turn", 4);
    const ledgerRows = db
      .prepare("SELECT * FROM api_cost_ledger WHERE assistant_message_id=11")
      .all() as Parameters<typeof resolveMessageTurnProviderCostKrw>[1];
    const turn = resolveMessageTurnProviderCostKrw(
      mainUsage(syncExtractUsage(5, true)),
      ledgerRows
    );
    assert.equal(turn.coverage, "complete");
    assert.equal(turn.realizedMarginExact, true);
    assert.equal(turn.exactApiCostKrw, 54);
    assert.equal(turn.knownApiCostKrw, 54);
    const summary = buildAdminFinanceSummary(db);
    assert.equal(summary.chat.realizedMarginExact, true);
    assert.equal(summary.chat.marginRate, 0.46);
    assert.equal(adminFinanceRealizedMarginReady(), "YES");
  });
});

describe("adminFinanceTurnCost — whole-turn provider cost (F1–F7)", () => {
  beforeEach(() => installAuditLegacyFxForTest());
  afterEach(() => clearAuditLegacyFxForTest());
  it("F1 — main only: revenue 100, API cost 40", () => {
    const db = createFinanceDb();
    insertAssistant(db, 1, mainUsage(), [{ pointType: "PAID", amount: 100 }]);
    const summary = buildAdminFinanceSummary(db);
    assert.equal(summary.chat.paidRevenueKrw, 100);
    assert.equal(summary.chat.apiCostKrw, 40);
  });

  it("F2 — main + sync: API cost 45", () => {
    const db = createFinanceDb();
    insertAssistant(
      db,
      2,
      mainUsage(syncExtractUsage(5)),
      [{ pointType: "PAID", amount: 100 }]
    );
    const summary = buildAdminFinanceSummary(db);
    assert.equal(summary.chat.apiCostKrw, 45);
  });

  it("F3 — main + async: API cost 49", () => {
    const db = createFinanceDb();
    insertAssistant(db, 3, mainUsage(), [{ pointType: "PAID", amount: 100 }]);
    ledgerRow(db, 3, "suggested_replies_repair", "async_post_turn", 3);
    ledgerRow(db, 3, "status_meta", "async_post_turn", 2);
    ledgerRow(db, 3, "memory_relationship", "async_post_turn", 4);
    const summary = buildAdminFinanceSummary(db);
    assert.equal(summary.chat.apiCostKrw, 49);
  });

  it("F4 — main + sync + async: each family counted once", () => {
    const db = createFinanceDb();
    insertAssistant(
      db,
      4,
      mainUsage(syncExtractUsage(5, true)),
      [{ pointType: "PAID", amount: 100 }]
    );
    ledgerRow(db, 4, "suggested_replies_repair", "async_post_turn", 3);
    ledgerRow(db, 4, "status_meta", "async_post_turn", 2);
    ledgerRow(db, 4, "memory_relationship", "async_post_turn", 4);
    const summary = buildAdminFinanceSummary(db);
    assert.equal(summary.chat.apiCostKrw, 54);
    const usage = mainUsage(syncExtractUsage(5, true));
    const ledgerRows = db
      .prepare("SELECT * FROM api_cost_ledger WHERE assistant_message_id=4")
      .all() as Parameters<typeof resolveMessageTurnProviderCostKrw>[1];
    const breakdown = resolveMessageTurnProviderCostKrw(usage, ledgerRows);
    assert.equal(breakdown.mainGenerationKrw, 40);
    assert.equal(breakdown.syncPostTurnKrw, 5);
    assert.equal(breakdown.asyncPostTurnKrw, 9);
    assert.equal(breakdown.familyKrw.post_turn_shared_initial, 5);
  });

  it("F5 — status_widget_extract not double-counted (usage wins over sync ledger)", () => {
    const db = createFinanceDb();
    insertAssistant(
      db,
      5,
      mainUsage(syncExtractUsage(5)),
      [{ pointType: "PAID", amount: 100 }]
    );
    ledgerRow(db, 5, "status_widget_extract", "sync_post_turn", 5);
    const summary = buildAdminFinanceSummary(db);
    assert.equal(summary.chat.apiCostKrw, 45);
    const ledgerRows = db
      .prepare("SELECT * FROM api_cost_ledger WHERE assistant_message_id=5")
      .all() as Parameters<typeof resolveMessageTurnProviderCostKrw>[1];
    const cost = resolveMessageTurnProviderCostKrw(
      mainUsage(syncExtractUsage(5)),
      ledgerRows
    );
    assert.equal(cost.statusWidgetExtractFinanceSource, "usage");
    assert.equal(cost.syncPostTurnKrw, 5);
    assert.equal(cost.totalEligibleKrw, 45);
  });

  it("F6 — free points: provider cost included, paid revenue excluded", () => {
    const db = createFinanceDb();
    insertAssistant(db, 6, mainUsage(), [{ pointType: "FREE", amount: 100 }]);
    const summary = buildAdminFinanceSummary(db);
    assert.equal(summary.chat.paidRevenueKrw, 0);
    assert.equal(summary.chat.freePointSpend, 100);
    assert.equal(summary.chat.apiCostKrw, 40);
  });

  it("F7 — refunded assistant excluded from Finance", () => {
    const db = createFinanceDb();
    insertAssistant(
      db,
      7,
      mainUsage(),
      [{ pointType: "PAID", amount: 100 }],
      { refunded: true }
    );
    const summary = buildAdminFinanceSummary(db);
    assert.equal(summary.chat.paidRevenueKrw, 0);
    assert.equal(summary.chat.apiCostKrw, 0);
  });

  it("Receipt V3 exact scope aligns with Finance included provider costs", () => {
    const usage = mainUsage(syncExtractUsage(5));
    const db = createFinanceDb();
    ledgerRow(db, 99, "suggested_replies_repair", "async_post_turn", 3);
    ledgerRow(db, 99, "status_meta", "async_post_turn", 2);
    ledgerRow(db, 99, "memory_relationship", "async_post_turn", 4);
    const ledgerRows = db
      .prepare("SELECT * FROM api_cost_ledger WHERE assistant_message_id=99")
      .all() as Parameters<typeof resolveMessageTurnProviderCostKrw>[1];
    const financeKrw = resolveMessageTurnProviderCostKrw(usage, ledgerRows).totalEligibleKrw;
    const receiptKrw = resolveReceiptV3ExactProviderSpendKrw(usage, ledgerRows);
    assert.equal(financeKrw, 54);
    assert.equal(receiptKrw, 54);
    assert.ok(Math.abs(financeKrw - (receiptKrw ?? 0)) < 0.05);
  });
});

describe("adminFinanceCostScopeAudit — computed gates", () => {
  it("fixture audit reports realized margin ready with zero missing/double-count families", () => {
    const evaluated = evaluateAdminFinanceCostScopeFromFixtures();
    assert.equal(evaluated.MAIN_GENERATION_INCLUDED, true);
    assert.equal(evaluated.SYNC_POST_TURN_INCLUDED, true);
    assert.equal(evaluated.ASYNC_POST_TURN_INCLUDED, true);
    assert.equal(evaluated.ADMIN_FINANCE_MISSING_COST_FAMILIES.length, 0);
    assert.equal(evaluated.ADMIN_FINANCE_DOUBLE_COUNTED_COST_FAMILIES.length, 0);
    assert.equal(evaluated.STATUS_WIDGET_EXTRACT_DOUBLE_COUNT, false);
    assert.equal(evaluated.ADMIN_FINANCE_RECOMPUTES_USER_PRICE, false);
    assert.equal(evaluated.TARGET_MARGIN_USED_AS_REALIZED_MARGIN, false);
    assert.equal(adminFinanceRealizedMarginReady(evaluated), "YES");
  });

  it("static audit entry delegates to fixture evaluation", () => {
    const audit = auditAdminFinanceCostScope();
    assert.equal(audit.ADMIN_FINANCE_REALIZED_MARGIN_READY, "YES");
    assert.match(audit.ADMIN_FINANCE_COST_OWNER, /knownApiCostKrw \+ coverage/);
  });
});
