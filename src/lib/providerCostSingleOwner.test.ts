import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import { buildAdminFinanceSummary, ensureAdminFinanceTables } from "./adminFinance";
import { resolveBillingExchangeRateSnapshot } from "./exchangeRate";
import { resolveMessageTurnProviderCostKrw } from "./adminFinanceTurnCost";
import {
  ensureProviderCostLedgerSchema,
  listProviderCostEventsForAssistantMessage,
  readLedgerPeriodCostAttribution,
  recordMainGenerationProviderCost,
  upsertReconciledProviderCost,
} from "./providerCostLedger";
import {
  readLocalReconciledMicroUsd,
  readProviderReconciliationState,
  reconcileCheaperInferenceUsage,
} from "./providerCostReconciliation";
import { fetchUsageRequestsPage } from "./cheaperInferenceUsage";
import type { Usage } from "./chatUsage";

const FX = resolveBillingExchangeRateSnapshot().effectiveKrwPerUsd;
const usdForKrw = (krw: number) => krw / FX;
const krwForUsd = (usd: number) => Math.round(usd * FX * 10) / 10;

function db(): Database.Database {
  const d = new Database(":memory:");
  d.exec(`
    CREATE TABLE messages (id INTEGER PRIMARY KEY, chat_id INTEGER NOT NULL DEFAULT 1, role TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '', request_id TEXT, usage TEXT, deduction_slices TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), is_refunded INTEGER NOT NULL DEFAULT 0);
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
      deduction_slices TEXT, exchange_rate_krw_per_usd REAL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
  `);
  ensureAdminFinanceTables(d);
  ensureProviderCostLedgerSchema(d);
  return d;
}

function usage(opts: {
  model?: string;
  actualKrw?: number | null;
  source?: string;
  coverage?: string;
}): Usage {
  const model = opts.model ?? "deepseek-v4-pro-0813";
  const hasActual = opts.actualKrw != null;
  return {
    input: 1000,
    output: 500,
    model,
    modelLabel: model,
    provider: "cheaperinference",
    cost: 5000,
    ...(hasActual
      ? {
          shadowPricing: {
            pricingVersion: 1,
            actualTurnCostCoverage: opts.coverage ?? "complete",
            actualProviderCostKrw: opts.actualKrw as number,
            actualCostUsd: usdForKrw(opts.actualKrw as number),
            actualCostSource: opts.source ?? "cheaper_inference_billed",
            provider: "cheaperinference",
            modelId: model,
            fxSnapshot: { effectiveKrwPerUsd: FX },
          },
        }
      : {}),
  } as Usage;
}

function insertMessage(d: Database.Database, id: number, u: Usage, paid = 5000) {
  d.prepare(
    `INSERT INTO messages (id, chat_id, role, usage, deduction_slices, created_at, is_refunded)
     VALUES (?, 1, 'assistant', ?, ?, datetime('now'), 0)`
  ).run(id, JSON.stringify(u), JSON.stringify([{ pointType: "PAID", amount: paid }]));
}

function mainRow(
  d: Database.Database,
  opts: {
    messageId?: number;
    generationSequence?: number;
    billedKrw?: number;
    billedUsd?: number;
    usageEstimated?: boolean;
    model?: string;
    requestId?: string | null;
  }
) {
  return recordMainGenerationProviderCost(
    {
      chatId: 1,
      assistantMessageId: opts.messageId ?? 1,
      generationSequence: opts.generationSequence ?? 0,
      provider: "cheaperinference",
      model: opts.model ?? "deepseek-v4-pro-0813",
      requestKind: "main-rp",
      inputTokens: 1000,
      outputTokens: 500,
      cheaperInferenceBilledCostUsd:
        opts.billedUsd != null
          ? opts.billedUsd
          : opts.billedKrw != null
            ? usdForKrw(opts.billedKrw)
            : undefined,
      usageEstimated: opts.usageEstimated ?? false,
      providerRequestId: opts.requestId ?? null,
      outcome: "success",
      persistInTests: true,
    },
    d
  );
}

let restoreKey: string | undefined;
afterEach(() => {
  if (restoreKey === undefined) delete process.env.CHEAPER_INFERENCE_API_KEY;
  else process.env.CHEAPER_INFERENCE_API_KEY = restoreKey;
  restoreKey = undefined;
});

