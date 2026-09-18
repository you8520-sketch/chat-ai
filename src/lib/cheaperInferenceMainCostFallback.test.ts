import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import type { UsageClientResult } from "./cheaperInferenceUsage";
import {
  enrichMainGenerationCostFromUsageApi,
  shouldAttemptMainCostUsageApiFallback,
} from "./cheaperInferenceMainCostFallback";
import {
  ensureProviderCostLedgerSchema,
  listProviderCostEventsForAssistantMessage,
  recordMainGenerationProviderCost,
} from "./providerCostLedger";
import { resolveMessageTurnProviderCostKrw } from "./adminFinanceTurnCost";
import { resolveBillingExchangeRateSnapshot } from "./exchangeRate";
import type { Usage } from "./chatUsage";

const FX = resolveBillingExchangeRateSnapshot().effectiveKrwPerUsd;

function db(): Database.Database {
  const d = new Database(":memory:");
  ensureProviderCostLedgerSchema(d);
  return d;
}

function mockFetch(
  pages: Array<{ requests: Array<Record<string, unknown>>; nextCursor?: string | null }>,
  status = 200
) {
  let call = 0;
  return async (): Promise<
    UsageClientResult<{ requests: Array<{ requestId: string; status: string; billedMicroUsd: number; settled: boolean; model: string | null; endpoint: string | null; createdAt: string | null }>; pages: number }>
  > => {
    if (status === 403) {
      return { ok: false, reason: "http", status: 403, message: "usage API 403" };
    }
    if (status >= 500) {
      return { ok: false, reason: "http", status, message: `usage API ${status}` };
    }
    const page = pages[call] ?? { requests: [], nextCursor: null };
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
    return {
      ok: true,
      value: {
        requests,
        pages: call,
      },
    };
  };
}

function usage(actualKrw: number | null): Usage {
  return {
    input: 1000,
    output: 500,
    model: "deepseek-v4-pro-0813",
    modelLabel: "deepseek-v4-pro-0813",
    provider: "cheaperinference",
    cost: 5000,
  } as Usage;
}

