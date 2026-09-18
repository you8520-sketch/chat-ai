import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import { fetchAllUsageRequests } from "./cheaperInferenceUsage";
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
const REQUEST_STARTED_MS = Date.parse("2026-09-18T00:12:27Z");
const FIXED_NOW_MS = Date.parse("2026-09-18T00:14:00Z");

function db(): Database.Database {
  const d = new Database(":memory:");
  ensureProviderCostLedgerSchema(d);
  return d;
}

/** Raw Usage API payloads parsed by production cheaperInferenceUsage client. */
function usageApiFetchImpl(
  pages: Array<{ data: Array<Record<string, unknown>> }>,
  httpStatus = 200
): typeof fetch {
  let call = 0;
  return (async () => {
    if (httpStatus === 403) {
      return new Response("forbidden", { status: 403 });
    }
    if (httpStatus >= 500) {
      return new Response("error", { status: httpStatus });
    }
    const page = pages[call] ?? { data: [] };
    call += 1;
    return new Response(JSON.stringify(page), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

function depsWithUsagePages(
  pages: Array<{ data: Array<Record<string, unknown>> }>,
  opts?: { httpStatus?: number; now?: number }
) {
  const fetchImpl = usageApiFetchImpl(pages, opts?.httpStatus ?? 200);
  return {
    persistInTests: true,
    now: opts?.now != null ? () => opts.now! : undefined,
    fetchRequests: (requestOpts) =>
      fetchAllUsageRequests({ ...requestOpts, fetchImpl }),
    fetchDaily: async () => ({ ok: true, value: { settledMicroUsd: 0 } }),
  };
}

function ensureMessagesTable(d: Database.Database): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY, chat_id INTEGER NOT NULL DEFAULT 1, role TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '', request_id TEXT, usage TEXT, deduction_slices TEXT,
      model TEXT NOT NULL DEFAULT '', alternates TEXT NOT NULL DEFAULT '[]',
      active_variant INTEGER NOT NULL DEFAULT 0, generation_status TEXT NOT NULL DEFAULT 'completed',
      created_at TEXT NOT NULL DEFAULT (datetime('now')), is_refunded INTEGER NOT NULL DEFAULT 0
    );
  `);
}

describe("providerCostReconciliation targeted request reconcile T1–T11", () => {
  let restoreKey: string | undefined;

  beforeEach(() => {
    restoreKey = process.env.CHEAPER_INFERENCE_API_KEY;
    process.env.CHEAPER_INFERENCE_API_KEY = "test-key";
  });

  afterEach(() => {
    if (restoreKey === undefined) delete process.env.CHEAPER_INFERENCE_API_KEY;
    else process.env.CHEAPER_INFERENCE_API_KEY = restoreKey;
  });

  const baseInput = {
    provider: "cheaperinference",
    providerRequestId: "0840da41-b1d4-4946-8175-c645e5613b77",
    requestStartedAtMs: REQUEST_STARTED_MS,
    outcome: "success" as const,
  };

  it("T1 stream exact present → targeted lookup skip", async () => {
    let called = false;
    const result = await reconcileCheaperInferenceRequestById({
      ...baseInput,
      streamBilledCostUsd: 0.019894,
      deps: {
        persistInTests: true,
        fetchRequests: async () => {
          called = true;
          return { ok: true, value: { requests: [], pages: 0 } };
        },
      },
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
        deps: depsWithUsagePages([
          {
            data: [
              {
                request_id: baseInput.providerRequestId,
                status: "settled",
                billed_cost_usd: "0.019894",
                model: "deepseek-v4-pro-0813",
              },
            ],
          },
        ]),
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
        deps: depsWithUsagePages([], { httpStatus: 403 }),
      });
      assert.equal(forbidden.lookupOk, false);
      assert.equal(
        listProviderCostEventsForAssistantMessage(11, d)[0]?.event_status,
        "completed_without_exact_cost"
      );

      const serverError = await reconcileCheaperInferenceRequestById({
        ...baseInput,
        db: d,
        deps: depsWithUsagePages([], { httpStatus: 503 }),
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
        deps: depsWithUsagePages([
          {
            data: [
              {
                request_id: baseInput.providerRequestId,
                status: "pending",
                billed_cost_usd: "0",
              },
            ],
          },
        ]),
      });
      assert.equal(pending.requestStatus, "pending");
      assert.equal(
        listProviderCostEventsForAssistantMessage(12, d)[0]?.actual_cost_source,
        "unavailable"
      );

      const missing = await reconcileCheaperInferenceRequestById({
        ...baseInput,
        db: d,
        deps: depsWithUsagePages([{ data: [] }]),
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
        deps: depsWithUsagePages([
          {
            data: [
              {
                request_id: "different-request-id",
                status: "settled",
                billed_cost_usd: "0.019894",
              },
            ],
          },
        ]),
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
        deps: depsWithUsagePages([
          {
            data: [
              {
                request_id: "req-variant-b",
                status: "settled",
                billed_cost_usd: "0.008000",
              },
            ],
          },
        ]),
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
        deps: depsWithUsagePages([
          {
            data: [
              {
                request_id: baseInput.providerRequestId,
                status: "settled",
                billed_cost_usd: "0.019894",
              },
            ],
          },
        ]),
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
      ensureMessagesTable(d);
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
        deps: depsWithUsagePages([{ data: [] }]),
      });
      assert.equal(miss.requestFound, false);

      const window = await reconcileCheaperInferenceUsage({
        windowStart: "2026-09-18 00:00:00",
        windowEnd: "2026-09-19 00:00:00",
        db: d,
        deps: {
          ...depsWithUsagePages([
            {
              data: [
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
        deps: depsWithUsagePages([
          {
            data: [
              {
                request_id: baseInput.providerRequestId,
                status: "settled",
                billed_cost_usd: "0.019894",
              },
            ],
          },
        ]),
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

  it("T11 settlement parity — cached status uses canonical CheaperInferenceUsageRequest.settled", async () => {
    const requestId = "cached-req-parity";
    const pages = [
      {
        data: [
          {
            request_id: requestId,
            status: "cached",
            billed_cost_usd: "0.019894",
            model: "deepseek-v4-pro-0813",
          },
        ],
      },
    ];

    const dTargeted = db();
    const dWindow = db();
    try {
      ensureMessagesTable(dWindow);
      for (const d of [dTargeted, dWindow]) {
        recordMainGenerationProviderCost(
          {
            chatId: 1,
            assistantMessageId: 18,
            generationSequence: 0,
            provider: "cheaperinference",
            model: "deepseek-v4-pro-0813",
            providerRequestId: requestId,
            outcome: "success",
            persistInTests: true,
          },
          d
        );
      }

      const targeted = await reconcileCheaperInferenceRequestById({
        provider: "cheaperinference",
        providerRequestId: requestId,
        requestStartedAtMs: REQUEST_STARTED_MS,
        outcome: "success",
        db: dTargeted,
        deps: depsWithUsagePages(pages),
      });

      const window = await reconcileCheaperInferenceUsage({
        windowStart: "2026-09-18 00:00:00",
        windowEnd: "2026-09-19 00:00:00",
        db: dWindow,
        deps: {
          ...depsWithUsagePages(pages),
          fetchDaily: async () => ({ ok: true, value: { settledMicroUsd: 19_894 } }),
        },
      });

      assert.equal(targeted.ledgerOutcome, "promoted");
      assert.equal(window.promoted, 1);
      assert.equal(
        listProviderCostEventsForAssistantMessage(18, dTargeted)[0]?.actual_cost_usd,
        0.019894
      );
      assert.equal(
        listProviderCostEventsForAssistantMessage(18, dWindow)[0]?.actual_cost_usd,
        0.019894
      );
    } finally {
      dTargeted.close();
      dWindow.close();
    }
  });

  it("targeted lookup window uses ReconciliationDeps.now seam", async () => {
    let capturedStart = "";
    let capturedEnd = "";
    const d = db();
    try {
      recordMainGenerationProviderCost(
        {
          chatId: 1,
          assistantMessageId: 19,
          generationSequence: 0,
          provider: "cheaperinference",
          model: "deepseek-v4-pro-0813",
          providerRequestId: baseInput.providerRequestId,
          outcome: "success",
          persistInTests: true,
        },
        d
      );
      await reconcileCheaperInferenceRequestById({
        ...baseInput,
        db: d,
        deps: {
          ...depsWithUsagePages([{ data: [] }], { now: FIXED_NOW_MS }),
          fetchRequests: async (requestOpts) => {
            capturedStart = requestOpts.startAt;
            capturedEnd = requestOpts.endAt;
            return fetchAllUsageRequests({
              ...requestOpts,
              fetchImpl: usageApiFetchImpl([{ data: [] }]),
            });
          },
        },
      });
      assert.equal(
        capturedStart,
        new Date(Math.max(0, REQUEST_STARTED_MS - 2 * 60_000)).toISOString()
      );
      assert.equal(capturedEnd, new Date(FIXED_NOW_MS + 60_000).toISOString());
    } finally {
      d.close();
    }
  });
});
