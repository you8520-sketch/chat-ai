import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  batchEndForStart,
  buildOocOnlyBatchPlaceholder,
  buildSummaryBatchDiagnostics,
  earliestMissingBatchStart,
  expectedBatchStartsThrough,
  highestContiguousCompletedTurn,
  isOocOnlyPlaceholderText,
  isOocOnlySummaryKind,
  missingContiguousBatchStarts,
  OOC_ONLY_SUMMARY_MARKER,
  parseRecentSummaryBatchStarts,
  validateSummaryNarrative,
} from "./memory-summary-integrity";

function rec(turnStart: number) {
  return { turnStart, turnEnd: turnStart + 5 };
}

describe("highestContiguousCompletedTurn", () => {
  it("returns 0 when only 7~12 exists (gap at 1)", () => {
    assert.equal(highestContiguousCompletedTurn([rec(7)], 13), 0);
  });

  it("returns 6 for first batch only", () => {
    assert.equal(highestContiguousCompletedTurn([rec(1)], 13), 6);
  });

  it("returns 12 for contiguous 1 then 7", () => {
    assert.equal(highestContiguousCompletedTurn([rec(1), rec(7)], 13), 12);
  });

  it("stops at gap even if later batch exists (1 and 13 only → 6)", () => {
    assert.equal(highestContiguousCompletedTurn([rec(1), rec(13)], 20), 6);
  });
});

describe("missing / expected batches", () => {
  it("expected starts for 13 playable turns", () => {
    assert.deepEqual(expectedBatchStartsThrough(13), [1, 7]);
  });

  it("finds missing 1 when only 7 present", () => {
    assert.deepEqual(missingContiguousBatchStarts([rec(7)], 13), [1]);
    assert.equal(earliestMissingBatchStart([rec(7)], 13), 1);
  });

  it("no missing when 1 and 7 present", () => {
    assert.deepEqual(missingContiguousBatchStarts([rec(1), rec(7)], 13), []);
  });
});

describe("validateSummaryNarrative", () => {
  it("rejects empty", () => {
    assert.equal(validateSummaryNarrative("").ok, false);
  });

  it("rejects short", () => {
    const r = validateSummaryNarrative("짧음");
    assert.equal(r.ok, false);
  });

  it("accepts long narrative", () => {
    const text =
      "레온은 연회장에서 렌을 만나 정원을 안내했다 → 렌의 청혼에 흔들리며 감정을 드러냈다 → " +
      "커프링크스를 받으며 둘만의 약속을 나눴다 → 이별 전 심장을 맡긴다고 고백했다.";
    const r = validateSummaryNarrative(text);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.kind, "narrative");
  });

  it("OOC placeholder has explicit ooc_only kind and marker text", () => {
    const p = buildOocOnlyBatchPlaceholder(1, 6);
    assert.equal(p, OOC_ONLY_SUMMARY_MARKER);
    assert.equal(isOocOnlyPlaceholderText(p), true);
    const r = validateSummaryNarrative(p, "ooc_only");
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.kind, "ooc_only");
    assert.equal(r.text, OOC_ONLY_SUMMARY_MARKER);
    assert.equal(isOocOnlySummaryKind(r.kind), true);
  });

  it("rejects using OOC marker as narrative summary", () => {
    assert.equal(validateSummaryNarrative(OOC_ONLY_SUMMARY_MARKER, "narrative").ok, false);
  });
});

describe("diagnostics", () => {
  it("flags SUMMARY_BATCH_GAP for chat44-like state", () => {
    const d = buildSummaryBatchDiagnostics({
      chatId: 44,
      records: [rec(7)],
      playableTurnCount: 13,
      summarizedTurnCount: 12,
      recentSummary: "[7~12턴] 레온과 렌의 이별",
    });
    assert.equal(d.reasonCode, "SUMMARY_BATCH_GAP");
    assert.deepEqual(d.missingBatchStarts, [1]);
    assert.equal(d.highestContiguousTurn, 0);
    assert.equal(d.recentSummaryBatchRange, "7~12");
  });

  it("parses batch starts from recent_summary", () => {
    assert.deepEqual(
      parseRecentSummaryBatchStarts("[1~6턴] a\n\n[7~12턴] b"),
      [1, 7]
    );
    assert.equal(batchEndForStart(1), 6);
  });
});