describe("cheaperInferenceMainCostFallback U1–U10", () => {
  const baseInput = {
    provider: "cheaperinference",
    providerRequestId: "0840da41-b1d4-4946-8175-c645e5613b77",
    model: "deepseek-v4-pro-0813",
    requestStartedAtMs: Date.parse("2026-09-18T00:12:27Z"),
    outcome: "success" as const,
    persistInTests: true,
  };

  it("U1 stream has billed_cost_usd -> usage API not called", async () => {
    let called = false;
    const fetchRequests = async () => {
      called = true;
      return { ok: true as const, value: { requests: [], pages: 0 } };
    };
    const result = await enrichMainGenerationCostFromUsageApi({
      ...baseInput,
      streamBilledCostUsd: 0.019894,
      fetchRequests,
    });
    assert.equal(result.attempted, false);
    assert.equal(called, false);
  });

  it("U2 stream exact absent + usage API settled -> billed_cost captured, one ledger row", async () => {
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
      const result = await enrichMainGenerationCostFromUsageApi({
        ...baseInput,
        db: d,
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
      });
      assert.equal(result.attempted, true);
      assert.equal(result.requestFound, true);
      assert.equal(result.billedCostUsd, 0.019894);
      assert.equal(result.ledgerOutcome, "promoted");
      const rows = listProviderCostEventsForAssistantMessage(10, d);
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.actual_cost_source, "cheaper_inference_usage_api");
      assert.equal(rows[0]?.actual_cost_usd, 0.019894);
    } finally {
      d.close();
    }
  });

  it("U3 usage API 403 -> Main remains completed path, no fake cost", async () => {
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
      const result = await enrichMainGenerationCostFromUsageApi({
        ...baseInput,
        db: d,
        fetchRequests: mockFetch([], 403),
      });
      assert.equal(result.lookupOk, false);
      assert.equal(result.billedCostUsd, undefined);
      const rows = listProviderCostEventsForAssistantMessage(11, d);
      assert.equal(rows[0]?.event_status, "completed_without_exact_cost");
    } finally {
      d.close();
    }
  });

  it("U4 usage API 5xx -> cost unresolved", async () => {
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
      const result = await enrichMainGenerationCostFromUsageApi({
        ...baseInput,
        db: d,
        fetchRequests: mockFetch([], 503),
      });
      assert.equal(result.lookupOk, false);
      const rows = listProviderCostEventsForAssistantMessage(12, d);
      assert.equal(rows[0]?.actual_cost_source, "unavailable");
    } finally {
      d.close();
    }
  });

  it("U5 usage API request exists but status != settled -> do not record billed cost", async () => {
    const d = db();
    try {
      recordMainGenerationProviderCost(
        {
          chatId: 1,
          assistantMessageId: 13,
          generationSequence: 0,
          provider: "cheaperinference",
          model: "deepseek-v4-pro-0813",
          providerRequestId: baseInput.providerRequestId,
          outcome: "success",
          persistInTests: true,
        },
        d
      );
      const result = await enrichMainGenerationCostFromUsageApi({
        ...baseInput,
        db: d,
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
      });
      assert.equal(result.requestStatus, "pending");
      assert.equal(result.billedCostUsd, undefined);
      const rows = listProviderCostEventsForAssistantMessage(13, d);
      assert.equal(rows[0]?.actual_cost_source, "unavailable");
    } finally {
      d.close();
    }
  });

  it("U6 wrong request id -> never attach cost", async () => {
    const d = db();
    try {
      recordMainGenerationProviderCost(
        {
          chatId: 1,
          assistantMessageId: 14,
          generationSequence: 0,
          provider: "cheaperinference",
          model: "deepseek-v4-pro-0813",
          providerRequestId: "actual-request-id",
          outcome: "success",
          persistInTests: true,
        },
        d
      );
      const result = await enrichMainGenerationCostFromUsageApi({
        ...baseInput,
        providerRequestId: "actual-request-id",
        db: d,
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
      });
      assert.equal(result.requestFound, false);
      const rows = listProviderCostEventsForAssistantMessage(14, d);
      assert.equal(rows[0]?.actual_cost_source, "unavailable");
    } finally {
      d.close();
    }
  });

  it("U7 regen variants with different provider_request_id -> correct variant cost only", async () => {
    const d = db();
    try {
      recordMainGenerationProviderCost(
        {
          chatId: 1,
          assistantMessageId: 15,
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
          assistantMessageId: 15,
          generationSequence: 1,
          provider: "cheaperinference",
          model: "deepseek-v4-pro-0813",
          providerRequestId: "req-variant-b",
          outcome: "success",
          persistInTests: true,
        },
        d
      );
      await enrichMainGenerationCostFromUsageApi({
        ...baseInput,
        providerRequestId: "req-variant-b",
        db: d,
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
      });
      const rowsA = listProviderCostEventsForAssistantMessage(15, d).filter(
        (r) => r.generation_sequence === 0
      );
      const rowsB = listProviderCostEventsForAssistantMessage(15, d).filter(
        (r) => r.generation_sequence === 1
      );
      assert.equal(rowsA[0]?.actual_cost_source, "unavailable");
      assert.equal(rowsB[0]?.actual_cost_usd, 0.008);
    } finally {
      d.close();
    }
  });

  it("U8 stream cost later + fallback same request -> deduplicated, no double ledger row", async () => {
    const d = db();
    try {
      recordMainGenerationProviderCost(
        {
          chatId: 1,
          assistantMessageId: 16,
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
      const result = await enrichMainGenerationCostFromUsageApi({
        ...baseInput,
        streamBilledCostUsd: 0.019894,
        db: d,
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
      });
      assert.equal(result.attempted, false);
      const rows = listProviderCostEventsForAssistantMessage(16, d);
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.actual_cost_source, "cheaper_inference_billed");
    } finally {
      d.close();
    }
  });

  it("U9 shouldAttempt gate keeps single-inference eligibility", () => {
    assert.equal(
      shouldAttemptMainCostUsageApiFallback({
        provider: "cheaperinference",
        providerRequestId: "req-1",
        streamBilledCostUsd: undefined,
        outcome: "success",
      }),
      true
    );
    assert.equal(
      shouldAttemptMainCostUsageApiFallback({
        provider: "openrouter",
        providerRequestId: "req-1",
        streamBilledCostUsd: undefined,
        outcome: "success",
      }),
      false
    );
  });

  it("U10 Admin Receipt after fallback exact cost: Main cost present, margin computable", async () => {
    const d = db();
    try {
      d.exec(`
        CREATE TABLE messages (id INTEGER PRIMARY KEY, chat_id INTEGER NOT NULL DEFAULT 1, role TEXT NOT NULL,
          content TEXT NOT NULL DEFAULT '', request_id TEXT, usage TEXT, deduction_slices TEXT,
          model TEXT NOT NULL DEFAULT '', alternates TEXT NOT NULL DEFAULT '[]',
          active_variant INTEGER NOT NULL DEFAULT 0, generation_status TEXT NOT NULL DEFAULT 'completed',
          created_at TEXT NOT NULL DEFAULT (datetime('now')), is_refunded INTEGER NOT NULL DEFAULT 0);
      `);
      const mainKrw = Math.round(0.019894 * FX * 10) / 10;
      const u = usage(null);
      d.prepare(
        `INSERT INTO messages (id, chat_id, role, usage, deduction_slices) VALUES (?, 1, 'assistant', ?, ?)`
      ).run(17, JSON.stringify(u), JSON.stringify([{ pointType: "PAID", amount: 5000 }]));

      recordMainGenerationProviderCost(
        {
          chatId: 1,
          assistantMessageId: 17,
          generationSequence: 0,
          provider: "cheaperinference",
          model: "deepseek-v4-pro-0813",
          providerRequestId: baseInput.providerRequestId,
          outcome: "success",
          persistInTests: true,
        },
        d
      );
      await enrichMainGenerationCostFromUsageApi({
        ...baseInput,
        db: d,
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
      });

      const rows = listProviderCostEventsForAssistantMessage(17, d);
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.actual_cost_source, "cheaper_inference_usage_api");
      assert.equal(rows[0]?.actual_cost_usd, 0.019894);

      const turn = resolveMessageTurnProviderCostKrw(u, rows);
      assert.ok(turn.knownApiCostKrw > 0);
      assert.ok(Math.abs(turn.knownApiCostKrw - mainKrw) < 1);

      const { buildAdminBillingReceiptV3 } = await import("./adminBillingReceiptV3");
      const receipt = buildAdminBillingReceiptV3({
        usage: u,
        assistantMessageId: 17,
        chatId: 1,
        suggestedRepliesRecord: null,
        statusMetaRecord: null,
        memoryRelationshipTask: null,
        ledgerRows: rows,
      });
      assert.equal(receipt.wholeTurn.mainExact, true);
      assert.equal(receipt.wholeTurn.mainActualCostUsd, 0.019894);
      assert.ok((receipt.wholeTurn.knownProviderSpendUsd ?? 0) >= 0.019894);
    } finally {
      d.close();
    }
  });
});
