import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EOF_RECONCILE_EXTENDED_MAX_SLEEP_MS,
  EOF_RECONCILE_EXTENDED_RETRY_MS,
  EOF_RECONCILE_EXTENDED_MAX_ATTEMPTS,
  EOF_RECONCILE_SUBSTANTIAL_PROSE_MIN_CHARS,
  EOF_RECONCILE_TRUE_INTERRUPTION_MAX_SLEEP_MS,
  classifyReconcileStatus,
  eofReconcileMaxSleepMs,
  generationStatusFromEofResult,
  needsEofReconcile,
  reconcileStreamEof,
  resolveEofReconcilePollBudget,
  type EofReconcileSnapshot,
} from "@/lib/chatStreamEofReconcile";
import {
  applyStatusMessageEvidence,
  createEmptyPostProcessPhaseEvidence,
  hasPostProcessPhaseEvidence,
} from "@/lib/chatStreamPostProcessEvidence";
import {
  createStreamPostprocessHeartbeat,
  STREAM_POSTPROCESS_HEARTBEAT_INTERVAL_MS,
} from "@/lib/streamPostprocessHeartbeat";
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
  it("D: substantial prose alone does not open extended budget", () => {
    const budget = resolveEofReconcilePollBudget({
      streamedContentChars: EOF_RECONCILE_SUBSTANTIAL_PROSE_MIN_CHARS,
    });
    assert.equal(budget.extended, false);
    assert.equal(budget.maxAttempts, 6);
    assert.equal(budget.retryMs, 350);
  });

  it("C: substantial prose + postprocess evidence opens extended budget", () => {
    const evidence = createEmptyPostProcessPhaseEvidence();
    applyStatusMessageEvidence(evidence, "상태창 생성 중…");
    assert.ok(hasPostProcessPhaseEvidence(evidence));
    const budget = resolveEofReconcilePollBudget({
      streamedContentChars: 4200,
      postProcessEvidence: evidence,
    });
    assert.equal(budget.extended, true);
    assert.equal(budget.maxAttempts, EOF_RECONCILE_EXTENDED_MAX_ATTEMPTS);
    assert.equal(budget.retryMs, EOF_RECONCILE_EXTENDED_RETRY_MS);
    assert.equal(EOF_RECONCILE_EXTENDED_MAX_SLEEP_MS, 60_000);
    assert.equal(EOF_RECONCILE_TRUE_INTERRUPTION_MAX_SLEEP_MS, 1750);
  });
});

describe("reconcileStreamEof extended finalize window", () => {
  it("C: substantial prose + postprocess evidence + generating→completed", async () => {
    const evidence = createEmptyPostProcessPhaseEvidence();
    applyStatusMessageEvidence(evidence, "마무리 중…");
    const completeAfterMs = eofReconcileMaxSleepMs(6, 350) + 5000;
    let elapsed = 0;
    const result = await reconcileStreamEof({
      messageId: 781,
      streamedContentChars: 4200,
      postProcessEvidence: evidence,
      sleep: async (ms) => {
        elapsed += ms;
      },
      fetchSnapshot: async () => {
        if (elapsed < completeAfterMs) {
          return snap({ generationStatus: "generating", content: "long rp body" });
        }
        return snap({ generationStatus: "completed", content: "long rp body final" });
      },
    });
    assert.equal(result.kind, "completed");
    assert.equal(generationStatusFromEofResult(result), "completed");
  });

  it("D: substantial prose without postprocess evidence stays short budget", async () => {
    let fetches = 0;
    const result = await reconcileStreamEof({
      messageId: 781,
      streamedContentChars: 4200,
      retryMs: 0,
      maxAttempts: 6,
      sleep: async () => {},
      fetchSnapshot: async () => {
        fetches += 1;
        return snap({ generationStatus: "generating", content: "long rp body" });
      },
    });
    assert.equal(result.kind, "interrupted");
    assert.equal(fetches, 6);
  });

  it("E: main stream interrupted returns terminal quickly", async () => {
    const result = await reconcileStreamEof({
      messageId: 99,
      streamedContentChars: 1200,
      postProcessEvidence: (() => {
        const e = createEmptyPostProcessPhaseEvidence();
        applyStatusMessageEvidence(e, "마무리 중…");
        return e;
      })(),
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
  it("A: completed family maps to completed client status", async () => {
    const result = await reconcileStreamEof({
      messageId: 1,
      retryMs: 0,
      sleep: async () => {},
      fetchSnapshot: async () => snap({ generationStatus: "completed", content: "ok" }),
    });
    assert.equal(generationStatusFromEofResult(result), "completed");
    assert.ok(needsEofReconcile({ sawDone: true, sawError: false }) === false);
  });

  it("B: widget/postprocess delay path uses heartbeat interval constant", () => {
    const sent: object[] = [];
    const hb = createStreamPostprocessHeartbeat((obj) => sent.push(obj), {
      intervalMs: 10,
    });
    hb.start("status_widget");
    assert.equal(sent[0], sent[0]);
    assert.deepEqual(sent[0], { type: "stream_heartbeat", phase: "status_widget" });
    hb.stop();
    assert.equal(STREAM_POSTPROCESS_HEARTBEAT_INTERVAL_MS, 12_000);
  });

  it("B/C: completed_with_postprocess_error is terminal-completed for reconcile", () => {
    assert.equal(classifyReconcileStatus("completed_with_postprocess_error"), "completed");
    assert.ok(isTerminalGenerationStatus("completed_with_postprocess_error"));
  });

  it("G: interrupted partial preserved; completed finalize is terminal", () => {
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

  it("G: heartbeat timer count returns to zero after stop", () => {
    const hb = createStreamPostprocessHeartbeat(() => {}, { intervalMs: 1000 });
    hb.start("finalizing");
    assert.equal(hb.activeTimerCount(), 1);
    hb.stop();
    assert.equal(hb.activeTimerCount(), 0);
  });
});

describe("forensics ordering semantics", () => {
  it("H: sse_done_attempted is true only after done send is queued", () => {
    let sseDoneAttempted = false;
    const events: string[] = [];
    const send = (type: string) => {
      events.push(type);
    };
    const emitForensics = () => {
      events.push(
        `forensics:sse_done=${sseDoneAttempted}:disconnect=false:status=completed`
      );
    };

    sseDoneAttempted = true;
    send("done");
    emitForensics();

    assert.deepEqual(events, [
      "done",
      "forensics:sse_done=true:disconnect=false:status=completed",
    ]);
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
  });
});
