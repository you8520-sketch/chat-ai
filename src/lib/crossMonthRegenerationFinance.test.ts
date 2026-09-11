/**
 * Cross-month regeneration — monthly accounting-event period owners.
 *
 * OWNER MAP
 *  - MESSAGE CHRONOLOGY      messages.created_at                 (UI/history only)
 *  - USER CHARGE EVENT       chat_billing_settlements.created_at (revenue)
 *  - PROVIDER EXPENSE EVENT  api_cost_ledger.created_at          (cost)
 *  - GENERATION IDENTITY     settlement.request_id / ledger.generation_request_id /
 *                            assistant_message_id
 *  - MONTHLY FINANCE         buildAdminFinanceSummary
 *
 * Regeneration reuses the assistant message row (created_at never moves) but is
 * a NEW charge event and a NEW physical provider request. These tests pin that
 * monthly P&L follows the EVENT period, never the message's creation period.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { buildAdminFinanceSummary, ensureAdminFinanceTables } from "./adminFinance";
import {
  ensureProviderCostLedgerSchema,
  readLedgerPeriodCostAttribution,
  recordMainGenerationProviderCost,
} from "./providerCostLedger";
import { ensureChatBillingSettlementSchema } from "./chatBillingSettlementSchema";

const MODEL = "deepseek-v4-pro-0813";
const MODEL_LABEL = "DeepSeek V4 Pro";
const FX = 1500;
const usd = (krw: number) => krw / FX;

function financeDb(): Database.Database {
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
  ensureChatBillingSettlementSchema(d);
  return d;
}

function slices(paid: number, free = 0) {
  const out: Array<{ transactionId: number; pointType: string; amount: number }> = [];
  if (paid > 0) out.push({ transactionId: 1, pointType: "PAID", amount: paid });
  if (free > 0) out.push({ transactionId: 2, pointType: "FREE", amount: free });
  return JSON.stringify(out);
}

function usageJson(model = MODEL, modelLabel = MODEL_LABEL, actualKrw?: number) {
  return JSON.stringify({
    model,
    modelLabel,
    provider: "cheaperinference",
    input: 1000,
    output: 500,
    cost: 5000,
    ...(actualKrw != null
      ? {
          shadowPricing: {
            pricingVersion: 1,
            actualTurnCostCoverage: "complete",
            actualProviderCostKrw: actualKrw,
            actualCostUsd: usd(actualKrw),
            actualCostSource: "cheaper_inference_billed",
            provider: "cheaperinference",
            modelId: model,
            fxSnapshot: { effectiveKrwPerUsd: FX },
          },
        }
      : {}),
  });
}

function insertMessage(
  d: Database.Database,
  id: number,
  opts: {
    createdAt: string;
    requestId: string | null;
    paid?: number;
    free?: number;
    actualKrw?: number | null;
    model?: string;
    modelLabel?: string;
  }
) {
  d.prepare(
    `INSERT INTO messages (id, chat_id, role, content, request_id, usage, deduction_slices, created_at, is_refunded)
     VALUES (?, 1, 'assistant', 'reply', ?, ?, ?, ?, 0)`
  ).run(
    id,
    opts.requestId,
    usageJson(opts.model, opts.modelLabel, opts.actualKrw ?? undefined),
    slices(opts.paid ?? 0, opts.free ?? 0),
    opts.createdAt
  );
}

/** Simulate regeneration: reuse the row, overwrite generation state, keep created_at. */
function regenerateMessage(
  d: Database.Database,
  id: number,
  opts: { requestId: string; paid?: number; free?: number; actualKrw?: number | null; model?: string; modelLabel?: string }
) {
  d.prepare(
    `UPDATE messages
        SET request_id = ?, usage = ?, deduction_slices = ?
      WHERE id = ?`
  ).run(
    opts.requestId,
    usageJson(opts.model, opts.modelLabel, opts.actualKrw ?? undefined),
    slices(opts.paid ?? 0, opts.free ?? 0),
    id
  );
}

