import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveSuggestedRepliesExpectation } from "@/lib/asyncTurnCoverage";
import type { Usage } from "@/lib/chatUsage";
import type { SuggestedRepliesRecord } from "@/lib/suggestedReplies/types";

function record(
  overrides: Partial<SuggestedRepliesRecord> = {}
): SuggestedRepliesRecord {
  return {
    replies: [],
    extractedAt: new Date().toISOString(),
    source: "post-turn-shared",
    pending: false,
    failed: false,
    generationSequence: 0,
    generationRequestId: "req-suggested-coverage",
    ...overrides,
  };
}

function canonicalReplies(): SuggestedRepliesRecord["replies"] {
  return [
    { kind: "natural", text: "a".repeat(72) },
    { kind: "twist", text: "b".repeat(72) },
    { kind: "banter", text: "c".repeat(72) },
  ];
}

describe("Suggested Replies async coverage owner", () => {
  it("missing persisted record is unverifiable", () => {
    const result = resolveSuggestedRepliesExpectation({
      usage: {} as Usage,
      record: null,
      repairLedgerRowCount: 0,
    });
    assert.equal(result.expectationState, "unverifiable");
    assert.equal(result.skipReason, "missing_suggested_replies_record");
  });

  it("original-turn ineligibility is not expected regardless of empty replies", () => {
    const result = resolveSuggestedRepliesExpectation({
      usage: {} as Usage,
      record: record({
        terminalReason: "original_turn_ineligible",
        failed: true,
      }),
      repairLedgerRowCount: 0,
    });
    assert.equal(result.expectationState, "not_expected");
    assert.equal(result.skipReason, "original_turn_ineligible");
  });

  it("pending record remains pending before terminal failure is considered", () => {
    const result = resolveSuggestedRepliesExpectation({
      usage: {} as Usage,
      record: record({ pending: true, failed: true }),
      repairLedgerRowCount: 0,
    });
    assert.equal(result.expectationState, "pending");
    assert.equal(result.taskPending, true);
  });

  it("terminal empty record uses persisted failed metadata for taskFailed", () => {
    const failed = resolveSuggestedRepliesExpectation({
      usage: {} as Usage,
      record: record({ failed: true }),
      repairLedgerRowCount: 1,
    });
    assert.equal(failed.expectationState, "terminal");
    assert.equal(failed.taskFailed, true);

    const notMarkedFailed = resolveSuggestedRepliesExpectation({
      usage: {} as Usage,
      record: record({ failed: false }),
      repairLedgerRowCount: 1,
    });
    assert.equal(notMarkedFailed.expectationState, "terminal");
    assert.equal(notMarkedFailed.taskFailed, false);
  });

  it("valid terminal trio is not taskFailed even if legacy metadata says failed", () => {
    const result = resolveSuggestedRepliesExpectation({
      usage: {} as Usage,
      record: record({
        replies: canonicalReplies(),
        failed: true,
      }),
      repairLedgerRowCount: 1,
    });
    assert.equal(result.expectationState, "terminal");
    assert.equal(result.taskFailed, false);
  });

  it("shared-initial satisfied trio is not expected when no repair call exists", () => {
    const result = resolveSuggestedRepliesExpectation({
      usage: {
        statusWidgetExtract: {
          postTurnSharedInitial: true,
        } as Usage["statusWidgetExtract"],
      } as Usage,
      record: record({
        replies: canonicalReplies(),
        failed: false,
      }),
      repairLedgerRowCount: 0,
    });
    assert.equal(result.expectationState, "not_expected");
    assert.equal(result.skipReason, "post_turn_shared_initial_satisfied");
  });
});