describe("provider cost single owner — main generation ledger", () => {
  it("1. legacy usage 100 + same main ledger 100 => 100 (not 200)", () => {
    const d = db();
    try {
      insertMessage(d, 1, usage({ actualKrw: 100 }));
      mainRow(d, { messageId: 1, billedKrw: 100, requestId: "req-1" });
      const rows = listProviderCostEventsForAssistantMessage(1, d);
      const turn = resolveMessageTurnProviderCostKrw(usage({ actualKrw: 100 }), rows);
      assert.equal(turn.knownApiCostKrw, 100);
      const summary = buildAdminFinanceSummary(d);
      assert.equal(summary.totalApiCostKrw, 100);
    } finally {
      d.close();
    }
  });

  it("2. main ledger only 100 => 100 (ledger-first over usage)", () => {
    const d = db();
    try {
      insertMessage(d, 1, usage({ actualKrw: null }));
      mainRow(d, { messageId: 1, billedKrw: 100, requestId: "req-2" });
      const rows = listProviderCostEventsForAssistantMessage(1, d);
      const turn = resolveMessageTurnProviderCostKrw(usage({ actualKrw: null }), rows);
      assert.equal(turn.knownApiCostKrw, 100);
    } finally {
      d.close();
    }
  });

  it("3. legacy usage only 100 => 100 (historical fallback)", () => {
    const d = db();
    try {
      insertMessage(d, 1, usage({ actualKrw: 100 }));
      const rows = listProviderCostEventsForAssistantMessage(1, d);
      const turn = resolveMessageTurnProviderCostKrw(usage({ actualKrw: 100 }), rows);
      assert.equal(turn.knownApiCostKrw, 100);
    } finally {
      d.close();
    }
  });

  it("4. primary 100 + recovery physical 20 => 120", () => {
    const d = db();
    try {
      insertMessage(d, 1, usage({ actualKrw: null }));
      mainRow(d, { messageId: 1, billedKrw: 100, requestId: "req-p" });
      mainRow(d, { messageId: 1, billedKrw: 20, requestId: "req-r" });
      const rows = listProviderCostEventsForAssistantMessage(1, d);
      const turn = resolveMessageTurnProviderCostKrw(usage({ actualKrw: null }), rows);
      assert.equal(turn.knownApiCostKrw, 120);
    } finally {
      d.close();
    }
  });

  it("5. primary 100 + fallback provider request 30 => 130", () => {
    const d = db();
    try {
      insertMessage(d, 1, usage({ actualKrw: null }));
      mainRow(d, { messageId: 1, billedKrw: 100, requestId: "req-f1" });
      mainRow(d, { messageId: 1, billedKrw: 30, requestId: "req-f2" });
      const rows = listProviderCostEventsForAssistantMessage(1, d);
      const turn = resolveMessageTurnProviderCostKrw(usage({ actualKrw: null }), rows);
      assert.equal(turn.knownApiCostKrw, 130);
    } finally {
      d.close();
    }
  });

  it("6. same provider request recorded twice => unchanged (idempotent)", () => {
    const d = db();
    try {
      insertMessage(d, 1, usage({ actualKrw: null }));
      mainRow(d, { messageId: 1, billedKrw: 100, requestId: "req-dup" });
      mainRow(d, { messageId: 1, billedKrw: 100, requestId: "req-dup" });
      const rows = listProviderCostEventsForAssistantMessage(1, d);
      assert.equal(rows.length, 1);
      const turn = resolveMessageTurnProviderCostKrw(usage({ actualKrw: null }), rows);
      assert.equal(turn.knownApiCostKrw, 100);
    } finally {
      d.close();
    }
  });

  it("7. local estimated 90 promoted to remote settled 83 => 83 (not 173)", () => {
    const d = db();
    try {
      insertMessage(d, 1, usage({ actualKrw: null }));
      mainRow(d, { messageId: 1, billedKrw: 90, usageEstimated: true, requestId: "req-est" });
      const before = resolveMessageTurnProviderCostKrw(
        usage({ actualKrw: null }),
        listProviderCostEventsForAssistantMessage(1, d)
      );
      assert.equal(before.knownApiCostKrw, 90);
      upsertReconciledProviderCost(
        {
          provider: "cheaperinference",
          providerRequestId: "req-est",
          model: "deepseek-v4-pro-0813",
          billedCostUsd: usdForKrw(83),
          persistInTests: true,
        },
        d
      );
      const after = resolveMessageTurnProviderCostKrw(
        usage({ actualKrw: null }),
        listProviderCostEventsForAssistantMessage(1, d)
      );
      assert.equal(after.knownApiCostKrw, 83);
    } finally {
      d.close();
    }
  });

  it("8. local exact 83 + remote exact 83 => 83 (no double)", () => {
    const d = db();
    try {
      insertMessage(d, 1, usage({ actualKrw: null }));
      mainRow(d, { messageId: 1, billedKrw: 83, requestId: "req-exact" });
      const out = upsertReconciledProviderCost(
        {
          provider: "cheaperinference",
          providerRequestId: "req-exact",
          model: "deepseek-v4-pro-0813",
          billedCostUsd: usdForKrw(83),
          persistInTests: true,
        },
        d
      );
      assert.equal(out.outcome, "matched");
      const turn = resolveMessageTurnProviderCostKrw(
        usage({ actualKrw: null }),
        listProviderCostEventsForAssistantMessage(1, d)
      );
      assert.equal(turn.knownApiCostKrw, 83);
    } finally {
      d.close();
    }
  });

  it("9. unseen model id appears in finance model breakdown", () => {
    const d = db();
    try {
      insertMessage(d, 1, usage({ actualKrw: null }));
      mainRow(d, { messageId: 1, billedKrw: 100, requestId: "req-m", model: "brand-new-model-zz" });
      const summary = buildAdminFinanceSummary(d);
      assert.ok(summary.aiModelCosts.some((m) => m.model.includes("brand-new-model-zz")));
    } finally {
      d.close();
    }
  });

  it("10. background ledger attribution is preserved", () => {    const d = db();
    try {
      upsertReconciledProviderCost(
        {
          provider: "cheaperinference",
          providerRequestId: "req-bg",
          model: "luna",
          billedCostUsd: 0.05,
          requestKind: "background-memory-extract",
          costCenter: "memory",
          persistInTests: true,
        },
        d
      );
      const attr = readLedgerPeriodCostAttribution(d, "2000-01-01", "2100-01-01");
      assert.equal(attr.byCenter.memory.actualKrw, krwForUsd(0.05));
    } finally {
      d.close();
    }
  });

  it("10b. chat receipt consumes the same main ledger exact owner as finance", async () => {
    const d = db();
    try {
      const estimatedUsage = usage({
        actualKrw: 90,
        source: "live_catalog_estimated",
        coverage: "partial",
      });
      insertMessage(d, 1, estimatedUsage);
      mainRow(d, { messageId: 1, billedUsd: 0.1, requestId: "req-receipt" });
      const rows = listProviderCostEventsForAssistantMessage(1, d);
      const { buildAdminBillingReceiptV3 } = await import("./adminBillingReceiptV3");
      const receipt = buildAdminBillingReceiptV3({
        usage: estimatedUsage,
        assistantMessageId: 1,
        chatId: 1,
        suggestedRepliesRecord: null,
        statusMetaRecord: null,
        memoryRelationshipTask: null,
        ledgerRows: rows,
      });
      assert.equal(receipt.wholeTurn.knownProviderSpendUsd, 0.1);
    } finally {
      d.close();
    }
  });
});

