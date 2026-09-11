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
import {
  attachProviderRequestLinkageForPersistence,
  sanitizeUsageForPublicReceipt,
  serializeUsageForPublicClient,
} from "./billingReceiptAccess";
import { fetchUsageRequestsPage } from "./cheaperInferenceUsage";
import type { Usage } from "./chatUsage";

const FX = resolveBillingExchangeRateSnapshot().effectiveKrwPerUsd;
const usdForKrw = (krw: number) => krw / FX;
const krwForUsd = (usd: number) => Math.round(usd * FX * 10) / 10;
const nowSql = () => new Date().toISOString().slice(0, 19).replace("T", " ");

function db(): Database.Database {
  const d = new Database(":memory:");
  d.exec(`
    CREATE TABLE messages (id INTEGER PRIMARY KEY, chat_id INTEGER NOT NULL DEFAULT 1, role TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '', request_id TEXT, usage TEXT, deduction_slices TEXT,
      model TEXT NOT NULL DEFAULT '', alternates TEXT NOT NULL DEFAULT '[]',
      active_variant INTEGER NOT NULL DEFAULT 0, generation_status TEXT NOT NULL DEFAULT 'completed',
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

/**
 * Persists a message through the REAL non-admin production persistence
 * transform: internal usage -> sanitizeUsageForPublicReceipt (privacy) ->
 * attachProviderRequestLinkageForPersistence (DB linkage). This proves the
 * linkage survives the production path, not a hand-injected JSON blob.
 */
function insertMessageWithStage(
  d: Database.Database,
  id: number,
  opts: {
    actualKrw: number | null;
    stageProviderRequestId: string;
    requestFx: number;
    createdAt?: string;
  }
) {
  const base = usage({ actualKrw: opts.actualKrw });
  const internal = {
    ...(base as Record<string, unknown>),
    stages: [
      {
        stage: "main",
        model: base.model,
        input: 1000,
        output: 500,
        cost: 5000,
        providerRequestId: opts.stageProviderRequestId,
      },
    ],
  };
  if (opts.actualKrw != null) {
    (internal as Record<string, unknown>).shadowPricing = {
      ...((base as Record<string, unknown>).shadowPricing as Record<string, unknown>),
      fxSnapshot: { effectiveKrwPerUsd: opts.requestFx },
    };
  }
  // Non-admin (showFullBillingReceipt === false) production transform:
  // 1) public privacy sanitize, 2) restore DB provider-request linkage,
  // 3) re-attach shadowPricing diagnostics (route does this after sanitize).
  const sanitized = sanitizeUsageForPublicReceipt(internal as unknown as Usage);
  const persistedDb = attachProviderRequestLinkageForPersistence(
    sanitized,
    internal as unknown as Usage
  ) as Record<string, unknown>;
  if (opts.actualKrw != null) {
    persistedDb.shadowPricing = (internal as Record<string, unknown>).shadowPricing;
  }
  d.prepare(
    `INSERT INTO messages (id, chat_id, role, content, usage, deduction_slices, created_at, is_refunded)
     VALUES (?, 1, 'assistant', 'reply', ?, ?, COALESCE(?, datetime('now')), 0)`
  ).run(
    id,
    JSON.stringify(persistedDb),
    JSON.stringify([{ pointType: "PAID", amount: 5000 }]),
    opts.createdAt ?? null
  );
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

  it("12A. remote-only + deterministic message identity => linked recovery exactly once", async () => {
    const d = db();
    try {
      // Ledger-write-failure precondition: message persisted (usage has the
      // physical provider request id) but NO linked main_generation row.
      insertMessageWithStage(d, 1, {
        actualKrw: 100,
        stageProviderRequestId: "post-1",
        requestFx: FX,
      });
      const requests = () => ({
        ok: true as const,
        value: {
          pages: 1,
          requests: [
            {
              requestId: "post-1",
              status: "settled",
              billedMicroUsd: Math.round(usdForKrw(100) * 1_000_000),
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
        fetchDaily: async () => ({ ok: true as const, value: { settledMicroUsd: 0 } }),
      };
      const r1 = await reconcileCheaperInferenceUsage({
        windowStart: "2000-01-01 00:00:00",
        windowEnd: "2100-01-01 00:00:00",
        db: d,
        deps,
      });
      assert.equal(r1.inserted, 1, "linked recovery inserted once");

      const rows = listProviderCostEventsForAssistantMessage(1, d);
      const main = rows.filter((r) => r.execution_phase === "main_generation");
      assert.equal(main.length, 1);
      assert.equal(main[0]!.assistant_message_id, 1, "recovered row is linked to the message");
      const turn = resolveMessageTurnProviderCostKrw(usage({ actualKrw: null }), rows);
      assert.equal(turn.knownApiCostKrw, 100);
      const summary = buildAdminFinanceSummary(d);
      assert.equal(summary.totalApiCostKrw, 100, "linked recovery, not usage+ledger double count");
    } finally {
      d.close();
    }
  });

  it("12B. remote-only + no deterministic identity => no blind insert, gap", async () => {
    const d = db();
    try {
      // cutover-anchor main row exists, but the request has no message identity.
      insertMessage(d, 9, usage({ actualKrw: null }));
      mainRow(d, { messageId: 9, billedKrw: 10, requestId: "cutover-anchor" });
      const res = await reconcileCheaperInferenceUsage({
        windowStart: "2000-01-01 00:00:00",
        windowEnd: "2100-01-01 00:00:00",
        db: d,
        deps: {
          persistInTests: true,
          fetchRequests: async () => ({
            ok: true,
            value: {
              pages: 1,
              requests: [
                {
                  requestId: "orphan-1",
                  status: "settled",
                  billedMicroUsd: 20_000,
                  settled: true,
                  model: "m",
                  endpoint: "/c",
                  createdAt: "2099-01-01 00:00:00",
                },
              ],
            },
          }),
          fetchDaily: async () => ({ ok: true, value: { settledMicroUsd: 20_000 } }),
        },
      });
      assert.equal(res.inserted, 0);
      assert.equal(res.unreconciledProviderMicroUsd, 20_000);
      const count = (
        d.prepare("SELECT COUNT(*) AS c FROM api_cost_ledger WHERE provider_request_id='orphan-1'").get() as {
          c: number;
        }
      ).c;
      assert.equal(count, 0, "no blind insert");
    } finally {
      d.close();
    }
  });

  it("exactly-once: ledger write failure + usage + remote settled => 100 before/after, stable across syncs", async () => {
    const d = db();
    try {
      insertMessageWithStage(d, 1, {
        actualKrw: 100,
        stageProviderRequestId: "req-B",
        requestFx: FX,
      });
      // BEFORE any reconciliation the missing linked ledger means usage fallback.
      assert.equal(buildAdminFinanceSummary(d).totalApiCostKrw, 100);

      const remote = Math.round(usdForKrw(100) * 1_000_000);
      const deps = {
        persistInTests: true,
        fetchRequests: async () => ({
          ok: true as const,
          value: {
            pages: 1,
            requests: [
              {
                requestId: "req-B",
                status: "settled",
                billedMicroUsd: remote,
                settled: true,
                model: "m",
                endpoint: "/c",
                createdAt: nowSql(),
              },
            ],
          },
        }),
        fetchDaily: async () => ({ ok: true as const, value: { settledMicroUsd: remote } }),
      };
      await reconcileCheaperInferenceUsage({
        windowStart: "2000-01-01 00:00:00",
        windowEnd: "2100-01-01 00:00:00",
        db: d,
        deps,
      });
      const first = buildAdminFinanceSummary(d);
      assert.equal(first.totalApiCostKrw, 100, "not 200");
      const identityCount1 = (
        d.prepare("SELECT COUNT(*) AS c FROM api_cost_ledger WHERE provider_request_id='req-B'").get() as {
          c: number;
        }
      ).c;
      assert.equal(identityCount1, 1);

      await reconcileCheaperInferenceUsage({
        windowStart: "2000-01-01 00:00:00",
        windowEnd: "2100-01-01 00:00:00",
        db: d,
        deps,
      });
      const second = buildAdminFinanceSummary(d);
      assert.equal(second.totalApiCostKrw, 100, "stable across repeated syncs");
      const identityCount2 = (
        d.prepare("SELECT COUNT(*) AS c FROM api_cost_ledger WHERE provider_request_id='req-B'").get() as {
          c: number;
        }
      ).c;
      assert.equal(identityCount2, 1, "exactly one physical billing identity");

      // Receipt V3 reads the recovered linked owner.
      const { buildAdminBillingReceiptV3 } = await import("./adminBillingReceiptV3");
      const receipt = buildAdminBillingReceiptV3({
        usage: usage({ actualKrw: null }),
        assistantMessageId: 1,
        chatId: 1,
        suggestedRepliesRecord: null,
        statusMetaRecord: null,
        memoryRelationshipTask: null,
        ledgerRows: listProviderCostEventsForAssistantMessage(1, d),
      });
      assert.equal(
        receipt.wholeTurn.knownProviderSpendUsd,
        Math.round((100 / FX) * 1_000_000) / 1_000_000
      );
    } finally {
      d.close();
    }
  });

  it("FX invariant: promotion preserves request-time FX, never re-values at sync time", () => {
    const d = db();
    try {
      insertMessage(d, 1, usage({ actualKrw: null }));
      // Request-time FX = 1400 (overridden), not the reconciliation-time snapshot.
      recordMainGenerationProviderCost(
        {
          chatId: 1,
          assistantMessageId: 1,
          generationSequence: 0,
          provider: "cheaperinference",
          model: "deepseek-v4-pro-0813",
          requestKind: "main-rp",
          upstreamCostUsd: usdForKrw(90),
          usageEstimated: true,
          providerRequestId: "req-fx",
          exchangeRateKrwPerUsd: 1400,
          outcome: "success",
          persistInTests: true,
        },
        d
      );
      const before = listProviderCostEventsForAssistantMessage(1, d)[0]!;
      assert.equal(before.exchange_rate_krw_per_usd, 1400);

      upsertReconciledProviderCost(
        {
          provider: "cheaperinference",
          providerRequestId: "req-fx",
          model: "deepseek-v4-pro-0813",
          billedCostUsd: usdForKrw(83),
          persistInTests: true,
        },
        d
      );
      const after = listProviderCostEventsForAssistantMessage(1, d)[0]!;
      assert.equal(after.exchange_rate_krw_per_usd, 1400, "request-time FX preserved");
      const turn = resolveMessageTurnProviderCostKrw(
        usage({ actualKrw: null }),
        listProviderCostEventsForAssistantMessage(1, d)
      );
      assert.equal(turn.knownApiCostKrw, Math.round(usdForKrw(83) * 1400 * 10) / 10);
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
      // Deterministic message identity for the request, no linked ledger yet.
      insertMessageWithStage(d, 1, {
        actualKrw: null,
        stageProviderRequestId: "concurrent-1",
        requestFx: FX,
      });
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



describe("merge blockers A-C — real daily schema, true estimate, pagination cap", () => {
  const OFFICIAL_DAILY = {
    object: "usage.daily",
    scope: "workspace",
    currency: "USD",
    start_at: "2026-07-01T00:00:00Z",
    end_at: "2026-08-01T00:00:00Z",
    total_requests: 820,
    settled_requests: 811,
    spend_usd: "148.420015",
    prompt_tokens: 1043200,
    cached_tokens: 786400,
    cache_reported_request_count: 811,
    cache_hit_pct: 75.4,
    daily_spend: [{ date: "2026-07-01", spend_usd: "4.5" }],
  };

  it("21. official /usage/daily spend_usd decimal string => exact microUSD", async () => {
    restoreKey = process.env.CHEAPER_INFERENCE_API_KEY;
    process.env.CHEAPER_INFERENCE_API_KEY = "test-key";
    const { fetchUsageDaily } = await import("./cheaperInferenceUsage");
    const fetchImpl = (async () =>
      new Response(JSON.stringify(OFFICIAL_DAILY), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;
    const res = await fetchUsageDaily({
      startAt: "2026-07-01T00:00:00Z",
      endAt: "2026-08-01T00:00:00Z",
      fetchImpl,
    });
    assert.equal(res.ok, true);
    if (res.ok) assert.equal(res.value.settledMicroUsd, 148420015);
  });

  it("25. spend_usd + daily_spend both present => spend_usd counted once", async () => {
    restoreKey = process.env.CHEAPER_INFERENCE_API_KEY;
    process.env.CHEAPER_INFERENCE_API_KEY = "test-key";
    const { fetchUsageDaily } = await import("./cheaperInferenceUsage");
    const fetchImpl = (async () =>
      new Response(JSON.stringify(OFFICIAL_DAILY), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;
    const res = await fetchUsageDaily({
      startAt: "2026-07-01T00:00:00Z",
      endAt: "2026-08-01T00:00:00Z",
      fetchImpl,
    });
    assert.equal(res.ok, true);
    if (res.ok) assert.equal(res.value.settledMicroUsd, 148420015);
    assert.notEqual((res as { value?: { settledMicroUsd: number } }).value?.settledMicroUsd, 148424515);
  });

  it("22/23. true non-exact main estimate 90 => known 90, promoted to 83 (not 173)", () => {
    const d = db();
    try {
      insertMessage(d, 1, usage({ actualKrw: null }));
      // TRUE estimate: no CI billed cost; upstream/reference only; not settled.
      recordMainGenerationProviderCost(
        {
          chatId: 1,
          assistantMessageId: 1,
          generationSequence: 0,
          provider: "cheaperinference",
          model: "deepseek-v4-pro-0813",
          requestKind: "main-rp",
          inputTokens: 1000,
          outputTokens: 500,
          upstreamCostUsd: usdForKrw(90),
          usageEstimated: true,
          providerRequestId: "req-est-true",
          outcome: "success",
          persistInTests: true,
        },
        d
      );
      const before = listProviderCostEventsForAssistantMessage(1, d);
      assert.equal(before[0]!.actual_cost_usd, null);
      const turnBefore = resolveMessageTurnProviderCostKrw(usage({ actualKrw: null }), before);
      assert.equal(turnBefore.knownApiCostKrw, 90, "ledger-owned estimate preserved, not 0");
      assert.equal(turnBefore.realizedMarginExact, false);

      const out = upsertReconciledProviderCost(
        {
          provider: "cheaperinference",
          providerRequestId: "req-est-true",
          model: "deepseek-v4-pro-0813",
          billedCostUsd: usdForKrw(83),
          persistInTests: true,
        },
        d
      );
      assert.equal(out.outcome, "promoted");
      const after = listProviderCostEventsForAssistantMessage(1, d);
      const turnAfter = resolveMessageTurnProviderCostKrw(usage({ actualKrw: null }), after);
      assert.equal(turnAfter.knownApiCostKrw, 83);
      assert.notEqual(turnAfter.knownApiCostKrw, 173);
    } finally {
      d.close();
    }
  });

  it("24. pagination cap hit with remaining cursor => not a complete success", async () => {
    restoreKey = process.env.CHEAPER_INFERENCE_API_KEY;
    process.env.CHEAPER_INFERENCE_API_KEY = "test-key";
    const { fetchAllUsageRequests } = await import("./cheaperInferenceUsage");
    let call = 0;
    const fetchImpl = (async () => {
      call += 1;
      return new Response(
        JSON.stringify({
          data: [{ request_id: "r" + call, status: "settled", billed_cost_usd: "0.001" }],
          next_cursor: "more-" + call,
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }) as unknown as typeof fetch;
    const res = await fetchAllUsageRequests({
      startAt: "2026-09-01T00:00:00Z",
      endAt: "2026-10-01T00:00:00Z",
      maxPages: 2,
      fetchImpl,
    });
    assert.equal(res.ok, false, "truncated result must not be reported as complete");
    if (!res.ok) assert.equal(res.reason, "incomplete");
  });
});


describe("merge blockers — non-admin persistence linkage + accounting window", () => {
  it("P1. non-admin DB persists providerRequestId, public serialization never leaks it", () => {
    const internal = {
      input: 1000,
      output: 500,
      model: "deepseek-v4-pro-0813",
      modelLabel: "DeepSeek V4 Pro",
      provider: "cheaperinference",
      route: "safe",
      cost: 5000,
      breakdown: [],
      stages: [
        {
          stage: "main",
          model: "deepseek-v4-pro-0813",
          input: 1000,
          output: 500,
          cost: 5000,
          providerRequestId: "req-normal-user",
          upstreamCostUsd: 0.05,
          cheaperInferenceBilledCostUsd: 0.05,
        },
      ],
      upstreamCostUsd: 0.05,
    } as unknown as Usage;

    // Public privacy owner still strips it (client must never see it).
    const publicOnly = sanitizeUsageForPublicReceipt(internal);
    const publicStage = (publicOnly.stages ?? [])[0] as unknown as Record<string, unknown>;
    assert.equal(publicStage.providerRequestId, undefined);

    // DB persistence restores ONLY the linkage.
    const persisted = attachProviderRequestLinkageForPersistence(publicOnly, internal);
    const persistedStage = (persisted.stages ?? [])[0] as unknown as Record<string, unknown>;
    assert.equal(persistedStage.providerRequestId, "req-normal-user");
    // No economics restored.
    assert.equal(persistedStage.upstreamCostUsd, undefined);
    assert.equal(persistedStage.cheaperInferenceBilledCostUsd, undefined);
    assert.equal((persisted as unknown as Record<string, unknown>).upstreamCostUsd, undefined);

    // Full public client serialization has zero occurrences anywhere.
    const client = serializeUsageForPublicClient(persisted, { keepInternal: false });
    assert.equal(JSON.stringify(client).includes("providerRequestId"), false);
  });

  it("P2. exactly-once recovery through the real non-admin persistence transform", async () => {
    const d = db();
    try {
      // Persist via the production transform (sanitize + linkage attach).
      insertMessageWithStage(d, 1, {
        actualKrw: 100,
        stageProviderRequestId: "req-B",
        requestFx: FX,
      });
      const persistedUsage = JSON.parse(
        (d.prepare("SELECT usage FROM messages WHERE id=1").get() as { usage: string }).usage
      ) as { stages: Array<{ providerRequestId?: string }> };
      assert.equal(persistedUsage.stages[0]!.providerRequestId, "req-B", "DB linkage persisted");

      const remote = Math.round(usdForKrw(100) * 1_000_000);
      const deps = {
        persistInTests: true,
        fetchRequests: async () => ({
          ok: true as const,
          value: {
            pages: 1,
            requests: [
              {
                requestId: "req-B",
                status: "settled",
                billedMicroUsd: remote,
                settled: true,
                model: "m",
                endpoint: "/c",
                createdAt: nowSql(),
              },
            ],
          },
        }),
        fetchDaily: async () => ({ ok: true as const, value: { settledMicroUsd: remote } }),
      };
      const run = () =>
        reconcileCheaperInferenceUsage({
          windowStart: "2000-01-01 00:00:00",
          windowEnd: "2100-01-01 00:00:00",
          db: d,
          deps,
        });
      await run();
      assert.equal(buildAdminFinanceSummary(d).totalApiCostKrw, 100);
      await run();
      assert.equal(buildAdminFinanceSummary(d).totalApiCostKrw, 100);
      const count = (
        d.prepare("SELECT COUNT(*) AS c FROM api_cost_ledger WHERE provider_request_id='req-B'").get() as {
          c: number;
        }
      ).c;
      assert.equal(count, 1);
    } finally {
      d.close();
    }
  });

  it("P3. cross-month: delayed recovery books into the original physical period", async () => {
    const d = db();
    try {
      const AUG_START = "2026-08-01 00:00:00";
      const AUG_END = "2026-09-01 00:00:00";
      const SEP_END = "2026-10-01 00:00:00";
      insertMessageWithStage(d, 1, {
        actualKrw: 100,
        stageProviderRequestId: "req-aug",
        requestFx: FX,
        createdAt: "2026-08-31 20:00:00",
      });
      assert.equal(readLocalReconciledMicroUsd(d, AUG_START, AUG_END), 0, "no ledger yet");

      const remote = Math.round(usdForKrw(100) * 1_000_000);
      await reconcileCheaperInferenceUsage({
        windowStart: AUG_START,
        windowEnd: AUG_END,
        db: d,
        deps: {
          persistInTests: true,
          fetchRequests: async () => ({
            ok: true as const,
            value: {
              pages: 1,
              requests: [
                {
                  requestId: "req-aug",
                  status: "settled",
                  billedMicroUsd: remote,
                  settled: true,
                  model: "m",
                  endpoint: "/c",
                  createdAt: "2026-08-31 20:00:00",
                },
              ],
            },
          }),
          fetchDaily: async () => ({ ok: true as const, value: { settledMicroUsd: remote } }),
        },
      });

      assert.equal(
        readLocalReconciledMicroUsd(d, AUG_START, AUG_END),
        remote,
        "August attribution includes the recovered request"
      );
      assert.equal(
        readLocalReconciledMicroUsd(d, AUG_END, SEP_END),
        0,
        "September attribution does not double-book it"
      );
      const row = d
        .prepare("SELECT created_at FROM api_cost_ledger WHERE provider_request_id='req-aug'")
        .get() as { created_at: string };
      assert.equal(row.created_at, "2026-08-31 20:00:00");
      assert.equal(buildAdminFinanceSummary(d, "2026-08").totalApiCostKrw, 100);
    } finally {
      d.close();
    }
  });
});
