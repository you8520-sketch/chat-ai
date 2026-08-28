/** 해외 결제 수수료 2% — canonical owner */
export const OVERSEAS_CARD_FEE_PERCENT = 0.02;
export const OVERSEAS_CARD_FEE_RATE = 1 + OVERSEAS_CARD_FEE_PERCENT;

export function applyOverseasCardFee(baseUsdKrw: number): number {
  return baseUsdKrw * (1 + OVERSEAS_CARD_FEE_PERCENT);
}

/** USD→KRW 메모리 캐시 TTL — 1시간 (realtime 모드·API 폴링) */
export const EXCHANGE_RATE_TTL_MS = 3600 * 1000;

/** API 장애 시 안전망 (안전 마진 포함) */
export const EXCHANGE_RATE_FALLBACK_KRW =
  Number(process.env.EXCHANGE_RATE_FALLBACK_KRW) || 1500;

/** daily_kst = KST 자정 기준 당일 고정 · realtime = 1시간 캐시 실시간 */
export type ExchangeRateMode = "daily_kst" | "realtime";

export type BillingFxSource = "api_daily" | "previous_daily_snapshot" | "emergency_fallback";

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

export function resolveExchangeRateMode(): ExchangeRateMode {
  const raw = (process.env.EXCHANGE_RATE_MODE ?? "daily_kst").trim().toLowerCase();
  return raw === "realtime" ? "realtime" : "daily_kst";
}

const EXCHANGE_API_URL = "https://open.er-api.com/v6/latest/USD";
const FETCH_TIMEOUT_MS = 8000;

type RateCache = {
  usdToKrw: number;
  fetchedAt: number;
  source: BillingFxSource;
};

type LockedDailyBillingSnapshot = {
  dateKey: string;
  usdToKrw: number;
  fetchedAt: number;
  source: BillingFxSource;
};

type PrefetchedCandidate = {
  dateKey: string;
  usdToKrw: number;
  fetchedAt: number;
};

export type BillingExchangeRateSnapshot = {
  mode: ExchangeRateMode;
  dateKey: string;
  usdToKrw: number;
  effectiveKrwPerUsd: number;
  /** Daily lock sources; legacy stored receipts may still carry api/fallback. */
  source: BillingFxSource | "api" | "fallback";
  overseasFeeRate?: number;
};

let memoryCache: RateCache | null = null;
/** Immutable billing lock for the current KST date — never mutated after first sync lock. */
let lockedDailyBillingSnapshot: LockedDailyBillingSnapshot | null = null;
/** Latest successful API fetch candidate — may differ from lockedDailyBillingSnapshot same day. */
let prefetchedCandidate: PrefetchedCandidate | null = null;
/** Last locked snapshot from a prior KST date (successful carry-forward source). */
let previousSuccessfulDailySnapshot: LockedDailyBillingSnapshot | null = null;
let refreshPromise: Promise<void> | null = null;
let testNowOverride: number | null = null;

