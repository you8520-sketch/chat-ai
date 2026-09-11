import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildAdminFinanceSummary, ensureAdminFinanceTables } from "./adminFinance";
import { resolveBillingExchangeRateSnapshot } from "./exchangeRate";
import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
  MAIN_RP_USER_SELECTABLE_OPTIONS,
} from "./chatModels";
import { CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL } from "./chatModels";
import {
  ensureProviderCostLedgerSchema,
  finalizeProviderCostAttempt,
  hasProviderRequestIdempotencyIndex,
  readLedgerPeriodCostAttribution,
  recordBackgroundProviderCost,
  resolveLedgerCostCenter,
  startProviderCostAttempt,
} from "./providerCostLedger";
import { spawnSync } from "node:child_process";

const FX = resolveBillingExchangeRateSnapshot().effectiveKrwPerUsd;
const krw = (usd: number) => Math.round(usd * FX * 10) / 10;

/** Deterministic expectation: settled KRW from the row's own stored FX snapshot. */
function settledKrw(db: Database.Database, requestId: string): number {
  const row = db
    .prepare(
      "SELECT actual_cost_usd, exchange_rate_krw_per_usd FROM api_cost_ledger WHERE provider_request_id=?"
    )
    .get(requestId) as { actual_cost_usd: number; exchange_rate_krw_per_usd: number };
  return Math.round(row.actual_cost_usd * row.exchange_rate_krw_per_usd * 10) / 10;
}

function financeDbBare(): Database.Database {
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
  return db;
}

function financeDb(): Database.Database {
  const db = financeDbBare();
  ensureProviderCostLedgerSchema(db);
  return db;
}

function settledBackground(
  db: Database.Database,
  opts: {
    model: string;
    billedUsd?: number;
    upstreamUsd?: number;
    usageEstimated?: boolean;
    requestKind?: string;
    costCenter?: "memory" | "status_widget" | "image" | "moderation" | "profile" | "asset" | "trpg" | "other";
    requestId?: string | null;
    inputTokens?: number;
    outputTokens?: number;
  }
) {
  return recordBackgroundProviderCost(
    {
      provider: "cheaperinference",
      outcome: "success",
      persistInTests: true,
      model: opts.model,
      cheaperInferenceBilledCostUsd: opts.billedUsd,
      upstreamCostUsd: opts.upstreamUsd,
      usageEstimated: opts.usageEstimated,
      requestKind: opts.requestKind,
      costCenter: opts.costCenter,
      providerRequestId: opts.requestId,
      inputTokens: opts.inputTokens,
      outputTokens: opts.outputTokens,
    },
    db
  );
}

