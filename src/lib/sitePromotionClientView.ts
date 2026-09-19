/**
 * Client-safe site promotion view types and lifecycle helpers.
 * Badge/notice share one active check — no separate expiration logic.
 */

export type SitePromotionClientView = {
  modelId: string;
  siteDiscountPercent: number;
  endsAt: string;
  title: string;
  subtitle: string;
  detailLine: string;
  badge: string;
};

export function isSitePromotionClientViewActive(
  promo: SitePromotionClientView | null | undefined,
  nowMs = Date.now()
): promo is SitePromotionClientView {
  if (!promo) return false;
  const endsMs = Date.parse(promo.endsAt);
  return Number.isFinite(endsMs) && nowMs < endsMs;
}

export function buildActiveSitePromotionClientViewMap(
  promos: readonly SitePromotionClientView[],
  nowMs = Date.now()
): Record<string, SitePromotionClientView> {
  const map: Record<string, SitePromotionClientView> = {};
  for (const promo of promos) {
    if (!isSitePromotionClientViewActive(promo, nowMs)) continue;
    map[promo.modelId.trim().toLowerCase()] = promo;
  }
  return map;
}

/** Next endsAt among currently active client views — for one-shot expiry scheduling. */
export function nearestActiveSitePromotionExpiryMs(
  promos: readonly SitePromotionClientView[],
  nowMs = Date.now()
): number | null {
  let nearest: number | null = null;
  for (const promo of promos) {
    if (!isSitePromotionClientViewActive(promo, nowMs)) continue;
    const endsMs = Date.parse(promo.endsAt);
    if (!Number.isFinite(endsMs)) continue;
    if (nearest == null || endsMs < nearest) nearest = endsMs;
  }
  return nearest;
}
