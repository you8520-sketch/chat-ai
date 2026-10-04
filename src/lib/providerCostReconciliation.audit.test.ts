import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";

import { buildAdminFinanceSummary, currentKstMonthKey, monthRangeSql } from "@/lib/adminFinance";
import { buildFinanceAnomalyReport } from "@/lib/financeAnomalyRadar";
import {
  ensureProviderCostLedgerSchema,
  recordMainGenerationProviderCost,
} from "@/lib/providerCostLedger";
import {
  reconcileCheaperInferenceUsage,
  type ProviderReconciliationResult,
} from "@/lib/providerCostReconciliation";
import type { CheaperInferenceUsageRequest } from "@/lib/cheaperInferenceUsage";

function db(): Database.Database {
  const d = new Database(":memory:");
  d.exec(`
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY, chat_id INTEGER NOT NULL DEFAULT 1, role TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '', request_id TEXT, usage TEXT, deduction_slices TEXT,
      model TEXT NOT NULL DEFAULT '', alternates TEXT NOT NULL DEFAULT '[]',
      active_variant INTEGER NOT NULL DEFAULT 0, generation_status TEXT NOT NULL DEFAULT 'completed',
      created_at TEXT NOT NULL DEFAULT (datetime('now')), is_refunded INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE point_gifts (id INTEGER PRIMARY KEY, paid_fee_amount REAL NOT NULL DEFAULT 0,
      free_fee_amount REAL NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE creator_earnings (id INTEGER PRIMARY KEY, reward_amount REAL NOT NULL DEFAULT 0,
      reversed INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE withdrawal_requests (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL DEFAULT 0,
      requested_cp REAL NOT NULL DEFAULT 0, tax_amount REAL NOT NULL DEFAULT 0,
      platform_fee REAL NOT NULL DEFAULT 0, payout_amount REAL NOT NULL DEFAULT 0,
      account_info TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'PENDING',
      processed_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE portone_checkouts (id INTEGER PRIMARY KEY, amount REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending', paid_at TEXT);
    CREATE TABLE chat_image_generations (id INTEGER PRIMARY KEY, upstream_cost_usd REAL,
      deduction_slices TEXT, exchange_rate_krw_per_usd REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')));
  `);
  ensureProviderCostLedgerSchema(d);
  return d;
}

function settled(
  requestId: string,
  billedMicroUsd: number,
  createdAt: string
): CheaperInferenceUsageRequest {
  return {
    requestId,
    status: "settled",
    billedMicroUsd,
    settled: true,
    model: "deepseek-v4-pro-0813",
    endpoint: "/chat/completions",
    createdAt,
  };
}

function insertIdentity(
  d: Database.Database,
  opts: { id: number; requestId: string; createdAt: string }
): void {
  d.prepare(
    `INSERT INTO messages (id, chat_id, role, content, usage, created_at)
     VALUES (?, 1, 'assistant', 'ok', ?, ?)`
  ).run(
    opts.id,
    JSON.stringify({
      stages: [
        {
          stage: "main",
          providerRequestId: opts.requestId,
          model: "deepseek-v4-pro-0813",
        },
      ],
    }),
    opts.createdAt
  );
}

async function reconcile(
  d: Database.Database,
  input: {
    windowStart: string;
    windowEnd: string;
    requests: CheaperInferenceUsageRequest[];
    dailyMicroUsd: number;
    fetchOk?: boolean;
    incomplete?: boolean;
    captureWindow?: { startAt: string; endAt: string };
    nowMs?: number;
    observedSinceEnv?: string | null;
  }
): Promise<ProviderReconciliationResult> {
  return reconcileCheaperInferenceUsage({
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    db: d,
    deps: {
      persistInTests: true,
      now: input.nowMs != null ? () => input.nowMs! : undefined,
      observedSinceEnv: input.observedSinceEnv,
      fetchRequests: async (opts) => {
        if (input.incomplete) {
          return {
            ok: false,
            reason: "incomplete",
            message: "usage requests pagination hit the 50-page safety cap with more pages remaining",
          };
        }
        if (input.fetchOk === false) {
          return { ok: false, reason: "http", status: 503, message: "usage API 503" };
        }
        if (input.captureWindow) {
          input.captureWindow.startAt = opts.startAt;
          input.captureWindow.endAt = opts.endAt;
        }
        return { ok: true, value: { pages: 1, requests: input.requests } };
      },
      fetchDaily: async () => ({ ok: true, value: { settledMicroUsd: input.dailyMicroUsd } }),
    },
  });
}

