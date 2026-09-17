import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EOF_RECONCILE_MAX_ATTEMPTS,
  EOF_RECONCILE_RETRY_MS,
  EOF_RECONCILE_SUBSTANTIAL_PROSE_MIN_CHARS,
  classifyReconcileStatus,
  clearStreamErrorOnCompletedReconcile,
  eofReconcileMaxSleepMs,
  generationStatusFromEofResult,
  needsEofReconcile,
  reconcileStreamEof,
  resolveEofReconcilePollBudget,
  shouldRunLostTerminalReconcile,
  type EofReconcileSnapshot,
} from "@/lib/chatStreamEofReconcile";
import { applyStatusMessageEvidence, createEmptyPostProcessPhaseEvidence } from "@/lib/chatStreamPostProcessEvidence";

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
  it("short budget defaults", () => {
    assert.equal(EOF_RECONCILE_MAX_ATTEMPTS, 6);
    assert.equal(EOF_RECONCILE_RETRY_MS, 350);
    assert.equal(eofReconcileMaxSleepMs(), 1750);
  });
});

describe("resolveEofReconcilePollBudget", () => {
  it("uses short budget for empty/minimal streamed prose", () => {
    const budget = resolveEofReconcilePollBudget({ streamedContentChars: 50 });
    assert.equal(budget.maxAttempts, 6);
    assert.equal(budget.retryMs, 350);
    assert.equal(budget.extended, false);
  });

  it("requires postprocess evidence for extended budget", () => {
    const withoutEvidence = resolveEofReconcilePollBudget({
      streamedContentChars: EOF_RECONCILE_SUBSTANTIAL_PROSE_MIN_CHARS,
    });
    assert.equal(withoutEvidence.extended, false);

    const evidence = createEmptyPostProcessPhaseEvidence();
    applyStatusMessageEvidence(evidence, "상태창 생성 중…");
    const withEvidence = resolveEofReconcilePollBudget({
      streamedContentChars: EOF_RECONCILE_SUBSTANTIAL_PROSE_MIN_CHARS,
      postProcessEvidence: evidence,
    });
    assert.equal(withEvidence.extended, true);
  });
});

describe("reconcileStreamEof", () => {
  it("B: DB completed after EOF → completed UI snapshot", async () => {
    const evidence = createEmptyPostProcessPhaseEvidence();
    applyStatusMessageEvidence(evidence, "마무리 중…");
    const result = await reconcileStreamEof({
      messageId: 781,
      streamedContentChars: 4200,
      postProcessEvidence: evidence,
      retryMs: 0,
      maxAttempts: 2,
      sleep: async () => {},
      fetchSnapshot: async () =>
        snap({ generationStatus: "completed", content: "final prose preserved" }),
    });
    assert.equal(result.kind, "completed");
    assert.equal(generationStatusFromEofResult(result), "completed");
  });

  it("D-guard: error terminal flag skips reconcile", () => {
    assert.equal(needsEofReconcile({ sawDone: false, sawError: true }), false);
  });

  it("still generating under short budget → interrupted", async () => {
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

  it("A: receive exception + DB completed clears generic stream error", async () => {
    assert.equal(
      shouldRunLostTerminalReconcile({
        trafficOverload: false,
        sawDone: false,
        sawError: false,
      }),
      true
    );
    const genericError = "스트림 수신 중 오류가 발생했습니다.";
    const result = await reconcileStreamEof({
      messageId: 707,
      streamedContentChars: 5182,
      retryMs: 0,
      maxAttempts: 1,
      sleep: async () => {},
      fetchSnapshot: async () =>
        snap({
          generationStatus: "completed",
          content: "final prose from DB",
          messageId: 707,
          chatId: 39,
        }),
    });
    assert.equal(result.kind, "completed");
    assert.equal(
      clearStreamErrorOnCompletedReconcile(genericError, result),
      "",
      "completed reconcile must drop generic receive error"
    );
  });

  it("A-guard: legacy EOF gate skipped reconcile when streamError was set", () => {
    const streamError = "스트림 수신 중 오류가 발생했습니다.";
    const legacyGate =
      !"" &&
      !streamError &&
      needsEofReconcile({ sawDone: false, sawError: false });
    assert.equal(legacyGate, false, "pre-fix gate blocked reconcile on receive exception");
    assert.equal(
      shouldRunLostTerminalReconcile({
        trafficOverload: false,
        sawDone: false,
        sawError: false,
      }),
      true,
      "lost-terminal gate ignores streamError"
    );
  });

  it("C: receive exception + DB still generating stays interrupted", async () => {
    const result = await reconcileStreamEof({
      messageId: 781,
      streamedContentChars: 4200,
      retryMs: 0,
      maxAttempts: 2,
      sleep: async () => {},
      fetchSnapshot: async () => snap({ generationStatus: "generating", content: "partial" }),
    });
    assert.equal(result.kind, "interrupted");
    assert.equal(
      clearStreamErrorOnCompletedReconcile("스트림 수신 중 오류가 발생했습니다.", result),
      "스트림 수신 중 오류가 발생했습니다."
    );
  });

  it("D: receive exception + DB failed keeps stream error", async () => {
    const result = await reconcileStreamEof({
      messageId: 781,
      retryMs: 0,
      maxAttempts: 1,
      sleep: async () => {},
      fetchSnapshot: async () => snap({ generationStatus: "failed", content: "x" }),
    });
    assert.equal(result.kind, "terminal");
    assert.equal(
      clearStreamErrorOnCompletedReconcile("스트림 수신 중 오류가 발생했습니다.", result),
      "스트림 수신 중 오류가 발생했습니다."
    );
  });

  it("failed_partial is terminal", async () => {
    const result = await reconcileStreamEof({
      messageId: 781,
      retryMs: 0,
      maxAttempts: 1,
      sleep: async () => {},
      fetchSnapshot: async () => snap({ generationStatus: "failed_partial", content: "x" }),
    });
    assert.equal(result.kind, "terminal");
    assert.equal(classifyReconcileStatus("failed_partial"), "failed_like");
  });
});
