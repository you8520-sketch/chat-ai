import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assessCategoryForAutoRefund } from "@/lib/refundCategoryValidation";
import { AUTO_REFUND_MIN_VISIBLE_CHARS } from "@/lib/reportRefundPolicy";

function longContent(): string {
  return "정상 RP 본문입니다. ".repeat(120);
}

describe("refund category evidence regression", () => {
  it("similar_content + messageStatus error without similarity → not auto", () => {
    const assessment = assessCategoryForAutoRefund({
      category: "similar_content",
      content: longContent(),
      messageStatus: "error",
      generationStatus: "completed",
      previousAssistantContent: "완전히 다른 이전 assistant 본문 ".repeat(20),
      userMessage: "다른 user input ".repeat(10),
    });
    assert.equal(assessment.isError, false);
    assert.equal(assessment.reasons.length, 0);
  });

  it("under_length + messageStatus error when length >= threshold → not auto", () => {
    const assessment = assessCategoryForAutoRefund({
      category: "under_length",
      content: longContent(),
      messageStatus: "error",
      generationStatus: "completed",
    });
    assert.equal(assessment.isError, false);
    assert.ok(visibleLengthAboveThreshold(longContent()));
  });

  it("under_length with short content still auto-refunds", () => {
    const short = "x".repeat(AUTO_REFUND_MIN_VISIBLE_CHARS - 10);
    const assessment = assessCategoryForAutoRefund({
      category: "under_length",
      content: short,
      messageStatus: "completed",
    });
    assert.equal(assessment.isError, true);
    assert.ok(assessment.reasons.includes("under_length"));
  });

  it("spam_flood + messageStatus error without spam evidence → not auto", () => {
    const assessment = assessCategoryForAutoRefund({
      category: "spam_flood",
      content: longContent(),
      messageStatus: "error",
    });
    assert.equal(assessment.isError, false);
  });

  it("incomplete_output + messageStatus error without incomplete signals → not auto", () => {
    const assessment = assessCategoryForAutoRefund({
      category: "incomplete_output",
      content: longContent(),
      messageStatus: "error",
      generationStatus: "completed",
      finishReason: "stop",
    });
    assert.equal(assessment.isError, false);
  });
});

function visibleLengthAboveThreshold(content: string): boolean {
  return content.length >= AUTO_REFUND_MIN_VISIBLE_CHARS;
}
