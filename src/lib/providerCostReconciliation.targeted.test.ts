import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import type { UsageClientResult } from "./cheaperInferenceUsage";
import {
  reconcileCheaperInferenceRequestById,
  reconcileCheaperInferenceUsage,
  shouldTargetReconcileMainGeneration,
} from "./providerCostReconciliation";
import {
  ensureProviderCostLedgerSchema,
  listProviderCostEventsForAssistantMessage,
  recordMainGenerationProviderCost,
} from "./providerCostLedger";
import { resolveBillingExchangeRateSnapshot } from "./exchangeRate";

const FX = resolveBillingExchangeRateSnapshot().effectiveKrwPerUsd;

function db(): Database.Database {
  const d = new Database(":memory:");
  ensureProviderCostLedgerSchema(d);
  return d;
}

function mockFetch(
  pages: Array<{ requests: Array<Record<string, unknown>> }>,
  status = 200
) {
  let call = 0;
  return async (): Promise<
    UsageClientResult<{
      requests: Array<{
        requestId: string;
        status: string;
        billedMicroUsd: number;
        settled: boolean;
        model: string | null;
        endpoint: string | null;
        createdAt: string | null;
      }>;
      pages: number;
    }>
  > => {
    if (status === 403) {
      return { ok: false, reason: "http", status: 403, message: "usage API 403" };
    }
    if (status >= 500) {
      return { ok: false, reason: "http", status, message: `usage API ${status}` };
    }
    const page = pages[call] ?? { requests: [] };
    call += 1;
    const requests = page.requests.map((item) => {
      const billed = String(item.billed_cost_usd ?? "0");
      const micro = Math.round(Number(billed) * 1_000_000);
      const statusVal = String(item.status ?? "settled");
      return {
        requestId: String(item.request_id),
        status: statusVal,
        billedMicroUsd: micro,
        settled: micro > 0 && statusVal === "settled",
        model: typeof item.model === "string" ? item.model : null,
        endpoint: null,
        createdAt: "2026-09-18 00:12:27",
      };
    });
    return { ok: true, value: { requests, pages: call } };
  };
}

