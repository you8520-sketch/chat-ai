import type Database from "better-sqlite3";

export type ShadowBillingFxSource = "api_daily" | "previous_daily_snapshot" | "emergency_fallback";

export type ShadowBillingFxDailyRow = {
  date_key: string;
  base_usd_krw: number;
  source: ShadowBillingFxSource;
  fetched_at: string;
  created_at: string;
};

export function ensureShadowBillingFxTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS billing_fx_daily_snapshots (
      date_key TEXT PRIMARY KEY,
      base_usd_krw REAL NOT NULL,
      source TEXT NOT NULL CHECK(source IN ('api_daily', 'previous_daily_snapshot', 'emergency_fallback')),
      fetched_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

export function readShadowBillingFxDailySnapshot(
  db: Database.Database,
  dateKey: string
): ShadowBillingFxDailyRow | null {
  const row = db
    .prepare(
      `SELECT date_key, base_usd_krw, source, fetched_at, created_at
       FROM billing_fx_daily_snapshots
       WHERE date_key = ?`
    )
    .get(dateKey) as ShadowBillingFxDailyRow | undefined;
  return row ?? null;
}

export function readLatestShadowBillingFxDailySnapshotBefore(
  db: Database.Database,
  dateKey: string
): ShadowBillingFxDailyRow | null {
  const row = db
    .prepare(
      `SELECT date_key, base_usd_krw, source, fetched_at, created_at
       FROM billing_fx_daily_snapshots
       WHERE date_key < ?
       ORDER BY date_key DESC
       LIMIT 1`
    )
    .get(dateKey) as ShadowBillingFxDailyRow | undefined;
  return row ?? null;
}

/** INSERT OR IGNORE — returns true when this caller created the row. */
export function insertShadowBillingFxDailySnapshotIgnore(
  db: Database.Database,
  row: {
    dateKey: string;
    baseUsdKrw: number;
    source: ShadowBillingFxSource;
    fetchedAt: string;
  }
): boolean {
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO billing_fx_daily_snapshots
       (date_key, base_usd_krw, source, fetched_at)
       VALUES (?, ?, ?, ?)`
    )
    .run(row.dateKey, row.baseUsdKrw, row.source, row.fetchedAt);
  return result.changes === 1;
}

export function countShadowBillingFxDailySnapshots(db: Database.Database, dateKey: string): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS c FROM billing_fx_daily_snapshots WHERE date_key = ?`)
    .get(dateKey) as { c: number };
  return row.c;
}
