import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canClaimRecordedCostLossFloor,
  formatFinanceMarginRate,
  formatFinanceNetProfit,
  formatLedgerRecordedCoverageCaption,
  formatProviderReconciliationState,
  formatRecordedActualAiCostKrw,
  formatRecordedAiCostMetricLabel,
} from "@/lib/adminFinanceMarginDisplay";

describe("admin finance free-point loss display helpers", () => {
  it("shows exact zero-revenue profit instead of hiding it", () => {
    assert.equal(formatFinanceNetProfit(-1280, "complete", 0), "-1,280원");
    assert.equal(formatFinanceMarginRate(null, "complete", 0), "매출 없음 · 수익률 해당 없음");
  });

  it("keeps final profit unset when cost is partial, and does not invent a margin", () => {
    assert.equal(formatFinanceNetProfit(null, "partial", 0), "부분 집계 · 미확정");
    assert.equal(
      formatFinanceMarginRate(null, "partial", 0),
      "매출 없음 · 수익률 해당 없음"
    );
  });

  it("never labels paid revenue as 매출 없음 when cost is uncertain", () => {
    assert.equal(formatFinanceMarginRate(null, "partial", 100), "부분 집계 · 미확정");
    assert.notEqual(formatFinanceMarginRate(null, "unavailable", 80), "매출 없음");
    assert.notEqual(
      formatFinanceMarginRate(null, "unavailable", 80),
      "매출 없음 · 수익률 해당 없음"
    );
  });

  it("claims a recorded-cost loss floor only when revenue and positive adjustments are zero", () => {
    const base = {
      recognizedRevenueKrw: 0,
      paymentsCollectedKrw: 0,
      creatorPlatformRetainedKrw: 0,
      recordedActualAiCostKrw: 1280,
    };
    assert.equal(canClaimRecordedCostLossFloor(base), true);
    assert.equal(formatRecordedAiCostMetricLabel(true), "현재 기록 기준 최소 손실");
    assert.equal(formatRecordedActualAiCostKrw(1280), "1,280원");

    assert.equal(canClaimRecordedCostLossFloor({ ...base, recognizedRevenueKrw: 10 }), false);
    assert.equal(canClaimRecordedCostLossFloor({ ...base, paymentsCollectedKrw: 1000 }), false);
    assert.equal(
      canClaimRecordedCostLossFloor({ ...base, creatorPlatformRetainedKrw: 5 }),
      false
    );
    assert.equal(
      canClaimRecordedCostLossFloor({ ...base, recordedActualAiCostKrw: 0 }),
      false
    );
    assert.equal(
      formatRecordedAiCostMetricLabel(false),
      "내부 원장에 기록된 실제 AI 비용"
    );
  });

  it("labels ledger coverage as recorded-row exactness, not invoice completeness", () => {
    assert.equal(formatLedgerRecordedCoverageCaption(100), "원장 기록 확정 100%");
    assert.equal(formatLedgerRecordedCoverageCaption(null), "");
  });

  it("does not hide incomplete provider reconciliation", () => {
    assert.equal(formatProviderReconciliationState(null), "공급자 청구 대조 기록 없음");
    assert.equal(
      formatProviderReconciliationState({ status: "mismatch" }),
      "공급자 청구 대조 불일치 · 미완료"
    );
    assert.equal(
      formatProviderReconciliationState({ status: "pending" }),
      "공급자 청구 대조 대기 · 미완료"
    );
    assert.equal(
      formatProviderReconciliationState({ status: "matched" }),
      "공급자 청구 대조 일치"
    );
  });
});