function anomalyCodes(result: ProviderReconciliationResult): string[] {
  const summary = {
    monthKey: "2026-10",
    providerReconciliation: result,
  } as unknown as Parameters<typeof buildFinanceAnomalyReport>[0]["summary"];
  return buildFinanceAnomalyReport({
    summary,
    pricing: null,
  }).anomalies.map((row) => row.code);
}

describe("provider cost reconciliation audit #1337", () => {
  it("treats mismatch and unreconciled spend as one stored state, not two missing-cost events", async () => {
    const d = db();
    try {
      const result = await reconcile(d, {
        windowStart: "2026-10-01 00:00:00",
        windowEnd: "2026-11-01 00:00:00",
        requests: [settled("orphan-settled", 125_000, "2026-10-02 01:00:00")],
        dailyMicroUsd: 125_000,
        nowMs: Date.parse("2026-10-03T14:00:00.000Z"),
      });
      assert.equal(result.status, "mismatch");
      assert.equal(result.unreconciledProviderMicroUsd, 125_000);
      assert.equal(result.localReconciledMicroUsd, 0);
      assert.equal(result.forwardAudit?.cases.includes("zero_new_calls"), true);
      assert.equal(result.forwardAudit?.unmatchedSettledMicroUsd, 0);
      // Month residue stays on the stored row but is not a new current warning.
      assert.deepEqual(anomalyCodes(result), []);
    } finally {
      d.close();
    }
  });

  it("sends the KST month key to the provider as a UTC calendar instant range", async () => {
    const d = db();
    try {
      const monthKey = currentKstMonthKey(Date.parse("2026-10-02T09:00:00.000Z"));
      assert.equal(monthKey, "2026-10");
      const range = monthRangeSql(monthKey);
      const captureWindow = { startAt: "", endAt: "" };
      await reconcile(d, {
        windowStart: range.start,
        windowEnd: range.end,
        requests: [],
        dailyMicroUsd: 0,
        captureWindow,
      });
      assert.equal(captureWindow.startAt, "2026-10-01T00:00:00Z");
      assert.equal(captureWindow.endAt, "2026-11-01T00:00:00Z");
      assert.ok("2026-09-30 15:00:00" < range.start);
    } finally {
      d.close();
    }
  });

  it("skips unsettled provider rows instead of counting them as unreconciled spend", async () => {
    const d = db();
    try {
      const result = await reconcile(d, {
        windowStart: "2026-10-01 00:00:00",
        windowEnd: "2026-11-01 00:00:00",
        requests: [
          {
            requestId: "pending-1",
            status: "pending",
            billedMicroUsd: 0,
            settled: false,
            model: "deepseek-v4-pro-0813",
            endpoint: "/chat/completions",
            createdAt: "2026-10-02 01:00:00",
          },
        ],
        dailyMicroUsd: 0,
      });
      assert.equal(result.status, "matched");
      assert.equal(result.skipped, 1);
      assert.equal(result.unreconciledProviderMicroUsd, 0);
      assert.deepEqual(anomalyCodes(result), []);
    } finally {
      d.close();
    }
  });

  it("marks truncated provider pages pending and does not invent a mismatch", async () => {
    const d = db();
    try {
      const result = await reconcile(d, {
        windowStart: "2026-10-01 00:00:00",
        windowEnd: "2026-11-01 00:00:00",
        requests: [],
        dailyMicroUsd: 0,
        incomplete: true,
      });
      assert.equal(result.status, "pending");
      assert.match(result.message, /safety cap/);
      assert.deepEqual(anomalyCodes(result), ["PROVIDER_RECONCILIATION_UNAVAILABLE"]);
    } finally {
      d.close();
    }
  });

  it("does not attach a settled request when the message identity is outside the window", async () => {
    const d = db();
    try {
      insertIdentity(d, {
        id: 1,
        requestId: "late-message",
        createdAt: "2026-11-01 00:00:05",
      });
      const result = await reconcile(d, {
        windowStart: "2026-10-01 00:00:00",
        windowEnd: "2026-11-01 00:00:00",
        requests: [settled("late-message", 50_000, "2026-10-31 23:59:50")],
        dailyMicroUsd: 50_000,
      });
      assert.equal(result.inserted, 0);
      assert.equal(result.unreconciledProviderMicroUsd, 50_000);
      assert.equal(result.status, "mismatch");
    } finally {
      d.close();
    }
  });

  it("recovers a settled request once when the message identity is inside the window", async () => {
    const d = db();
    try {
      insertIdentity(d, {
        id: 2,
        requestId: "linked-message",
        createdAt: "2026-10-02 01:00:00",
      });
      const first = await reconcile(d, {
        windowStart: "2026-10-01 00:00:00",
        windowEnd: "2026-11-01 00:00:00",
        requests: [settled("linked-message", 50_000, "2026-10-02 01:00:00")],
        dailyMicroUsd: 50_000,
      });
      assert.equal(first.status, "matched");
      assert.equal(first.inserted, 1);
      assert.equal(first.unreconciledProviderMicroUsd, 0);

      const second = await reconcile(d, {
        windowStart: "2026-10-01 00:00:00",
        windowEnd: "2026-11-01 00:00:00",
        requests: [settled("linked-message", 50_000, "2026-10-02 01:00:00")],
        dailyMicroUsd: 50_000,
      });
      assert.equal(second.status, "matched");
      assert.equal(second.matched, 1);
      assert.equal(second.inserted, 0);
    } finally {
      d.close();
    }
  });

  it("does not double-count a request that already has a ledger row", async () => {
    const d = db();
    try {
      recordMainGenerationProviderCost(
        {
          chatId: 1,
          assistantMessageId: 3,
          generationSequence: 0,
          provider: "cheaperinference",
          model: "deepseek-v4-pro-0813",
          providerRequestId: "already-ledgered",
          cheaperInferenceBilledCostUsd: 0.05,
          outcome: "success",
          persistInTests: true,
          eventTime: "2026-10-02 01:00:00",
        },
        d
      );
      const result = await reconcile(d, {
        windowStart: "2026-10-01 00:00:00",
        windowEnd: "2026-11-01 00:00:00",
        requests: [settled("already-ledgered", 50_000, "2026-10-02 01:00:00")],
        dailyMicroUsd: 50_000,
      });
      assert.equal(result.status, "matched");
      assert.ok(result.matched + result.promoted >= 1);
      assert.equal(result.inserted, 0);
      const count = (
        d
          .prepare("SELECT COUNT(*) AS c FROM api_cost_ledger WHERE provider_request_id='already-ledgered'")
          .get() as { c: number }
      ).c;
      assert.equal(count, 1);
    } finally {
      d.close();
    }
  });

  it("preserves last good numbers after provider failure and recovers on rerun", async () => {
    const d = db();
    try {
      insertIdentity(d, {
        id: 4,
        requestId: "recover-1",
        createdAt: "2026-10-02 01:00:00",
      });
      const ok = await reconcile(d, {
        windowStart: "2026-10-01 00:00:00",
        windowEnd: "2026-11-01 00:00:00",
        requests: [settled("recover-1", 40_000, "2026-10-02 01:00:00")],
        dailyMicroUsd: 40_000,
        nowMs: Date.parse("2026-10-03T14:00:00.000Z"),
      });
      assert.equal(ok.status, "matched");

      const failed = await reconcile(d, {
        windowStart: "2026-10-01 00:00:00",
        windowEnd: "2026-11-01 00:00:00",
        requests: [],
        dailyMicroUsd: 40_000,
        fetchOk: false,
      });
      assert.equal(failed.status, "provider_unavailable");
      assert.equal(failed.localReconciledMicroUsd, ok.localReconciledMicroUsd);
      assert.equal(failed.settledMicroUsd, ok.settledMicroUsd);
      assert.equal(failed.forwardAudit?.observedSince, ok.forwardAudit?.observedSince);
      assert.equal(failed.forwardAudit?.fetchStatus, "http");
      assert.deepEqual(failed.forwardAudit?.cases, ["fetch_failure"]);

      const rerun = await reconcile(d, {
        windowStart: "2026-10-01 00:00:00",
        windowEnd: "2026-11-01 00:00:00",
        requests: [settled("recover-1", 40_000, "2026-10-02 01:00:00")],
        dailyMicroUsd: 40_000,
      });
      assert.equal(rerun.status, "matched");
      assert.equal(rerun.localReconciledMicroUsd, ok.localReconciledMicroUsd);
    } finally {
      d.close();
    }
  });

  it("audits only the forward window and does not mix month residue into new unmatched cost", async () => {
    const d = db();
    try {
      const historical = await reconcile(d, {
        windowStart: "2026-10-01 00:00:00",
        windowEnd: "2026-11-01 00:00:00",
        requests: [settled("hist-orphan", 125_000, "2026-10-02 01:00:00")],
        dailyMicroUsd: 125_000,
        nowMs: Date.parse("2026-10-03T12:00:00.000Z"),
      });
      assert.equal(historical.status, "mismatch");
      assert.equal(historical.unreconciledProviderMicroUsd, 125_000);
      assert.equal(historical.forwardAudit?.unmatchedSettledMicroUsd, 0);

      const withNew = await reconcile(d, {
        windowStart: "2026-10-01 00:00:00",
        windowEnd: "2026-11-01 00:00:00",
        requests: [
          settled("hist-orphan", 125_000, "2026-10-02 01:00:00"),
          {
            requestId: "new-luna",
            status: "settled",
            billedMicroUsd: 8_000,
            settled: true,
            model: "gpt-6-luna",
            endpoint: "/chat/completions",
            createdAt: "2026-10-03 13:00:00",
          },
        ],
        dailyMicroUsd: 133_000,
        nowMs: Date.parse("2026-10-03T14:00:00.000Z"),
      });
      assert.equal(withNew.status, "mismatch");
      assert.equal(withNew.unreconciledProviderMicroUsd, 133_000);
      assert.equal(withNew.forwardAudit?.unmatchedLedgerCount, 1);
      assert.equal(withNew.forwardAudit?.unmatchedSettledMicroUsd, 8_000);
      assert.equal(withNew.forwardAudit?.cases.includes("unmatched_luna"), true);
      assert.deepEqual(anomalyCodes(withNew), ["FORWARD_UNMATCHED_REMOTE_SPEND"]);
    } finally {
      d.close();
    }
  });

  it("does not let the anomaly projection change finance totals", async () => {
    const d = db();
    try {
      insertIdentity(d, {
        id: 5,
        requestId: "totals-1",
        createdAt: "2026-10-02 01:00:00",
      });
      const result = await reconcile(d, {
        windowStart: "2026-10-01 00:00:00",
        windowEnd: "2026-11-01 00:00:00",
        requests: [settled("totals-1", 10_000, "2026-10-02 01:00:00")],
        dailyMicroUsd: 10_000,
      });
      const before = buildAdminFinanceSummary(d, "2026-10");
      const report = buildFinanceAnomalyReport({
        summary: before,
        pricing: null,
      });
      const after = buildAdminFinanceSummary(d, "2026-10");
      assert.equal(result.status, "matched");
      assert.equal(report.status, "HEALTHY");
      assert.equal(after.totalApiCostKrw, before.totalApiCostKrw);
      assert.equal(after.aiCost.totalActualKrw, before.aiCost.totalActualKrw);
    } finally {
      d.close();
    }
  });
});
