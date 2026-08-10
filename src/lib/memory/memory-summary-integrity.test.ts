import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  batchEndForStart,
  buildOocOnlyBatchPlaceholder,
  buildSummaryBatchDiagnostics,
  earliestMissingBatchStart,
  expectedBatchStartsThrough,
  highestContiguousCompletedTurn,
  isLikelySummaryInstructionEcho,
  isOocOnlyPlaceholderText,
  isOocOnlySummaryKind,
  isRollingSummaryGroundedInDialogue,
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
    if (r.ok) assert.equal(r.kind, "main_canon");
  });

  it("OOC placeholder has explicit ooc_only kind and marker text", () => {
    const p = buildOocOnlyBatchPlaceholder(1, 6);
    assert.equal(p, OOC_ONLY_SUMMARY_MARKER);
    assert.equal(isOocOnlyPlaceholderText(p), true);
    const r = validateSummaryNarrative(p, "empty_ooc");
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.kind, "empty_ooc");
    assert.equal(r.text, OOC_ONLY_SUMMARY_MARKER);
    assert.equal(isOocOnlySummaryKind(r.kind), true);
  });

  it("rejects using OOC marker as narrative summary", () => {
    assert.equal(validateSummaryNarrative(OOC_ONLY_SUMMARY_MARKER, "narrative").ok, false);
  });

  it("rejects a summary-writing instruction echoed as the summary body", () => {
    const echo =
      "6턴 배치의 사건을 발생 순서대로 요약한다. 사건 시기와 인과관계를 누락하지 않는다. 최종 출력에는 핵심 사건을 기록한다.";
    assert.equal(isLikelySummaryInstructionEcho(echo), true);
    assert.equal(validateSummaryNarrative(echo).ok, false);
  });
});

describe("rolling summary source grounding", () => {
  it("rejects expanding a limited recognition statement into global amnesia", () => {
    const dialogue =
      "[1턴]\n유저: 나는 렌이라고 해. 널 본 기억이 안 나는데, 나 알아?\n에녹: 그는 렌을 본부 안으로 안내했다.";
    assert.equal(
      isRollingSummaryGroundedInDialogue(
        "렌이 기억을 잃은 채 본부에 도착했고 에녹의 안내를 받았다.",
        dialogue
      ),
      false
    );
    assert.equal(
      isRollingSummaryGroundedInDialogue(
        "렌은 에녹을 본 기억이 없다고 말했고, 에녹은 렌을 본부 안으로 안내했다.",
        dialogue
      ),
      true
    );
  });

  it("requires attribution when an uncertain assistant claim enters the summary", () => {
    const dialogue =
      "[1턴]\n유저: 몸이 왜 이러지?\n에녹: 에녹은 렌이 가이드 각성 중일 가능성이 높다고 추측했다.";
    assert.equal(
      isRollingSummaryGroundedInDialogue(
        "렌의 가이드 각성은 현재 진행 중이며 미해결 상태다.",
        dialogue
      ),
      false
    );
    assert.equal(
      isRollingSummaryGroundedInDialogue(
        "에녹은 렌이 가이드 각성 중일 가능성이 있다고 추측했으나 확정되지 않았다.",
        dialogue
      ),
      true
    );
  });

  it("does not let attribution in one sentence canonize another sentence", () => {
    const dialogue =
      "[1턴]\n유저: 몸이 왜 이러지?\n에녹: 에녹은 렌이 가이드 각성 중일 가능성이 높다고 추측했다.";
    assert.equal(
      isRollingSummaryGroundedInDialogue(
        "에녹은 원인을 추측했다. 렌의 가이드 각성은 현재 진행 중이다.",
        dialogue
      ),
      false
    );
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
