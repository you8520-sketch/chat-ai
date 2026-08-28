/**
 * Shadow billing FX owner — daily KST immutable snapshots persisted in SQLite.
 * Does NOT affect legacy production billing (points.ts / exchangeRate.ts).
 */

import "server-only";

import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";
import {
  OVERSEAS_CARD_FEE_PERCENT,
  applyOverseasCardFee,
} from "@/lib/billingFxPolicy";
import { getKstDateKey } from "@/lib/exchangeRate";
import {
  countShadowBillingFxDailySnapshots,
  ensureShadowBillingFxTables,
  insertShadowBillingFxDailySnapshotIgnore,
  readLatestNonEmergencyShadowBillingFxSnapshotBefore,
  readShadowBillingFxDailySnapshot,
  type ShadowBillingFxSource,
} from "@/lib/shadowBillingFxPersistence";

export type BillingFxSource = ShadowBillingFxSource;

export const SHADOW_BILLING_FX_MODE = "daily_kst" as const;
export const SHADOW_BILLING_EMERGENCY_FX_KRW = 1500;

export type ShadowBillingExchangeRateSnapshot = {
  mode: typeof SHADOW_BILLING_FX_MODE;
  dateKey: string;
  usdToKrw: number;
  effectiveKrwPerUsd: number;
  source: BillingFxSource;
  overseasFeeRate: number;
  locked: boolean;
};

export class ShadowBillingFxPersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShadowBillingFxPersistenceError";
  }
}

type PrefetchedCandidate = {
  dateKey: string;
  usdToKrw: number;
  fetchedAt: number;
};

const EXCHANGE_API_URL = "https://open.er-api.com/v6/latest/USD";
const FETCH_TIMEOUT_MS = 8000;

let prefetchedCandidate: PrefetchedCandidate | null = null;
let refreshPromise: Promise<void> | null = null;
let testDbOverride: Database.Database | null = null;
let testNowOverride: number | null = null;

function resolveNow(): number {
  return testNowOverride ?? Date.now();
}

function resolveDateKey(now = resolveNow()): string {
  return getKstDateKey(now);
}

function getPersistenceDb(): Database.Database {
  const db = testDbOverride ?? getDb();
  ensureShadowBillingFxTables(db);
  return db;
}

export function normalizeBillingFxSource(
  source: BillingFxSource | "api" | "fallback"
): BillingFxSource {
  switch (source) {
    case "api_daily":
    case "previous_daily_snapshot":
    case "emergency_fallback":
      return source;
    case "api":
      return "api_daily";
    case "fallback":
      return "emergency_fallback";
    default: {
      const _exhaustive: never = source;
      return _exhaustive;
    }
  }
}

