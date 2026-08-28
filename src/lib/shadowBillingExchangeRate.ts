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
import {
  EXCHANGE_RATE_FALLBACK_KRW,
  EXCHANGE_RATE_TTL_MS,
  getKstDateKey,
  resolveExchangeRateMode,
  type ExchangeRateMode,
} from "@/lib/exchangeRate";
import {
  countShadowBillingFxDailySnapshots,
  ensureShadowBillingFxTables,
  insertShadowBillingFxDailySnapshotIgnore,
  readLatestShadowBillingFxDailySnapshotBefore,
  readShadowBillingFxDailySnapshot,
  type ShadowBillingFxSource,
} from "@/lib/shadowBillingFxPersistence";

export type BillingFxSource = ShadowBillingFxSource;

export type ShadowBillingExchangeRateSnapshot = {
  mode: ExchangeRateMode;
  dateKey: string;
  usdToKrw: number;
  effectiveKrwPerUsd: number;
  source: BillingFxSource;
  overseasFeeRate: number;
};

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

function rowToSnapshot(row: {
  date_key: string;
  base_usd_krw: number;
  source: ShadowBillingFxSource;
}): ShadowBillingExchangeRateSnapshot {
  return {
    mode: resolveExchangeRateMode(),
    dateKey: row.date_key,
    usdToKrw: row.base_usd_krw,
    effectiveKrwPerUsd: applyOverseasCardFee(row.base_usd_krw),
    source: row.source,
    overseasFeeRate: OVERSEAS_CARD_FEE_PERCENT,
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
  const previous = readLatestShadowBillingFxDailySnapshotBefore(db, dateKey);
  if (previous && previous.base_usd_krw > 0) {
    return {
      baseUsdKrw: previous.base_usd_krw,
      source: "previous_daily_snapshot",
      fetchedAt: new Date().toISOString(),
    };
  }

  return {
    baseUsdKrw: EXCHANGE_RATE_FALLBACK_KRW,
    source: "emergency_fallback",
    fetchedAt: new Date().toISOString(),
  };
}

/** Sync shadow billing lock — persisted INSERT OR IGNORE, never same-day UPDATE. */
export function resolveShadowBillingExchangeRateSnapshot(
  now = resolveNow()
): ShadowBillingExchangeRateSnapshot {
  const dateKey = resolveDateKey(now);
  const db = getPersistenceDb();

  const existing = readShadowBillingFxDailySnapshot(db, dateKey);
  if (existing) return rowToSnapshot(existing);

  const candidate = buildInsertCandidate(dateKey);
  insertShadowBillingFxDailySnapshotIgnore(db, {
    dateKey,
    baseUsdKrw: candidate.baseUsdKrw,
    source: candidate.source,
    fetchedAt: candidate.fetchedAt,
  });

  const locked = readShadowBillingFxDailySnapshot(db, dateKey);
  if (!locked) {
    return {
      mode: resolveExchangeRateMode(),
      dateKey,
      usdToKrw: candidate.baseUsdKrw,
      effectiveKrwPerUsd: applyOverseasCardFee(candidate.baseUsdKrw),
      source: candidate.source,
      overseasFeeRate: OVERSEAS_CARD_FEE_PERCENT,
    };
  }
  return rowToSnapshot(locked);
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

export function primeShadowBillingFxResolution(): ShadowBillingExchangeRateSnapshot {
  schedulePrefetchIfNeeded(resolveDateKey());
  return resolveShadowBillingExchangeRateSnapshot();
}

export function getShadowBillingFxCacheStatus() {
  const snapshot = resolveShadowBillingExchangeRateSnapshot();
  return {
    mode: snapshot.mode,
    dateKey: snapshot.dateKey,
    usdToKrw: snapshot.usdToKrw,
    effectiveKrwPerUsd: snapshot.effectiveKrwPerUsd,
    source: snapshot.source,
    overseasFeeRate: snapshot.overseasFeeRate,
    prefetchedCandidateDateKey: prefetchedCandidate?.dateKey ?? null,
    prefetchedCandidateUsdToKrw: prefetchedCandidate?.usdToKrw ?? null,
    persistedRowCount: countShadowBillingFxDailySnapshots(getPersistenceDb(), snapshot.dateKey),
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

export { EXCHANGE_RATE_TTL_MS };
