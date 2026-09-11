/**
 * Refund / reversal → monthly revenue projection.
 *
 * OWNER MAP
 *  - USER CHARGE      chat_billing_settlements
 *  - POINT REFUND     refundMessageDeduction (canonical reversal core)
 *  - REFUND STATUS    messages.is_refunded (assistant-wide, reset on regen)
 *  - REFUND HISTORY   report_refunds.status
 *  - CREATOR REVERSAL reverseCreatorRewardForMessage
 *  - MONTHLY REVENUE  buildAdminFinanceSummary settlement/bridge event reader
 *
 * These tests exercise the REAL reversal core (refundMessageDeduction) and the
 * REAL report flow (processReportRefund/reviewReportRefund), then assert the
 * monthly projection. Each test owns a distinct month so summaries never see
 * another test's rows.
 */

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { getDb } from "./db";
import { installIsolatedTestDatabase } from "./test/isolatedTestDatabase";
import { creditPoints, deductPoints, type DeductionSlice } from "./points";
import { refundMessageDeduction, processReportRefund, reviewReportRefund } from "./refund";
import { buildAdminFinanceSummary, ensureAdminFinanceTables } from "./adminFinance";
import {
  ensureProviderCostLedgerSchema,
  recordMainGenerationProviderCost,
} from "./providerCostLedger";
import { ensureChatBillingSettlementSchema } from "./chatBillingSettlementSchema";

const FX = 1500;
const usd = (krw: number) => krw / FX;

let monthCounter = 0;
/** Distinct month per test so month-scoped summaries stay isolated. */
function nextMonth(): { month: string; at: string } {
  monthCounter += 1;
  const month = `2020-${String(monthCounter).padStart(2, "0")}`;
  return { month, at: `${month}-15 10:00:00` };
}

let characterId = 0;

before(() => {
  installIsolatedTestDatabase();
  const db = getDb();
  ensureAdminFinanceTables(db);
  ensureProviderCostLedgerSchema(db);
  ensureChatBillingSettlementSchema(db);
  const existing = db.prepare("SELECT id FROM characters LIMIT 1").get() as
    | { id: number }
    | undefined;
  characterId = existing
    ? existing.id
    : Number(db.prepare("INSERT INTO characters (name) VALUES ('refund-test')").run().lastInsertRowid);
});

