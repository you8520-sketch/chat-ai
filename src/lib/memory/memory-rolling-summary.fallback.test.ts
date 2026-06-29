import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isFallbackMemoryRecordSummary } from "./memory-summary-clamp";

describe("isFallbackMemoryRecordSummary", () => {
  it("detects legacy mechanical fallback pattern", () => {
    assert.equal(
      isFallbackMemoryRecordSummary(
        "유저가 안녕…라 말했고 레온은(는) 고개를 끄덕였다…"
      ),
      true
    );
  });

  it("detects new temporary record header", () => {
    assert.equal(
      isFallbackMemoryRecordSummary("[임시 기록 — AI 요약 실패] 레온과 대화"),
      true
    );
  });

  it("returns false for normal narrative summary", () => {
    assert.equal(
      isFallbackMemoryRecordSummary(
        "렌이 레온을 만나러 왔다고 말하자 → 레온은 경계심을 풀고 안내를 수락했다"
      ),
      false
    );
  });
});
