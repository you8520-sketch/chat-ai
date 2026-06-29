import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assessMessageForAutoRefund,
  formatAutoRefundReasons,
} from "@/lib/refundAutoValidation";
import { AUTO_REFUND_MIN_VISIBLE_CHARS } from "@/lib/reportRefundPolicy";

describe("assessMessageForAutoRefund", () => {
  it("flags under-length output", () => {
    const r = assessMessageForAutoRefund({
      content: "짧은 답변입니다.".repeat(5),
    });
    assert.equal(r.isError, true);
    assert.ok(r.reasons.includes("under_length"));
  });

  it("flags duplicate vs previous assistant", () => {
    const body = "A".repeat(AUTO_REFUND_MIN_VISIBLE_CHARS + 20);
    const r = assessMessageForAutoRefund({
      content: body,
      previousAssistantContent: body,
    });
    assert.ok(r.reasons.includes("duplicate_output"));
  });

  it("passes healthy long output", () => {
    const r = assessMessageForAutoRefund({
      content: "정상적인 RP 본문입니다. ".repeat(120),
    });
    assert.equal(r.isError, false);
    assert.equal(r.summary, "");
  });

  it("formatAutoRefundReasons joins labels", () => {
    assert.match(formatAutoRefundReasons(["under_length", "garbage_output"]), /미달/);
  });
});
