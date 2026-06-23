import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isPointChargeHistoryLog,
  isPointFreeCreditHistoryLog,
  isPointPaidCreditHistoryLog,
  isPointUsageHistoryLog,
  CHARGE_MAX_ITEMS,
  CHARGE_PAGE_SIZE,
  USAGE_MAX_ITEMS,
  USAGE_PAGE_SIZE,
} from "@/lib/pointUsageLog";
import {
  clampChargePage,
  clampCreditPage,
  clampUsagePage,
} from "@/lib/pointLogsQuery";

describe("pointUsageLog history filters", () => {
  it("classifies paid charge and cancellation as paid credit history", () => {
    assert.equal(
      isPointPaidCreditHistoryLog({ delta: 10000, reason: "포인트 충전 (₩10,000)" }),
      true
    );
    assert.equal(
      isPointPaidCreditHistoryLog({ delta: -10000, reason: "결제 취소 (₩10,000)" }),
      true
    );
    assert.equal(
      isPointPaidCreditHistoryLog({ delta: 450, reason: "포인트 선물 수령 (450P)" }),
      true
    );
  });

  it("classifies attendance and event rewards as free credit history", () => {
    assert.equal(
      isPointFreeCreditHistoryLog({ delta: 300, reason: "일일 출석 보상 (+300P)" }),
      true
    );
    assert.equal(
      isPointFreeCreditHistoryLog({
        delta: 5000,
        reason: "캐릭터 제작·이식 이벤트 — 테스트 캐릭터",
      }),
      true
    );
    assert.equal(
      isPointFreeCreditHistoryLog({ delta: 2000, reason: "신규 가입 보너스" }),
      true
    );
    assert.equal(
      isPointFreeCreditHistoryLog({ delta: 500, reason: "충전 보너스 (+500P)" }),
      true
    );
    assert.equal(
      isPointFreeCreditHistoryLog({ delta: 20000, reason: "베이직 멤버십 지급 (₩19,000)" }),
      true
    );
    assert.equal(
      isPointFreeCreditHistoryLog({
        delta: 1000,
        reason: "관리자 무료 포인트 지급 — CS 보상",
      }),
      true
    );
  });

  it("does not mix paid and free credit tabs", () => {
    assert.equal(
      isPointPaidCreditHistoryLog({ delta: 300, reason: "일일 출석 보상 (+300P)" }),
      false
    );
    assert.equal(
      isPointFreeCreditHistoryLog({ delta: 10000, reason: "포인트 충전 (₩10,000)" }),
      false
    );
  });

  it("classifies chat deductions and gifts as usage history", () => {
    assert.equal(
      isPointUsageHistoryLog({
        delta: -33,
        reason: "대화 · 딥 하비 (입력토큰 19,607 / 출력토큰 1,061)",
      }),
      true
    );
    assert.equal(
      isPointUsageHistoryLog({ delta: -500, reason: "포인트 선물 → alice (500P, 수수료 50P)" }),
      true
    );
    assert.equal(
      isPointUsageHistoryLog({ delta: 450, reason: "포인트 선물 수령 (450P)" }),
      false
    );
    assert.equal(
      isPointUsageHistoryLog({ delta: 10000, reason: "포인트 충전 (₩10,000)" }),
      false
    );
    assert.equal(
      isPointUsageHistoryLog({ delta: 300, reason: "일일 출석 보상 (+300P)" }),
      false
    );
  });

  it("keeps legacy combined charge history helper", () => {
    assert.equal(
      isPointChargeHistoryLog({ delta: 10000, reason: "포인트 충전 (₩10,000)" }),
      true
    );
    assert.equal(
      isPointChargeHistoryLog({ delta: 300, reason: "일일 출석 보상 (+300P)" }),
      true
    );
  });
});

describe("pointLogsQuery pagination", () => {
  it("clamps usage page to valid range", () => {
    const maxPage = Math.ceil(USAGE_MAX_ITEMS / USAGE_PAGE_SIZE);
    assert.equal(clampUsagePage(0), 1);
    assert.equal(clampUsagePage(1), 1);
    assert.equal(clampUsagePage(maxPage), maxPage);
    assert.equal(clampUsagePage(maxPage + 5), maxPage);
    assert.equal(clampUsagePage(Number.NaN), 1);
  });

  it("clamps credit page to valid range", () => {
    const maxPage = Math.ceil(CHARGE_MAX_ITEMS / CHARGE_PAGE_SIZE);
    assert.equal(clampCreditPage(0), 1);
    assert.equal(clampCreditPage(1), 1);
    assert.equal(clampCreditPage(maxPage), maxPage);
    assert.equal(clampChargePage(maxPage + 3), maxPage);
  });
});
