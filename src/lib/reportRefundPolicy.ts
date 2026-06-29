/** 오류 신고·자동 환불 정책 상수 */

export const REPORT_REFUND_WINDOW_MS = 24 * 60 * 60 * 1000;
export const AUTO_REFUND_DAILY_LIMIT = 3;
/** 자동 환불 — 표시 글자수 미달 기준 */
export const AUTO_REFUND_MIN_VISIBLE_CHARS = 500;

export function isWithinReportRefundWindow(createdAt?: string | null): boolean {
  if (!createdAt?.trim()) return true;
  const ts = Date.parse(createdAt.replace(" ", "T") + (createdAt.includes("Z") ? "" : "Z"));
  if (!Number.isFinite(ts)) return true;
  return Date.now() - ts < REPORT_REFUND_WINDOW_MS;
}

export function canShowAssistantCharCount(showFullBillingReceipt: boolean): boolean {
  return showFullBillingReceipt;
}
