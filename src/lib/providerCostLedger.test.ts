import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { describe, it } from "node:test";
import { ensureAdminFinanceTables } from "./adminFinance";
import {
  buildPlatformAsyncTurnLedgerContext,
  ensureProviderCostLedgerSchema,
  finalizeProviderCostAttempt,
  isLedgerEventCostCoverageIncomplete,
  isLedgerEventCostExact,
  listProviderCostEventsForAssistantMessage,
  readProviderCostEventByKey,
  resolveLedgerAttemptSettlement,
  startProviderCostAttempt,
} from "./providerCostLedger";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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
      generationSequence: 0,
      family: "suggested_replies_repair" as const,
      jobAttemptOrdinal,
      requestedModel: "deepseek-v4-flash",
      requestKind: "background-suggested-replies-extract",
    }),
    persistInTests: true,
  };
}

function settledInput(overrides: Record<string, unknown> = {}) {
  return {
    actualProvider: "cheaperinference",
    actualModel: "deepseek-v4-flash",
    inputTokens: 100,
    outputTokens: 50,
    cheaperInferenceBilledCostUsd: 0.002,
    outcome: "success" as const,
    ...overrides,
  };
}

describe("providerCostLedger", () => {
  it("A1/R2 — stale requeue with same job metadata creates distinct physical events", () => {
    const db = createLedgerTestDb();
    const ctx = baseAsyncCtx(1);

    const run1 = startProviderCostAttempt(ctx, db);
    finalizeProviderCostAttempt(run1, settledInput(), db);

    const run2 = startProviderCostAttempt(ctx, db);
    finalizeProviderCostAttempt(run2, settledInput(), db);

    const rows = listProviderCostEventsForAssistantMessage(42, db);
    assert.equal(rows.length, 2);
    assert.notEqual(rows[0]?.event_key, rows[1]?.event_key);
  });

  it("A3/R3 — duplicate finalize on same physical handle inserts once", () => {
    const db = createLedgerTestDb();
    const attempt = startProviderCostAttempt(baseAsyncCtx(1), db);
    const input = settledInput({ cheaperInferenceBilledCostUsd: 0.003 });
    finalizeProviderCostAttempt(attempt, input, db);
    finalizeProviderCostAttempt(attempt, input, db);
    assert.equal(listProviderCostEventsForAssistantMessage(42, db).length, 1);
  });

  it("A4/R4 — genuine logical retries remain separate events", () => {
    const db = createLedgerTestDb();
    for (const ordinal of [1, 2]) {
      const attempt = startProviderCostAttempt(baseAsyncCtx(ordinal), db);
      finalizeProviderCostAttempt(
        attempt,
        {
          actualProvider: "cheaperinference",
          actualModel: "deepseek-v4-flash",
          inputTokens: 500,
          outputTokens: 120,
          outcome: "failed_without_usage",
        },
        db
      );
    }
    assert.equal(listProviderCostEventsForAssistantMessage(42, db).length, 2);
  });

  it("C/R8 — failure coverage keeps incomplete attempt plus settled retry", () => {
    const db = createLedgerTestDb();
    const failAttempt = startProviderCostAttempt(baseAsyncCtx(1), db);
    finalizeProviderCostAttempt(
      failAttempt,
      {
        actualProvider: "cheaperinference",
        actualModel: "deepseek-v4-flash",
        outcome: "failed_without_usage",
      },
      db
    );
    const okAttempt = startProviderCostAttempt(baseAsyncCtx(2), db);
    finalizeProviderCostAttempt(
      okAttempt,
      settledInput({ cheaperInferenceBilledCostUsd: 0.01 }),
      db
    );
    const rows = listProviderCostEventsForAssistantMessage(42, db);
    assert.equal(rows.length, 2);
    assert.equal(isLedgerEventCostCoverageIncomplete(rows[0]!), true);
    assert.equal(rows[1]?.actual_cost_source, "cheaper_inference_billed");
  });

  it("R6 — CI billed and upstream provenance stored separately", () => {
    const db = createLedgerTestDb();
    const attempt = startProviderCostAttempt(baseAsyncCtx(1), db);
    finalizeProviderCostAttempt(
      attempt,
      {
        actualProvider: "cheaperinference",
        actualModel: "deepseek-v4-flash",
        cheaperInferenceBilledCostUsd: 0.01,
        upstreamCostUsd: 0.02,
        outcome: "success",
      },
      db
    );
    const row = readProviderCostEventByKey(attempt.physicalAttemptId, db);
    assert.ok(row);
    assert.equal(row?.cheaper_inference_billed_cost_usd, 0.01);
    assert.equal(row?.upstream_cost_usd, 0.02);
    assert.equal(row?.actual_cost_usd, 0.01);
    assert.equal(row?.actual_cost_source, "cheaper_inference_billed");
  });

  it("R7 — CI upstream-only is not settled", () => {
    const settlement = resolveLedgerAttemptSettlement({
      actualProvider: "cheaperinference",
      upstreamCostUsd: 0.02,
      usageEstimated: false,
      outcome: "success",
    });
    assert.notEqual(settlement.eventStatus, "settled");
    assert.equal(settlement.settled, false);
    assert.equal(settlement.actualCostSource, "unavailable");

    const db = createLedgerTestDb();
    const attempt = startProviderCostAttempt(baseAsyncCtx(1), db);
    finalizeProviderCostAttempt(
      attempt,
      {
        actualProvider: "cheaperinference",
        actualModel: "deepseek-v4-flash",
        upstreamCostUsd: 0.02,
        usageEstimated: false,
        outcome: "success",
      },
      db
    );
    const row = readProviderCostEventByKey(attempt.physicalAttemptId, db)!;
    assert.equal(row.event_status, "completed_without_exact_cost");
    assert.equal(row.actual_cost_usd, null);
    assert.equal(isLedgerEventCostExact(row), false);
    assert.equal(isLedgerEventCostCoverageIncomplete(row), true);
  });

  it("R9 — failed transport with exact CI billed cost remains cost-exact", () => {
    const db = createLedgerTestDb();
    const attempt = startProviderCostAttempt(baseAsyncCtx(1), db);
    finalizeProviderCostAttempt(
      attempt,
      {
        actualProvider: "cheaperinference",
        actualModel: "deepseek-v4-flash",
        cheaperInferenceBilledCostUsd: 0.003,
        outcome: "failed_with_usage",
      },
      db
    );
    const row = readProviderCostEventByKey(attempt.physicalAttemptId, db)!;
    assert.equal(row.event_status, "failed_with_usage");
    assert.equal(isLedgerEventCostExact(row), true);
    assert.equal(isLedgerEventCostCoverageIncomplete(row), false);
  });

  it("R10 — started without finalize is incomplete coverage", () => {
    const db = createLedgerTestDb();
    const attempt = startProviderCostAttempt(baseAsyncCtx(1), db);
    const row = readProviderCostEventByKey(attempt.physicalAttemptId, db)!;
    assert.equal(row.event_status, "started");
    assert.equal(isLedgerEventCostCoverageIncomplete(row), true);
    assert.equal(isLedgerEventCostExact(row), false);
  });

  it("G — status meta row stores actual_provider/model", () => {
    const db = createLedgerTestDb();
    const ctx = {
      ...buildPlatformAsyncTurnLedgerContext({
        chatId: 7,
        assistantMessageId: 99,
        generationSequence: 0,
        family: "status_meta",
        jobAttemptOrdinal: 1,
        requestKind: "background-status-meta-extract",
      }),
      persistInTests: true,
    };
    const attempt = startProviderCostAttempt(ctx, db);
    finalizeProviderCostAttempt(
      attempt,
      {
        actualProvider: "openrouter",
        actualModel: "google/gemini-3.1-flash-lite-preview",
        upstreamCostUsd: 0.001,
        usageEstimated: false,
        outcome: "success",
      },
      db
    );
    const row = readProviderCostEventByKey(attempt.physicalAttemptId, db)!;
    assert.equal(row.actual_provider, "openrouter");
    assert.equal(row.actual_model, "google/gemini-3.1-flash-lite-preview");
    assert.equal(row.assistant_message_id, 99);
  });

  it("micro-correction gates — legacy finance isolation and cleanup", () => {
    const openRouterCompletionSource = readFileSync(
      join(process.cwd(), "src/lib/openRouterCompletion.ts"),
      "utf8"
    );
    const legacyRecordApiCostBlock = openRouterCompletionSource.match(
      /recordApiCost\(\{[\s\S]*?\}\);/
    )?.[0];
    assert.ok(legacyRecordApiCostBlock);
    assert.equal(
      legacyRecordApiCostBlock.includes("upstreamCostUsd"),
      false,
      "LEGACY_NO_CONTEXT_UPSTREAM_FORWARDING=false"
    );

    const providerCostLedgerSource = readFileSync(
      join(process.cwd(), "src/lib/providerCostLedger.ts"),
      "utf8"
    );
    assert.equal(
      providerCostLedgerSource.includes("projectAsyncLedgerUsdToTurnKrw"),
      false,
      "WHOLE_TURN_FX_PROJECTION_IMPLEMENTED=false"
    );
    assert.equal(
      providerCostLedgerSource.includes("resolveLedgerAttemptActualCost"),
      false,
      "DEPRECATED_PROVIDER_LEDGER_ADAPTER_COUNT=0"
    );
    assert.equal(
      providerCostLedgerSource.includes("isLedgerEventExact"),
      false,
      "DEPRECATED_PROVIDER_LEDGER_ADAPTER_COUNT=0"
    );
    assert.equal(
      providerCostLedgerSource.includes("isLedgerEventCoverageIncomplete"),
      false,
      "DEPRECATED_PROVIDER_LEDGER_ADAPTER_COUNT=0"
    );
    assert.equal(
      providerCostLedgerSource.includes("@deprecated"),
      false,
      "DEPRECATED_PROVIDER_LEDGER_ADAPTER_COUNT=0"
    );
  });
});
