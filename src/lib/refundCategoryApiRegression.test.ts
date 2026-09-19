import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { getDb } from "@/lib/db";
import { installIsolatedTestDatabase } from "@/lib/test/isolatedTestDatabase";
import { creditPoints, deductPoints } from "@/lib/points";
import { processReportRefund } from "@/lib/refund";
import { assessCategoryForAutoRefund } from "@/lib/refundCategoryValidation";
import { detectDuplicateBillingEvidence } from "@/lib/duplicateChargeEvidence";
import { ensureChatBillingSettlementSchema } from "@/lib/chatBillingSettlementSchema";
import { CHAT_TURN_CHARGE_KIND } from "@/lib/chatBillingSettlementSchema";
import type { Usage } from "@/lib/chatUsage";

let characterId = 0;

before(() => {
  installIsolatedTestDatabase();
  const db = getDb();
  ensureChatBillingSettlementSchema(db);
  characterId = Number(
    db.prepare("INSERT INTO characters (name) VALUES ('refund-api-cat')").run().lastInsertRowid
  );
});

function createUser(): number {
  const tag = `ra_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  return Number(
    getDb()
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

describe("report category API regression", () => {
  it("missing category is rejected by processReportRefund type contract", () => {
    const userId = createUser();
    const chatId = createChat(userId);
    creditPoints(userId, 200, "PAID", "seed");
    const messageId = Number(
      getDb()
        .prepare(
          `INSERT INTO messages (chat_id, role, content, model, usage, deduction_slices)
           VALUES (?, 'assistant', '짧음', 'm', ?, '[]')`
        )
        .run(
          chatId,
          JSON.stringify({
            input: 1,
            output: 1,
            model: "m",
            route: "safe",
            cost: 10,
            breakdown: [],
          } satisfies Usage)
        ).lastInsertRowid
    );
    const rejected = processReportRefund(
      userId,
      messageId,
      chatId,
      null as unknown as "under_length"
    );
    assert.equal(rejected.status, "rejected");
    assert.match(rejected.message, /유효한 신고 유형/);
  });

  it("legitimate different-request assistant siblings are not auto duplicate", () => {
    const userId = createUser();
    const chatId = createChat(userId);
    const userMsgId = Number(
      getDb()
        .prepare("INSERT INTO messages (chat_id, role, content) VALUES (?, 'user', 'hello')")
        .run(chatId).lastInsertRowid
    );
    void userMsgId;

    const firstId = Number(
      getDb()
        .prepare(
          `INSERT INTO messages (chat_id, role, content, request_id, usage)
           VALUES (?, 'assistant', 'a1', 'req-a', ?)`
        )
        .run(
          chatId,
          JSON.stringify({ cost: 20, input: 1, output: 1, model: "m", route: "safe", breakdown: [] })
        ).lastInsertRowid
    );
    const secondId = Number(
      getDb()
        .prepare(
          `INSERT INTO messages (chat_id, role, content, request_id, usage)
           VALUES (?, 'assistant', 'a2', 'req-b', ?)`
        )
        .run(
          chatId,
          JSON.stringify({ cost: 15, input: 1, output: 1, model: "m", route: "safe", breakdown: [] })
        ).lastInsertRowid
    );

    const dupFirst = detectDuplicateBillingEvidence({ userId, chatId, messageId: firstId });
    const dupSecond = detectDuplicateBillingEvidence({ userId, chatId, messageId: secondId });
    assert.equal(dupFirst.isDuplicate, false);
    assert.equal(dupSecond.isDuplicate, false);

    const assessment = assessCategoryForAutoRefund({
      category: "duplicate_billing",
      content: "a2",
      messageId: secondId,
      chatId,
      userId,
    });
    assert.equal(assessment.isError, false);
  });

  it("proven duplicate same request identity reverses duplicate charge only", () => {
    const userId = createUser();
    const chatId = createChat(userId);
    getDb()
      .prepare("INSERT INTO messages (chat_id, role, content) VALUES (?, 'user', 'hello')")
      .run(chatId);

    const usagePrimary = JSON.stringify({
      cost: 30,
      input: 1,
      output: 1,
      model: "m",
      route: "safe",
      breakdown: [],
    });
    const usageDuplicate = JSON.stringify({
      cost: 12,
      input: 1,
      output: 1,
      model: "m",
      route: "safe",
      breakdown: [],
    });

    const primaryId = Number(
      getDb()
        .prepare(
          `INSERT INTO messages (chat_id, role, content, request_id, usage)
           VALUES (?, 'assistant', 'primary', 'req-dup', ?)`
        )
        .run(chatId, usagePrimary).lastInsertRowid
    );
    const duplicateId = Number(
      getDb()
        .prepare(
          `INSERT INTO messages (chat_id, role, content, request_id, usage)
           VALUES (?, 'assistant', 'duplicate', 'req-dup', ?)`
        )
        .run(chatId, usageDuplicate).lastInsertRowid
    );

    getDb()
      .prepare(
        `INSERT INTO chat_billing_settlements
           (user_id, chat_id, request_id, charge_kind, assistant_message_id, requested_points, settled_points, outcome)
         VALUES (?, ?, 'req-dup', ?, ?, 30, 30, 'charged')`
      )
      .run(userId, chatId, CHAT_TURN_CHARGE_KIND, primaryId);

    const evidence = detectDuplicateBillingEvidence({
      userId,
      chatId,
      messageId: duplicateId,
    });
    assert.equal(evidence.isDuplicate, true);
    assert.equal(evidence.duplicateChargePoints, 12);
    assert.equal(evidence.primaryChargePoints, 30);

    const assessment = assessCategoryForAutoRefund({
      category: "duplicate_billing",
      content: "duplicate",
      messageId: duplicateId,
      chatId,
      userId,
    });
    assert.equal(assessment.isError, true);
    assert.equal(assessment.partialRefundAmount, 12);
  });
});