describe("provider usage reconciliation — safety and completeness", () => {
  it("11. remote-only historical (no cutover) => no blind insert, gap surfaced", async () => {
    const d = db();
    try {
      const res = await reconcileCheaperInferenceUsage({
        windowStart: "2026-09-01 00:00:00",
        windowEnd: "2026-10-01 00:00:00",
        db: d,
        deps: {
          persistInTests: true,
          fetchRequests: async () => ({
            ok: true,
            value: {
              pages: 1,
              requests: [
                {
                  requestId: "hist-1",
                  status: "settled",
                  billedMicroUsd: 100_000,
                  settled: true,
                  model: "m",
                  endpoint: "/chat/completions",
                  createdAt: "2026-09-10 00:00:00",
                },
              ],
            },
          }),
          fetchDaily: async () => ({ ok: true, value: { settledMicroUsd: 100_000 } }),
        },
      });
      assert.equal(res.inserted, 0);
      assert.equal(res.unreconciledProviderMicroUsd, 100_000);
      assert.equal(readLedgerPeriodCostAttribution(d, "2000-01-01", "2100-01-01").totals.actualKrw, 0);
    } finally {
      d.close();
    }
  });

  it("12. remote-only post-cutover => recorded exactly once", async () => {
    const d = db();
    try {
      insertMessage(d, 1, usage({ actualKrw: null }));
      mainRow(d, { messageId: 1, billedKrw: 10, requestId: "cutover-anchor" });
      const requests = () => ({
        ok: true as const,
        value: {
          pages: 1,
          requests: [
            {
              requestId: "post-1",
              status: "settled",
              billedMicroUsd: 20_000,
              settled: true,
              model: "m",
              endpoint: "/chat/completions",
              createdAt: "2099-01-01 00:00:00",
            },
          ],
        },
      });
      const deps = {
        persistInTests: true,
        fetchRequests: async () => requests(),
        fetchDaily: async () => ({ ok: true as const, value: { settledMicroUsd: 20_000 } }),
      };
      const r1 = await reconcileCheaperInferenceUsage({
        windowStart: "2026-09-01 00:00:00",
        windowEnd: "2026-10-01 00:00:00",
        db: d,
        deps,
      });
      const r2 = await reconcileCheaperInferenceUsage({
        windowStart: "2026-09-01 00:00:00",
        windowEnd: "2026-10-01 00:00:00",
        db: d,
        deps,
      });
      assert.equal(r1.inserted, 1);
      assert.equal(r2.inserted, 0);
      assert.equal(r2.matched, 1);
      const count = (
        d.prepare("SELECT COUNT(*) AS c FROM api_cost_ledger WHERE provider_request_id='post-1'").get() as {
          c: number;
        }
      ).c;
      assert.equal(count, 1);
    } finally {
      d.close();
    }
  });

  it("13. daily 1000 vs local reconciled 900 => delta 100, total not additive", async () => {
    const d = db();
    try {
      insertMessage(d, 1, usage({ actualKrw: null }));
      mainRow(d, { messageId: 1, billedUsd: 0.9, requestId: "local-900" });
      const res = await reconcileCheaperInferenceUsage({
        windowStart: "2000-01-01 00:00:00",
        windowEnd: "2100-01-01 00:00:00",
        db: d,
        deps: {
          persistInTests: true,
          fetchRequests: async () => ({ ok: true, value: { pages: 1, requests: [] } }),
          fetchDaily: async () => ({ ok: true, value: { settledMicroUsd: 1_000_000 } }),
        },
      });
      assert.equal(res.localReconciledMicroUsd, 900_000);
      assert.equal(res.dailyMicroUsd, 1_000_000);
      assert.equal(res.dailyDeltaMicroUsd, 100_000);
      assert.notEqual(res.localReconciledMicroUsd, 1_900_000);
      assert.equal(readLocalReconciledMicroUsd(d, "2000-01-01", "2100-01-01"), 900_000);
    } finally {
      d.close();
    }
  });

  it("14/16. provider error preserves last good values, no zero overwrite", async () => {
    const d = db();
    try {
      insertMessage(d, 1, usage({ actualKrw: null }));
      mainRow(d, { messageId: 1, billedUsd: 0.9, requestId: "keep-900" });
      await reconcileCheaperInferenceUsage({
        windowStart: "2000-01-01 00:00:00",
        windowEnd: "2100-01-01 00:00:00",
        db: d,
        deps: {
          persistInTests: true,
          fetchRequests: async () => ({ ok: true, value: { pages: 1, requests: [] } }),
          fetchDaily: async () => ({ ok: true, value: { settledMicroUsd: 900_000 } }),
        },
      });
      const failed = await reconcileCheaperInferenceUsage({
        windowStart: "2000-01-01 00:00:00",
        windowEnd: "2100-01-01 00:00:00",
        db: d,
        deps: {
          persistInTests: true,
          fetchRequests: async () => ({
            ok: false,
            reason: "http",
            status: 403,
            message: "usage API 403",
          }),
          fetchDaily: async () => ({ ok: true, value: { settledMicroUsd: 900_000 } }),
        },
      });
      assert.equal(failed.status, "provider_unavailable");
      assert.equal(failed.localReconciledMicroUsd, 900_000);
      const state = readProviderReconciliationState(d);
      assert.equal(state?.localReconciledMicroUsd, 900_000);
      assert.equal(readLocalReconciledMicroUsd(d, "2000-01-01", "2100-01-01"), 900_000);
    } finally {
      d.close();
    }
  });

  it("19. concurrent duplicate sync => no duplicate ledger rows", async () => {
    const d = db();
    try {
      insertMessage(d, 1, usage({ actualKrw: null }));
      mainRow(d, { messageId: 1, billedKrw: 10, requestId: "anchor" });
      const req = {
        requestId: "concurrent-1",
        status: "settled",
        billedMicroUsd: 30_000,
        settled: true,
        model: "m",
        endpoint: "/c",
        createdAt: "2099-01-01 00:00:00",
      };
      const deps = {
        persistInTests: true,
        fetchRequests: async () => ({ ok: true as const, value: { pages: 1, requests: [req] } }),
        fetchDaily: async () => ({ ok: true as const, value: { settledMicroUsd: 30_000 } }),
      };
      await Promise.all([
        reconcileCheaperInferenceUsage({ windowStart: "2000-01-01 00:00:00", windowEnd: "2100-01-01 00:00:00", db: d, deps }),
        reconcileCheaperInferenceUsage({ windowStart: "2000-01-01 00:00:00", windowEnd: "2100-01-01 00:00:00", db: d, deps }),
      ]);
      const count = (
        d.prepare("SELECT COUNT(*) AS c FROM api_cost_ledger WHERE provider_request_id='concurrent-1'").get() as {
          c: number;
        }
      ).c;
      assert.equal(count, 1);
    } finally {
      d.close();
    }
  });
});

