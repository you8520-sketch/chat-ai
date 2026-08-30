import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { describe, it } from "node:test";
import { ensureAdminFinanceTables } from "./adminFinance";
import {
  buildPlatformAsyncTurnLedgerContext,
  buildProviderCostEventKey,
  ensureProviderCostLedgerSchema,
  finalizeProviderCostAttempt,
  isLedgerEventCoverageIncomplete,
  isLedgerEventExact,
  listProviderCostEventsForAssistantMessage,
  projectAsyncLedgerUsdToTurnKrw,
  readProviderCostEventByKey,
  resolveLedgerAttemptActualCost,
  startProviderCostAttempt,
} from "./providerCostLedger";

function createLedgerTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE IF NOT EXISTS point_gifts (id INTEGER PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS chat_image_generations (id INTEGER PRIMARY KEY);
  `);
  ensureAdminFinanceTables(db);
  ensureProviderCostLedgerSchema(db);
  return db;
}

function baseAsyncCtx(jobAttemptOrdinal: number) {
  return {
    ...buildPlatformAsyncTurnLedgerContext({
      chatId: 10,
      assistantMessageId: 42,
      family: "suggested_replies_repair" as const,
      jobAttemptOrdinal,
      requestedModel: "deepseek-v4-flash",
      requestKind: "background-suggested-replies-extract",
    }),
    persistInTests: true,
  };
}

describe("providerCostLedger", () => {
  it("A1 — one async repair attempt creates one physical event", () => {
    const db = createLedgerTestDb();
    const ctx = baseAsyncCtx(1);
    startProviderCostAttempt(ctx, db);
    finalizeProviderCostAttempt(
      ctx,
      {
        actualProvider: "cheaperinference",
        actualModel: "deepseek-v4-flash",
        inputTokens: 100,
        outputTokens: 50,
        cheaperInferenceBilledCostUsd: 0.002,
        eventStatus: "settled",
      },
      db
    );
    const rows = listProviderCostEventsForAssistantMessage(42, db);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.family, "suggested_replies_repair");
    assert.equal(rows[0]?.assistant_message_id, 42);
  });

  it("A2 — two repair job attempts create two physical events", () => {
    const db = createLedgerTestDb();
    for (const ordinal of [1, 2]) {
      const ctx = baseAsyncCtx(ordinal);
      startProviderCostAttempt(ctx, db);
      finalizeProviderCostAttempt(
        ctx,
        {
          actualProvider: "cheaperinference",
          actualModel: "deepseek-v4-flash",
          inputTokens: 100,
          outputTokens: 50,
          eventStatus: "failed_without_usage",
        },
        db
      );
    }
    assert.equal(listProviderCostEventsForAssistantMessage(42, db).length, 2);
  });

  it("A3 — duplicate finalize inserts once", () => {
    const db = createLedgerTestDb();
    const ctx = { ...baseAsyncCtx(1), persistInTests: true };
    startProviderCostAttempt(ctx, db);
    const input = {
      actualProvider: "cheaperinference",
      actualModel: "deepseek-v4-flash",
      inputTokens: 100,
      outputTokens: 50,
      cheaperInferenceBilledCostUsd: 0.003,
      eventStatus: "settled" as const,
    };
    finalizeProviderCostAttempt(ctx, input, db);
    finalizeProviderCostAttempt(ctx, input, db);
    assert.equal(listProviderCostEventsForAssistantMessage(42, db).length, 1);
  });

  it("A4 — genuine retries with identical token counts remain separate events", () => {
    const db = createLedgerTestDb();
    for (const ordinal of [1, 2]) {
      const ctx = baseAsyncCtx(ordinal);
      startProviderCostAttempt(ctx, db);
      finalizeProviderCostAttempt(
        ctx,
        {
          actualProvider: "cheaperinference",
          actualModel: "deepseek-v4-flash",
          inputTokens: 500,
          outputTokens: 120,
          eventStatus: "failed_without_usage",
        },
        db
      );
    }
    const keys = listProviderCostEventsForAssistantMessage(42, db).map((r) => r.event_key);
    assert.equal(new Set(keys).size, 2);
  });

  it("C — failure coverage keeps incomplete attempt plus settled retry", () => {
    const db = createLedgerTestDb();
    const failCtx = baseAsyncCtx(1);
    startProviderCostAttempt(failCtx, db);
    finalizeProviderCostAttempt(
      failCtx,
      {
        actualProvider: "cheaperinference",
        actualModel: "deepseek-v4-flash",
        eventStatus: "failed_without_usage",
      },
      db
    );
    const okCtx = baseAsyncCtx(2);
    startProviderCostAttempt(okCtx, db);
    finalizeProviderCostAttempt(
      okCtx,
      {
        actualProvider: "cheaperinference",
        actualModel: "deepseek-v4-flash",
        cheaperInferenceBilledCostUsd: 0.01,
        eventStatus: "settled",
      },
      db
    );
    const rows = listProviderCostEventsForAssistantMessage(42, db);
    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.event_status, "failed_without_usage");
    assert.equal(rows[1]?.actual_cost_source, "cheaper_inference_billed");
  });

  it("D — CI billed wins over upstream for actual cost", () => {
    const resolved = resolveLedgerAttemptActualCost({
      actualProvider: "cheaperinference",
      cheaperInferenceBilledCostUsd: 0.01,
      upstreamCostUsd: 0.02,
      eventStatus: "settled",
    });
    assert.equal(resolved.actualCostUsd, 0.01);
    assert.equal(resolved.actualCostSource, "cheaper_inference_billed");
    assert.equal(resolved.settled, true);
  });

  it("E — CI upstream only is not settled", () => {
    const resolved = resolveLedgerAttemptActualCost({
      actualProvider: "cheaperinference",
      upstreamCostUsd: 0.02,
      eventStatus: "settled",
    });
    assert.equal(resolved.settled, false);
    assert.equal(resolved.actualCostSource, "incomplete");
  });

  it("F — provider failover uses separate physical ordinals in event keys", () => {
    const base = baseAsyncCtx(1);
    const primaryKey = buildProviderCostEventKey({
      ...base,
      physicalAttemptOrdinal: 1,
      requestedProvider: "cheaperinference",
      requestedModel: "deepseek-v4-flash",
    });
    const backupKey = buildProviderCostEventKey({
      ...base,
      physicalAttemptOrdinal: 2,
      requestedProvider: "openrouter",
      requestedModel: "deepseek/deepseek-v4-flash-0731",
    });
    assert.notEqual(primaryKey, backupKey);
  });

  it("G — status meta event links assistant message id", () => {
    const db = createLedgerTestDb();
    const ctx = {
      ...buildPlatformAsyncTurnLedgerContext({
        chatId: 7,
        assistantMessageId: 99,
        family: "status_meta",
        jobAttemptOrdinal: 1,
        requestKind: "background-status-meta-extract",
      }),
      persistInTests: true,
    };
    startProviderCostAttempt(ctx, db);
    finalizeProviderCostAttempt(
      ctx,
      {
        actualProvider: "openrouter",
        actualModel: "google/gemini-3.1-flash-lite-preview",
        upstreamCostUsd: 0.001,
        usageEstimated: false,
        eventStatus: "settled",
      },
      db
    );
    const row = readProviderCostEventByKey(buildProviderCostEventKey(ctx), db);
    assert.ok(row);
    assert.equal(row?.assistant_message_id, 99);
    assert.equal(row?.funding_class, "platform_funded");
    assert.equal(isLedgerEventExact(row!), true);
  });

  it("L — started without finalize is incomplete coverage", () => {
    const db = createLedgerTestDb();
    const ctx = baseAsyncCtx(1);
    startProviderCostAttempt(ctx, db);
    const row = readProviderCostEventByKey(buildProviderCostEventKey(ctx), db);
    assert.ok(row);
    assert.equal(row?.event_status, "started");
    assert.equal(isLedgerEventCoverageIncomplete(row!), true);
    assert.equal(isLedgerEventExact(row!), false);
  });

  it("M/N — async USD projects with parent turn FX snapshot only", () => {
    const krw = projectAsyncLedgerUsdToTurnKrw(0.02, {
      dateKey: "2026-08-30",
      baseUsdKrw: 1530,
      overseasFeeRate: 0.02,
      effectiveKrwPerUsd: 1560.6,
      source: "test",
    });
    assert.ok(krw != null && Math.abs(krw - 31.2) < 0.05);
  });

  it("O — missing parent FX returns unavailable KRW projection", () => {
    assert.equal(projectAsyncLedgerUsdToTurnKrw(0.02, null), null);
  });
});
