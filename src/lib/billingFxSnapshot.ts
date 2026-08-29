/**
 * Neutral FX snapshot contract — passed into the pure Published user-charge engine.
 * Persistence and resolution live in shadowBillingExchangeRate.ts.
 */

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

export function validateBillingFxSnapshot(snapshot: BillingFxSnapshot): boolean {
  if (snapshot.mode !== "daily_kst") return false;
  if (!snapshot.dateKey || typeof snapshot.dateKey !== "string") return false;
  if (!Number.isFinite(snapshot.usdToKrw) || snapshot.usdToKrw <= 0) return false;
  if (!Number.isFinite(snapshot.effectiveKrwPerUsd) || snapshot.effectiveKrwPerUsd <= 0) return false;
  if (!Number.isFinite(snapshot.overseasFeeRate) || snapshot.overseasFeeRate < 0) return false;
  switch (snapshot.source) {
    case "api_daily":
    case "previous_daily_snapshot":
    case "emergency_fallback":
      break;
    default:
      return false;
  }
  return true;
}
