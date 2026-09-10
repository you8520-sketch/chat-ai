import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildAdminFinanceSummary } from "./adminFinance";
import { resolveBillingExchangeRateSnapshot } from "./exchangeRate";
import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
  MAIN_RP_USER_SELECTABLE_OPTIONS,
} from "./chatModels";
import { CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL } from "./chatModels";
import { ensureProviderCostLedgerSchema } from "./providerCostLedger";
import {
  finalizeProviderCostAttempt,
  readLedgerPeriodCostAttribution,
  recordBackgroundProviderCost,
  startProviderCostAttempt,
} from "./providerCostLedger";

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
      for (const db of [base, withCost]) {
        db.prepare(
          `INSERT INTO messages (id, chat_id, role, usage, deduction_slices, created_at, is_refunded)
           VALUES (1, 1, 'assistant', ?, ?, datetime('now'), 0)`
        ).run(
          JSON.stringify({ model: CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL }),
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