/** KST 달력일 YYYY-MM-DD */
export function getKstDateKey(now = testNowOverride ?? Date.now()): string {
  const kst = new Date(now + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

function isMemoryCacheFresh(now = testNowOverride ?? Date.now()): boolean {
  return memoryCache != null && now - memoryCache.fetchedAt < EXCHANGE_RATE_TTL_MS;
}

async function fetchUsdToKrwFromApi(): Promise<number> {
  const res = await fetch(EXCHANGE_API_URL, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Exchange API HTTP ${res.status}`);
  const data = (await res.json()) as { rates?: { KRW?: number } };
  const krw = data?.rates?.KRW;
  if (typeof krw !== "number" || !Number.isFinite(krw) || krw <= 0) throw new Error("Exchange API: invalid KRW rate");
  return krw;
}

function rememberPreviousSuccessfulSnapshot(snapshot: LockedDailyBillingSnapshot): void {
  if (snapshot.source === "emergency_fallback") return;
  previousSuccessfulDailySnapshot = snapshot;
}

/** Sync lock — first billing resolution for dateKey sets immutable lockedDailyBillingSnapshot. */
function lockDailyBillingSnapshot(dateKey: string): LockedDailyBillingSnapshot {
  if (lockedDailyBillingSnapshot?.dateKey === dateKey) {
    return lockedDailyBillingSnapshot;
  }

  let snap: LockedDailyBillingSnapshot;
  if (prefetchedCandidate?.dateKey === dateKey && prefetchedCandidate.usdToKrw > 0) {
    snap = {
      dateKey,
      usdToKrw: prefetchedCandidate.usdToKrw,
      fetchedAt: prefetchedCandidate.fetchedAt,
      source: "api_daily",
    };
  } else if (lockedDailyBillingSnapshot && lockedDailyBillingSnapshot.usdToKrw > 0) {
    snap = {
      dateKey,
      usdToKrw: lockedDailyBillingSnapshot.usdToKrw,
      fetchedAt: Date.now(),
      source: "previous_daily_snapshot",
    };
  } else if (previousSuccessfulDailySnapshot && previousSuccessfulDailySnapshot.usdToKrw > 0) {
    snap = {
      dateKey,
      usdToKrw: previousSuccessfulDailySnapshot.usdToKrw,
      fetchedAt: Date.now(),
      source: "previous_daily_snapshot",
    };
  } else if (memoryCache && memoryCache.usdToKrw > 0) {
    snap = {
      dateKey,
      usdToKrw: memoryCache.usdToKrw,
      fetchedAt: Date.now(),
      source: "previous_daily_snapshot",
    };
  } else {
    snap = {
      dateKey,
      usdToKrw: EXCHANGE_RATE_FALLBACK_KRW,
      fetchedAt: Date.now(),
      source: "emergency_fallback",
    };
  }

  lockedDailyBillingSnapshot = snap;
  rememberPreviousSuccessfulSnapshot(snap);
  return snap;
}

async function prefetchFreshCandidate(dateKey: string): Promise<void> {
  try {
    const usdToKrw = await fetchUsdToKrwFromApi();
    const fetchedAt = Date.now();
    prefetchedCandidate = { dateKey, usdToKrw, fetchedAt };
    memoryCache = { usdToKrw, fetchedAt, source: "api_daily" };
    if (process.env.NODE_ENV !== "production") {
      console.log("[exchangeRate] prefetched candidate", {
        dateKey,
        usdToKrw,
        lockedDateKey: lockedDailyBillingSnapshot?.dateKey ?? null,
      });
    }
  } catch (err) {
    console.warn("[exchangeRate] prefetch failed — candidate unchanged", (err as Error).message);
  }
}

function schedulePrefetchIfNeeded(dateKey: string): void {
  if (refreshPromise) return;
  const needsPrefetch =
    resolveExchangeRateMode() === "daily_kst"
      ? prefetchedCandidate?.dateKey !== dateKey
      : !isMemoryCacheFresh();
  if (!needsPrefetch) return;
  refreshPromise = prefetchFreshCandidate(dateKey).finally(() => {
    refreshPromise = null;
  });
}

async function refreshExchangeRateInternal(): Promise<number> {
  const dateKey = getKstDateKey();
  schedulePrefetchIfNeeded(dateKey);
  if (resolveExchangeRateMode() === "daily_kst") {
    return lockDailyBillingSnapshot(dateKey).usdToKrw;
  }
  if (isMemoryCacheFresh() && memoryCache) return memoryCache.usdToKrw;
  await prefetchFreshCandidate(dateKey);
  return memoryCache?.usdToKrw ?? EXCHANGE_RATE_FALLBACK_KRW;
}

/**
 * USD→KRW 실시간 환율 (수수료 미포함).
 * daily_kst에서는 하루 하나의 snapshot만 확정 — same-day drift 없음.
 */
export async function getRealTimeExchangeRate(): Promise<number> {
  const dateKey = getKstDateKey();
  if (resolveExchangeRateMode() === "daily_kst") {
    schedulePrefetchIfNeeded(dateKey);
    return lockDailyBillingSnapshot(dateKey).usdToKrw;
  }
  if (isMemoryCacheFresh() && memoryCache) return memoryCache.usdToKrw;
  if (!refreshPromise) {
    refreshPromise = prefetchFreshCandidate(dateKey).finally(() => {
      refreshPromise = null;
    });
  }
  await refreshPromise;
  return memoryCache?.usdToKrw ?? EXCHANGE_RATE_FALLBACK_KRW;
}

function resolveDailyKstUsdToKrw(): number {
  const dateKey = getKstDateKey();
  schedulePrefetchIfNeeded(dateKey);
  return lockDailyBillingSnapshot(dateKey).usdToKrw;
}

function resolveRealtimeUsdToKrw(): number {
  schedulePrefetchIfNeeded(getKstDateKey());
  if (isMemoryCacheFresh() && memoryCache) return memoryCache.usdToKrw;
  if (memoryCache) return memoryCache.usdToKrw;
  return EXCHANGE_RATE_FALLBACK_KRW;
}

/** sync 과금·영수증 — 모드별 단일 환율 (USD, 수수료 미포함) */
export function getCachedUsdToKrwRate(): number {
  return resolveExchangeRateMode() === "daily_kst" ? resolveDailyKstUsdToKrw() : resolveRealtimeUsdToKrw();
}

/** 과금·영수증 스냅샷 — USD→KRW×2% 단일 적용, 동일 KST date에서는 1 snapshot만 사용 */
export function resolveBillingExchangeRateSnapshot(): BillingExchangeRateSnapshot {
  const mode = resolveExchangeRateMode();
  const dateKey = getKstDateKey();
  const locked =
    mode === "daily_kst"
      ? lockDailyBillingSnapshot(dateKey)
      : {
          dateKey,
          usdToKrw: resolveRealtimeUsdToKrw(),
          fetchedAt: memoryCache?.fetchedAt ?? Date.now(),
          source: (memoryCache?.source ?? "emergency_fallback") as BillingFxSource,
        };
  return {
    mode,
    dateKey,
    usdToKrw: locked.usdToKrw,
    effectiveKrwPerUsd: applyOverseasCardFee(locked.usdToKrw),
    source: locked.source,
    overseasFeeRate: OVERSEAS_CARD_FEE_PERCENT,
  };
}

/** @deprecated resolveBillingExchangeRateSnapshot().effectiveKrwPerUsd 사용 */
export function getEffectiveKrwPerUsd(): number {
  return resolveBillingExchangeRateSnapshot().effectiveKrwPerUsd;
}

/** USD → KRW (effective rate = USD×KRW × card fee) */
export function convertUsdToKrw(
  usd: number,
  effectiveKrwPerUsd = resolveBillingExchangeRateSnapshot().effectiveKrwPerUsd
): number {
  if (!Number.isFinite(usd) || usd <= 0) return 0;
  return Math.round(usd * effectiveKrwPerUsd * 10) / 10;
}

export function formatExchangeRateLabel(snapshot: BillingExchangeRateSnapshot): string {
  const modeLabel = snapshot.mode === "daily_kst" ? `KST ${snapshot.dateKey} 고정` : "실시간(1h 캐시)";
  const sourceLabel =
    snapshot.source === "api_daily"
      ? "API"
      : snapshot.source === "previous_daily_snapshot"
        ? "previous"
        : "fallback";
  return `${modeLabel} · ₩${Math.round(snapshot.effectiveKrwPerUsd).toLocaleString()}/USD (${sourceLabel})`;
}

/** 서버 기동 시 1회 prefetch */
export function warmExchangeRateCache(): void {
  void getRealTimeExchangeRate().catch(() => {});
}

export function getExchangeRateCacheStatus() {
  const snapshot = resolveBillingExchangeRateSnapshot();
  return {
    mode: snapshot.mode,
    dateKey: snapshot.dateKey,
    valid: isMemoryCacheFresh() || lockedDailyBillingSnapshot?.dateKey === snapshot.dateKey,
    usdToKrw: snapshot.usdToKrw,
    effectiveKrwPerUsd: snapshot.effectiveKrwPerUsd,
    source: snapshot.source,
    overseasFeeRate: snapshot.overseasFeeRate,
    fetchedAt: lockedDailyBillingSnapshot?.fetchedAt ?? memoryCache?.fetchedAt ?? null,
    prefetchedCandidateDateKey: prefetchedCandidate?.dateKey ?? null,
    prefetchedCandidateUsdToKrw: prefetchedCandidate?.usdToKrw ?? null,
  };
}

// Test injection — does not affect production behavior when unused
export function _setKstNowForTest(now: number | null): void {
  testNowOverride = now;
}

export function _setExchangeRateForTest(opts: { dateKey: string; usdToKrw: number; source: BillingFxSource }): void {
  lockedDailyBillingSnapshot = {
    dateKey: opts.dateKey,
    usdToKrw: opts.usdToKrw,
    fetchedAt: Date.now(),
    source: opts.source,
  };
  memoryCache = { usdToKrw: opts.usdToKrw, fetchedAt: Date.now(), source: opts.source };
  rememberPreviousSuccessfulSnapshot(lockedDailyBillingSnapshot);
}

export function _setPrefetchedCandidateForTest(opts: { dateKey: string; usdToKrw: number }): void {
  prefetchedCandidate = { dateKey: opts.dateKey, usdToKrw: opts.usdToKrw, fetchedAt: Date.now() };
  memoryCache = { usdToKrw: opts.usdToKrw, fetchedAt: Date.now(), source: "api_daily" };
}

export function _setPreviousDailySnapshotForTest(opts: { dateKey: string; usdToKrw: number }): void {
  previousSuccessfulDailySnapshot = {
    dateKey: opts.dateKey,
    usdToKrw: opts.usdToKrw,
    fetchedAt: Date.now(),
    source: "api_daily",
  };
}

export function _simulateBackgroundFetchSuccessForTest(opts: { dateKey: string; usdToKrw: number }): void {
  prefetchedCandidate = { dateKey: opts.dateKey, usdToKrw: opts.usdToKrw, fetchedAt: Date.now() };
  memoryCache = { usdToKrw: opts.usdToKrw, fetchedAt: Date.now(), source: "api_daily" };
}

export function _clearExchangeRateCacheForTest(): void {
  lockedDailyBillingSnapshot = null;
  prefetchedCandidate = null;
  previousSuccessfulDailySnapshot = null;
  memoryCache = null;
  refreshPromise = null;
  testNowOverride = null;
}
