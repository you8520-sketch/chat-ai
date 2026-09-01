import type { FinanceTurnCostCoverage } from "@/lib/adminFinanceTurnCost";

/** Margin label — never show "매출 없음" when paid revenue exists but cost is uncertain. */
export function formatFinanceMarginRate(
  marginRate: number | null,
  coverage: FinanceTurnCostCoverage | undefined,
  paidRevenueKrw: number
): string {
  if (marginRate != null) {
    return `${(marginRate * 100).toFixed(1)}%`;
  }
  if (coverage === "partial") return "부분 집계 · 미확정";
  if (coverage === "estimated") return "추정 원가 포함 · 미확정";
  if (coverage === "unavailable") return "원가 미확정";
  if (paidRevenueKrw > 0) return "원가 미확정";
  return "매출 없음";
}

export function formatFinanceNetProfit(
  netProfitKrw: number | null,
  coverage: FinanceTurnCostCoverage | undefined,
  paidRevenueKrw: number
): string {
  if (netProfitKrw != null) {
    return `${Math.round(netProfitKrw).toLocaleString()}원`;
  }
  if (coverage === "partial") return "부분 집계 · 미확정";
  if (coverage === "estimated") return "추정 원가 포함 · 미확정";
  if (coverage === "unavailable") return "원가 미확정";
  if (paidRevenueKrw > 0) return "원가 미확정";
  return "미확정";
}

export function imageHasAccountingActivity(
  imagePaid: number,
  imageFree: number,
  imageApiCostKrw: number
): boolean {
  return imagePaid > 0 || imageFree > 0 || imageApiCostKrw > 0;
}