describe("cheaper inference usage client", () => {
  it("15. 429 exposes Retry-After without throwing", async () => {
    restoreKey = process.env.CHEAPER_INFERENCE_API_KEY;
    process.env.CHEAPER_INFERENCE_API_KEY = "test-key";
    const fetchImpl = (async () =>
      new Response("rate limited", {
        status: 429,
        headers: { "retry-after": "3" },
      })) as typeof fetch;
    const res = await fetchUsageRequestsPage({
      startAt: "2026-09-01T00:00:00Z",
      endAt: "2026-10-01T00:00:00Z",
      fetchImpl,
    });
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(res.status, 429);
      assert.equal(res.retryAfterMs, 3000);
    }
  });

  it("17. multi-page cursor pagination collects every page", async () => {
    restoreKey = process.env.CHEAPER_INFERENCE_API_KEY;
    process.env.CHEAPER_INFERENCE_API_KEY = "test-key";
    const pages = [
      { data: [{ request_id: "a", status: "settled", billed_cost_usd: "0.001" }], next_cursor: "CUR2" },
      { data: [{ request_id: "b", status: "settled", billed_cost_usd: "0.002" }], next_cursor: null },
    ];
    let call = 0;
    const fetchImpl = (async (url: string) => {
      const page = pages[call] ?? { data: [], next_cursor: null };
      call += 1;
      return new Response(JSON.stringify(page), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    const { fetchAllUsageRequests } = await import("./cheaperInferenceUsage");
    const res = await fetchAllUsageRequests({
      startAt: "2026-09-01T00:00:00Z",
      endAt: "2026-10-01T00:00:00Z",
      fetchImpl,
    });
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(res.value.requests.length, 2);
      assert.deepEqual(
        res.value.requests.map((r) => r.requestId),
        ["a", "b"]
      );
      assert.equal(res.value.requests[0]!.billedMicroUsd, 1000);
    }
  });

  it("decimal string billing is normalized to micro-USD", async () => {
    restoreKey = process.env.CHEAPER_INFERENCE_API_KEY;
    process.env.CHEAPER_INFERENCE_API_KEY = "test-key";
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ data: [{ request_id: "uuid-1", status: "settled", billed_cost_usd: "0.012345" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;
    const res = await fetchUsageRequestsPage({
      startAt: "2026-09-01T00:00:00Z",
      endAt: "2026-10-01T00:00:00Z",
      fetchImpl,
    });
    assert.equal(res.ok, true);
    if (res.ok) assert.equal(res.value.requests[0]!.billedMicroUsd, 12345);
  });

  it("schema mismatch is reported, never silently parsed", async () => {
    restoreKey = process.env.CHEAPER_INFERENCE_API_KEY;
    process.env.CHEAPER_INFERENCE_API_KEY = "test-key";
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ unexpected: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;
    const res = await fetchUsageRequestsPage({
      startAt: "2026-09-01T00:00:00Z",
      endAt: "2026-10-01T00:00:00Z",
      fetchImpl,
    });
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.reason, "schema");
  });
});
