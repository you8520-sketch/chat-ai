/**
 * Official provider promotion persistence owner (admin-entered events).
 */

import { getDb } from "@/lib/db";
import { ensureSitePromotionSchema } from "@/lib/sitePromotionSchema";

export type OfficialProviderPromotion = {
  id: number;
  provider: string;
  modelId: string | null;
  modelFamily: string | null;
  officialDiscountPct: number;
  officialStart: string;
  officialEnd: string;
  source: string;
  provenance: string;
  verifiedAt: string | null;
  verifiedBy: string | null;
  status: "active" | "ended" | "cancelled";
  episodeKey: string;
  createdAt: string;
};

export type CreateOfficialProviderPromotionInput = {
  provider: string;
  modelId?: string | null;
  modelFamily?: string | null;
  officialDiscountPct: number;
  officialStart: string;
  officialEnd: string;
  source?: string;
  provenance?: string;
  verifiedAt?: string | null;
  verifiedBy?: string | null;
  episodeKey?: string;
};

function normalizeModelId(modelId: string | null | undefined): string | null {
  const trimmed = modelId?.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

function rowToPromotion(row: Record<string, unknown>): OfficialProviderPromotion {
  return {
    id: Number(row.id),
    provider: String(row.provider),
    modelId: row.model_id ? String(row.model_id) : null,
    modelFamily: row.model_family ? String(row.model_family) : null,
    officialDiscountPct: Number(row.official_discount_pct),
    officialStart: String(row.official_start),
    officialEnd: String(row.official_end),
    source: String(row.source ?? ""),
    provenance: String(row.provenance ?? ""),
    verifiedAt: row.verified_at ? String(row.verified_at) : null,
    verifiedBy: row.verified_by ? String(row.verified_by) : null,
    status: String(row.status) as OfficialProviderPromotion["status"],
    episodeKey: String(row.episode_key ?? ""),
    createdAt: String(row.created_at),
  };
}

export function createOfficialProviderPromotion(
  input: CreateOfficialProviderPromotionInput
): OfficialProviderPromotion {
  const db = getDb();
  ensureSitePromotionSchema(db);
  const modelId = normalizeModelId(input.modelId);
  const episodeKey =
    input.episodeKey?.trim() ||
    `${input.provider}:${modelId ?? input.modelFamily ?? "all"}:${input.officialStart}`;
  const result = db
    .prepare(
      `INSERT INTO official_provider_promotions
         (provider, model_id, model_family, official_discount_pct, official_start, official_end,
          source, provenance, verified_at, verified_by, status, episode_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`
    )
    .run(
      input.provider.trim(),
      modelId,
      input.modelFamily?.trim() || null,
      input.officialDiscountPct,
      input.officialStart,
      input.officialEnd,
      input.source?.trim() ?? "",
      input.provenance?.trim() ?? "",
      input.verifiedAt ?? null,
      input.verifiedBy ?? null,
      episodeKey
    );
  const row = db
    .prepare("SELECT * FROM official_provider_promotions WHERE id = ?")
    .get(Number(result.lastInsertRowid)) as Record<string, unknown>;
  return rowToPromotion(row);
}

export function getOfficialProviderPromotion(id: number): OfficialProviderPromotion | null {
  const db = getDb();
  ensureSitePromotionSchema(db);
  const row = db
    .prepare("SELECT * FROM official_provider_promotions WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined;
  return row ? rowToPromotion(row) : null;
}

export function updateOfficialProviderPromotionDiscount(
  id: number,
  officialDiscountPct: number
): OfficialProviderPromotion | null {
  const db = getDb();
  ensureSitePromotionSchema(db);
  db.prepare(
    "UPDATE official_provider_promotions SET official_discount_pct = ? WHERE id = ? AND status = 'active'"
  ).run(officialDiscountPct, id);
  return getOfficialProviderPromotion(id);
}

/** Active verified official promotions for a model at a point in time. */
export function listActiveOfficialPromotionsForModel(
  modelId: string,
  nowIso = new Date().toISOString()
): OfficialProviderPromotion[] {
  const db = getDb();
  ensureSitePromotionSchema(db);
  const normalized = normalizeModelId(modelId) ?? modelId.trim().toLowerCase();
  const rows = db
    .prepare(
      `SELECT * FROM official_provider_promotions
       WHERE status = 'active'
         AND official_start <= ?
         AND official_end > ?
         AND (model_id IS NULL OR lower(model_id) = ?)
       ORDER BY id DESC`
    )
    .all(nowIso, nowIso, normalized) as Record<string, unknown>[];
  return rows.map(rowToPromotion);
}
