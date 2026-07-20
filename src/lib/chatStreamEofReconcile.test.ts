import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EOF_RECONCILE_MAX_ATTEMPTS,
  EOF_RECONCILE_RETRY_MS,
  classifyReconcileStatus,
  eofReconcileMaxSleepMs,
  generationStatusFromEofResult,
  needsEofReconcile,
  reconcileStreamEof,
  type EofReconcileSnapshot,
} from "@/lib/chatStreamEofReconcile";

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

describe("EOF reconcile timing budget", () => {
  it("documents attempts, interval, and max sleep", () => {
    assert.equal(EOF_RECONCILE_MAX_ATTEMPTS, 6);
    assert.equal(EOF_RECONCILE_RETRY_MS, 350);
    assert.equal(eofReconcileMaxSleepMs(), 1750);
    // Prior budget (4 attempts) was 3×350 = 1050ms — too tight for late widget finalize.
    assert.equal(eofReconcileMaxSleepMs(4, 350), 1050);
  });
});

describe("needsEofReconcile", () => {
  it("A-guard: skips when done was seen", () => {
    assert.equal(needsEofReconcile({ sawDone: true, sawError: false }), false);
  });

  it("skips when error was seen", () => {
    assert.equal(needsEofReconcile({ sawDone: false, sawError: true }), false);
  });

  it("runs only when neither terminal event arrived", () => {
    assert.equal(needsEofReconcile({ sawDone: false, sawError: false }), true);
  });
});

describe("classifyReconcileStatus", () => {
  it("classifies completed family", () => {
    assert.equal(classifyReconcileStatus("completed"), "completed");
    assert.equal(classifyReconcileStatus("ok"), "completed");
    assert.equal(classifyReconcileStatus("completed_with_postprocess_error"), "completed");
  });

  it("classifies failed-like and in-flight", () => {
    assert.equal(classifyReconcileStatus("failed"), "failed_like");
    assert.equal(classifyReconcileStatus("interrupted"), "failed_like");
    assert.equal(classifyReconcileStatus("generating"), "in_flight");
    assert.equal(classifyReconcileStatus("submitted"), "in_flight");
  });
});

describe("reconcileStreamEof", () => {
  it("A: not invoked when needsEofReconcile is false (done path)", () => {
    assert.equal(needsEofReconcile({ sawDone: true, sawError: false }), false);
  });

  it("B: DB completed after EOF → completed UI snapshot", async () => {
    let fetches = 0;
    const result = await reconcileStreamEof({
      messageId: 781,
      retryMs: 0,
      maxAttempts: 3,
      sleep: async () => {},
      fetchSnapshot: async () => {
        fetches += 1;
        return snap({ generationStatus: "completed", content: "final prose" });
      },
    });
    assert.equal(result.kind, "completed");
    if (result.kind === "completed") {
      assert.equal(result.snapshot.content, "final prose");
      assert.equal(generationStatusFromEofResult(result), "completed");
    }
    assert.equal(fetches, 1);
  });

  it("C: DB stays generating → interrupted after limited retries", async () => {
    let fetches = 0;
    const result = await reconcileStreamEof({
      messageId: 781,
      retryMs: 0,
      maxAttempts: 3,
      sleep: async () => {},
      fetchSnapshot: async () => {
        fetches += 1;
        return snap({ generationStatus: "generating" });
      },
    });
    assert.equal(result.kind, "interrupted");
    if (result.kind === "interrupted") {
      assert.equal(result.reason, "still_generating");
    }
    assert.equal(generationStatusFromEofResult(result), "interrupted");
    assert.equal(fetches, 3);
  });

  it("D-guard: error terminal flag skips reconcile", () => {
    assert.equal(needsEofReconcile({ sawDone: false, sawError: true }), false);
  });

  it("E: failed/interrupted server status maps to terminal", async () => {
    const result = await reconcileStreamEof({
      messageId: 99,
      retryMs: 0,
      maxAttempts: 2,
      sleep: async () => {},
      fetchSnapshot: async () => snap({ generationStatus: "failed", content: "x" }),
    });
    assert.equal(result.kind, "terminal");
    if (result.kind === "terminal") {
      assert.equal(result.status, "failed");
      assert.equal(generationStatusFromEofResult(result), "failed");
    }
  });

  it("F: generating then completed (status-widget finalizing window)", async () => {
    let fetches = 0;
    const result = await reconcileStreamEof({
      messageId: 781,
      retryMs: 0,
      maxAttempts: 4,
      sleep: async () => {},
      fetchSnapshot: async () => {
        fetches += 1;
        if (fetches < 3) return snap({ generationStatus: "generating", content: "mid" });
        return snap({ generationStatus: "completed", content: "done body" });
      },
    });
    assert.equal(result.kind, "completed");
    if (result.kind === "completed") {
      assert.equal(result.snapshot.content, "done body");
    }
    assert.equal(fetches, 3);
  });

  it("G-race: widget finalize slightly after prior 1050ms budget still completes", async () => {
    // Server stays generating until elapsed sleep passes the old 4-attempt budget
    // (1050ms) by a small margin, then flips to completed — must not interrupt.
    const priorBudgetMs = eofReconcileMaxSleepMs(4, 350);
    assert.equal(priorBudgetMs, 1050);
    const completeAfterMs = priorBudgetMs + 150; // 1200ms — slightly late vs old window

    let elapsed = 0;
    let fetches = 0;
    const result = await reconcileStreamEof({
      messageId: 781,
      // production defaults (6 × 350 → 1750ms)
      sleep: async (ms) => {
        elapsed += ms;
      },
      fetchSnapshot: async () => {
        fetches += 1;
        if (elapsed < completeAfterMs) {
          return snap({ generationStatus: "generating", content: "mid-widget" });
        }
        return snap({ generationStatus: "completed", content: "finalized after widget" });
      },
    });

    assert.equal(result.kind, "completed");
    if (result.kind === "completed") {
      assert.equal(result.snapshot.content, "finalized after widget");
      assert.equal(generationStatusFromEofResult(result), "completed");
    }
    assert.ok(elapsed >= completeAfterMs, `elapsed=${elapsed} should reach late finalize`);
    assert.ok(elapsed <= eofReconcileMaxSleepMs(), `elapsed=${elapsed} within production budget`);
    assert.ok(fetches >= 5, `expected late poll, got fetches=${fetches}`);
  });

  it("G-boundary: same late finalize under old 4-attempt budget would interrupt", async () => {
    const priorBudgetMs = eofReconcileMaxSleepMs(4, 350);
    const completeAfterMs = priorBudgetMs + 150; // 1200ms
    let elapsed = 0;
    const result = await reconcileStreamEof({
      messageId: 781,
      maxAttempts: 4,
      retryMs: 350,
      sleep: async (ms) => {
        elapsed += ms;
      },
      fetchSnapshot: async () => {
        if (elapsed < completeAfterMs) {
          return snap({ generationStatus: "generating" });
        }
        return snap({ generationStatus: "completed" });
      },
    });
    assert.equal(result.kind, "interrupted");
    if (result.kind === "interrupted") {
      assert.equal(result.reason, "still_generating");
    }
    assert.equal(elapsed, priorBudgetMs);
  });

  it("missing messageId → interrupted without fetch", async () => {
    let fetches = 0;
    const result = await reconcileStreamEof({
      messageId: null,
      fetchSnapshot: async () => {
        fetches += 1;
        return snap();
      },
    });
    assert.equal(result.kind, "interrupted");
    if (result.kind === "interrupted") {
      assert.equal(result.reason, "missing_message_id");
    }
    assert.equal(fetches, 0);
  });
});