describe("admin finance actual cost — dynamic discovery and attribution", () => {
  it("A. future model id appears automatically without finance code changes", () => {
    const db = financeDb();
    try {
      settledBackground(db, {
        model: "future-model-zzz-9",
        billedUsd: 0.01,
        requestKind: "background-memory-extract",
        requestId: "req-a-1",
      });
      const summary = buildAdminFinanceSummary(db);
      const row = summary.aiModelCosts.find((r) => r.model === "future-model-zzz-9");
      assert.ok(row, "unknown model surfaces in the union model table");
      assert.equal(row!.kind, "indirect");
      assert.equal(row!.actualKrw, settledKrw(db, "req-a-1"));
      assert.equal(row!.contributionKrw, null);
      assert.equal(row!.marginRate, null);
    } finally {
      db.close();
    }
  });

  it("B. active registry models with zero usage are listed as zero-use, not hidden or carded", () => {
    const db = financeDb();
    try {
      const summary = buildAdminFinanceSummary(db);
      assert.equal(summary.zeroUseModels.length, MAIN_RP_USER_SELECTABLE_OPTIONS.length);
      assert.ok(
        summary.zeroUseModels.some((m) => m.id === CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL),
        "Opus 5 (active, zero use) is a compact zero-use row"
      );
      assert.equal(summary.aiModelCosts.length, 0);
    } finally {
      db.close();
    }
  });

  it("C. background cost without messages increases total AI cost and centers", () => {
    const db = financeDb();
    try {
      settledBackground(db, {
        model: "memory-model-x",
        billedUsd: 0.005,
        requestKind: "background-memory-extract",
        requestId: "req-c-1",
        inputTokens: 1000,
        outputTokens: 200,
      });
      const summary = buildAdminFinanceSummary(db);
      const expected = settledKrw(db, "req-c-1");
      assert.ok(expected > 0);
      assert.equal(summary.totalApiCostKrw, expected);
      assert.equal(summary.netProfitKrw, -expected);
      assert.equal(summary.aiCost.byCenter.find((c) => c.center === "memory")?.actualKrw, expected);
      assert.equal(summary.aiCost.calls, 1);
    } finally {
      db.close();
    }
  });

  it("D. internal reconciliation: attributed 900 + unattributed 100, total 1000", () => {
    const db = financeDb();
    try {
      settledBackground(db, {
        model: "known-model",
        billedUsd: 0.009,
        requestKind: "background-memory-extract",
        requestId: "req-d-1",
      });
      settledBackground(db, {
        model: "",
        billedUsd: 0.001,
        requestKind: "mystery-kind-zzz",
        requestId: "req-d-2",
      });
      const summary = buildAdminFinanceSummary(db);
      const expectedTotal = Math.round(
        (settledKrw(db, "req-d-1") + settledKrw(db, "req-d-2")) * 10
      ) / 10;
      assert.equal(summary.aiCost.totalActualKrw, expectedTotal);
      assert.equal(summary.aiCost.unattributedKrw, settledKrw(db, "req-d-2"));
      assert.equal(summary.aiCost.unattributedCalls, 1);
    } finally {
      db.close();
    }
  });

  it("E. unmatched cost is included in net profit, never hidden", () => {
    const db = financeDb();
    try {
      settledBackground(db, {
        model: "",
        billedUsd: 0.01,
        requestKind: "mystery-kind-zzz",
        requestId: "req-e-1",
      });
      const summary = buildAdminFinanceSummary(db);
      assert.equal(summary.netProfitKrw, -settledKrw(db, "req-e-1"));
    } finally {
      db.close();
    }
  });

  it("F. estimate-then-actual on one request settles exactly once (actual wins)", () => {
    const db = financeDb();
    try {
      const attempt = startProviderCostAttempt(
        {
          chatId: null,
          assistantMessageId: null,
          generationSequence: 0,
          family: "background",
          fundingClass: "platform_funded",
          executionPhase: "async_post_turn",
          jobAttemptOrdinal: 1,
          requestedProvider: "cheaperinference",
          requestedModel: "f-model",
          requestKind: "background-memory-extract",
          persistInTests: true,
        },
        db
      );
      finalizeProviderCostAttempt(
        attempt,
        {
          actualProvider: "cheaperinference",
          actualModel: "f-model",
          inputTokens: 100,
          outputTokens: 50,
          upstreamCostUsd: 0.01,
          usageEstimated: true,
          outcome: "success",
        },
        db
      );
      finalizeProviderCostAttempt(
        attempt,
        {
          actualProvider: "cheaperinference",
          actualModel: "f-model",
          inputTokens: 100,
          outputTokens: 50,
          cheaperInferenceBilledCostUsd: 0.008,
          outcome: "success",
        },
        db
      );
      const attribution = readLedgerPeriodCostAttribution(db, "2000-01-01", "2100-01-01");
      const row = db
        .prepare(
          "SELECT actual_cost_usd, exchange_rate_krw_per_usd FROM api_cost_ledger WHERE actual_model='f-model'"
        )
        .get() as { actual_cost_usd: number; exchange_rate_krw_per_usd: number };
      const expected = Math.round(row.actual_cost_usd * row.exchange_rate_krw_per_usd * 10) / 10;
      assert.equal(attribution.totals.actualKrw, expected);
      assert.equal(attribution.totals.estimatedKrw, 0);
      assert.equal(attribution.totals.calls, 1);
    } finally {
      db.close();
    }
  });

  it("G. duplicate background sync of one provider request records once", () => {
    const db = financeDb();
    try {
      const first = settledBackground(db, {
        model: "g-model",
        billedUsd: 0.004,
        requestKind: "background-memory-extract",
        requestId: "req-g-dup",
      });
      const second = settledBackground(db, {
        model: "g-model",
        billedUsd: 0.004,
        requestKind: "background-memory-extract",
        requestId: "req-g-dup",
      });
      assert.equal(first.recorded, true);
      assert.equal(second.recorded, false);
      assert.equal(first.eventKey, second.eventKey);
      const count = (
        db.prepare("SELECT COUNT(*) AS c FROM api_cost_ledger").get() as { c: number }
      ).c;
      assert.equal(count, 1);
    } finally {
      db.close();
    }
  });

  it("H. failed events contribute no cost and keep coverage honest", () => {
    const db = financeDb();
    try {
      settledBackground(db, {
        model: "h-model",
        billedUsd: 0.006,
        requestKind: "background-memory-extract",
        requestId: "req-h-ok",
      });
      recordBackgroundProviderCost(
        {
          provider: "cheaperinference",
          model: "h-model-failed",
          requestKind: "background-memory-extract",
          outcome: "failed_without_usage",
          persistInTests: true,
        },
        db
      );
      const attribution = readLedgerPeriodCostAttribution(db, "2000-01-01", "2100-01-01");
      assert.equal(attribution.totals.actualKrw, settledKrw(db, "req-h-ok"));
      assert.equal(attribution.totals.hasInexact, true);
    } finally {
      db.close();
    }
  });

  it("I. billed retry finalize on one event stays a single row", () => {
    const db = financeDb();
    try {
      const attempt = startProviderCostAttempt(
        {
          chatId: null,
          assistantMessageId: null,
          generationSequence: 0,
          family: "background",
          fundingClass: "platform_funded",
          executionPhase: "async_post_turn",
          jobAttemptOrdinal: 1,
          requestedProvider: "cheaperinference",
          requestedModel: "i-model",
          requestKind: "background-memory-extract",
          persistInTests: true,
        },
        db
      );
      const input = {
        actualProvider: "cheaperinference",
        actualModel: "i-model",
        inputTokens: 50,
        outputTokens: 25,
        cheaperInferenceBilledCostUsd: 0.003,
        providerRequestId: "req-i-1",
        outcome: "success" as const,
      };
      finalizeProviderCostAttempt(attempt, input, db);
      finalizeProviderCostAttempt(attempt, input, db);
      const attribution = readLedgerPeriodCostAttribution(db, "2000-01-01", "2100-01-01");
      assert.equal(attribution.totals.actualKrw, settledKrw(db, "req-i-1"));
      assert.equal(attribution.totals.calls, 1);
    } finally {
      db.close();
    }
  });

  it("J. retired models with period cost never disappear", () => {
    const db = financeDb();
    try {
      settledBackground(db, {
        model: "retired-model-2001",
        billedUsd: 0.007,
        requestKind: "background-memory-extract",
        requestId: "req-j-1",
      });
      const summary = buildAdminFinanceSummary(db);
      const row = summary.aiModelCosts.find((r) => r.model === "retired-model-2001");
      assert.ok(row, "retired model row present");
      assert.equal(row!.kind, "indirect");
      assert.ok(!summary.zeroUseModels.some((m) => m.id === "retired-model-2001"));
    } finally {
      db.close();
    }
  });

  it("K. obsolete DeepSeek standalone card is gone from the finance UI", () => {
    const source = readFileSync(join(process.cwd(), "src/app/admin/finance/AdminFinanceClient.tsx"), "utf8");
    assert.equal(
      source.includes("DeepSeek V4 Flash · 이번 달 실제 원가"),
      false,
      "standalone card removed"
    );
    assert.ok(source.includes("AI 실제 원가"), "generic actual-cost section present");
  });

  it("L. recorded AI actual moves net profit by exactly that amount, once", () => {
    const base = financeDb();
    const withCost = financeDb();
    try {
      // Settled zero-cost main stage (generic owner): exact summary with no
      // API cost of its own, so the unlinked actual is the only delta.
      const settledZeroUsage = JSON.stringify({
        model: CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL,
        modelLabel: "DeepSeek V4 Flash",
        provider: "cheaperinference",
        input: 100,
        output: 50,
        cost: 5000,
        shadowPricing: {
          pricingVersion: 1,
          actualTurnCostCoverage: "complete",
          actualProviderCostKrw: 0,
          actualCostUsd: 0,
          actualCostSource: "cheaper_inference_billed",
          provider: "cheaperinference",
          modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL,
          fxSnapshot: { effectiveKrwPerUsd: 1500 },
        },
      });
      for (const db of [base, withCost]) {
        db.prepare(
          `INSERT INTO messages (id, chat_id, role, usage, deduction_slices, created_at, is_refunded)
           VALUES (1, 1, 'assistant', ?, ?, datetime('now'), 0)`
        ).run(
          settledZeroUsage,
          JSON.stringify([{ pointType: "PAID", amount: 5000 }])
        );
      }
      settledBackground(withCost, {
        model: "l-model",
        billedUsd: 0.7,
        requestKind: "background-memory-extract",
        requestId: "req-l-1",
      });
      const before = buildAdminFinanceSummary(base);
      const after = buildAdminFinanceSummary(withCost);
      assert.equal(before.netProfitKrw, 5000);
      const recorded = settledKrw(withCost, "req-l-1");
      assert.ok(recorded > 0);
      assert.equal(after.netProfitKrw, 5000 - recorded);
    } finally {
      base.close();
      withCost.close();
    }
  });

  it("M. period boundary pins current naive-UTC compare semantics", () => {
    const db = financeDb();
    try {
      settledBackground(db, {
        model: "m-model",
        billedUsd: 0.002,
        requestKind: "background-memory-extract",
        requestId: "req-m-1",
      });
      // 2026-08-31 15:30 UTC == 2026-09-01 00:30 KST: current finance buckets
      // by raw stored timestamp (no KST shift). Pinned as-is; changing the
      // accounting basis is out of scope (STOP condition).
      db.prepare("UPDATE api_cost_ledger SET created_at = '2026-08-31 15:30:00'").run();
      const august = buildAdminFinanceSummary(db, "2026-08");
      assert.equal(august.aiCost.calls, 1);
    } finally {
      db.close();
    }
  });
});

