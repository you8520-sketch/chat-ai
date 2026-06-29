import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseChatLogTokens } from "@/lib/pointLogRefundLink";
import { isChatPointDeductionLog } from "@/lib/pointUsageLog";

describe("pointUsageLog", () => {
  it("detects chat deduction logs including legacy reason format", () => {
    assert.equal(
      isChatPointDeductionLog({
        delta: -33,
        reason: "대화 · 딥 하비 (입력토큰 19,607 / 출력토큰 1,061)",
      }),
      true
    );
    assert.equal(
      isChatPointDeductionLog({
        delta: -33,
        reason: "대화(입력토큰 10,198 출력토큰 1,061)",
      }),
      true
    );
    assert.equal(isChatPointDeductionLog({ delta: 100, reason: "포인트 충전" }), false);
  });

  it("parseChatLogTokens supports slash and legacy spacing", () => {
    assert.deepEqual(
      parseChatLogTokens("대화 · 딥 하비 (입력토큰 19,607 / 출력토큰 1,061)"),
      { input: 19607, output: 1061 }
    );
    assert.deepEqual(parseChatLogTokens("대화(입력토큰 10,198 출력토큰 1,061)"), {
      input: 10198,
      output: 1061,
    });
  });
});
