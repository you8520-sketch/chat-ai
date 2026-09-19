/**
 * Canonical site-promotion policy owner.
 * official provider discount → site user discount (single rounding rule).
 */

export const SITE_PROMOTION_PASS_THROUGH_RATIO = 0.6;
export const SITE_PROMOTION_MAX_CAMPAIGN_DAYS = 7;

/** Raw pass-through before user-facing 10% step rounding. */
export function computeRawSiteDiscountPercent(officialProviderDiscountPct: number): number {
  const official = Math.max(0, Math.min(100, officialProviderDiscountPct));
  return official * SITE_PROMOTION_PASS_THROUGH_RATIO;
}

/** Canonical site user discount — nearest 10% of raw (official × 0.6). */
export function computeSiteDiscountPercent(officialProviderDiscountPct: number): number {
  const raw = computeRawSiteDiscountPercent(officialProviderDiscountPct);
  const nearestTen = Math.round(raw / 10) * 10;
  return Math.max(0, Math.min(100, nearestTen));
}

function ceilChargePoints(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Number.isInteger(n) ? n : Math.ceil(n - 1e-9);
}

export type SitePromotionChargeAdjustment = {
  baseUserChargePoints: number;
  siteDiscountPercent: number;
  siteDiscountPoints: number;
  finalChargePoints: number;
};

/** Apply site promotion discount exactly once on base user charge. */
export function applySitePromotionToCharge(
  baseUserChargePoints: number,
  siteDiscountPercent: number
): SitePromotionChargeAdjustment {
  const base = Math.max(0, baseUserChargePoints);
  const pct = Math.max(0, Math.min(100, siteDiscountPercent));
  if (base <= 0 || pct <= 0) {
    return {
      baseUserChargePoints: base,
      siteDiscountPercent: 0,
      siteDiscountPoints: 0,
      finalChargePoints: base,
    };
  }
  const finalChargePoints = ceilChargePoints(base * (1 - pct / 100));
  const siteDiscountPoints = Math.max(0, base - finalChargePoints);
  return {
    baseUserChargePoints: base,
    siteDiscountPercent: pct,
    siteDiscountPoints,
    finalChargePoints,
  };
}

export function resolveSiteCampaignActivatedAt(
  verifiedAtIso: string,
  officialStartIso: string
): string {
  const verifiedMs = Date.parse(verifiedAtIso);
  const startMs = Date.parse(officialStartIso);
  const activatedMs = Math.max(
    Number.isFinite(verifiedMs) ? verifiedMs : 0,
    Number.isFinite(startMs) ? startMs : 0
  );
  return new Date(activatedMs).toISOString();
}

export function computeSiteCampaignEndsAt(
  activatedAtIso: string,
  officialEndsAtIso: string,
  nowMs = Date.now()
): string {
  const activatedMs = Date.parse(activatedAtIso);
  const officialEndMs = Date.parse(officialEndsAtIso);
  const maxCampaignMs = SITE_PROMOTION_MAX_CAMPAIGN_DAYS * 24 * 60 * 60 * 1000;
  const campaignCapMs = Number.isFinite(activatedMs)
    ? activatedMs + maxCampaignMs
    : nowMs + maxCampaignMs;
  const officialEnd = Number.isFinite(officialEndMs) ? officialEndMs : campaignCapMs;
  const endsMs = Math.min(campaignCapMs, officialEnd);
  return new Date(endsMs).toISOString();
}
