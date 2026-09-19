/**
 * Canonical site-promotion owner — eligibility, campaign persistence, charge-time resolution.
 * CheaperInference catalog discount is NEVER a site promotion signal.
 */

import { getDb } from "@/lib/db";
import {
  listActiveOfficialPromotionsForModel,
  type OfficialProviderPromotion,
} from "@/lib/officialProviderPromotion";
import {
  computeSiteCampaignEndsAt,
  computeSiteDiscountPercent,
} from "@/lib/sitePromotionPolicy";
import { ensureSitePromotionSchema } from "@/lib/sitePromotionSchema";

export type SitePromotionCampaign = {
  id: number;
  officialPromotionId: number;
  modelId: string;
  siteDiscountPercent: number;
  activatedAt: string;
  endsAt: string;
  episodeKey: string;
  createdAt: string;
};

export type ActiveSitePromotion = {
  campaignId: number;
  officialPromotionId: number;
  modelId: string;
  siteDiscountPercent: number;
  activatedAt: string;
  endsAt: string;
  episodeKey: string;
  provider: string;
  officialDiscountPercent: number;
  source: string;
  provenance: string;
  verifiedAt: string | null;
};

export type SitePromotionSnapshot = {
  baseUserChargePoints: number;
  siteDiscountPercent: number;
  siteDiscountPoints: number;
  finalChargePoints: number;
  campaignId: number;
  officialPromotionId: number;
  episodeKey: string;
  provider: string;
  source: string;
  provenance: string;
  appliedAt: string;
};

function rowToCampaign(row: Record<string, unknown>): SitePromotionCampaign {
  return {
    id: Number(row.id),
    officialPromotionId: Number(row.official_promotion_id),
    modelId: String(row.model_id),
    siteDiscountPercent: Number(row.site_discount_pct),
    activatedAt: String(row.activated_at),
    endsAt: String(row.ends_at),
    episodeKey: String(row.episode_key),
    createdAt: String(row.created_at),
  };
}

function findCampaignByEpisode(
  episodeKey: string,
  modelId: string
): SitePromotionCampaign | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT * FROM site_promotion_campaigns
       WHERE episode_key = ? AND lower(model_id) = ?
       LIMIT 1`
    )
    .get(episodeKey, modelId.trim().toLowerCase()) as Record<string, unknown> | undefined;
  return row ? rowToCampaign(row) : null;
}

function upsertCampaignForOfficialPromotion(
  official: OfficialProviderPromotion,
  modelId: string,
  nowIso: string
): SitePromotionCampaign {
  const db = getDb();
  const normalizedModelId = modelId.trim().toLowerCase();
  const episodeKey = official.episodeKey;
  const existing = findCampaignByEpisode(episodeKey, normalizedModelId);
  const siteDiscountPercent = computeSiteDiscountPercent(official.officialDiscountPct);

  if (existing) {
    db.prepare(
      "UPDATE site_promotion_campaigns SET site_discount_pct = ? WHERE id = ?"
    ).run(siteDiscountPercent, existing.id);
    return {
      ...existing,
      siteDiscountPercent,
    };
  }

  const activatedAt = nowIso;
  const endsAt = computeSiteCampaignEndsAt(activatedAt, official.officialEnd, Date.parse(nowIso));
  const result = db
    .prepare(
      `INSERT INTO site_promotion_campaigns
         (official_promotion_id, model_id, site_discount_pct, activated_at, ends_at, episode_key)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      official.id,
      normalizedModelId,
      siteDiscountPercent,
      activatedAt,
      endsAt,
      episodeKey
    );
  const row = db
    .prepare("SELECT * FROM site_promotion_campaigns WHERE id = ?")
    .get(Number(result.lastInsertRowid)) as Record<string, unknown>;
  return rowToCampaign(row);
}

/** Resolve active site promotion for billing/UI — restart-safe via DB campaigns. */
export function resolveActiveSitePromotion(
  modelId: string,
  nowIso = new Date().toISOString()
): ActiveSitePromotion | null {
  const db = getDb();
  ensureSitePromotionSchema(db);
  const normalizedModelId = modelId.trim().toLowerCase();
  if (!normalizedModelId) return null;

  const officialPromos = listActiveOfficialPromotionsForModel(normalizedModelId, nowIso);
  if (officialPromos.length === 0) return null;

  const official = officialPromos[0];
  const campaign = upsertCampaignForOfficialPromotion(official, normalizedModelId, nowIso);

  const nowMs = Date.parse(nowIso);
  const endsMs = Date.parse(campaign.endsAt);
  if (!Number.isFinite(endsMs) || nowMs >= endsMs) return null;

  return {
    campaignId: campaign.id,
    officialPromotionId: official.id,
    modelId: normalizedModelId,
    siteDiscountPercent: campaign.siteDiscountPercent,
    activatedAt: campaign.activatedAt,
    endsAt: campaign.endsAt,
    episodeKey: campaign.episodeKey,
    provider: official.provider,
    officialDiscountPercent: official.officialDiscountPct,
    source: official.source,
    provenance: official.provenance,
    verifiedAt: official.verifiedAt,
  };
}

export function buildSitePromotionSnapshot(
  adjustment: {
    baseUserChargePoints: number;
    siteDiscountPercent: number;
    siteDiscountPoints: number;
    finalChargePoints: number;
  },
  promo: ActiveSitePromotion,
  appliedAt = new Date().toISOString()
): SitePromotionSnapshot {
  return {
    baseUserChargePoints: adjustment.baseUserChargePoints,
    siteDiscountPercent: adjustment.siteDiscountPercent,
    siteDiscountPoints: adjustment.siteDiscountPoints,
    finalChargePoints: adjustment.finalChargePoints,
    campaignId: promo.campaignId,
    officialPromotionId: promo.officialPromotionId,
    episodeKey: promo.episodeKey,
    provider: promo.provider,
    source: promo.source,
    provenance: promo.provenance,
    appliedAt,
  };
}

/** UI copy for promotion badge/banner — reads canonical site promotion only. */
export function formatSitePromotionUserLabel(promo: ActiveSitePromotion): {
  title: string;
  subtitle: string;
  badge: string;
} {
  const endsDate = promo.endsAt.slice(0, 10).replace(/-/g, ".");
  const verified = promo.verifiedAt != null && promo.verifiedAt.length > 0;
  const providerLabel = promo.provider.charAt(0).toUpperCase() + promo.provider.slice(1);
  return {
    title: verified
      ? `${providerLabel} 기간 한정 모델 할인`
      : `${providerLabel} 모델 할인`,
    subtitle: `${Math.round(promo.siteDiscountPercent)}% 할인 · 자동 적용 · ${endsDate}까지`,
    badge: `-${Math.round(promo.siteDiscountPercent)}%`,
  };
}
