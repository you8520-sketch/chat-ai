/**
 * Neutral FX snapshot contract — passed into the pure Published user-charge engine.
 * Persistence and resolution live in shadowBillingExchangeRate.ts.
 */

import {
  OVERSEAS_CARD_FEE_PERCENT,
  applyOverseasCardFee,
} from "@/lib/billingFxPolicy";

export type BillingFxSource =
  | "api_daily"
  | "previous_daily_snapshot"
  | "emergency_fallback";

export type BillingFxSnapshot = {
  mode: "daily_kst";
  dateKey: string;
  usdToKrw: number;
  effectiveKrwPerUsd: number;
  source: BillingFxSource;
  overseasFeeRate: number;
  locked: boolean;
};

const KST_DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const FX_RATE_TOLERANCE = 1e-4;

function isValidKstDateKey(dateKey: string): boolean {
  if (!KST_DATE_KEY_RE.test(dateKey)) return false;
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function ratesApproximatelyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= FX_RATE_TOLERANCE;
}

export type ValidateBillingFxOptions = {
  /** Live-grade charges require locked snapshots. Diagnostic paths may omit. */
  requireLocked?: boolean;
};

export function validateBillingFxSnapshot(
  snapshot: BillingFxSnapshot,
  opts?: ValidateBillingFxOptions
): boolean {
  if (snapshot.mode !== "daily_kst") return false;
  if (!snapshot.dateKey || typeof snapshot.dateKey !== "string") return false;
  if (!isValidKstDateKey(snapshot.dateKey)) return false;
  if (!Number.isFinite(snapshot.usdToKrw) || snapshot.usdToKrw <= 0) return false;
  if (!Number.isFinite(snapshot.effectiveKrwPerUsd) || snapshot.effectiveKrwPerUsd <= 0) return false;
  if (!Number.isFinite(snapshot.overseasFeeRate) || snapshot.overseasFeeRate < 0) return false;
  if (!ratesApproximatelyEqual(snapshot.overseasFeeRate, OVERSEAS_CARD_FEE_PERCENT)) {
    return false;
  }
  const expectedEffective = applyOverseasCardFee(snapshot.usdToKrw);
  if (!ratesApproximatelyEqual(snapshot.effectiveKrwPerUsd, expectedEffective)) {
    return false;
  }
  switch (snapshot.source) {
    case "api_daily":
    case "previous_daily_snapshot":
    case "emergency_fallback":
      break;
    default:
      return false;
  }
  if (opts?.requireLocked === true && snapshot.locked !== true) {
    return false;
  }
  return true;
}

/** Live-grade Published charge validation — locked snapshot with fee coherence. */
export function validateBillingFxSnapshotForLiveGrade(snapshot: BillingFxSnapshot): boolean {
  return validateBillingFxSnapshot(snapshot, { requireLocked: true });
}
