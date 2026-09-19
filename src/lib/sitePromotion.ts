/**
 * Canonical site-promotion owner — eligibility, campaign persistence, charge-time resolution.
 * CheaperInference catalog discount is NEVER a site promotion signal.
 */

import { getDb } from "@/lib/db";
import {
  computeSiteCampaignEndsAt,
  computeSiteDiscountPercent,
} from "@/lib/sitePromotionPolicy";
import { ensureSitePromotionSchema } from "@/lib/sitePromotionSchema";

type VerifiedOfficialPromotion = {
  id: number;
  provider: string;
  modelId: string;
  officialDiscountPct: number;
  officialStart: string;
  officialEnd: string;
  episodeKey: string;
  source: string;
  provenance: string;
  verifiedAt: string;
};

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

/** Explicit activation writer — sets campaign timer at activation time (never on billing read). */
export function activateSitePromotionCampaign(
  official: VerifiedOfficialPromotion,
  modelId: string,
  activatedAtIso = new Date().toISOString()
): SitePromotionCampaign {
  const db = getDb();
  ensureSitePromotionSchema(db);
  const normalizedModelId = modelId.trim().toLowerCase();
  if (!normalizedModelId) {
    throw new Error("site promotion activation requires exact model_id");
  }
  if (!official.verifiedAt?.trim()) {
    throw new Error("site promotion activation requires verified official promotion");
  }

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

  const endsAt = computeSiteCampaignEndsAt(
    activatedAtIso,
    official.officialEnd,
    Date.parse(activatedAtIso)
  );
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
      activatedAtIso,
      endsAt,
      episodeKey
    );
  const row = db
    .prepare("SELECT * FROM site_promotion_campaigns WHERE id = ?")
    .get(Number(result.lastInsertRowid)) as Record<string, unknown>;
  return rowToCampaign(row);
}

function rowToVerifiedOfficial(row: Record<string, unknown>): VerifiedOfficialPromotion {
  return {
    id: Number(row.official_promotion_id ?? row.id),
    provider: String(row.provider),
    modelId: String(row.model_id),
    officialDiscountPct: Number(row.official_discount_pct),
    officialStart: String(row.official_start),
    officialEnd: String(row.official_end),
    episodeKey: String(row.episode_key),
    source: String(row.source ?? ""),
    provenance: String(row.provenance ?? ""),
    verifiedAt: String(row.verified_at),
  };
}

function findActiveCampaignForModel(
  modelId: string,
  nowIso: string
): { campaign: SitePromotionCampaign; official: VerifiedOfficialPromotion } | null {
  const db = getDb();
  ensureSitePromotionSchema(db);
  const normalizedModelId = modelId.trim().toLowerCase();
  if (!normalizedModelId) return null;

  const row = db
    .prepare(
      `SELECT c.*, o.provider, o.official_discount_pct, o.official_start, o.official_end, o.source,
              o.provenance, o.verified_at, o.episode_key
       FROM site_promotion_campaigns c
       JOIN official_provider_promotions o ON o.id = c.official_promotion_id
       WHERE lower(c.model_id) = ?
         AND o.status = 'active'
         AND o.verified_at IS NOT NULL
         AND o.official_start <= ?
         AND o.official_end > ?
         AND c.activated_at <= ?
         AND c.ends_at > ?
       ORDER BY c.id DESC
       LIMIT 1`
    )
    .get(normalizedModelId, nowIso, nowIso, nowIso, nowIso) as
    | Record<string, unknown>
    | undefined;

  if (!row || !row.verified_at) return null;

  return {
    campaign: rowToCampaign(row),
    official: rowToVerifiedOfficial(row),
  };
}

/** Pure read: resolve active site promotion for billing/UI from persisted campaigns only. */
export function resolveActiveSitePromotion(
  modelId: string,
  nowIso = new Date().toISOString()
): ActiveSitePromotion | null {
  const match = findActiveCampaignForModel(modelId, nowIso);
  if (!match) return null;

  const { campaign, official } = match;
  const nowMs = Date.parse(nowIso);
  const endsMs = Date.parse(campaign.endsAt);
  if (!Number.isFinite(endsMs) || nowMs >= endsMs) return null;

  return {
    campaignId: campaign.id,
    officialPromotionId: official.id,
    modelId: campaign.modelId,
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

export type SitePromotionClientView = {
  modelId: string;
  siteDiscountPercent: number;
  endsAt: string;
  title: string;
  subtitle: string;
  detailLine: string;
  badge: string;
};

function formatPromotionEndsDate(endsAtIso: string): string {
  return endsAtIso.slice(0, 10).replace(/-/g, ".");
}

/** UI copy for promotion badge/banner — reads canonical site promotion only. */
export function formatSitePromotionUserLabel(
  promo: ActiveSitePromotion,
  modelDisplayName?: string
): Pick<SitePromotionClientView, "title" | "subtitle" | "detailLine" | "badge"> {
  const pct = Math.round(promo.siteDiscountPercent);
  const endsDate = formatPromotionEndsDate(promo.endsAt);
  const label = modelDisplayName?.trim() || promo.provider;
  return {
    title: `${label} 기간 한정 모델 할인`,
    subtitle: `공식 프로모션 반영으로 7일간 모델 이용료 ${pct}% 할인`,
    detailLine: `자동 적용 · ${endsDate}까지`,
    badge: `-${pct}%`,
  };
}

export function toSitePromotionClientView(
  promo: ActiveSitePromotion,
  modelDisplayName?: string
): SitePromotionClientView {
  const copy = formatSitePromotionUserLabel(promo, modelDisplayName);
  return {
    modelId: promo.modelId,
    siteDiscountPercent: promo.siteDiscountPercent,
    endsAt: promo.endsAt,
    ...copy,
  };
}

/** Resolve active site promotions for model picker / chat notice surfaces. */
export function resolveActiveSitePromotionsForModels(
  modelIds: readonly string[],
  nowIso = new Date().toISOString()
): SitePromotionClientView[] {
  const seen = new Set<string>();
  const results: SitePromotionClientView[] = [];
  for (const modelId of modelIds) {
    const normalized = modelId.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    const promo = resolveActiveSitePromotion(normalized, nowIso);
    if (!promo) continue;
    results.push(toSitePromotionClientView(promo));
  }
  return results;
}
