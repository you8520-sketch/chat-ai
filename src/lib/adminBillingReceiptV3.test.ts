import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, it } from "node:test";
import {
  buildAdminBillingReceiptV3,
  projectWholeTurnExactKrw,
} from "@/lib/adminBillingReceiptV3";
import { ensureAdminFinanceTables } from "@/lib/adminFinance";
import {
  ensureProviderCostLedgerSchema,
  finalizeProviderCostAttempt,
  startProviderCostAttempt,
  buildPlatformAsyncTurnLedgerContext,
  buildPlatformSyncTurnLedgerContext,
} from "@/lib/providerCostLedger";
import type { Usage } from "@/lib/chatUsage";
import { convertUsdToKrw } from "@/lib/exchangeRate";
import {
  resolveSuggestedRepliesExpectation,
  resolveStatusMetaExpectation,
  resolveMemoryRelationshipExpectation,
} from "@/lib/asyncTurnCoverage";
import { sanitizeUsageForPublicReceipt } from "@/lib/billingReceiptAccess";
import { assertNoInternalEconomics } from "@/lib/publicUsageEconomicsBoundary";

const FX = {
  dateKey: "2026-08-30",
  source: "api_daily" as const,
  baseUsdKrw: 1560,
  overseasFeeRate: 0.02,
  effectiveKrwPerUsd: 1560.6,
};

function baseUsage(overrides: Partial<Usage> = {}): Usage {
  return {
    input: 1000,
    output: 500,
    model: "deepseek/deepseek-v4-pro",
    modelLabel: "DeepSeek V4 Pro",
    provider: "cheaperinference",
    route: "nsfw",
    cost: 80,
    baseCost: 80,
    breakdown: [],
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
      actualProviderCostKrw: 31.2,
      actualCostUsd: 0.02,
      actualCostSource: "cheaper_inference_billed",
      providerListCostKrw: 35,
      inputCostKrw: 5,
      outputCostKrw: 5,
      reasoningCostKrw: 0,
      cacheReadCostKrw: 0,
      cacheWriteCostKrw: 0,
      targetMargin: 0.5,
      minimumMarginFloor: 0.3,
      standardUserChargeKrw: 80,
      promoPercent: 0,
      finalShadowChargeKrw: 80,
      finalShadowPoints: 80,
      providerSavingsKrw: null,
      providerOverrunKrw: null,
      promoGivebackKrw: 0,
      netPricingBufferDeltaKrw: null,
      actualGrossProfitKrw: 50,
      actualRealizedMargin: 0.625,
      worstCasePromoMargin: null,
      marginFloorViolated: null,
      modelId: "deepseek/deepseek-v4-pro",
      provider: "cheaperinference",
    },
    ...overrides,
  };
}

function createLedgerDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE IF NOT EXISTS point_gifts (id INTEGER PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS chat_image_generations (id INTEGER PRIMARY KEY);
  `);
  ensureAdminFinanceTables(db);
  ensureProviderCostLedgerSchema(db);
  return db;
}

function settledInput(overrides: Record<string, unknown> = {}) {
  return {
    actualProvider: "cheaperinference",
    actualModel: "deepseek-v4-flash",
    cheaperInferenceBilledCostUsd: 0.001,
    outcome: "success" as const,
    ...overrides,
  };
}

function ledgerRow(
  db: Database.Database,
  assistantMessageId: number,
  family: "suggested_replies_repair" | "status_meta" | "memory_relationship" | "post_turn_shared_initial",
  phase: "async_post_turn" | "sync_post_turn",
  usd: number
) {
  const ctx =
    phase === "async_post_turn"
      ? {
          ...buildPlatformAsyncTurnLedgerContext({
            chatId: 1,
            assistantMessageId,
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
    settledInput({ cheaperInferenceBilledCostUsd: usd }),
    db
  );
  return attempt;
}

describe("adminBillingReceiptV3", () => {
  it("A — main only, async families proven skipped", () => {
    const receipt = buildAdminBillingReceiptV3({
      usage: baseUsage({ statusWidgetExtract: undefined }),
      assistantMessageId: 1,
      chatId: 1,
      suggestedRepliesRecord: {
        replies: [{ kind: "escalate", text: "abc" }, { kind: "soften", text: "def" }, { kind: "pivot", text: "ghi" }],
        extractedAt: new Date().toISOString(),
        source: "background-deepseek",
        pending: false,
        failed: false,
      },
      statusMetaRecord: {
        meta: { tableMarkdown: "|a|b|\n|-|-|\n|1|2|", datetime: "", location: "", relationship: "", npcEmotion: "", npcIntent: "", nextObjective: "", hiddenThought: "", sceneSummary: "" },
        extractedAt: new Date().toISOString(),
        source: "background-deepseek",
        pending: false,
        failed: false,
        formatSpec: null,
      },
      ledgerRows: [],
    });
    assert.equal(receipt.wholeTurn.mainExact, true);
    assert.equal(receipt.wholeTurn.syncProvablyNone, false);
    assert.equal(receipt.async.byFamily.find((f) => f.family === "memory_relationship")?.expectationState, "unverifiable");
    assert.notEqual(receipt.wholeTurn.coverage, "complete");
  });

  it("C — main + sync + async exact sums USD before FX", () => {
    const db = createLedgerDb();
    ledgerRow(db, 10, "suggested_replies_repair", "async_post_turn", 0.001);
    ledgerRow(db, 10, "suggested_replies_repair", "async_post_turn", 0.002);
    ledgerRow(db, 10, "status_meta", "async_post_turn", 0.0015);
    ledgerRow(db, 10, "memory_relationship", "async_post_turn", 0.0005);
    const rows = db
      .prepare("SELECT * FROM api_cost_ledger WHERE assistant_message_id=?")
      .all(10);

    const receipt = buildAdminBillingReceiptV3({
      usage: baseUsage({
        statusWidgetExtract: {
          input: 100,
          output: 50,
          model: "deepseek-v4-flash",
          modelLabel: "Flash",
          estimated: false,
          apiRawCostKrw: 4,
          actualProviderCostUsd: 0.003,
          actualCostSource: "cheaper_inference_billed",
          actualCostCoverage: "complete",
          actualProviderCostKrw: 4.7,
        },
      }),
      assistantMessageId: 10,
      chatId: 1,
      suggestedRepliesRecord: {
        replies: [],
        extractedAt: new Date().toISOString(),
        source: "background-deepseek",
        pending: false,
        failed: false,
      },
      statusMetaRecord: {
        meta: { tableMarkdown: "", datetime: "x", location: "y", relationship: "", npcEmotion: "", npcIntent: "", nextObjective: "", hiddenThought: "", sceneSummary: "" },
        extractedAt: new Date().toISOString(),
        source: "background-deepseek",
        pending: false,
        failed: false,
        formatSpec: null,
      },
      ledgerRows: rows as never[],
    });

    assert.ok(Math.abs((receipt.wholeTurn.exactProviderSpendUsd ?? 0) - 0.028) < 1e-9);
    const expectedKrw = Math.round(convertUsdToKrw(0.028, FX.effectiveKrwPerUsd) * 10) / 10;
    assert.equal(receipt.wholeTurn.exactProviderSpendKrw, expectedKrw);
  });

  it("G — failed_without_usage keeps partial coverage", () => {
    const db = createLedgerDb();
    const ctx = {
      ...buildPlatformAsyncTurnLedgerContext({
        chatId: 1,
        assistantMessageId: 20,
        family: "suggested_replies_repair",
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
        outcome: "failed_without_usage",
      },
      db
    );
    const rows = db.prepare("SELECT * FROM api_cost_ledger WHERE assistant_message_id=?").all(20);
    const receipt = buildAdminBillingReceiptV3({
      usage: baseUsage(),
      assistantMessageId: 20,
      chatId: 1,
      suggestedRepliesRecord: {
        replies: [],
        extractedAt: new Date().toISOString(),
        source: "background-deepseek",
        pending: false,
        failed: true,
      },
      statusMetaRecord: null,
      ledgerRows: rows as never[],
    });
    assert.equal(receipt.async.coverage, "unverifiable");
    assert.equal(receipt.wholeTurn.exactProviderSpendUsd, null);
    assert.equal(receipt.wholeTurn.contributionMarginPercent, null);
  });

  it("H — started event => pending", () => {
    const db = createLedgerDb();
    const ctx = {
      ...buildPlatformAsyncTurnLedgerContext({
        chatId: 1,
        assistantMessageId: 30,
        family: "status_meta",
        jobAttemptOrdinal: 1,
      }),
      persistInTests: true,
    };
    startProviderCostAttempt(ctx, db);
    const rows = db.prepare("SELECT * FROM api_cost_ledger WHERE assistant_message_id=?").all(30);
    const receipt = buildAdminBillingReceiptV3({
      usage: baseUsage(),
      assistantMessageId: 30,
      chatId: 1,
      suggestedRepliesRecord: null,
      statusMetaRecord: {
        meta: { tableMarkdown: "", datetime: "", location: "", relationship: "", npcEmotion: "", npcIntent: "", nextObjective: "", hiddenThought: "", sceneSummary: "" },
        extractedAt: new Date().toISOString(),
        source: "background-deepseek",
        pending: true,
        failed: false,
        formatSpec: null,
      },
      ledgerRows: rows as never[],
    });
    assert.equal(receipt.async.coverage, "pending");
    assert.equal(receipt.wholeTurn.exactProviderSpendUsd, null);
  });

  it("I — expected family zero rows is NOT zero exact", () => {
    const receipt = buildAdminBillingReceiptV3({
      usage: baseUsage(),
      assistantMessageId: 40,
      chatId: 1,
      suggestedRepliesRecord: {
        replies: [],
        extractedAt: new Date().toISOString(),
        source: "background-deepseek",
        pending: true,
        failed: false,
      },
      statusMetaRecord: null,
      ledgerRows: [],
    });
    assert.notEqual(receipt.async.exactActualCostUsd, 0);
    assert.equal(receipt.async.exactActualCostUsd, null);
    assert.equal(receipt.async.knownActualCostUsd, 0);
  });

  it("K/L — sync_post_turn ledger excluded from async total", () => {
    const db = createLedgerDb();
    ledgerRow(db, 50, "post_turn_shared_initial", "sync_post_turn", 0.003);
    ledgerRow(db, 50, "suggested_replies_repair", "async_post_turn", 0.001);
    ledgerRow(db, 50, "status_meta", "async_post_turn", 0.0005);
    ledgerRow(db, 50, "memory_relationship", "async_post_turn", 0.0005);
    const rows = db.prepare("SELECT * FROM api_cost_ledger WHERE assistant_message_id=?").all(50);
    const receipt = buildAdminBillingReceiptV3({
      usage: baseUsage({
        statusWidgetExtract: {
          input: 100,
          output: 50,
          model: "flash",
          modelLabel: "Flash",
          estimated: false,
          apiRawCostKrw: 4,
          postTurnSharedInitial: true,
          actualProviderCostUsd: 0.003,
          actualCostSource: "cheaper_inference_billed",
          actualCostCoverage: "complete",
          actualProviderCostKrw: 4.7,
        },
      }),
      assistantMessageId: 50,
      chatId: 1,
      suggestedRepliesRecord: {
        replies: [],
        extractedAt: new Date().toISOString(),
        source: "background-deepseek",
        pending: false,
        failed: false,
      },
      statusMetaRecord: {
        meta: { tableMarkdown: "", datetime: "d", location: "l", relationship: "", npcEmotion: "", npcIntent: "", nextObjective: "", hiddenThought: "", sceneSummary: "" },
        extractedAt: new Date().toISOString(),
        source: "background-deepseek",
        pending: false,
        failed: false,
        formatSpec: null,
      },
      ledgerRows: rows as never[],
    });
    assert.equal(receipt.async.physicalCallCount, 3);
    assert.equal(receipt.async.unexpectedRowCount, 0);
    assert.notEqual(receipt.async.coverage, "unverifiable");
    assert.ok(Math.abs(receipt.async.knownActualCostUsd - 0.002) < 1e-9);
    assert.ok(Math.abs((receipt.wholeTurn.syncActualCostUsd ?? 0) - 0.003) < 1e-9);
  });

  it("T1 — sync row exclusion does not poison async coverage", () => {
    const db = createLedgerDb();
    ledgerRow(db, 51, "post_turn_shared_initial", "sync_post_turn", 0.003);
    ledgerRow(db, 51, "suggested_replies_repair", "async_post_turn", 0.001);
    ledgerRow(db, 51, "status_meta", "async_post_turn", 0.0005);
    ledgerRow(db, 51, "memory_relationship", "async_post_turn", 0.0005);
    const rows = db.prepare("SELECT * FROM api_cost_ledger WHERE assistant_message_id=?").all(51);
    const receipt = buildAdminBillingReceiptV3({
      usage: baseUsage({
        statusWidgetExtract: {
          input: 100,
          output: 50,
          model: "flash",
          modelLabel: "Flash",
          estimated: false,
          apiRawCostKrw: 4,
          postTurnSharedInitial: true,
          actualProviderCostUsd: 0.003,
          actualCostSource: "cheaper_inference_billed",
          actualCostCoverage: "complete",
          actualProviderCostKrw: 4.7,
        },
      }),
      assistantMessageId: 51,
      chatId: 1,
      suggestedRepliesRecord: {
        replies: [],
        extractedAt: new Date().toISOString(),
        source: "background-deepseek",
        pending: false,
        failed: false,
      },
      statusMetaRecord: {
        meta: { tableMarkdown: "", datetime: "d", location: "l", relationship: "", npcEmotion: "", npcIntent: "", nextObjective: "", hiddenThought: "", sceneSummary: "" },
        extractedAt: new Date().toISOString(),
        source: "background-deepseek",
        pending: false,
        failed: false,
        formatSpec: null,
      },
      ledgerRows: rows as never[],
    });
    assert.equal(receipt.async.unexpectedRowCount, 0);
    assert.equal(receipt.async.coverage, "complete");
    assert.equal(receipt.wholeTurn.coverage, "complete");
    assert.ok(receipt.wholeTurn.exactProviderSpendUsd != null);
  });

  it("T2 — bad async funding fails closed", () => {
    const db = createLedgerDb();
    db.prepare(
      `INSERT INTO api_cost_ledger
        (event_key, chat_id, assistant_message_id, family, funding_class, execution_phase,
         attempt_ordinal, requested_provider, requested_model, provider, model, request_kind,
         event_status, exchange_rate_krw_per_usd, cost_krw, estimated, actual_cost_usd,
         actual_cost_source, created_at)
       VALUES (?, 1, 61, 'suggested_replies_repair', 'user_funded', 'async_post_turn',
         1, 'cheaperinference', 'flash', 'cheaperinference', 'flash', 'test',
         'settled', 1500, 1.5, 0, 0.001, 'cheaper_inference_billed', datetime('now'))`
    ).run(randomUUID());
    const rows = db.prepare("SELECT * FROM api_cost_ledger WHERE assistant_message_id=?").all(61);
    const receipt = buildAdminBillingReceiptV3({
      usage: baseUsage(),
      assistantMessageId: 61,
      chatId: 1,
      suggestedRepliesRecord: null,
      statusMetaRecord: null,
      ledgerRows: rows as never[],
    });
    assert.equal(receipt.async.unexpectedRowCount, 1);
    assert.equal(receipt.async.coverage, "unverifiable");
  });

  it("T3 — unknown async family fails closed", () => {
    const db = createLedgerDb();
    db.prepare(
      `INSERT INTO api_cost_ledger
        (event_key, chat_id, assistant_message_id, family, funding_class, execution_phase,
         attempt_ordinal, requested_provider, requested_model, provider, model, request_kind,
         event_status, exchange_rate_krw_per_usd, cost_krw, estimated, actual_cost_usd,
         actual_cost_source, created_at)
       VALUES (?, 1, 62, 'status_widget_extract', 'platform_funded', 'async_post_turn',
         1, 'cheaperinference', 'flash', 'cheaperinference', 'flash', 'test',
         'settled', 1500, 1.5, 0, 0.001, 'cheaper_inference_billed', datetime('now'))`
    ).run(randomUUID());
    const rows = db.prepare("SELECT * FROM api_cost_ledger WHERE assistant_message_id=?").all(62);
    const receipt = buildAdminBillingReceiptV3({
      usage: baseUsage(),
      assistantMessageId: 62,
      chatId: 1,
      suggestedRepliesRecord: null,
      statusMetaRecord: null,
      ledgerRows: rows as never[],
    });
    assert.equal(receipt.async.unexpectedRowCount, 1);
    assert.equal(receipt.async.coverage, "unverifiable");
  });

  it("T4 — not_persisted sync is not provably none", () => {
    const db = createLedgerDb();
    ledgerRow(db, 63, "suggested_replies_repair", "async_post_turn", 0.001);
    ledgerRow(db, 63, "status_meta", "async_post_turn", 0.0005);
    ledgerRow(db, 63, "memory_relationship", "async_post_turn", 0.0005);
    const rows = db.prepare("SELECT * FROM api_cost_ledger WHERE assistant_message_id=?").all(63);
    const receipt = buildAdminBillingReceiptV3({
      usage: baseUsage({ statusWidgetExtract: undefined }),
      assistantMessageId: 63,
      chatId: 1,
      suggestedRepliesRecord: {
        replies: [],
        extractedAt: new Date().toISOString(),
        source: "background-deepseek",
        pending: false,
        failed: false,
      },
      statusMetaRecord: {
        meta: { tableMarkdown: "", datetime: "d", location: "l", relationship: "", npcEmotion: "", npcIntent: "", nextObjective: "", hiddenThought: "", sceneSummary: "" },
        extractedAt: new Date().toISOString(),
        source: "background-deepseek",
        pending: false,
        failed: false,
        formatSpec: null,
      },
      ledgerRows: rows as never[],
    });
    assert.equal(receipt.wholeTurn.syncProvablyNone, false);
    assert.equal(receipt.syncReceipt.syncPlatformSpend.status, "not_persisted");
    assert.notEqual(receipt.wholeTurn.coverage, "complete");
    assert.equal(receipt.wholeTurn.exactProviderSpendUsd, null);
    assert.equal(receipt.wholeTurn.exactProviderSpendKrw, null);
    assert.equal(receipt.wholeTurn.contributionMarginPercent, null);
  });

  it("T5 — partial coverage keeps known USD but null exact USD", () => {
    const db = createLedgerDb();
    ledgerRow(db, 64, "suggested_replies_repair", "async_post_turn", 0.001);
    const rows = db.prepare("SELECT * FROM api_cost_ledger WHERE assistant_message_id=?").all(64);
    const receipt = buildAdminBillingReceiptV3({
      usage: baseUsage(),
      assistantMessageId: 64,
      chatId: 1,
      suggestedRepliesRecord: {
        replies: [],
        extractedAt: new Date().toISOString(),
        source: "background-deepseek",
        pending: false,
        failed: false,
      },
      statusMetaRecord: null,
      ledgerRows: rows as never[],
    });
    assert.ok(receipt.async.knownActualCostUsd > 0);
    assert.equal(receipt.async.exactActualCostUsd, null);
    assert.equal(receipt.wholeTurn.exactProviderSpendUsd, null);
  });

  it("T6 — zero ledger rows does not auto historical note", () => {
    const receipt = buildAdminBillingReceiptV3({
      usage: baseUsage(),
      assistantMessageId: 65,
      chatId: 1,
      suggestedRepliesRecord: null,
      statusMetaRecord: null,
      ledgerRows: [],
    });
    assert.equal(receipt.historicalNote, undefined);
    assert.notEqual(receipt.historicalNote, "이 턴은 async ledger/coverage 도입 이전 데이터라 전체 턴 원가를 확정할 수 없음");
  });

  it("T7 — client graph has zero runtime import from server-only v3", () => {
    const clientFiles = [
      "src/components/AdminBillingReceiptV3Panel.tsx",
      "src/components/BillingReceiptTooltip.tsx",
    ];
    for (const file of clientFiles) {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      assert.equal(
        source.includes('from "@/lib/adminBillingReceiptV3"'),
        false,
        `${file} must not import server-only adminBillingReceiptV3`
      );
      assert.equal(
        source.includes("server-only"),
        false,
        `${file} must not reference server-only`
      );
    }
  });

  it("P — missing parent FX keeps USD, null KRW/margin", () => {
    const usage = baseUsage();
    delete usage.shadowPricing;
    const receipt = buildAdminBillingReceiptV3({
      usage,
      assistantMessageId: 70,
      chatId: 1,
      suggestedRepliesRecord: null,
      statusMetaRecord: null,
      ledgerRows: [],
    });
    assert.equal(receipt.wholeTurn.fx, null);
    assert.equal(receipt.wholeTurn.exactProviderSpendKrw, null);
    assert.equal(receipt.wholeTurn.contributionMarginPercent, null);
  });

  it("R — sum USD first then FX once (no per-event KRW rounding)", () => {
    const db = createLedgerDb();
    ledgerRow(db, 80, "suggested_replies_repair", "async_post_turn", 0.0001);
    ledgerRow(db, 80, "status_meta", "async_post_turn", 0.0002);
    const rows = db.prepare("SELECT * FROM api_cost_ledger WHERE assistant_message_id=?").all(80);
    const receipt = buildAdminBillingReceiptV3({
      usage: baseUsage(),
      assistantMessageId: 80,
      chatId: 1,
      suggestedRepliesRecord: {
        replies: [],
        extractedAt: new Date().toISOString(),
        source: "background-deepseek",
        pending: false,
        failed: false,
      },
      statusMetaRecord: {
        meta: { tableMarkdown: "", datetime: "a", location: "b", relationship: "", npcEmotion: "", npcIntent: "", nextObjective: "", hiddenThought: "", sceneSummary: "" },
        extractedAt: new Date().toISOString(),
        source: "background-deepseek",
        pending: false,
        failed: false,
        formatSpec: null,
      },
      ledgerRows: rows as never[],
    });
    const asyncUsd = receipt.async.knownActualCostUsd;
    assert.ok(Math.abs(asyncUsd - 0.0003) < 1e-9);
    const krw = projectWholeTurnExactKrw(asyncUsd, FX);
    assert.ok(krw != null);
  });

  it("ZERO_LEDGER_ROWS_IMPLIES_ZERO_COST=false gate", () => {
    const memory = resolveMemoryRelationshipExpectation({ memoryRelationshipLedgerRowCount: 0 });
    assert.equal(memory.expectationState, "unverifiable");
    const receipt = buildAdminBillingReceiptV3({
      usage: baseUsage(),
      assistantMessageId: 90,
      chatId: 1,
      suggestedRepliesRecord: null,
      statusMetaRecord: null,
      ledgerRows: [],
    });
    assert.equal(receipt.async.knownActualCostUsd, 0);
    assert.equal(receipt.async.exactActualCostUsd, null);
  });

  it("shared initial skip for suggested replies repair", () => {
    const skip = resolveSuggestedRepliesExpectation({
      usage: baseUsage({
        statusWidgetExtract: {
          input: 10,
          output: 5,
          model: "x",
          modelLabel: "x",
          estimated: false,
          apiRawCostKrw: 1,
          postTurnSharedInitial: true,
        },
      }),
      record: {
        replies: [{ kind: "escalate", text: "abc" }, { kind: "soften", text: "def" }, { kind: "pivot", text: "ghi" }],
        extractedAt: new Date().toISOString(),
        source: "background-deepseek",
        pending: false,
        failed: false,
      },
      repairLedgerRowCount: 0,
    });
    assert.equal(skip.expectationState, "not_expected");
  });

  it("Z — public boundary preserves no v3 economics", () => {
    const usage = baseUsage();
    const publicUsage = sanitizeUsageForPublicReceipt(usage);
    assertNoInternalEconomics(publicUsage as Usage & Record<string, unknown>);
    assert.equal((publicUsage as Record<string, unknown>).wholeTurn, undefined);
  });
});