describe("providerCostReconciliation targeted request reconcile T1–T10", () => {
  const baseInput = {
    provider: "cheaperinference",
    providerRequestId: "0840da41-b1d4-4946-8175-c645e5613b77",
    model: "deepseek-v4-pro-0813",
    requestStartedAtMs: Date.parse("2026-09-18T00:12:27Z"),
    outcome: "success" as const,
    persistInTests: true,
  };

  it("T1 stream exact present → targeted lookup skip", async () => {
    let called = false;
    const fetchRequests = async () => {
      called = true;
      return { ok: true as const, value: { requests: [], pages: 0 } };
    };
    const result = await reconcileCheaperInferenceRequestById({
      ...baseInput,
      streamBilledCostUsd: 0.019894,
      deps: { fetchRequests, persistInTests: true },
    });
    assert.equal(result.attempted, false);
    assert.equal(called, false);
  });

  it("T2 unresolved ledger row + settled request → same row promoted", async () => {
    const d = db();
    try {
      recordMainGenerationProviderCost(
        {
          chatId: 1,
          assistantMessageId: 10,
          generationSequence: 0,
          provider: "cheaperinference",
          model: "deepseek-v4-pro-0813",
          providerRequestId: baseInput.providerRequestId,
          outcome: "success",
          persistInTests: true,
        },
        d
      );
      const result = await reconcileCheaperInferenceRequestById({
        ...baseInput,
        db: d,
        deps: {
          persistInTests: true,
          fetchRequests: mockFetch([
            {
              requests: [
                {
                  request_id: baseInput.providerRequestId,
                  status: "settled",
                  billed_cost_usd: "0.019894",
                  model: "deepseek-v4-pro-0813",
                },
              ],
            },
          ]),
        },
      });
      assert.equal(result.ledgerOutcome, "promoted");
      const rows = listProviderCostEventsForAssistantMessage(10, d);
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.actual_cost_source, "cheaper_inference_usage_api");
      assert.equal(rows[0]?.actual_cost_usd, 0.019894);
    } finally {
      d.close();
    }
  });

  it("T3 usage API 403/5xx → unresolved", async () => {
    const d = db();
    try {
      recordMainGenerationProviderCost(
        {
          chatId: 1,
          assistantMessageId: 11,
          generationSequence: 0,
          provider: "cheaperinference",
          model: "deepseek-v4-pro-0813",
          providerRequestId: baseInput.providerRequestId,
          outcome: "success",
          persistInTests: true,
        },
        d
      );
      const forbidden = await reconcileCheaperInferenceRequestById({
        ...baseInput,
        db: d,
        deps: { persistInTests: true, fetchRequests: mockFetch([], 403) },
      });
      assert.equal(forbidden.lookupOk, false);
      assert.equal(
        listProviderCostEventsForAssistantMessage(11, d)[0]?.event_status,
        "completed_without_exact_cost"
      );

      const serverError = await reconcileCheaperInferenceRequestById({
        ...baseInput,
        db: d,
        deps: { persistInTests: true, fetchRequests: mockFetch([], 503) },
      });
      assert.equal(serverError.lookupOk, false);
    } finally {
      d.close();
    }
  });

  it("T4 pending/not-found → unresolved", async () => {
    const d = db();
    try {
      recordMainGenerationProviderCost(
        {
          chatId: 1,
          assistantMessageId: 12,
          generationSequence: 0,
          provider: "cheaperinference",
          model: "deepseek-v4-pro-0813",
          providerRequestId: baseInput.providerRequestId,
          outcome: "success",
          persistInTests: true,
        },
        d
      );
      const pending = await reconcileCheaperInferenceRequestById({
        ...baseInput,
        db: d,
        deps: {
          persistInTests: true,
          fetchRequests: mockFetch([
            {
              requests: [
                {
                  request_id: baseInput.providerRequestId,
                  status: "pending",
                  billed_cost_usd: "0.019894",
                },
              ],
            },
          ]),
        },
      });
      assert.equal(pending.requestStatus, "pending");
      assert.equal(
        listProviderCostEventsForAssistantMessage(12, d)[0]?.actual_cost_source,
        "unavailable"
      );

      const missing = await reconcileCheaperInferenceRequestById({
        ...baseInput,
        db: d,
        deps: {
          persistInTests: true,
          fetchRequests: mockFetch([{ requests: [] }]),
        },
      });
      assert.equal(missing.requestFound, false);
    } finally {
      d.close();
    }
  });

  it("T5 wrong request id → no attach", async () => {
    const d = db();
    try {
      recordMainGenerationProviderCost(
        {
          chatId: 1,
          assistantMessageId: 13,
          generationSequence: 0,
          provider: "cheaperinference",
          model: "deepseek-v4-pro-0813",
          providerRequestId: "actual-request-id",
          outcome: "success",
          persistInTests: true,
        },
        d
      );
      await reconcileCheaperInferenceRequestById({
        ...baseInput,
        providerRequestId: "actual-request-id",
        db: d,
        deps: {
          persistInTests: true,
          fetchRequests: mockFetch([
            {
              requests: [
                {
                  request_id: "different-request-id",
                  status: "settled",
                  billed_cost_usd: "0.019894",
                },
              ],
            },
          ]),
        },
      });
      assert.equal(
        listProviderCostEventsForAssistantMessage(13, d)[0]?.actual_cost_source,
        "unavailable"
      );
    } finally {
      d.close();
    }
  });

  it("T6 regen request ids separated", async () => {
    const d = db();
    try {
      recordMainGenerationProviderCost(
        {
          chatId: 1,
          assistantMessageId: 14,
          generationSequence: 0,
          provider: "cheaperinference",
          model: "deepseek-v4-pro-0813",
          providerRequestId: "req-variant-a",
          outcome: "success",
          persistInTests: true,
        },
        d
      );
      recordMainGenerationProviderCost(
        {
          chatId: 1,
          assistantMessageId: 14,
          generationSequence: 1,
          provider: "cheaperinference",
          model: "deepseek-v4-pro-0813",
          providerRequestId: "req-variant-b",
          outcome: "success",
          persistInTests: true,
        },
        d
      );
      await reconcileCheaperInferenceRequestById({
        ...baseInput,
        providerRequestId: "req-variant-b",
        db: d,
        deps: {
          persistInTests: true,
          fetchRequests: mockFetch([
            {
              requests: [
                {
                  request_id: "req-variant-b",
                  status: "settled",
                  billed_cost_usd: "0.008000",
                },
              ],
            },
          ]),
        },
      });
      const rows = listProviderCostEventsForAssistantMessage(14, d);
      const rowA = rows.find((r) => r.generation_sequence === 0);
      const rowB = rows.find((r) => r.generation_sequence === 1);
      assert.equal(rowA?.actual_cost_source, "unavailable");
      assert.equal(rowB?.actual_cost_usd, 0.008);
    } finally {
      d.close();
    }
  });

  it("T7 existing exact row → no duplicate", async () => {
    const d = db();
    try {
      recordMainGenerationProviderCost(
        {
          chatId: 1,
          assistantMessageId: 15,
          generationSequence: 0,
          provider: "cheaperinference",
          model: "deepseek-v4-pro-0813",
          providerRequestId: baseInput.providerRequestId,
          cheaperInferenceBilledCostUsd: 0.019894,
          outcome: "success",
          persistInTests: true,
        },
        d
      );
      const result = await reconcileCheaperInferenceRequestById({
        ...baseInput,
        streamBilledCostUsd: 0.019894,
        db: d,
        deps: {
          persistInTests: true,
          fetchRequests: mockFetch([
            {
              requests: [
                {
                  request_id: baseInput.providerRequestId,
                  status: "settled",
                  billed_cost_usd: "0.019894",
                },
              ],
            },
          ]),
        },
      });
      assert.equal(result.attempted, false);
      assert.equal(listProviderCostEventsForAssistantMessage(15, d).length, 1);
    } finally {
      d.close();
    }
  });

  it("T8 targeted miss → full-window reconciliation later promotes same row", async () => {
    const d = db();
    try {
      d.exec(`
        CREATE TABLE IF NOT EXISTS messages (
          id INTEGER PRIMARY KEY, chat_id INTEGER NOT NULL DEFAULT 1, role TEXT NOT NULL,
          content TEXT NOT NULL DEFAULT '', request_id TEXT, usage TEXT, deduction_slices TEXT,
          model TEXT NOT NULL DEFAULT '', alternates TEXT NOT NULL DEFAULT '[]',
          active_variant INTEGER NOT NULL DEFAULT 0, generation_status TEXT NOT NULL DEFAULT 'completed',
          created_at TEXT NOT NULL DEFAULT (datetime('now')), is_refunded INTEGER NOT NULL DEFAULT 0
        );
      `);
      recordMainGenerationProviderCost(
        {
          chatId: 1,
          assistantMessageId: 16,
          generationSequence: 0,
          provider: "cheaperinference",
          model: "deepseek-v4-pro-0813",
          providerRequestId: baseInput.providerRequestId,
          outcome: "success",
          persistInTests: true,
        },
        d
      );
      const miss = await reconcileCheaperInferenceRequestById({
        ...baseInput,
        db: d,
        deps: {
          persistInTests: true,
          fetchRequests: mockFetch([{ requests: [] }]),
        },
      });
      assert.equal(miss.requestFound, false);

      const window = await reconcileCheaperInferenceUsage({
        windowStart: "2026-09-18 00:00:00",
        windowEnd: "2026-09-19 00:00:00",
        db: d,
        deps: {
          persistInTests: true,
          fetchRequests: mockFetch([
            {
              requests: [
                {
                  request_id: baseInput.providerRequestId,
                  status: "settled",
                  billed_cost_usd: "0.019894",
                },
              ],
            },
          ]),
          fetchDaily: async () => ({ ok: true, value: { settledMicroUsd: 19_894 } }),
        },
      });
      assert.equal(window.promoted, 1);
      assert.equal(
        listProviderCostEventsForAssistantMessage(16, d)[0]?.actual_cost_source,
        "cheaper_inference_usage_api"
      );
    } finally {
      d.close();
    }
  });

  it("T9 FX semantics identical to latest main — exchange_rate not rewritten on promote", async () => {
    const d = db();
    try {
      const requestFx = FX * 0.99;
      recordMainGenerationProviderCost(
        {
          chatId: 1,
          assistantMessageId: 17,
          generationSequence: 0,
          provider: "cheaperinference",
          model: "deepseek-v4-pro-0813",
          providerRequestId: baseInput.providerRequestId,
          exchangeRateKrwPerUsd: requestFx,
          outcome: "success",
          persistInTests: true,
        },
        d
      );
      const before = listProviderCostEventsForAssistantMessage(17, d)[0];
      assert.equal(before?.exchange_rate_krw_per_usd, requestFx);

      await reconcileCheaperInferenceRequestById({
        ...baseInput,
        db: d,
        deps: {
          persistInTests: true,
          fetchRequests: mockFetch([
            {
              requests: [
                {
                  request_id: baseInput.providerRequestId,
                  status: "settled",
                  billed_cost_usd: "0.019894",
                },
              ],
            },
          ]),
        },
      });

      const after = listProviderCostEventsForAssistantMessage(17, d)[0];
      assert.equal(after?.exchange_rate_krw_per_usd, requestFx);
    } finally {
      d.close();
    }
  });

  it("T10 eligibility gate — no Usage API when stream exact or non-CI", () => {
    assert.equal(
      shouldTargetReconcileMainGeneration({
        provider: "cheaperinference",
        providerRequestId: "req-1",
        streamBilledCostUsd: undefined,
        outcome: "success",
      }),
      true
    );
    assert.equal(
      shouldTargetReconcileMainGeneration({
        provider: "openrouter",
        providerRequestId: "req-1",
        streamBilledCostUsd: undefined,
        outcome: "success",
      }),
      false
    );
  });
});
