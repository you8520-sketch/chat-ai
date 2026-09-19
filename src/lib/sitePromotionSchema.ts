/**
 * DB schema owner for official provider promotions and site promotion campaigns.
 */

import type Database from "better-sqlite3";

export const OFFICIAL_PROVIDER_PROMOTIONS_TABLE = "official_provider_promotions";
export const SITE_PROMOTION_CAMPAIGNS_TABLE = "site_promotion_campaigns";

export const OFFICIAL_PROVIDER_PROMOTIONS_DDL = `
  CREATE TABLE IF NOT EXISTS official_provider_promotions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    model_id TEXT,
    official_discount_pct REAL NOT NULL,
    official_start TEXT NOT NULL,
    official_end TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT '',
    provenance TEXT NOT NULL DEFAULT '',
    verified_at TEXT,
    verified_by TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    episode_key TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_official_provider_promotions_model
    ON official_provider_promotions(model_id, status, official_start, official_end);
`;

export const SITE_PROMOTION_CAMPAIGNS_DDL = `
  CREATE TABLE IF NOT EXISTS site_promotion_campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    official_promotion_id INTEGER NOT NULL,
    model_id TEXT NOT NULL,
    site_discount_pct REAL NOT NULL,
    activated_at TEXT NOT NULL,
    ends_at TEXT NOT NULL,
    episode_key TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(episode_key, model_id)
  );
  CREATE INDEX IF NOT EXISTS idx_site_promotion_campaigns_model
    ON site_promotion_campaigns(model_id, activated_at, ends_at);
`;

export function ensureSitePromotionSchema(
  db: Pick<Database.Database, "exec">
): void {
  db.exec(OFFICIAL_PROVIDER_PROMOTIONS_DDL);
  db.exec(SITE_PROMOTION_CAMPAIGNS_DDL);
}
