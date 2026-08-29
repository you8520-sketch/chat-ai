/**
 * Canonical Published user-charge rounding — pure helpers with no legacy FX dependencies.
 */

export const PUBLISHED_CHARGE_ROUNDING_POLICY_VERSION = "published_points_v1" as const;

/** Round KRW amounts to one decimal place (0.1 KRW precision). */
export function roundKrwTenths(krw: number): number {
  if (!Number.isFinite(krw)) return NaN;
  return Math.round(krw * 10) / 10;
}

/** Ceil to integer Published charge points at the final boundary. */
export function ceilPublishedChargePoints(krw: number): number {
  if (!Number.isFinite(krw) || krw <= 0) return 0;
  return Math.ceil(krw - 1e-9);
}

/** Pure USD→KRW conversion using an explicit effective rate (no legacy module). */
export function convertUsdToKrwPure(usd: number, effectiveKrwPerUsd: number): number {
  return usd * effectiveKrwPerUsd;
}