describe("admin finance actual cost — merge-blocker regressions N-U", () => {
  it("N. estimated-only costs emit estimated_auto and grow the estimate bucket", () => {
    const db = financeDb();
    try {
      const attempt = startProviderCostAttempt(
        {
          chatId: null,
          assistantMessageId: null,
          generationSequence: 0,
          family: "background",
          fundingClass: "platform_funded",
          executionPhase: "async_post_turn",
          jobAttemptOrdinal: 1,
          requestedProvider: "openrouter",
          requestedModel: "n-model",
          requestKind: "background-memory-extract",
          persistInTests: true,
        },
        db
      );
      finalizeProviderCostAttempt(
        attempt,
        {
          actualProvider: "openrouter",
          actualModel: "n-model",
          inputTokens: 100,
          outputTokens: 50,
          upstreamCostUsd: 0.02,
          usageEstimated: true,
          outcome: "success",
        },
        db
      );
      const attribution = readLedgerPeriodCostAttribution(db, "2000-01-01", "2100-01-01");
      const entry = attribution.byModel.find((r) => r.model === "n-model");
      assert.ok(entry, "estimated-only model row exists");
      assert.equal(entry!.sourceState, "estimated_auto");
      assert.equal(entry!.actualKrw, 0);
      assert.ok(entry!.estimatedKrw > 0, "unsettled upstream reference lands in estimate fallback");
      const summary = buildAdminFinanceSummary(db);
      assert.ok(summary.aiCost.estimatedFallbackKrw > 0);
      assert.equal(summary.aiCost.totalActualKrw, 0);
    } finally {
      db.close();
    }
  });

  it("O. asset tagging reaches the asset center, never image generation", () => {
    assert.equal(
      resolveLedgerCostCenter({ family: "background", request_kind: "background-asset-vision" }),
      "asset"
    );
    // Stored write-time centers win over the classifier (legacy fallback only).
    assert.equal(
      resolveLedgerCostCenter({
        family: "background",
        request_kind: "background-chat-image-scene-brief",
        cost_center: "asset",
      }),
      "asset"
    );
    const db = financeDb();
    try {
      settledBackground(db, {
        model: "o-model",
        billedUsd: 0.004,
        requestKind: "background-asset-vision",
        costCenter: "asset",
        requestId: "req-o-1",
      });
      const summary = buildAdminFinanceSummary(db);
      assert.equal(summary.aiCost.byCenter.find((c) => c.center === "asset")?.actualKrw, settledKrw(db, "req-o-1"));
      assert.equal(summary.aiCost.byCenter.find((c) => c.center === "image")?.actualKrw ?? 0, 0);
    } finally {
      db.close();
    }
  });

  it("P. scene brief maps to the documented image pipeline center", () => {
    assert.equal(
      resolveLedgerCostCenter({ family: "background", request_kind: "background-chat-image-scene-brief" }),
      "image"
    );
    const db = financeDb();
    try {
      settledBackground(db, {
        model: "p-model",
        billedUsd: 0.003,
        requestKind: "background-chat-image-scene-brief",
        requestId: "req-p-1",
      });
      const summary = buildAdminFinanceSummary(db);
      assert.equal(summary.aiCost.byCenter.find((c) => c.center === "image")?.actualKrw, settledKrw(db, "req-p-1"));
    } finally {
      db.close();
    }
  });

  it("Q. same model direct 100 + indirect 40 stays separated, totals exact", () => {
    const db = financeDb();
    try {
      db.prepare(
        `INSERT INTO messages (id, chat_id, role, usage, deduction_slices, created_at, is_refunded)
         VALUES (1, 1, 'assistant', ?, ?, datetime('now'), 0)`
      ).run(
        JSON.stringify({ model: "q-model", modelLabel: "q-model" }),
        JSON.stringify([{ pointType: "PAID", amount: 5000 }])
      );
      const linked = startProviderCostAttempt(
        {
          chatId: 1,
          assistantMessageId: 1,
          generationSequence: 0,
          family: "post_turn_shared_initial",
          fundingClass: "platform_funded",
          executionPhase: "sync_post_turn",
          jobAttemptOrdinal: 1,
          requestedProvider: "cheaperinference",
          requestedModel: "q-model",
          requestKind: "background-shared-initial",
          persistInTests: true,
        },
        db
      );
      finalizeProviderCostAttempt(
        linked,
        {
          actualProvider: "cheaperinference",
          actualModel: "q-model",
          inputTokens: 200,
          outputTokens: 100,
          cheaperInferenceBilledCostUsd: 0.05,
          providerRequestId: "req-q-direct",
          outcome: "success",
        },
        db
      );
      settledBackground(db, {
        model: "q-model",
        billedUsd: 0.02,
        requestKind: "background-memory-extract",
        requestId: "req-q-indirect",
      });
      const attribution = readLedgerPeriodCostAttribution(db, "2000-01-01", "2100-01-01");
      const direct = attribution.byModel.find((r) => r.model === "q-model" && r.kind === "direct");
      const indirect = attribution.byModel.find((r) => r.model === "q-model" && r.kind === "indirect");
      assert.ok(direct, "direct split exists");
      assert.ok(indirect, "indirect split exists");
      assert.equal(direct!.actualKrw, settledKrw(db, "req-q-direct"));
      assert.equal(indirect!.actualKrw, settledKrw(db, "req-q-indirect"));
      assert.equal(
        attribution.totals.actualKrw,
        Math.round((direct!.actualKrw + indirect!.actualKrw) * 10) / 10
      );

      const summary = buildAdminFinanceSummary(db);
      const directRow = summary.aiModelCosts.find((r) => r.model === "q-model" && r.kind === "direct");
      const indirectRow = summary.aiModelCosts.find((r) => r.model === "q-model" && r.kind === "indirect");
      assert.ok(directRow, "direct finance row present with revenue");
      assert.ok(indirectRow, "indirect finance row present without revenue");
      assert.equal(directRow!.paidRevenueKrw, 5000);
      assert.equal(indirectRow!.paidRevenueKrw, 0);
      assert.equal(indirectRow!.contributionKrw, null);
      assert.equal(indirectRow!.marginRate, null);
      assert.equal(indirectRow!.actualKrw, settledKrw(db, "req-q-indirect"));
    } finally {
      db.close();
    }
  });

  it("R. DeepSeek message-linked exact cost appears exactly once", () => {
    // Root cause was the isLedgeredDeepSeekFlash branch in
    // buildAdminFinanceSummary, which zeroed message-linked flash costs.
    // Production truth for a main-turn exact is the settled usage stage
    // (main-turn costs live in usage, not in ledger rows), so this fixture
    // carries settled shadowPricing with NO ledger rows: any ledger
    // involvement would be a second, different cost. Exact 76.5 must appear
    // in totals, net profit, and the model row exactly once.
    const db = financeDb();
    try {
      db.prepare(
        `INSERT INTO messages (id, chat_id, role, usage, deduction_slices, created_at, is_refunded)
         VALUES (1, 1, 'assistant', ?, ?, datetime('now'), 0)`
      ).run(
        JSON.stringify({
          model: CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL,
          modelLabel: "DeepSeek V4 Flash",
          provider: "cheaperinference",
          input: 1000,
          output: 500,
          cost: 5000,
          shadowPricing: {
            pricingVersion: 1,
            actualTurnCostCoverage: "complete",
            actualProviderCostKrw: 76.5,
            actualCostUsd: 0.05,
            actualCostSource: "cheaper_inference_billed",
            provider: "cheaperinference",
            modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL,
            fxSnapshot: { effectiveKrwPerUsd: 1530 },
          },
        }),
        JSON.stringify([{ pointType: "PAID", amount: 5000 }])
      );
      const summary = buildAdminFinanceSummary(db);
      assert.equal(summary.totalApiCostKrw, 76.5);
      assert.equal(summary.netProfitKrw, 5000 - 76.5);
      const flashRow = summary.modelBreakdown.find((r) => r.model === "DeepSeek V4 Flash");
      assert.ok(flashRow, "flash model row present");
      assert.equal(flashRow!.apiCostKrw, 76.5);
      const aiFlash = summary.aiModelCosts.find((r) => r.model === "DeepSeek V4 Flash");
      assert.ok(aiFlash, "flash union row present");
      assert.equal(aiFlash!.kind, "direct");
    } finally {
      db.close();
    }
  });

  it("S. atomic start dedup: pre-existing (provider, request) wins, no finalize double-write", () => {
    const db = financeDb();
    try {
      const first = recordBackgroundProviderCost(
        {
          provider: "cheaperinference",
          model: "s-model",
          requestKind: "background-memory-extract",
          cheaperInferenceBilledCostUsd: 0.009,
          providerRequestId: "req-s-1",
          outcome: "success",
          persistInTests: true,
        },
        db
      );
      assert.equal(first.recorded, true);
      // A racing worker with the same billing identity converges on the
      // existing row through the DB-level unique index (no in-memory flags).
      const racer = startProviderCostAttempt(
        {
          chatId: null,
          assistantMessageId: null,
          generationSequence: 0,
          family: "background",
          fundingClass: "platform_funded",
          executionPhase: "async_post_turn",
          jobAttemptOrdinal: 1,
          requestedProvider: "cheaperinference",
          requestedModel: "s-model",
          providerRequestId: "req-s-1",
          persistInTests: true,
        },
        db
      );
      assert.equal(racer.deduplicated, true);
      const second = recordBackgroundProviderCost(
        {
          provider: "cheaperinference",
          model: "s-model",
          requestKind: "background-memory-extract",
          cheaperInferenceBilledCostUsd: 0.009,
          providerRequestId: "req-s-1",
          outcome: "success",
          persistInTests: true,
        },
        db
      );
      assert.equal(second.recorded, false);
      assert.equal(second.eventKey, first.eventKey);
      const count = (
        db.prepare("SELECT COUNT(*) AS c FROM api_cost_ledger WHERE provider_request_id='req-s-1'").get() as {
          c: number;
        }
      ).c;
      assert.equal(count, 1);
    } finally {
      db.close();
    }
  });

  it("T. cross-provider same raw request id does not collide", () => {
    const db = financeDb();
    try {
      const a = recordBackgroundProviderCost(
        {
          provider: "cheaperinference",
          model: "t-model-a",
          requestKind: "background-memory-extract",
          cheaperInferenceBilledCostUsd: 0.002,
          providerRequestId: "same-raw-id",
          outcome: "success",
          persistInTests: true,
        },
        db
      );
      const b = recordBackgroundProviderCost(
        {
          provider: "openrouter",
          model: "t-model-b",
          requestKind: "background-memory-extract",
          upstreamCostUsd: 0.003,
          providerRequestId: "same-raw-id",
          outcome: "success",
          persistInTests: true,
        },
        db
      );
      assert.equal(a.recorded, true);
      assert.equal(b.recorded, true);
      assert.notEqual(a.eventKey, b.eventKey);
      const count = (
        db.prepare("SELECT COUNT(*) AS c FROM api_cost_ledger WHERE provider_request_id='same-raw-id'").get() as {
          c: number;
        }
      ).c;
      assert.equal(count, 2);
    } finally {
      db.close();
    }
  });

  it("U. assetVisionStructured passes the exact CI invocation (no react-server condition)", () => {    const visionSource = readFileSync(join(process.cwd(), "src/lib/vision.ts"), "utf8");
    assert.equal(
      visionSource.includes("providerCostLedger"),
      false,
      "pure vision module keeps no server-only ledger boundary"
    );
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "--test", "src/lib/assetVisionStructured.test.ts"],
      { cwd: process.cwd(), timeout: 240000, encoding: "utf8" }
    );
    assert.equal(
      result.status,
      0,
      `CI-equivalent invocation must exit 0, stderr: ${(result.stderr as string ?? "").slice(-2000)}`
    );
  });
});

