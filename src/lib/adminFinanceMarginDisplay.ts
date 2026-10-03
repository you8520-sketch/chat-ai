import type { FinanceTurnCostCoverage } from "@/lib/adminFinanceTurnCost";
import type { ProviderReconciliationResult } from "@/lib/providerCostReconciliation";

/** Margin label — never show "매출 없음" when paid revenue exists but cost is uncertain. */
export function formatFinanceMarginRate(
  marginRate: number | null,
  coverage: FinanceTurnCostCoverage | undefined,
  paidRevenueKrw: number
): string {
  if (marginRate != null) {
    return `${(marginRate * 100).toFixed(1)}%`;
  }
  if (paidRevenueKrw <= 0) return "매출 없음 · 수익률 해당 없음";
  if (coverage === "partial") return "부분 집계 · 미확정";
  if (coverage === "estimated") return "추정 원가 포함 · 미확정";
  if (coverage === "unavailable") return "원가 미확정";
  return "원가 미확정";
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

export function formatRecordedActualAiCostKrw(totalActualKrw: number): string {
  return `${Math.round(totalActualKrw).toLocaleString()}원`;
}

/**
 * Loss-floor label is allowed only when every recognized revenue source and
 * every positive P&L adjustment is verified zero, and a recorded exact AI
 * cost exists. Cash inflow this month blocks the claim so unused prepaid
 * deposits are not described as a guaranteed operating loss.
 */
export function canClaimRecordedCostLossFloor(input: {
  recognizedRevenueKrw: number;
  paymentsCollectedKrw: number;
  creatorPlatformRetainedKrw: number;
  recordedActualAiCostKrw: number;
}): boolean {
  return (
    input.recognizedRevenueKrw <= 0 &&
    input.paymentsCollectedKrw <= 0 &&
    input.creatorPlatformRetainedKrw <= 0 &&
    input.recordedActualAiCostKrw > 0
  );
}

export function formatRecordedAiCostMetricLabel(canClaimLossFloor: boolean): string {
  return canClaimLossFloor
    ? "현재 기록 기준 최소 손실"
    : "내부 원장에 기록된 실제 AI 비용";
}

/** Recorded-ledger exactness only — not provider invoice completeness. */
export function formatLedgerRecordedCoverageCaption(
  coveragePct: number | null
): string {
  if (coveragePct == null) return "";
  return `원장 기록 확정 ${coveragePct}%`;
}

export function formatProviderReconciliationState(
  recon: Pick<ProviderReconciliationResult, "status"> | null
): string {
  if (!recon) return "공급자 청구 대조 기록 없음";
  switch (recon.status) {
    case "matched":
      return "공급자 청구 대조 일치";
    case "mismatch":
      return "공급자 청구 대조 불일치 · 미완료";
    case "pending":
      return "공급자 청구 대조 대기 · 미완료";
    case "provider_unavailable":
      return "공급자 청구 대조 불가 · 미완료";
    case "not_configured":
      return "공급자 청구 대조 미설정 · 미완료";
    default: {
      const exhaustive: never = recon.status;
      return exhaustive;
    }
  }
}
