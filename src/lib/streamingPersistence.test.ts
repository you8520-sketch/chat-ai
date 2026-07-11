import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";

import {
  bootstrapStreamingTurn,
  createPartialSaveThrottler,
  finalizeAssistantMessage,
  findTurnByRequestId,
  markAssistantInterrupted,
  persistStreamCompleteContent,
  restoreAssistantFromAlternatesOnFailedRegen,
  recoverStaleInFlightAssistantMessages,
} from "@/lib/streamingPersistence";
import { resolveActiveVariantContent } from "@/lib/messageAlternates";

const REGENERATED_SAMPLE_PROSE =
  "문장 하나가 이어진다. 같은 문단의 다음 문장이다.\n\n" +
  "새 문단이 시작된다. 아직 같은 문단이다.\n\n" +
  "\"대사 한 줄.\"\n\n" +
  "그 뒤의 지문이 이어진다.";

function createMessagesDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      model TEXT NOT NULL DEFAULT '',
      request_id TEXT,
      generation_status TEXT NOT NULL DEFAULT 'completed',
      user_message_id INTEGER,
      alternates TEXT NOT NULL DEFAULT '[]',
      active_variant INTEGER NOT NULL DEFAULT 0,
      is_refunded INTEGER NOT NULL DEFAULT 0,
      deduction_slices TEXT,
      status TEXT NOT NULL DEFAULT 'ok',
      usage TEXT,
      status_meta TEXT,
      status_widget_values_json TEXT NOT NULL DEFAULT '',
      status_widget_turn_active INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

