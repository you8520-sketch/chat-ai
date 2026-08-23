import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EOF_RECONCILE_EXTENDED_MAX_ATTEMPTS,
  EOF_RECONCILE_EXTENDED_RETRY_MS,
  EOF_RECONCILE_SUBSTANTIAL_PROSE_MIN_CHARS,
  classifyReconcileStatus,
  eofReconcileMaxSleepMs,
  generationStatusFromEofResult,
  needsEofReconcile,
  reconcileStreamEof,
  resolveEofReconcilePollBudget,
  type EofReconcileSnapshot,
} from "@/lib/chatStreamEofReconcile";
import {
  finalizeAssistantMessageCore,
  isTerminalGenerationStatus,
  markAssistantInterrupted,
} from "@/lib/streamingPersistence";
import Database from "better-sqlite3";

function snap(overrides: Partial<EofReconcileSnapshot> = {}): EofReconcileSnapshot {
  return {
    messageId: 781,
    chatId: 39,
    generationStatus: "generating",
    content: "partial prose",
    usage: null,
    ...overrides,
  };
}

function openMessagesDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY,
      chat_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      usage TEXT,
      alternates TEXT,
      active_variant INTEGER,
      status_widget_values_json TEXT,
      status_widget_turn_active INTEGER DEFAULT 0,
      generation_status TEXT,
      status TEXT,
      deduction_slices TEXT,
      is_refunded INTEGER DEFAULT 0,
      status_meta TEXT,
      updated_at TEXT
    );
  `);
  return db;
}

describe("resolveEofReconcilePollBudget", () => {
  it("uses short budget for empty/minimal streamed prose", () => {
    const budget = resolveEofReconcilePollBudget({ streamedContentChars: 50 });
    assert.equal(budget.maxAttempts, 6);
    assert.equal(budget.retryMs, 350);
  });

  it("uses extended budget when substantial RP prose was already streamed", () => {
    const budget = resolveEofReconcilePollBudget({
      streamedContentChars: EOF_RECONCILE_SUBSTANTIAL_PROSE_MIN_CHARS,
    });
    assert.equal(budget.maxAttempts, EOF_RECONCILE_EXTENDED_MAX_ATTEMPTS);
    assert.equal(budget.retryMs, EOF_RECONCILE_EXTENDED_RETRY_MS);
    assert.equal(
      eofReconcileMaxSleepMs(budget.maxAttempts, budget.retryMs),
      (EOF_RECONCILE_EXTENDED_MAX_ATTEMPTS - 1) * EOF_RECONCILE_EXTENDED_RETRY_MS
    );
  });
});

describe("reconcileStreamEof extended finalize window", () => {
  it("Test D: substantial prose + generating then completed within extended budget", async () => {
    const completeAfterMs =
      eofReconcileMaxSleepMs(6, 350) + 5000; // well beyond short budget
    let elapsed = 0;
    let fetches = 0;
    const result = await reconcileStreamEof({
      messageId: 781,
      streamedContentChars: 4200,
      sleep: async (ms) => {
        elapsed += ms;
      },
      fetchSnapshot: async () => {
        fetches += 1;
        if (elapsed < completeAfterMs) {
          return snap({ generationStatus: "generating", content: "long rp body" });
        }
        return snap({ generationStatus: "completed", content: "long rp body final" });
      },
    });
    assert.equal(result.kind, "completed");
    if (result.kind === "completed") {
      assert.equal(result.snapshot.content, "long rp body final");
      assert.equal(generationStatusFromEofResult(result), "completed");
    }
    assert.ok(elapsed >= completeAfterMs);
    assert.ok(fetches >= 3);
  });

  it("Test F: DB completed after EOF — reconcile recovers terminal snapshot", async () => {
    const result = await reconcileStreamEof({
      messageId: 3750,
      streamedContentChars: 5400,
      retryMs: 0,
      maxAttempts: 2,
      sleep: async () => {},
      fetchSnapshot: async () =>
        snap({ generationStatus: "completed", content: "final prose preserved" }),
    });
    assert.equal(result.kind, "completed");
    assert.equal(generationStatusFromEofResult(result), "completed");
    assert.equal(needsEofReconcile({ sawDone: false, sawError: false }), true);
  });

  it("Test E: main stream interrupted stays failed_like terminal", async () => {
    const result = await reconcileStreamEof({
      messageId: 99,
      streamedContentChars: 1200,
      retryMs: 0,
      maxAttempts: 2,
      sleep: async () => {},
      fetchSnapshot: async () =>
        snap({ generationStatus: "interrupted", content: "partial only" }),
    });
    assert.equal(result.kind, "terminal");
    if (result.kind === "terminal") {
      assert.equal(result.status, "interrupted");
    }
  });
});

describe("post-process terminalization invariants", () => {
  it("Test B/C: widget empty or malformed must not block completed terminal status", () => {
    assert.equal(classifyReconcileStatus("completed"), "completed");
    assert.equal(classifyReconcileStatus("completed_with_postprocess_error"), "completed");
    assert.ok(isTerminalGenerationStatus("completed_with_postprocess_error"));
  });

  it("Test A: completed family maps to completed client status", async () => {
    const result = await reconcileStreamEof({
      messageId: 1,
      retryMs: 0,
      sleep: async () => {},
      fetchSnapshot: async () => snap({ generationStatus: "completed", content: "ok" }),
    });
    assert.equal(generationStatusFromEofResult(result), "completed");
  });

  it("Test G: interrupted partial with content remains retryable, completed does not", () => {
    const db = openMessagesDb();
    db.prepare(
      `INSERT INTO messages (id, chat_id, role, content, model, generation_status)
       VALUES (1, 707, 'assistant', 'partial rp', 'claude', 'generating')`
    ).run();
    markAssistantInterrupted(db, 1, "partial rp");
    const row = db
      .prepare("SELECT generation_status, content FROM messages WHERE id=1")
      .get() as { generation_status: string; content: string };
    assert.equal(row.generation_status, "interrupted");
    assert.ok(row.content.includes("partial rp"));

    finalizeAssistantMessageCore(db, {
      chatId: 707,
      assistantMessageId: 1,
      content: "partial rp",
      model: "claude",
      usageJson: null,
      alternatesJson: "[]",
      activeVariant: 0,
      generationStatus: "completed",
    });
    const done = db
      .prepare("SELECT generation_status FROM messages WHERE id=1")
      .get() as { generation_status: string };
    assert.equal(done.generation_status, "completed");
    db.close();
  });
});

describe("reconcileStreamEof short budget unchanged for tiny streams", () => {
  it("still interrupts when DB stays generating under short budget", async () => {
    const result = await reconcileStreamEof({
      messageId: 781,
      streamedContentChars: 0,
      retryMs: 0,
      maxAttempts: 3,
      sleep: async () => {},
      fetchSnapshot: async () => snap({ generationStatus: "generating" }),
    });
    assert.equal(result.kind, "interrupted");
    if (result.kind === "interrupted") {
      assert.equal(result.reason, "still_generating");
    }
  });
});
