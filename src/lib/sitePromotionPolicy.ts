/**
 * Canonical site-promotion policy owner.
 * official provider discount → site user discount (single rounding rule).
 */

export const SITE_PROMOTION_PASS_THROUGH_RATIO = 0.6;
export const SITE_PROMOTION_MAX_CAMPAIGN_DAYS = 7;

export function computeSiteDiscountPercent(officialProviderDiscountPct: number): number {
  const official = Math.max(0, Math.min(100, officialProviderDiscountPct));
  return Math.round(official * SITE_PROMOTION_PASS_THROUGH_RATIO * 10) / 10;
}

export function roundPromotionPoints(n: number): number {
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
  const discountPoints = roundPromotionPoints((base * pct) / 100);
  const finalChargePoints = Math.max(0, base - discountPoints);
  return {
    baseUserChargePoints: base,
    siteDiscountPercent: pct,
    siteDiscountPoints: discountPoints,
    finalChargePoints,
  };
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