function insertSettlement(
  d: Database.Database,
  opts: {
    requestId: string;
    assistantMessageId: number | null;
    createdAt: string;
    paid?: number;
    free?: number;
    outcome?: string;
    source?: string;
    ignoreDuplicate?: boolean;
  }
) {
  const suffix = opts.ignoreDuplicate
    ? "ON CONFLICT(user_id, chat_id, request_id, charge_kind) DO NOTHING"
    : "";
  const settled = (opts.paid ?? 0) + (opts.free ?? 0);
  d.prepare(
    `INSERT INTO chat_billing_settlements
       (user_id, chat_id, request_id, charge_kind, assistant_message_id, requested_points, settled_points,
        outcome, deduction_slices_json, reason, source, created_at)
     VALUES (1, 1, ?, 'chat_turn', ?, ?, ?, ?, ?, '', ?, ?)
     ${suffix}`
  ).run(
    opts.requestId,
    opts.assistantMessageId,
    settled,
    settled,
    opts.outcome ?? "charged",
    slices(opts.paid ?? 0, opts.free ?? 0),
    opts.source ?? "native",
    opts.createdAt
  );
}

function mainLedger(
  d: Database.Database,
  opts: { messageId: number; requestId: string; eventTime: string; krw: number; model?: string }
) {
  return recordMainGenerationProviderCost(
    {
      chatId: 1,
      assistantMessageId: opts.messageId,
      generationSequence: 0,
      generationRequestId: opts.requestId,
      provider: "cheaperinference",
      model: opts.model ?? MODEL,
      requestKind: "main-rp",
      inputTokens: 1000,
      outputTokens: 500,
      cheaperInferenceBilledCostUsd: usd(opts.krw),
      providerRequestId: opts.requestId,
      exchangeRateKrwPerUsd: FX,
      eventTime: opts.eventTime,
      outcome: "success",
      persistInTests: true,
    },
    d
  );
}

function pnl(s: ReturnType<typeof buildAdminFinanceSummary>) {
  return {
    chatPaid: s.chat.paidRevenueKrw,
    chatFree: s.chat.freePointSpend,
    chatApi: s.chat.apiCostKrw,
    totalApi: s.totalApiCostKrw,
    aiTotal: s.aiCost.totalKrw,
    net: s.netProfitKrw,
  };
}

