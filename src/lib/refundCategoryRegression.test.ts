import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { getDb } from "@/lib/db";
import { installIsolatedTestDatabase } from "@/lib/test/isolatedTestDatabase";
import { creditPoints, deductPoints, type DeductionSlice } from "@/lib/points";
import { processReportRefund } from "@/lib/refund";
import { assessCategoryForAutoRefund } from "@/lib/refundCategoryValidation";
import { AUTO_REFUND_DAILY_LIMIT, AUTO_REFUND_MIN_VISIBLE_CHARS } from "@/lib/reportRefundPolicy";
import { ensureChatBillingSettlementSchema } from "@/lib/chatBillingSettlementSchema";
import type { Usage } from "@/lib/chatUsage";

let characterId = 0;

before(() => {
  installIsolatedTestDatabase();
  const db = getDb();
  ensureChatBillingSettlementSchema(db);
  characterId = Number(
    db.prepare("INSERT INTO characters (name) VALUES ('refund-cat-test')").run().lastInsertRowid
  );
});

function createUser(): number {
  const db = getDb();
  const tag = `rc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  return Number(
    db
      .prepare("INSERT INTO users (email, nickname, pw_hash, points) VALUES (?,?,?,0)")
      .run(`${tag}@t.local`, tag, "x").lastInsertRowid
  );
}

function createChat(userId: number): number {
  return Number(
    getDb()
      .prepare("INSERT INTO chats (user_id, character_id) VALUES (?,?)")
      .run(userId, characterId).lastInsertRowid
  );
}

function chargeAndInsertAssistant(opts: {
  userId: number;
  chatId: number;
  content: string;
  cost: number;
  usage?: Partial<Usage>;
  generationStatus?: string;
  finishReason?: string;
}): { messageId: number; slices: DeductionSlice[] } {
  creditPoints(opts.userId, opts.cost + 100, "PAID", "test credit");
  const messageId = Number(
    getDb()
      .prepare(
        `INSERT INTO messages (chat_id, role, content, model, generation_status)
         VALUES (?, 'assistant', ?, 'test-model', ?)`
      )
      .run(opts.chatId, opts.content, opts.generationStatus ?? "completed").lastInsertRowid
  );
  const deducted = deductPoints(opts.userId, opts.cost, "test charge", {
    messageId,
    chatId: opts.chatId,
  });
  const usage: Usage = {
    input: 100,
    output: 200,
    model: "test-model",
    route: "safe",
    cost: opts.cost,
    savedOutputChars: 800,
    finishReason: opts.finishReason,
    breakdown: [],
    ...opts.usage,
  };
  getDb()
    .prepare("UPDATE messages SET usage = ?, deduction_slices = ? WHERE id = ?")
    .run(JSON.stringify(usage), JSON.stringify(deducted.slices), messageId);
  return { messageId, slices: deducted.slices };
}

function longContent(): string {
  return "정상 RP 본문입니다. ".repeat(120);
}

describe("refund category regression", () => {
  it("A: first 3 verified defects auto refund", () => {
    const userId = createUser();
    const chatId = createChat(userId);
    for (let i = 0; i < 3; i++) {
      const { messageId } = chargeAndInsertAssistant({
        userId,
        chatId,
        content: "짧음",
        cost: 10,
      });
      const result = processReportRefund(userId, messageId, chatId, "under_length");
      assert.equal(result.status, "approved");
    }
  });

  it("B: 4th verified defect pending", () => {
    const userId = createUser();
    const chatId = createChat(userId);
    for (let i = 0; i < AUTO_REFUND_DAILY_LIMIT; i++) {
      const { messageId } = chargeAndInsertAssistant({
        userId,
        chatId,
        content: "짧음",
        cost: 10,
      });
      processReportRefund(userId, messageId, chatId, "under_length");
    }
    const { messageId: fourthId } = chargeAndInsertAssistant({
      userId,
      chatId,
      content: "짧음",
      cost: 10,
    });
    const result = processReportRefund(userId, fourthId, chatId, "under_length");
    assert.equal(result.status, "pending");
    if (result.status === "pending") {
      assert.equal(result.dailyLimitExceeded, true);
    }
  });

  it("E: other category pending from first report", () => {
    const userId = createUser();
    const chatId = createChat(userId);
    const { messageId } = chargeAndInsertAssistant({
      userId,
      chatId,
      content: longContent(),
      cost: 10,
    });
    const result = processReportRefund(userId, messageId, chatId, "other");
    assert.equal(result.status, "pending");
  });

  it("F: false user-selected category does not auto refund", () => {
    const userId = createUser();
    const chatId = createChat(userId);
    const { messageId } = chargeAndInsertAssistant({
      userId,
      chatId,
      content: longContent(),
      cost: 10,
    });
    const result = processReportRefund(userId, messageId, chatId, "under_length");
    assert.equal(result.status, "pending");
  });

  it("G: widget OFF → no widget refund", () => {
    const assessment = assessCategoryForAutoRefund({
      category: "status_widget_error",
      content: longContent(),
      usage: { input: 1, output: 1, model: "m", route: "safe", cost: 1, breakdown: [] },
    });
    assert.equal(assessment.isError, false);
  });

  it("I/J incomplete evidence: interrupted vs completed", () => {
    const incomplete = assessCategoryForAutoRefund({
      category: "incomplete_output",
      content: longContent(),
      generationStatus: "interrupted",
    });
    assert.equal(incomplete.isError, true);
    const complete = assessCategoryForAutoRefund({
      category: "incomplete_output",
      content: longContent(),
      generationStatus: "completed",
      finishReason: "stop",
    });
    assert.equal(complete.isError, false);
  });

  it("N: zero-charge turn rejected", () => {
    const userId = createUser();
    const chatId = createChat(userId);
    const messageId = Number(
      getDb()
        .prepare(
          `INSERT INTO messages (chat_id, role, content, model, usage, deduction_slices)
           VALUES (?, 'assistant', '짧음', 'test-model', ?, '[]')`
        )
        .run(
          chatId,
          JSON.stringify({
            input: 1,
            output: 1,
            model: "test-model",
            route: "safe",
            cost: 0,
            breakdown: [],
          })
        ).lastInsertRowid
    );
    const result = processReportRefund(userId, messageId, chatId, "under_length");
    assert.equal(result.status, "rejected");
  });

  it("under_length category uses visible char threshold", () => {
    const short = "x".repeat(AUTO_REFUND_MIN_VISIBLE_CHARS - 10);
    const assessment = assessCategoryForAutoRefund({
      category: "under_length",
      content: short,
    });
    assert.equal(assessment.isError, true);
  });
});
