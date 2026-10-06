/** 오류 신고·자동 환불 정책 상수 */

export const REPORT_REFUND_WINDOW_MS = 24 * 60 * 60 * 1000;
export const AUTO_REFUND_DAILY_LIMIT = 3;

/**
 * Inclusive visible-char ceiling for under_length auto-refund evidence.
 * Product: visible chars <= 1000 AND user reports under_length / 출력량 부족.
 * Do not encode this as MIN + `<` (for example 1001).
 */
export const AUTO_REFUND_UNDER_LENGTH_MAX_VISIBLE_CHARS = 1000;

export function isAutoRefundUnderLengthEvidence(visibleChars: number): boolean {
  return (
    Number.isFinite(visibleChars) &&
    visibleChars >= 0 &&
    visibleChars <= AUTO_REFUND_UNDER_LENGTH_MAX_VISIBLE_CHARS
  );
}

export function isWithinReportRefundWindow(createdAt?: string | null): boolean {
  if (!createdAt?.trim()) return true;
  const ts = Date.parse(createdAt.replace(" ", "T") + (createdAt.includes("Z") ? "" : "Z"));
  if (!Number.isFinite(ts)) return true;
  return Date.now() - ts < REPORT_REFUND_WINDOW_MS;
}

export function canShowAssistantCharCount(showFullBillingReceipt: boolean): boolean {
  return showFullBillingReceipt;
}
