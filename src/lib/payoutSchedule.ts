/** Client-safe payout schedule and tax helpers (no DB / gateway). */

/** 매월 15일 03:00 (Asia/Seoul) */
export const PAYOUT_CRON_EXPRESSION = "0 3 15 * *";
export const PAYOUT_TIMEZONE = "Asia/Seoul";
export const PAYOUT_SCHEDULE_LABEL = "매월 15일 03:00 (Asia/Seoul)";

/** 지방소득세 = 국세(원천징수)의 10% (소득세법 기준) */
export const LOCAL_TAX_RATE_OF_NATIONAL = 0.1;

export function isPayoutSchedulerEnabled(): boolean {
  return process.env.DISABLE_PAYOUT_SCHEDULER !== "1";
}

export function calcLocalTax(nationalTax: number): number {
  return Math.floor(nationalTax * LOCAL_TAX_RATE_OF_NATIONAL);
}

/**
 * Canonical withholding split owner. Stored `tax_amount` is TOTAL
 * withholding (national + local combined), so display/reporting derives:
 * national ~= total x 10/11, local = canonical 10%-of-national via
 * calcLocalTax, and national absorbs the remainder - therefore
 * `nationalTax + localTax === total` holds exactly for every total, in both
 * the old 8.8% era and the current 3.3% era (rate-agnostic structure).
 */
export function splitWithholdingTax(totalWithholding: number): {
  nationalTax: number;
  localTax: number;
} {
  const total = Math.round(totalWithholding);
  const localTax = calcLocalTax(Math.round((total * 10) / 11));
  return { nationalTax: total - localTax, localTax };
}
