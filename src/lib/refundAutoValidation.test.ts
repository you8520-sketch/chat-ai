import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assessMessageForAutoRefund,
  formatAutoRefundReasons,
  hasRepeatedLongFormBlock,
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

  it("flags a long multi-paragraph repetition loop", () => {
    const block = [
      "태현은 안개 속에서 작은 균사 덩어리를 발견하고 조심스럽게 주머니에 넣었다.",
      "렌은 뒤를 따라가며 점점 커지는 형광점과 주변의 신호를 자세히 관찰했다.",
      "두 사람은 시야가 좁아지는 통로를 피해 더 깊은 구역으로 천천히 이동했다.",
    ].join("\n");
    const content = Array.from({ length: 24 }, () => block).join("\n");
    assert.equal(hasRepeatedLongFormBlock(content), true);
    const result = assessMessageForAutoRefund({ content });
    assert.equal(result.isError, true);
    assert.ok(result.reasons.includes("repeated_block"));
  });

  it("formatAutoRefundReasons joins labels", () => {
    assert.match(formatAutoRefundReasons(["under_length", "garbage_output"]), /미달/);
  });
});