async function fetchUsdToKrwFromApi(): Promise<number> {
  const res = await fetch(EXCHANGE_API_URL, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Exchange API HTTP ${res.status}`);
  const data = (await res.json()) as { rates?: { KRW?: number } };
  const krw = data?.rates?.KRW;
  if (typeof krw !== "number" || !Number.isFinite(krw) || krw <= 0) {
    throw new Error("Exchange API: invalid KRW rate");
  }
  return krw;
}

function rowToSnapshot(
  row: {
    date_key: string;
    base_usd_krw: number;
    source: ShadowBillingFxSource;
  },
  locked: boolean
): ShadowBillingExchangeRateSnapshot {
  return {
    mode: SHADOW_BILLING_FX_MODE,
    dateKey: row.date_key,
    usdToKrw: row.base_usd_krw,
    effectiveKrwPerUsd: applyOverseasCardFee(row.base_usd_krw),
    source: row.source,
    overseasFeeRate: OVERSEAS_CARD_FEE_PERCENT,
    locked,
  };
}

function candidateSourceForDate(dateKey: string): BillingFxSource | null {
  if (prefetchedCandidate?.dateKey === dateKey && prefetchedCandidate.usdToKrw > 0) {
    return "api_daily";
  }
  return null;
}

function buildInsertCandidate(dateKey: string): {
  baseUsdKrw: number;
  source: BillingFxSource;
  fetchedAt: string;
} {
  const freshSource = candidateSourceForDate(dateKey);
  if (freshSource === "api_daily" && prefetchedCandidate) {
    return {
      baseUsdKrw: prefetchedCandidate.usdToKrw,
      source: "api_daily",
      fetchedAt: new Date(prefetchedCandidate.fetchedAt).toISOString(),
    };
  }

  const db = getPersistenceDb();
  const previous = readLatestNonEmergencyShadowBillingFxSnapshotBefore(db, dateKey);
  if (previous && previous.base_usd_krw > 0) {
    return {
      baseUsdKrw: previous.base_usd_krw,
      source: "previous_daily_snapshot",
      fetchedAt: previous.fetched_at,
    };
  }

  return {
    baseUsdKrw: SHADOW_BILLING_EMERGENCY_FX_KRW,
    source: "emergency_fallback",
    fetchedAt: new Date().toISOString(),
  };
}

/** Read-only: return today's persisted daily row if locked, else null. */
export function peekShadowBillingFxDailySnapshot(
  now = resolveNow()
): ShadowBillingExchangeRateSnapshot | null {
  const dateKey = resolveDateKey(now);
  const existing = readShadowBillingFxDailySnapshot(getPersistenceDb(), dateKey);
  if (!existing) return null;
  return rowToSnapshot(existing, true);
}

/** Read-only preview — never INSERT. */
export function previewShadowBillingFxSnapshot(
  now = resolveNow()
): ShadowBillingExchangeRateSnapshot {
  const dateKey = resolveDateKey(now);
  const persisted = peekShadowBillingFxDailySnapshot(now);
  if (persisted) return persisted;

  const freshSource = candidateSourceForDate(dateKey);
  if (freshSource === "api_daily" && prefetchedCandidate) {
    return {
      mode: SHADOW_BILLING_FX_MODE,
      dateKey,
      usdToKrw: prefetchedCandidate.usdToKrw,
      effectiveKrwPerUsd: applyOverseasCardFee(prefetchedCandidate.usdToKrw),
      source: "api_daily",
      overseasFeeRate: OVERSEAS_CARD_FEE_PERCENT,
      locked: false,
    };
  }

  const db = getPersistenceDb();
  const previous = readLatestNonEmergencyShadowBillingFxSnapshotBefore(db, dateKey);
  if (previous && previous.base_usd_krw > 0) {
    return {
      mode: SHADOW_BILLING_FX_MODE,
      dateKey,
      usdToKrw: previous.base_usd_krw,
      effectiveKrwPerUsd: applyOverseasCardFee(previous.base_usd_krw),
      source: "previous_daily_snapshot",
      overseasFeeRate: OVERSEAS_CARD_FEE_PERCENT,
      locked: false,
    };
  }

  return {
    mode: SHADOW_BILLING_FX_MODE,
    dateKey,
    usdToKrw: SHADOW_BILLING_EMERGENCY_FX_KRW,
    effectiveKrwPerUsd: applyOverseasCardFee(SHADOW_BILLING_EMERGENCY_FX_KRW),
    source: "emergency_fallback",
    overseasFeeRate: OVERSEAS_CARD_FEE_PERCENT,
    locked: false,
  };
}

/** Sync shadow billing lock — persisted INSERT OR IGNORE, never same-day UPDATE. */
export function resolveShadowBillingExchangeRateSnapshot(
  now = resolveNow()
): ShadowBillingExchangeRateSnapshot {
  const dateKey = resolveDateKey(now);
  const db = getPersistenceDb();

  const existing = readShadowBillingFxDailySnapshot(db, dateKey);
  if (existing) return rowToSnapshot(existing, true);

  const candidate = buildInsertCandidate(dateKey);
  insertShadowBillingFxDailySnapshotIgnore(db, {
    dateKey,
    baseUsdKrw: candidate.baseUsdKrw,
    source: candidate.source,
    fetchedAt: candidate.fetchedAt,
  });

  const locked = readShadowBillingFxDailySnapshot(db, dateKey);
  if (!locked) {
    throw new ShadowBillingFxPersistenceError(
      `Failed to persist shadow billing FX daily snapshot for ${dateKey}`
    );
  }
  return rowToSnapshot(locked, true);
}

async function prefetchFreshCandidate(dateKey: string): Promise<void> {
  try {
    const usdToKrw = await fetchUsdToKrwFromApi();
    prefetchedCandidate = { dateKey, usdToKrw, fetchedAt: Date.now() };
  } catch (err) {
    console.warn("[shadowBillingFx] prefetch failed — candidate unchanged", (err as Error).message);
  }
}

function schedulePrefetchIfNeeded(dateKey: string): void {
  if (refreshPromise) return;
  if (prefetchedCandidate?.dateKey === dateKey) return;
  refreshPromise = prefetchFreshCandidate(dateKey).finally(() => {
    refreshPromise = null;
  });
}

/** Prefetch only — never creates persisted daily billing rows. */
export function warmShadowBillingFxPrefetch(): void {
  schedulePrefetchIfNeeded(resolveDateKey());
}

export function getShadowBillingFxCacheStatus(now = resolveNow()) {
  const dateKey = resolveDateKey(now);
  const db = getPersistenceDb();
  const persisted = readShadowBillingFxDailySnapshot(db, dateKey);
  const preview = previewShadowBillingFxSnapshot(now);
  return {
    mode: SHADOW_BILLING_FX_MODE,
    dateKey,
    locked: persisted != null,
    usdToKrw: persisted?.base_usd_krw ?? preview.usdToKrw,
    effectiveKrwPerUsd: persisted
      ? applyOverseasCardFee(persisted.base_usd_krw)
      : preview.effectiveKrwPerUsd,
    source: persisted?.source ?? preview.source,
    overseasFeeRate: OVERSEAS_CARD_FEE_PERCENT,
    prefetchedCandidateDateKey: prefetchedCandidate?.dateKey ?? null,
    prefetchedCandidateUsdToKrw: prefetchedCandidate?.usdToKrw ?? null,
    persistedRowCount: countShadowBillingFxDailySnapshots(db, dateKey),
    previewLocked: preview.locked,
  };
}

// Test injection
export function _setShadowBillingFxTestDb(db: Database.Database | null): void {
  testDbOverride = db;
}

export function _setShadowBillingFxKstNowForTest(now: number | null): void {
  testNowOverride = now;
}

export function _setShadowBillingFxPrefetchedCandidateForTest(opts: {
  dateKey: string;
  usdToKrw: number;
}): void {
  prefetchedCandidate = { dateKey: opts.dateKey, usdToKrw: opts.usdToKrw, fetchedAt: Date.now() };
}

export function _simulateShadowBillingFxBackgroundFetchForTest(opts: {
  dateKey: string;
  usdToKrw: number;
}): void {
  prefetchedCandidate = { dateKey: opts.dateKey, usdToKrw: opts.usdToKrw, fetchedAt: Date.now() };
}

export function _clearShadowBillingFxMemoryForTest(): void {
  prefetchedCandidate = null;
  refreshPromise = null;
  testNowOverride = null;
}

export function _insertShadowBillingFxDailyRowForTest(row: {
  dateKey: string;
  baseUsdKrw: number;
  source: BillingFxSource;
  fetchedAt?: string;
}): void {
  const db = getPersistenceDb();
  insertShadowBillingFxDailySnapshotIgnore(db, {
    dateKey: row.dateKey,
    baseUsdKrw: row.baseUsdKrw,
    source: row.source,
    fetchedAt: row.fetchedAt ?? new Date().toISOString(),
  });
}