describe("admin finance actual cost — billing-identity hardening V-Y", () => {
  function dirtyLegacyDb(): Database.Database {
    // True dirty legacy shape: full columns, NO partial unique index, then
    // two rows sharing one (provider, request id) — the state in which
    // index creation must be skipped without breaking boot or writers.
    const db = financeDbBare();
    ensureProviderCostLedgerSchema(db);
    db.exec("DROP INDEX IF EXISTS idx_api_cost_ledger_provider_request");
    db.prepare(
      `INSERT INTO api_cost_ledger
        (provider, model, request_kind, provider_request_id, event_status,
         actual_cost_usd, actual_cost_source, exchange_rate_krw_per_usd,
         cost_krw, estimated, created_at)
       VALUES ('cheaperinference', 'dirty-model', 'background-memory-extract',
         'req-dirty-1', 'settled', 0.001, 'cheaper_inference_billed', 1500, 1.5, 0,
         datetime('now'))`
    ).run();
    db.prepare(
      `INSERT INTO api_cost_ledger
        (provider, model, request_kind, provider_request_id, event_status,
         actual_cost_usd, actual_cost_source, exchange_rate_krw_per_usd,
         cost_krw, estimated, created_at)
       VALUES ('cheaperinference', 'dirty-model', 'background-memory-extract',
         'req-dirty-1', 'settled', 0.001, 'cheaper_inference_billed', 1500, 1.5, 0,
         datetime('now'))`
    ).run();
    return db;
  }

  function identityCount(db: Database.Database, provider: string, requestId: string): number {
    return (
      db
        .prepare(
          "SELECT COUNT(*) AS c FROM api_cost_ledger WHERE provider = ? AND provider_request_id = ?"
        )
        .get(provider, requestId) as { c: number }
    ).c;
  }

  it("V. dirty legacy duplicates: ensure survives, writer never errors, no new dup", () => {
    const db = dirtyLegacyDb();
    try {
      assert.equal(identityCount(db, "cheaperinference", "req-dirty-1"), 2);
      ensureProviderCostLedgerSchema(db);
      assert.equal(hasProviderRequestIdempotencyIndex(db), false, "unique index skipped, boot survives");
      const rowsBefore = (
        db.prepare("SELECT COUNT(*) AS c FROM api_cost_ledger").get() as { c: number }
      ).c;
      const replayed = recordBackgroundProviderCost(
        {
          provider: "cheaperinference",
          model: "v-model",
          requestKind: "background-memory-extract",
          cheaperInferenceBilledCostUsd: 0.009,
          providerRequestId: "req-dirty-1",
          outcome: "success",
          persistInTests: true,
        },
        db
      );
      // Same (provider, requestId) is the same billable request even on a
      // dirty DB: replay the stored row, mint nothing, drop nothing.
      assert.equal(replayed.recorded, false);
      assert.equal(identityCount(db, "cheaperinference", "req-dirty-1"), 2, "no third duplicate row");
      assert.equal(
        (db.prepare("SELECT COUNT(*) AS c FROM api_cost_ledger").get() as { c: number }).c,
        rowsBefore,
        "no NULL unlink row minted for a known identity"
      );
    } finally {
      db.close();
    }
  });

  it("W. clean DB owns the partial unique index; duplicate writers keep exactly 1 row", () => {
    const db = financeDb();
    try {
      ensureProviderCostLedgerSchema(db);
      const indexes = db
        .prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_api_cost_ledger_provider_request'")
        .all() as { sql: string }[];
      assert.equal(indexes.length, 1, "partial unique index exists on clean data");
      assert.ok(indexes[0]!.sql.includes("provider_request_id IS NOT NULL"));
      const first = recordBackgroundProviderCost(
        {
          provider: "cheaperinference",
          model: "w-model",
          requestKind: "background-memory-extract",
          cheaperInferenceBilledCostUsd: 0.005,
          providerRequestId: "req-w-1",
          outcome: "success",
          persistInTests: true,
        },
        db
      );
      const second = recordBackgroundProviderCost(
        {
          provider: "cheaperinference",
          model: "w-model",
          requestKind: "background-memory-extract",
          cheaperInferenceBilledCostUsd: 0.005,
          providerRequestId: "req-w-1",
          outcome: "success",
          persistInTests: true,
        },
        db
      );
      assert.equal(first.recorded, true);
      assert.equal(second.recorded, false);
      assert.equal(identityCount(db, "cheaperinference", "req-w-1"), 1);
    } finally {
      db.close();
    }
  });

  it("X. calls without providerRequestId use the normal event-identity path", () => {
    const db = financeDb();
    try {
      const first = recordBackgroundProviderCost(
        {
          provider: "openrouter",
          model: "x-model",
          requestKind: "comment-moderation",
          inputTokens: 40,
          outputTokens: 5,
          upstreamCostUsd: 0.001,
          outcome: "success",
          persistInTests: true,
        },
        db
      );
      const second = recordBackgroundProviderCost(
        {
          provider: "openrouter",
          model: "x-model",
          requestKind: "comment-moderation",
          inputTokens: 40,
          outputTokens: 5,
          upstreamCostUsd: 0.001,
          outcome: "success",
          persistInTests: true,
        },
        db
      );
      assert.equal(first.recorded, true);
      assert.equal(second.recorded, true);
      assert.notEqual(first.eventKey, second.eventKey);
      const count = (
        db.prepare("SELECT COUNT(*) AS c FROM api_cost_ledger").get() as { c: number }
      ).c;
      assert.equal(count, 2);
    } finally {
      db.close();
    }
  });

  it("Y. dirty-identity repeat adds no cost and no rows (exactly-once)", () => {
    const db = dirtyLegacyDb();
    try {
      ensureProviderCostLedgerSchema(db);
      const before = readLedgerPeriodCostAttribution(db, "2000-01-01", "2100-01-01").totals.actualKrw;
      const rowsBefore = (
        db.prepare("SELECT COUNT(*) AS c FROM api_cost_ledger").get() as { c: number }
      ).c;
      const replayed = recordBackgroundProviderCost(
        {
          provider: "cheaperinference",
          model: "y-model",
          requestKind: "background-memory-extract",
          cheaperInferenceBilledCostUsd: 0.009,
          providerRequestId: "req-dirty-1",
          outcome: "success",
          persistInTests: true,
        },
        db
      );
      assert.equal(replayed.recorded, false);
      const after = readLedgerPeriodCostAttribution(db, "2000-01-01", "2100-01-01").totals.actualKrw;
      assert.equal(after, before, "no double-count of a known billing identity");
      assert.equal(
        (db.prepare("SELECT COUNT(*) AS c FROM api_cost_ledger").get() as { c: number }).c,
        rowsBefore
      );
    } finally {
      db.close();
    }
  });

  it("Z. unrelated dirty A present: fresh B recorded twice costs exactly once", () => {
    // Billing invariant: same (provider, requestId) is the same billable
    // request. A NULL unlink row for the repeat would double-count B.
    const db = dirtyLegacyDb();
    try {
      ensureProviderCostLedgerSchema(db);
      const input = {
        provider: "cheaperinference",
        model: "z-model",
        requestKind: "background-memory-extract",
        cheaperInferenceBilledCostUsd: 0.011,
        providerRequestId: "req-fresh-b",
        outcome: "success" as const,
        persistInTests: true,
      };
      const first = recordBackgroundProviderCost(input, db);
      const second = recordBackgroundProviderCost(input, db);
      assert.equal(first.recorded, true);
      assert.equal(second.recorded, false);
      assert.equal(second.eventKey, first.eventKey);
      assert.equal(
        (
          db
            .prepare(
              "SELECT COUNT(*) AS c FROM api_cost_ledger WHERE provider='cheaperinference' AND provider_request_id='req-fresh-b'"
            )
            .get() as { c: number }
        ).c,
        1,
        "exactly one billing event for B"
      );
      const nullUnlink = (
        db
          .prepare(
            "SELECT COUNT(*) AS c FROM api_cost_ledger WHERE provider_request_id IS NULL AND actual_cost_usd = 0.011"
          )
          .get() as { c: number }
      ).c;
      assert.equal(nullUnlink, 0, "no NULL unlink row duplicating B");
      const totals = readLedgerPeriodCostAttribution(db, "2000-01-01", "2100-01-01").totals;
      assert.equal(totals.actualKrw, 3 + settledKrw(db, "req-fresh-b"), "dirty A (3.0) + B exactly once");
    } finally {
      db.close();
    }
  });

  it("AA. re-receiving a dirty identity creates no NULL-cost row", () => {
    const db = dirtyLegacyDb();
    try {
      ensureProviderCostLedgerSchema(db);
      const rowsBefore = (
        db.prepare("SELECT COUNT(*) AS c FROM api_cost_ledger").get() as { c: number }
      ).c;
      const result = recordBackgroundProviderCost(
        {
          provider: "cheaperinference",
          model: "aa-model",
          requestKind: "background-memory-extract",
          cheaperInferenceBilledCostUsd: 0.009,
          providerRequestId: "req-dirty-1",
          outcome: "success",
          persistInTests: true,
        },
        db
      );
      assert.equal(result.recorded, false, "same billing event replays, no new cost row");
      const rowsAfter = (
        db.prepare("SELECT COUNT(*) AS c FROM api_cost_ledger").get() as { c: number }
      ).c;
      assert.equal(rowsAfter, rowsBefore, "no NULL unlink row minted for a known identity");
    } finally {
      db.close();
    }
  });
});