describe("streamingPersistence", () => {
  it("saves user message and assistant placeholder before model call", () => {
    const db = createMessagesDb();
    const boot = bootstrapStreamingTurn(db, {
      chatId: 1,
      requestId: "cr_test_bootstrap_1",
      userContent: "안녕",
      skipUserInsert: false,
    });

    assert.equal(boot.userMessageSaved, true);
    assert.equal(boot.assistantPlaceholderCreated, true);
    assert.ok(boot.userMessageId != null);
    assert.ok(boot.assistantMessageId > 0);

    const user = db
      .prepare(`SELECT role, content, generation_status, request_id FROM messages WHERE id=?`)
      .get(boot.userMessageId!) as {
      role: string;
      content: string;
      generation_status: string;
      request_id: string;
    };
    const asst = db
      .prepare(`SELECT role, content, generation_status, request_id, user_message_id FROM messages WHERE id=?`)
      .get(boot.assistantMessageId) as {
      role: string;
      content: string;
      generation_status: string;
      request_id: string;
      user_message_id: number;
    };

    assert.equal(user.role, "user");
    assert.equal(user.content, "안녕");
    assert.equal(user.generation_status, "submitted");
    assert.equal(user.request_id, "cr_test_bootstrap_1");
    assert.equal(asst.role, "assistant");
    assert.equal(asst.content, "");
    assert.equal(asst.generation_status, "generating");
    assert.equal(asst.user_message_id, boot.userMessageId);
  });

  it("does not duplicate user/assistant rows for the same request_id", () => {
    const db = createMessagesDb();
    const first = bootstrapStreamingTurn(db, {
      chatId: 1,
      requestId: "cr_dup_1",
      userContent: "첫 메시지",
      skipUserInsert: false,
    });
    const second = bootstrapStreamingTurn(db, {
      chatId: 1,
      requestId: "cr_dup_1",
      userContent: "첫 메시지",
      skipUserInsert: false,
    });

    assert.equal(second.reusedExisting, true);
    assert.equal(second.userMessageId, first.userMessageId);
    assert.equal(second.assistantMessageId, first.assistantMessageId);

    const count = db.prepare(`SELECT COUNT(*) AS c FROM messages WHERE request_id=?`).get("cr_dup_1") as {
      c: number;
    };
    assert.equal(count.c, 2);
  });

  it("persists partial chunks during streaming (throttled)", () => {
    const db = createMessagesDb();
    const boot = bootstrapStreamingTurn(db, {
      chatId: 1,
      requestId: "cr_partial_1",
      userContent: "유저",
      skipUserInsert: false,
    });
    const saver = createPartialSaveThrottler({ minMs: 60_000, minChars: 10 });

    // First write always lands (lastAt starts at 0)
    assert.equal(saver.maybeSave(db, boot.assistantMessageId, "short"), true);
    // Within time window and below char delta → skip
    assert.equal(saver.maybeSave(db, boot.assistantMessageId, "short+1"), false);
    // Char delta crosses threshold → save even inside time window
    assert.equal(saver.maybeSave(db, boot.assistantMessageId, "short+1234567890"), true);

    const row = db
      .prepare(`SELECT content, generation_status FROM messages WHERE id=?`)
      .get(boot.assistantMessageId) as { content: string; generation_status: string };
    assert.equal(row.content, "short+1234567890");
    assert.equal(row.generation_status, "generating");
  });

  it("load path can return generating assistant with partial content", () => {
    const db = createMessagesDb();
    const boot = bootstrapStreamingTurn(db, {
      chatId: 7,
      requestId: "cr_load_gen",
      userContent: "질문",
      skipUserInsert: false,
    });
    persistStreamCompleteContent(db, boot.assistantMessageId, "부분 응답…");

    const rows = db
      .prepare(
        `SELECT role, content, generation_status, request_id FROM messages WHERE chat_id=? ORDER BY id ASC`
      )
      .all(7) as { role: string; content: string; generation_status: string; request_id: string }[];

    assert.equal(rows.length, 2);
    assert.equal(rows[1].role, "assistant");
    assert.equal(rows[1].generation_status, "generating");
    assert.equal(rows[1].content, "부분 응답…");
    assert.equal(rows[1].request_id, "cr_load_gen");
  });

  it("interrupted stream preserves partial content", () => {
    const db = createMessagesDb();
    const boot = bootstrapStreamingTurn(db, {
      chatId: 1,
      requestId: "cr_interrupt_1",
      userContent: "유저",
      skipUserInsert: false,
    });
    markAssistantInterrupted(db, boot.assistantMessageId, "중간에 끊긴 문장");

    const row = db
      .prepare(`SELECT content, generation_status FROM messages WHERE id=?`)
      .get(boot.assistantMessageId) as { content: string; generation_status: string };
    assert.equal(row.content, "중간에 끊긴 문장");
    assert.equal(row.generation_status, "interrupted");
  });

  it("post-processing failure path keeps assistant content via stream-complete save", () => {
    const db = createMessagesDb();
    const boot = bootstrapStreamingTurn(db, {
      chatId: 1,
      requestId: "cr_pp_fail",
      userContent: "유저",
      skipUserInsert: false,
    });
    const saved = "완성된 본문입니다. 충분히 긴 텍스트.";
    persistStreamCompleteContent(db, boot.assistantMessageId, saved);

    // Simulate post-process error marker without erase
    db.prepare(
      `UPDATE messages SET generation_status='completed_with_postprocess_error', updated_at=datetime('now') WHERE id=?`
    ).run(boot.assistantMessageId);

    const row = db
      .prepare(`SELECT content, generation_status FROM messages WHERE id=?`)
      .get(boot.assistantMessageId) as { content: string; generation_status: string };
    assert.equal(row.content, saved);
    assert.equal(row.generation_status, "completed_with_postprocess_error");
  });

  it("finalization is idempotent and does not rewrite completed turns", () => {
    const db = createMessagesDb();
    const boot = bootstrapStreamingTurn(db, {
      chatId: 1,
      requestId: "cr_final_idem",
      userContent: "유저",
      skipUserInsert: false,
    });

    const first = finalizeAssistantMessage(db, {
      assistantMessageId: boot.assistantMessageId,
      chatId: 1,
      content: "최종 답변",
      model: "test-model",
      usageJson: JSON.stringify({ cost: 1 }),
      alternatesJson: "[]",
      activeVariant: 0,
      generationStatus: "completed",
    });
    assert.equal(first.wrote, true);

    const second = finalizeAssistantMessage(db, {
      assistantMessageId: boot.assistantMessageId,
      chatId: 1,
      content: "덮어쓰면 안 됨",
      model: "other",
      usageJson: JSON.stringify({ cost: 99 }),
      alternatesJson: "[]",
      activeVariant: 0,
      generationStatus: "completed",
    });
    assert.equal(second.wrote, false);

    const row = db
      .prepare(`SELECT content, model FROM messages WHERE id=?`)
      .get(boot.assistantMessageId) as { content: string; model: string };
    assert.equal(row.content, "최종 답변");
    assert.equal(row.model, "test-model");
  });

  it("duplicate request_id reports alreadyBilled when deduction_slices present", () => {
    const db = createMessagesDb();
    const boot = bootstrapStreamingTurn(db, {
      chatId: 1,
      requestId: "cr_bill_1",
      userContent: "유저",
      skipUserInsert: false,
    });
    finalizeAssistantMessage(db, {
      assistantMessageId: boot.assistantMessageId,
      chatId: 1,
      content: "완료",
      model: "m",
      usageJson: "{}",
      alternatesJson: "[]",
      activeVariant: 0,
    });
    db.prepare(`UPDATE messages SET deduction_slices=? WHERE id=?`).run(
      JSON.stringify([{ amount: 10 }]),
      boot.assistantMessageId
    );

    const found = findTurnByRequestId(db, 1, "cr_bill_1");
    assert.equal(found.alreadyBilled, true);
    assert.equal(found.assistantMessageId, boot.assistantMessageId);
  });

  it("regenerate bootstrap snapshots prior reply into alternates before clearing content", () => {
    const db = createMessagesDb();
    const boot = bootstrapStreamingTurn(db, {
      chatId: 1,
      requestId: "cr_regen_base",
      userContent: "유저",
      skipUserInsert: false,
    });
    finalizeAssistantMessage(db, {
      assistantMessageId: boot.assistantMessageId,
      chatId: 1,
      content: "이전 답변",
      model: "m1",
      usageJson: "{}",
      alternatesJson: JSON.stringify([
        { content: "이전 답변", model: "m1", usage: null, created_at: "" },
      ]),
      activeVariant: 0,
    });

    bootstrapStreamingTurn(db, {
      chatId: 1,
      requestId: "cr_regen_2",
      userContent: "유저",
      skipUserInsert: true,
      existingUserMessageId: boot.userMessageId,
      regenerateAssistantId: boot.assistantMessageId,
    });

    const row = db
      .prepare(`SELECT content, generation_status, alternates, active_variant FROM messages WHERE id=?`)
      .get(boot.assistantMessageId) as {
      content: string;
      generation_status: string;
      alternates: string;
      active_variant: number;
    };
    assert.equal(row.content, "");
    assert.equal(row.generation_status, "generating");
    const alts = JSON.parse(row.alternates) as { content: string }[];
    assert.equal(alts.length, 1);
    assert.equal(alts[0].content, "이전 답변");
  });

  it("finalizes regenerated assistant with canonical prose in DB and active variant", () => {
    const db = createMessagesDb();
    const boot = bootstrapStreamingTurn(db, {
      chatId: 1,
      requestId: "cr_regen_format_base",
      userContent: "다시 써줘.",
      skipUserInsert: false,
    });
    finalizeAssistantMessage(db, {
      assistantMessageId: boot.assistantMessageId,
      chatId: 1,
      content: "이전 응답.",
      model: "m1",
      usageJson: "{}",
      alternatesJson: JSON.stringify([
        { content: "이전 응답.", model: "m1", usage: null, created_at: "" },
      ]),
      activeVariant: 0,
    });

    bootstrapStreamingTurn(db, {
      chatId: 1,
      requestId: "cr_regen_format_2",
      userContent: "다시 써줘.",
      skipUserInsert: true,
      existingUserMessageId: boot.userMessageId,
      regenerateAssistantId: boot.assistantMessageId,
    });

    const alternatesJson = JSON.stringify([
      { content: "이전 응답.", model: "m1", usage: null, created_at: "" },
      { content: REGENERATED_SAMPLE_PROSE, model: "m2", usage: null, created_at: "" },
    ]);
    finalizeAssistantMessage(db, {
      assistantMessageId: boot.assistantMessageId,
      chatId: 1,
      content: REGENERATED_SAMPLE_PROSE,
      model: "m2",
      usageJson: "{}",
      alternatesJson,
      activeVariant: 1,
      statusWidgetValuesJson: JSON.stringify({ character: { 위치: "복도" } }),
      statusWidgetTurnActive: 1,
      generationStatus: "completed",
    });

    const row = db
      .prepare(
        `SELECT content, alternates, active_variant, status_widget_values_json
         FROM messages WHERE id=?`
      )
      .get(boot.assistantMessageId) as {
      content: string;
      alternates: string;
      active_variant: number;
      status_widget_values_json: string;
    };
    const variants = JSON.parse(row.alternates) as Array<{
      content: string;
      model: string;
      usage: null;
      created_at: string;
    }>;

    assert.equal(row.content, REGENERATED_SAMPLE_PROSE);
    assert.equal(variants[1]?.content, REGENERATED_SAMPLE_PROSE);
    assert.equal(
      resolveActiveVariantContent({
        content: row.content,
        variants,
        activeVariant: row.active_variant,
      }),
      REGENERATED_SAMPLE_PROSE
    );
    assert.equal(row.status_widget_values_json.includes("복도"), true);
  });

  it("restoreAssistantFromAlternatesOnFailedRegen restores prior reply", () => {
    const db = createMessagesDb();
    const boot = bootstrapStreamingTurn(db, {
      chatId: 1,
      requestId: "cr_regen_fail_base",
      userContent: "유저",
      skipUserInsert: false,
    });
    finalizeAssistantMessage(db, {
      assistantMessageId: boot.assistantMessageId,
      chatId: 1,
      content: "이전 답변",
      model: "m1",
      usageJson: "{}",
      alternatesJson: JSON.stringify([
        { content: "이전 답변", model: "m1", usage: null, created_at: "" },
      ]),
      activeVariant: 0,
    });
    bootstrapStreamingTurn(db, {
      chatId: 1,
      requestId: "cr_regen_fail_2",
      userContent: "유저",
      skipUserInsert: true,
      existingUserMessageId: boot.userMessageId,
      regenerateAssistantId: boot.assistantMessageId,
    });
    markAssistantInterrupted(db, boot.assistantMessageId, "");
    const restored = restoreAssistantFromAlternatesOnFailedRegen(
      db,
      boot.assistantMessageId,
      1
    );
    assert.equal(restored, true);
    const row = db
      .prepare(`SELECT content, generation_status FROM messages WHERE id=?`)
      .get(boot.assistantMessageId) as { content: string; generation_status: string };
    assert.equal(row.content, "이전 답변");
    assert.equal(row.generation_status, "completed");
  });

  it("recoverStaleInFlightAssistantMessages restores stuck regen bootstrap rows", () => {
    const db = createMessagesDb();
    const boot = bootstrapStreamingTurn(db, {
      chatId: 1,
      requestId: "cr_stale_base",
      userContent: "유저",
      skipUserInsert: false,
    });
    finalizeAssistantMessage(db, {
      assistantMessageId: boot.assistantMessageId,
      chatId: 1,
      content: "이전 답변",
      model: "m1",
      usageJson: "{}",
      alternatesJson: JSON.stringify([
        { content: "이전 답변", model: "m1", usage: null, created_at: "" },
      ]),
      activeVariant: 0,
    });
    bootstrapStreamingTurn(db, {
      chatId: 1,
      requestId: "cr_stale_regen",
      userContent: "유저",
      skipUserInsert: true,
      existingUserMessageId: boot.userMessageId,
      regenerateAssistantId: boot.assistantMessageId,
    });
    const rows = db
      .prepare(
        `SELECT id, role, content, generation_status FROM messages WHERE chat_id=? ORDER BY id ASC`
      )
      .all(1) as Array<{
      id: number;
      role: string;
      content: string;
      generation_status: string | null;
    }>;
    const recovered = recoverStaleInFlightAssistantMessages(db, 1, rows);
    assert.equal(recovered, 1);
    const row = db
      .prepare(`SELECT content, generation_status FROM messages WHERE id=?`)
      .get(boot.assistantMessageId) as { content: string; generation_status: string };
    assert.equal(row.content, "이전 답변");
    assert.equal(row.generation_status, "completed");
  });
});
