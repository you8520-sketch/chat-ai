import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { getDb } from "@/lib/db";
import { installIsolatedTestDatabase } from "@/lib/test/isolatedTestDatabase";
import { creditPoints, deductPoints } from "@/lib/points";
import { getReportRefundForAdmin, processReportRefund } from "@/lib/refund";
import { AUTO_REFUND_MIN_VISIBLE_CHARS } from "@/lib/reportRefundPolicy";

let characterId = 0;

before(() => {
  installIsolatedTestDatabase();
  characterId = Number(
    getDb().prepare("INSERT INTO characters (name) VALUES ('admin-cat-parity')").run()
      .lastInsertRowid
  );
});

describe("admin report refund category parity", () => {
  it("live validation uses stored category validator, not legacy generic error path", () => {
    const db = getDb();
    const tag = `admin_${Date.now()}`;
    const userId = Number(
      db
        .prepare("INSERT INTO users (email, nickname, pw_hash, points) VALUES (?,?,?,0)")
        .run(`${tag}@t.local`, tag, "x").lastInsertRowid
    );
    const chatId = Number(
      db.prepare("INSERT INTO chats (user_id, character_id) VALUES (?,?)").run(userId, characterId)
        .lastInsertRowid
    );
    creditPoints(userId, 200, "PAID", "seed");
    const content = "정상 RP 본문입니다. ".repeat(120);
    const messageId = Number(
      db
        .prepare(
          `INSERT INTO messages (chat_id, role, content, model, status, generation_status)
           VALUES (?, 'assistant', ?, 'test-model', 'error', 'completed')`
        )
        .run(chatId, content).lastInsertRowid
    );
    const deducted = deductPoints(userId, 10, "charge", { messageId, chatId });
    db.prepare("UPDATE messages SET usage = ?, deduction_slices = ? WHERE id = ?").run(
      JSON.stringify({
        input: 1,
        output: 1,
        model: "test-model",
        route: "safe",
        cost: 10,
        breakdown: [],
      }),
      JSON.stringify(deducted.slices),
      messageId
    );

    const result = processReportRefund(userId, messageId, chatId, "similar_content");
    assert.equal(result.status, "pending");

    const reportId = (
      db.prepare("SELECT id FROM report_refunds WHERE message_id = ?").get(messageId) as {
        id: number;
      }
    ).id;
    const detail = getReportRefundForAdmin(reportId);
    assert.ok(detail);
    assert.equal(detail.report_category, "similar_content");
    assert.equal(detail.live_validation_pass, false);
    assert.equal(detail.live_validation_reasons.length, 0);
    assert.match(detail.live_validation_summary, /유사한 내용 출력/);
    assert.ok(content.length >= AUTO_REFUND_MIN_VISIBLE_CHARS);
  });
});