describe("cross-month regeneration — event-period accounting owners", () => {
  it("A. August is immutable and September owns its own generation", () => {
    const d = financeDb();
    try {
      // --- Original generation A (August) ---
      insertMessage(d, 1, {
        createdAt: "2026-08-31 20:00:00",
        requestId: "req-A",
        paid: 500,
        actualKrw: 100,
      });
      insertSettlement(d, {
        requestId: "req-A",
        assistantMessageId: 1,
        createdAt: "2026-08-31 20:00:00",
        paid: 500,
      });
      mainLedger(d, { messageId: 1, requestId: "req-A", eventTime: "2026-08-31 20:00:00", krw: 100 });

      const augustBefore = pnl(buildAdminFinanceSummary(d, "2026-08"));
      assert.deepEqual(augustBefore, {
        chatPaid: 500,
        chatFree: 0,
        chatApi: 100,
        totalApi: 100,
        aiTotal: 100,
        net: 400,
      });

      // --- Regeneration B (September): same message row, new generation ---
      regenerateMessage(d, 1, { requestId: "req-B", paid: 600, actualKrw: 120 });
      insertSettlement(d, {
        requestId: "req-B",
        assistantMessageId: 1,
        createdAt: "2026-09-01 10:00:00",
        paid: 600,
      });
      mainLedger(d, { messageId: 1, requestId: "req-B", eventTime: "2026-09-01 10:00:00", krw: 120 });

      const augustAfter = pnl(buildAdminFinanceSummary(d, "2026-08"));
      const september = pnl(buildAdminFinanceSummary(d, "2026-09"));

      assert.deepEqual(augustAfter, augustBefore, "August must not change after September regeneration");
      assert.deepEqual(september, {
        chatPaid: 600,
        chatFree: 0,
        chatApi: 120,
        totalApi: 120,
        aiTotal: 120,
        net: 480,
      });

      // Model breakdown uses the same event period.
      const augModels = buildAdminFinanceSummary(d, "2026-08").modelBreakdown;
      const sepModels = buildAdminFinanceSummary(d, "2026-09").modelBreakdown;
      assert.deepEqual(
        augModels.map((m) => ({ model: m.model, paid: m.paidRevenueKrw, api: m.apiCostKrw })),
        [{ model: MODEL_LABEL, paid: 500, api: 100 }]
      );
      assert.deepEqual(
        sepModels.map((m) => ({ model: m.model, paid: m.paidRevenueKrw, api: m.apiCostKrw })),
        [{ model: MODEL_LABEL, paid: 600, api: 120 }]
      );

      // aiModelCosts direct contribution uses the same event-period semantics:
      // the September settlement revenue merges with the September ledger cost.
      const shape = (m: {
        model: string;
        kind: string;
        paidRevenueKrw: number;
        actualKrw: number;
      }) => ({ model: m.model, kind: m.kind, paid: m.paidRevenueKrw, actual: m.actualKrw });
      assert.deepEqual(
        buildAdminFinanceSummary(d, "2026-08").aiModelCosts.map(shape),
        [{ model: MODEL_LABEL, kind: "direct", paid: 500, actual: 100 }]
      );
      assert.deepEqual(
        buildAdminFinanceSummary(d, "2026-09").aiModelCosts.map(shape),
        [{ model: MODEL_LABEL, kind: "direct", paid: 600, actual: 120 }]
      );
    } finally {
      d.close();
    }
  });

  it("B. same-month regeneration includes BOTH charge and provider events exactly once", () => {
    const d = financeDb();
    try {
      insertMessage(d, 1, {
        createdAt: "2026-08-05 10:00:00",
        requestId: "req-A",
        paid: 500,
        actualKrw: 100,
      });
      insertSettlement(d, {
        requestId: "req-A",
        assistantMessageId: 1,
        createdAt: "2026-08-05 10:00:00",
        paid: 500,
      });
      mainLedger(d, { messageId: 1, requestId: "req-A", eventTime: "2026-08-05 10:00:00", krw: 100 });

      regenerateMessage(d, 1, { requestId: "req-B", paid: 600, actualKrw: 120 });
      insertSettlement(d, {
        requestId: "req-B",
        assistantMessageId: 1,
        createdAt: "2026-08-20 10:00:00",
        paid: 600,
      });
      mainLedger(d, { messageId: 1, requestId: "req-B", eventTime: "2026-08-20 10:00:00", krw: 120 });

      assert.deepEqual(pnl(buildAdminFinanceSummary(d, "2026-08")), {
        chatPaid: 1100,
        chatFree: 0,
        chatApi: 220,
        totalApi: 220,
        aiTotal: 220,
        net: 880,
      });
    } finally {
      d.close();
    }
  });

  it("C. duplicate replay neither duplicates revenue nor cost", () => {
    const d = financeDb();
    try {
      insertMessage(d, 1, {
        createdAt: "2026-08-31 20:00:00",
        requestId: "req-B",
        paid: 600,
        actualKrw: 120,
      });
      insertSettlement(d, {
        requestId: "req-B",
        assistantMessageId: 1,
        createdAt: "2026-08-31 20:00:00",
        paid: 600,
        ignoreDuplicate: true,
      });
      // Replayed settlement insert must be a no-op (canonical UNIQUE identity).
      insertSettlement(d, {
        requestId: "req-B",
        assistantMessageId: 1,
        createdAt: "2026-08-31 20:00:00",
        paid: 600,
        ignoreDuplicate: true,
      });
      const settlementCount = (
        d.prepare("SELECT COUNT(*) AS c FROM chat_billing_settlements").get() as { c: number }
      ).c;
      assert.equal(settlementCount, 1);

      mainLedger(d, { messageId: 1, requestId: "req-B", eventTime: "2026-08-31 20:00:00", krw: 120 });
      // Replayed provider request is deduped by provider request identity.
      const replay = mainLedger(d, {
        messageId: 1,
        requestId: "req-B",
        eventTime: "2026-08-31 20:00:00",
        krw: 120,
      });
      assert.equal(replay.recorded, false);
      const ledgerCount = (
        d.prepare("SELECT COUNT(*) AS c FROM api_cost_ledger").get() as { c: number }
      ).c;
      assert.equal(ledgerCount, 1);

      assert.deepEqual(pnl(buildAdminFinanceSummary(d, "2026-08")), {
        chatPaid: 600,
        chatFree: 0,
        chatApi: 120,
        totalApi: 120,
        aiTotal: 120,
        net: 480,
      });
    } finally {
      d.close();
    }
  });

  it("D. waived settlement is 0 revenue; provider expense is still owned by its period", () => {
    const d = financeDb();
    try {
      insertMessage(d, 1, {
        createdAt: "2026-09-02 10:00:00",
        requestId: "req-w",
        paid: 0,
        actualKrw: 120,
      });
      insertSettlement(d, {
        requestId: "req-w",
        assistantMessageId: 1,
        createdAt: "2026-09-02 10:00:00",
        paid: 0,
        outcome: "waived",
      });
      mainLedger(d, { messageId: 1, requestId: "req-w", eventTime: "2026-09-02 10:00:00", krw: 120 });

      const s = pnl(buildAdminFinanceSummary(d, "2026-09"));
      assert.equal(s.chatPaid, 0);
      assert.equal(s.chatApi, 120);
      assert.equal(s.aiTotal, 120);
      assert.equal(s.totalApi, 120);
    } finally {
      d.close();
    }
  });

  it("E. FREE-only settlement credits free spend only", () => {
    const d = financeDb();
    try {
      insertMessage(d, 1, {
        createdAt: "2026-09-02 10:00:00",
        requestId: "req-f",
        free: 300,
        actualKrw: 90,
      });
      insertSettlement(d, {
        requestId: "req-f",
        assistantMessageId: 1,
        createdAt: "2026-09-02 10:00:00",
        free: 300,
      });
      mainLedger(d, { messageId: 1, requestId: "req-f", eventTime: "2026-09-02 10:00:00", krw: 90 });

      const s = pnl(buildAdminFinanceSummary(d, "2026-09"));
      assert.equal(s.chatPaid, 0);
      assert.equal(s.chatFree, 300);
    } finally {
      d.close();
    }
  });

  it("F. mixed PAID/FREE settlement keeps slice semantics", () => {
    const d = financeDb();
    try {
      insertMessage(d, 1, {
        createdAt: "2026-09-02 10:00:00",
        requestId: "req-m",
        paid: 400,
        free: 200,
        actualKrw: 90,
      });
      insertSettlement(d, {
        requestId: "req-m",
        assistantMessageId: 1,
        createdAt: "2026-09-02 10:00:00",
        paid: 400,
        free: 200,
      });
      mainLedger(d, { messageId: 1, requestId: "req-m", eventTime: "2026-09-02 10:00:00", krw: 90 });

      const s = pnl(buildAdminFinanceSummary(d, "2026-09"));
      assert.equal(s.chatPaid, 400);
      assert.equal(s.chatFree, 200);
    } finally {
      d.close();
    }
  });

  it("G. legacy turn with no canonical event keeps the message fallback", () => {
    const d = financeDb();
    try {
      insertMessage(d, 1, {
        createdAt: "2026-09-02 10:00:00",
        requestId: "req-legacy",
        paid: 500,
        actualKrw: 100,
      });
      const s = pnl(buildAdminFinanceSummary(d, "2026-09"));
      assert.deepEqual(s, {
        chatPaid: 500,
        chatFree: 0,
        chatApi: 100,
        totalApi: 100,
        aiTotal: 0,
        net: 400,
      });
    } finally {
      d.close();
    }
  });

  it("H. ledger exact + usage snapshot are never double counted", () => {
    const d = financeDb();
    try {
      insertMessage(d, 1, {
        createdAt: "2026-09-02 10:00:00",
        requestId: "req-h",
        paid: 500,
        actualKrw: 100,
      });
      insertSettlement(d, {
        requestId: "req-h",
        assistantMessageId: 1,
        createdAt: "2026-09-02 10:00:00",
        paid: 500,
      });
      mainLedger(d, { messageId: 1, requestId: "req-h", eventTime: "2026-09-02 10:00:00", krw: 100 });
      assert.equal(buildAdminFinanceSummary(d, "2026-09").totalApiCostKrw, 100);
    } finally {
      d.close();
    }
  });

  it("I. unlinked background expense is preserved without entering chat revenue", () => {
    const d = financeDb();
    try {
      insertMessage(d, 1, {
        createdAt: "2026-09-02 10:00:00",
        requestId: "req-i",
        paid: 500,
        actualKrw: 100,
      });
      insertSettlement(d, {
        requestId: "req-i",
        assistantMessageId: 1,
        createdAt: "2026-09-02 10:00:00",
        paid: 500,
      });
      mainLedger(d, { messageId: 1, requestId: "req-i", eventTime: "2026-09-02 10:00:00", krw: 100 });
      d.prepare(
        `INSERT INTO api_cost_ledger
           (event_key, family, funding_class, execution_phase, attempt_ordinal,
            requested_provider, requested_model, provider, model, request_kind, cost_center,
            provider_request_id, actual_cost_usd, actual_cost_source, event_status,
            exchange_rate_krw_per_usd, cost_krw, estimated, created_at, completed_at)
         VALUES ('bg-1','background','platform_funded','async_post_turn',1,
                 'cheaperinference','memory-model','cheaperinference','memory-model','background-memory-extract','memory',
                 'req-i-bg', ?, 'cheaper_inference_usage_api','settled',
                 ?, 75, 0, '2026-09-02 11:00:00', '2026-09-02 11:00:00')`
      ).run(usd(50), FX);

      const summary = buildAdminFinanceSummary(d, "2026-09");
      assert.equal(summary.chat.apiCostKrw, 100);
      assert.equal(summary.totalApiCostKrw, 150);
      assert.equal(summary.aiCost.totalKrw, 150);
      assert.equal(summary.aiCost.byCenter.find((c) => c.center === "memory")?.actualKrw, 50);
    } finally {
      d.close();
    }
  });

  it("J. image expense stays owned by chat_image_generations (documented difference)", () => {
    const d = financeDb();
    try {
      insertMessage(d, 1, {
        createdAt: "2026-09-02 10:00:00",
        requestId: "req-j",
        paid: 500,
        actualKrw: 100,
      });
      insertSettlement(d, {
        requestId: "req-j",
        assistantMessageId: 1,
        createdAt: "2026-09-02 10:00:00",
        paid: 500,
      });
      mainLedger(d, { messageId: 1, requestId: "req-j", eventTime: "2026-09-02 10:00:00", krw: 100 });
      d.prepare(
        `INSERT INTO chat_image_generations (upstream_cost_usd, deduction_slices, exchange_rate_krw_per_usd, created_at)
         VALUES (?, ?, ?, '2026-09-02 12:00:00')`
      ).run(usd(15), slices(300), FX);

      const summary = buildAdminFinanceSummary(d, "2026-09");
      assert.equal(summary.image.apiCostKrw, 15);
      assert.equal(summary.totalApiCostKrw, 115);
      // Image-generation cost is NOT in the ledger: the difference is documented
      // by the image category, not by a missing linked regeneration event.
      assert.equal(summary.aiCost.totalKrw, 100);
    } finally {
      d.close();
    }
  });

  it("K. provider period attribution matches the canonical ledger exactly", () => {
    const d = financeDb();
    try {
      insertMessage(d, 1, {
        createdAt: "2026-08-31 20:00:00",
        requestId: "req-A",
        paid: 500,
        actualKrw: 100,
      });
      insertSettlement(d, {
        requestId: "req-A",
        assistantMessageId: 1,
        createdAt: "2026-08-31 20:00:00",
        paid: 500,
      });
      mainLedger(d, { messageId: 1, requestId: "req-A", eventTime: "2026-08-31 20:00:00", krw: 100 });
      regenerateMessage(d, 1, { requestId: "req-B", paid: 600, actualKrw: 120 });
      insertSettlement(d, {
        requestId: "req-B",
        assistantMessageId: 1,
        createdAt: "2026-09-01 10:00:00",
        paid: 600,
      });
      mainLedger(d, { messageId: 1, requestId: "req-B", eventTime: "2026-09-01 10:00:00", krw: 120 });

      for (const [month, start, end, expected] of [
        ["2026-08", "2026-08-01 00:00:00", "2026-09-01 00:00:00", 100],
        ["2026-09", "2026-09-01 00:00:00", "2026-10-01 00:00:00", 120],
      ] as const) {
        const summary = buildAdminFinanceSummary(d, month);
        const ledger = readLedgerPeriodCostAttribution(d, start, end);
        assert.equal(ledger.totals.actualKrw, expected);
        assert.equal(summary.aiCost.totalKrw, expected);
        // No image / no legacy / no background in this fixture: the UI totals
        // must use the exact same physical-event set (invariant 6).
        assert.equal(summary.totalApiCostKrw, summary.aiCost.totalKrw);
      }
    } finally {
      d.close();
    }
  });
});