function createUserAndChat(): { userId: number; chatId: number } {
  const db = getDb();
  const tag = `refundfin_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const userId = Number(
    db
      .prepare("INSERT INTO users (email, nickname, pw_hash, points) VALUES (?,?,?,0)")
      .run(`${tag}@test.local`, tag, "x").lastInsertRowid
  );
  const chatId = Number(
    db
      .prepare("INSERT INTO chats (user_id, character_id) VALUES (?,?)")
      .run(userId, characterId).lastInsertRowid
  );
  return { userId, chatId };
}

function insertAssistantMessage(opts: {
  chatId: number;
  requestId: string;
  at: string;
  model: string;
  usage?: Record<string, unknown>;
  slices: DeductionSlice[];
}): number {
  const db = getDb();
  const sliceTotal = opts.slices.reduce((sum, s) => sum + s.amount, 0);
  const usage = {
    model: opts.model,
    modelLabel: opts.model,
    cost: sliceTotal,
    ...(opts.usage ?? {}),
  };
  return Number(
    db
      .prepare(
        `INSERT INTO messages (chat_id, role, content, model, request_id, usage, deduction_slices, created_at, is_refunded, generation_status)
         VALUES (?, 'assistant', ?, ?, ?, ?, ?, ?, 0, 'completed')`
      )
      .run(
        opts.chatId,
        "안녕하세요! 오늘은 정말 좋은 하루네요. 천천히 이야기해요.",
        opts.model,
        opts.requestId,
        JSON.stringify(usage),
        JSON.stringify(opts.slices),
        opts.at
      ).lastInsertRowid
  );
}

/** Credit real lots then deduct through the production engine to get real slices. */
function chargeTurn(
  userId: number,
  chatId: number,
  messageId: number,
  opts: { paid: number; free: number; reason: string }
): DeductionSlice[] {
  if (opts.paid > 0) creditPoints(userId, opts.paid, "PAID", `${opts.reason} credit paid`);
  if (opts.free > 0) creditPoints(userId, opts.free, "FREE", `${opts.reason} credit free`);
  const amount = opts.paid + opts.free;
  if (amount <= 0) return [];
  const deducted = deductPoints(userId, amount, opts.reason, { messageId, chatId });
  return deducted.slices;
}

function insertNativeSettlement(opts: {
  userId: number;
  chatId: number;
  requestId: string;
  messageId: number;
  slices: DeductionSlice[];
  at: string;
}) {
  const db = getDb();
  const settled = opts.slices.reduce((sum, s) => sum + s.amount, 0);
  db.prepare(
    `INSERT INTO chat_billing_settlements
       (user_id, chat_id, request_id, charge_kind, assistant_message_id, requested_points, settled_points,
        outcome, deduction_slices_json, reason, source, created_at)
     VALUES (?, ?, ?, 'chat_turn', ?, ?, ?, 'charged', ?, '', 'native', ?)`
  ).run(
    opts.userId,
    opts.chatId,
    opts.requestId,
    opts.messageId,
    settled,
    settled,
    JSON.stringify(opts.slices),
    opts.at
  );
}

function insertLegacyBridge(opts: {
  userId: number;
  chatId: number;
  requestId: string;
  messageId: number;
  slices: DeductionSlice[];
  at: string;
}) {
  const db = getDb();
  const settled = opts.slices.reduce((sum, s) => sum + s.amount, 0);
  db.prepare(
    `INSERT INTO chat_billing_settlements
       (user_id, chat_id, request_id, charge_kind, assistant_message_id, requested_points, settled_points,
        outcome, deduction_slices_json, reason, source, created_at)
     VALUES (?, ?, ?, 'chat_turn', ?, ?, ?, 'legacy_already_billed', ?, '', 'legacy_message_deduction_slices', ?)`
  ).run(
    opts.userId,
    opts.chatId,
    opts.requestId,
    opts.messageId,
    settled,
    settled,
    JSON.stringify(opts.slices),
    opts.at
  );
}

function seedMainLedger(opts: {
  chatId: number;
  messageId: number;
  requestId: string;
  at: string;
  krw: number;
  model: string;
}) {
  const db = getDb();
  recordMainGenerationProviderCost(
    {
      chatId: opts.chatId,
      assistantMessageId: opts.messageId,
      generationSequence: 0,
      generationRequestId: opts.requestId,
      provider: "cheaperinference",
      model: opts.model,
      requestKind: "main-rp",
      inputTokens: 1000,
      outputTokens: 500,
      cheaperInferenceBilledCostUsd: usd(opts.krw),
      providerRequestId: `prov-${opts.messageId}-${opts.requestId}`,
      exchangeRateKrwPerUsd: FX,
      eventTime: opts.at,
      outcome: "success",
      persistInTests: true,
    },
    db
  );
}

function modelRows(month: string) {
  return buildAdminFinanceSummary(getDb(), month).modelBreakdown
    .map((m) => ({ model: m.model, paid: m.paidRevenueKrw, api: m.apiCostKrw }))
    .sort((a, b) => a.model.localeCompare(b.model));
}

describe("refund → monthly finance projection", () => {
  it("R1. native paid refund removes revenue but keeps provider expense", () => {
    const { userId, chatId } = createUserAndChat();
    const { month, at } = nextMonth();
    const slices = chargeTurn(userId, chatId, 0, { paid: 500, free: 0, reason: "r1 seed" });
    const messageId = insertAssistantMessage({
      chatId,
      requestId: "req-R1",
      at,
      model: "model-r1",
      slices,
    });
    insertNativeSettlement({ userId, chatId, requestId: "req-R1", messageId, slices, at });
    seedMainLedger({ chatId, messageId, requestId: "req-R1", at, krw: 100, model: "model-r1" });

    const before = buildAdminFinanceSummary(getDb(), month);
    assert.equal(before.chat.paidRevenueKrw, 500);
    assert.equal(before.chat.apiCostKrw, 100);

    refundMessageDeduction(userId, messageId, slices, 500, "r1 refund");

    const after = buildAdminFinanceSummary(getDb(), month);
    assert.equal(after.chat.paidRevenueKrw, 0, "refunded charge must not remain revenue");
    assert.equal(after.chat.apiCostKrw, 100, "provider expense is not user-refunded");
    assert.equal(after.aiCost.totalKrw, 100);
  });

  it("R2. FREE-only refund keeps paid revenue at 0", () => {
    const { userId, chatId } = createUserAndChat();
    const { month, at } = nextMonth();
    const slices = chargeTurn(userId, chatId, 0, { paid: 0, free: 500, reason: "r2 seed" });
    const messageId = insertAssistantMessage({
      chatId,
      requestId: "req-R2",
      at,
      model: "model-r2",
      slices,
    });
    insertNativeSettlement({ userId, chatId, requestId: "req-R2", messageId, slices, at });

    assert.equal(buildAdminFinanceSummary(getDb(), month).chat.paidRevenueKrw, 0);
    refundMessageDeduction(userId, messageId, slices, 500, "r2 refund");
    const after = buildAdminFinanceSummary(getDb(), month);
    assert.equal(after.chat.paidRevenueKrw, 0);
    assert.ok(after.chat.paidRevenueKrw >= 0);
  });

  it("R3. mixed PAID/FREE refund reverses both without negative values", () => {
    const { userId, chatId } = createUserAndChat();
    const { month, at } = nextMonth();
    const slices = chargeTurn(userId, chatId, 0, { paid: 300, free: 200, reason: "r3 seed" });
    const messageId = insertAssistantMessage({
      chatId,
      requestId: "req-R3",
      at,
      model: "model-r3",
      slices,
    });
    insertNativeSettlement({ userId, chatId, requestId: "req-R3", messageId, slices, at });

    const before = buildAdminFinanceSummary(getDb(), month);
    assert.equal(before.chat.paidRevenueKrw, 300);
    assert.equal(before.chat.freePointSpend, 200);

    refundMessageDeduction(userId, messageId, slices, 500, "r3 refund");

    const after = buildAdminFinanceSummary(getDb(), month);
    assert.equal(after.chat.paidRevenueKrw, 0);
    assert.equal(after.chat.freePointSpend, 0);
    assert.equal(after.paidPointsConsumed, 0);
  });

  it("R4. pending report leaves revenue unchanged", () => {
    const { userId, chatId } = createUserAndChat();
    const { month, at } = nextMonth();
    const slices = chargeTurn(userId, chatId, 0, { paid: 500, free: 0, reason: "r4 seed" });
    const messageId = insertAssistantMessage({
      chatId,
      requestId: "req-R4",
      at,
      model: "model-r4",
      slices,
    });
    insertNativeSettlement({ userId, chatId, requestId: "req-R4", messageId, slices, at });
    // Pending state = report filed, NO reversal executed.
    getDb()
      .prepare(
        `INSERT INTO report_refunds (user_id, chat_id, message_id, status, refund_amount, validation_note)
         VALUES (?, ?, ?, 'pending', 500, 'r4 pending')`
      )
      .run(userId, chatId, messageId);

    assert.equal(buildAdminFinanceSummary(getDb(), month).chat.paidRevenueKrw, 500);
  });

  it("R5. rejected report leaves revenue unchanged", () => {
    const { userId, chatId } = createUserAndChat();
    const { month, at } = nextMonth();
    const slices = chargeTurn(userId, chatId, 0, { paid: 500, free: 0, reason: "r5 seed" });
    const messageId = insertAssistantMessage({
      chatId,
      requestId: "req-R5",
      at,
      model: "model-r5",
      slices,
    });
    insertNativeSettlement({ userId, chatId, requestId: "req-R5", messageId, slices, at });
    const reportId = Number(
      getDb()
        .prepare(
          `INSERT INTO report_refunds (user_id, chat_id, message_id, status, refund_amount, validation_note)
           VALUES (?, ?, ?, 'pending', 500, 'r5 pending')`
        )
        .run(userId, chatId, messageId).lastInsertRowid
    );

    const review = reviewReportRefund(reportId, "reject", "r5 reject");
    assert.equal(review.ok, true);
    assert.equal(buildAdminFinanceSummary(getDb(), month).chat.paidRevenueKrw, 500);
  });

  it("R6. refund A + regeneration B => A 0, B 600, total 600 (not 1100, not 0)", () => {
    const { userId, chatId } = createUserAndChat();
    const { month, at } = nextMonth();
    const slicesA = chargeTurn(userId, chatId, 0, { paid: 500, free: 0, reason: "r6 A" });
    const messageId = insertAssistantMessage({
      chatId,
      requestId: "req-A6",
      at,
      model: "model-X6",
      slices: slicesA,
    });
    insertNativeSettlement({ userId, chatId, requestId: "req-A6", messageId, slices: slicesA, at });
    seedMainLedger({ chatId, messageId, requestId: "req-A6", at, krw: 100, model: "model-X6" });

    refundMessageDeduction(userId, messageId, slicesA, 500, "r6 refund A");
    assert.equal(buildAdminFinanceSummary(getDb(), month).chat.paidRevenueKrw, 0);

    // Regeneration bootstrap semantics: same row, new request, is_refunded reset.
    const slicesB = chargeTurn(userId, chatId, messageId, { paid: 600, free: 0, reason: "r6 B" });
    getDb()
      .prepare(
        `UPDATE messages SET request_id=?, usage=?, deduction_slices=?, is_refunded=0, alternates=?
          WHERE id=?`
      )
      .run(
        "req-B6",
        JSON.stringify({ model: "model-Y6", modelLabel: "model-Y6" }),
        JSON.stringify(slicesB),
        JSON.stringify([{ content: "old", model: "model-X6", usage: null, created_at: at, requestId: "req-A6" }]),
        messageId
      );
    insertNativeSettlement({ userId, chatId, requestId: "req-B6", messageId, slices: slicesB, at });
    seedMainLedger({ chatId, messageId, requestId: "req-B6", at, krw: 120, model: "model-Y6" });

    const after = buildAdminFinanceSummary(getDb(), month);
    assert.equal(after.chat.paidRevenueKrw, 600);
    const rowsByModel = new Map(
      after.modelBreakdown.map((m) => [m.model, m.paidRevenueKrw])
    );
    assert.equal(rowsByModel.get("model-X6"), 0, "refunded A revenue removed");
    assert.equal(rowsByModel.get("model-Y6"), 600, "B revenue preserved");
    // Provider expense for both physical calls remains (not user-refunded).
    assert.equal(after.chat.apiCostKrw, 220);
  });

  it("R7. duplicate refund processing reverses revenue once", () => {
    const { userId, chatId } = createUserAndChat();
    const { month, at } = nextMonth();
    const slices = chargeTurn(userId, chatId, 0, { paid: 500, free: 0, reason: "r7 seed" });
    const messageId = insertAssistantMessage({
      chatId,
      requestId: "req-R7",
      at,
      model: "model-r7",
      slices,
    });
    insertNativeSettlement({ userId, chatId, requestId: "req-R7", messageId, slices, at });

    refundMessageDeduction(userId, messageId, slices, 500, "r7 refund");
    const second = processReportRefund(userId, messageId, chatId);
    assert.equal(second.status, "rejected");

    const after = buildAdminFinanceSummary(getDb(), month);
    assert.equal(after.chat.paidRevenueKrw, 0);
    assert.ok(after.chat.paidRevenueKrw >= 0);
  });

  it("R8. legacy bridge does not resurrect a refunded message's revenue", () => {
    const { userId, chatId } = createUserAndChat();
    const { month, at } = nextMonth();
    const slices = chargeTurn(userId, chatId, 0, { paid: 500, free: 0, reason: "r8 legacy" });
    const messageId = insertAssistantMessage({
      chatId,
      requestId: "req-legacy8",
      at,
      model: "model-r8",
      slices,
    });

    refundMessageDeduction(userId, messageId, slices, 500, "r8 refund legacy");
    insertLegacyBridge({
      userId,
      chatId,
      requestId: "req-legacy8",
      messageId,
      slices,
      at,
    });

    const after = buildAdminFinanceSummary(getDb(), month);
    assert.equal(after.chat.paidRevenueKrw, 0, "refunded legacy charge must not be resurrected");
  });

  it("R9. refund removes only the refunded generation's model row", () => {
    const { userId, chatId } = createUserAndChat();
    const { month, at } = nextMonth();
    const slicesX = chargeTurn(userId, chatId, 0, { paid: 500, free: 0, reason: "r9 X" });
    const msgX = insertAssistantMessage({
      chatId,
      requestId: "req-X9",
      at,
      model: "model-X9",
      slices: slicesX,
    });
    insertNativeSettlement({ userId, chatId, requestId: "req-X9", messageId: msgX, slices: slicesX, at });

    const slicesY = chargeTurn(userId, chatId, 0, { paid: 600, free: 0, reason: "r9 Y" });
    const msgY = insertAssistantMessage({
      chatId,
      requestId: "req-Y9",
      at,
      model: "model-Y9",
      slices: slicesY,
    });
    insertNativeSettlement({ userId, chatId, requestId: "req-Y9", messageId: msgY, slices: slicesY, at });

    assert.deepEqual(modelRows(month), [
      { model: "model-X9", paid: 500, api: 0 },
      { model: "model-Y9", paid: 600, api: 0 },
    ]);

    refundMessageDeduction(userId, msgX, slicesX, 500, "r9 refund X");

    assert.deepEqual(modelRows(month), [{ model: "model-Y9", paid: 600, api: 0 }]);
  });

  it("R10. refunded request provider expense remains in aiCost", () => {
    const { userId, chatId } = createUserAndChat();
    const { month, at } = nextMonth();
    const slices = chargeTurn(userId, chatId, 0, { paid: 500, free: 0, reason: "r10 seed" });
    const messageId = insertAssistantMessage({
      chatId,
      requestId: "req-R10",
      at,
      model: "model-r10",
      slices,
    });
    insertNativeSettlement({ userId, chatId, requestId: "req-R10", messageId, slices, at });
    seedMainLedger({ chatId, messageId, requestId: "req-R10", at, krw: 100, model: "model-r10" });

    refundMessageDeduction(userId, messageId, slices, 500, "r10 refund");
    const after = buildAdminFinanceSummary(getDb(), month);
    assert.equal(after.aiCost.totalKrw, 100);
    assert.equal(after.chat.apiCostKrw, 100);
  });
});
