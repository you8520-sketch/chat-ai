/** 해외 결제 수수료 (Visa/Master + 국내 카드사 + 전신환매도율 등) */
export const OVERSEAS_CARD_FEE_RATE = 1.02;

/** USD→KRW 메모리 캐시 TTL — 1시간 (realtime 모드·API 폴링) */
export const EXCHANGE_RATE_TTL_MS = 3600 * 1000;

/** API 장애 시 안전망 (안전 마진 포함) */
export const EXCHANGE_RATE_FALLBACK_KRW =
  Number(process.env.EXCHANGE_RATE_FALLBACK_KRW) || 1500;

/** daily_kst = KST 자정 기준 당일 고정 · realtime = 1시간 캐시 실시간 */
export type ExchangeRateMode = "daily_kst" | "realtime";

export function resolveExchangeRateMode(): ExchangeRateMode {
  const raw = (process.env.EXCHANGE_RATE_MODE ?? "daily_kst").trim().toLowerCase();
  return raw === "realtime" ? "realtime" : "daily_kst";
}

const EXCHANGE_API_URL = "https://open.er-api.com/v6/latest/USD";
const FETCH_TIMEOUT_MS = 8000;

type RateCache = {
  usdToKrw: number;
  fetchedAt: number;
  source: "api" | "fallback";
};

type DailyRateCache = {
  dateKey: string;
  usdToKrw: number;
  fetchedAt: number;
  source: "api" | "fallback";
};

export type BillingExchangeRateSnapshot = {
  mode: ExchangeRateMode;
  dateKey: string;
  usdToKrw: number;
  effectiveKrwPerUsd: number;
  source: "api" | "fallback";
};

let memoryCache: RateCache | null = null;
let dailyCache: DailyRateCache | null = null;
let refreshPromise: Promise<number> | null = null;

/** KST 달력일 YYYY-MM-DD */
export function getKstDateKey(now = Date.now()): string {
  const kst = new Date(now + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

function isMemoryCacheFresh(now = Date.now()): boolean {
  return memoryCache != null && now - memoryCache.fetchedAt < EXCHANGE_RATE_TTL_MS;
}

async function fetchUsdToKrwFromApi(): Promise<number> {
  const res = await fetch(EXCHANGE_API_URL, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Exchange API HTTP ${res.status}`);
  }
  const data = (await res.json()) as { rates?: { KRW?: number } };
  const krw = data?.rates?.KRW;
  if (typeof krw !== "number" || !Number.isFinite(krw) || krw <= 0) {
    throw new Error("Exchange API: invalid KRW rate");
  }
  return krw;
}

function applyFetchedRate(usdToKrw: number, source: "api" | "fallback", fetchedAt = Date.now()): number {
  memoryCache = { usdToKrw, fetchedAt, source };
  dailyCache = {
    dateKey: getKstDateKey(fetchedAt),
    usdToKrw,
    fetchedAt,
    source,
  };
  return usdToKrw;
}

async function refreshExchangeRateInternal(): Promise<number> {
  try {
    const usdToKrw = await fetchUsdToKrwFromApi();
    if (process.env.NODE_ENV !== "production") {
      console.log("[exchangeRate] refreshed", {
        mode: resolveExchangeRateMode(),
        dateKey: getKstDateKey(),
        usdToKrw,
        effectiveKrwPerUsd: usdToKrw * OVERSEAS_CARD_FEE_RATE,
      });
    }
    return applyFetchedRate(usdToKrw, "api");
  } catch (err) {
    console.warn("[exchangeRate] fetch failed — using last known or fallback", (err as Error).message);
    const carry =
      dailyCache?.usdToKrw ??
      memoryCache?.usdToKrw ??
      EXCHANGE_RATE_FALLBACK_KRW;
    return applyFetchedRate(carry, dailyCache || memoryCache ? "api" : "fallback");
  } finally {
    refreshPromise = null;
  }
}

/**
 * USD→KRW 실시간 환율 (수수료 미포함).
 * 메모리 캐시 TTL 1시간.
 */
export async function getRealTimeExchangeRate(): Promise<number> {
  const dateKey = getKstDateKey();
  if (resolveExchangeRateMode() === "daily_kst" && dailyCache?.dateKey === dateKey) {
    return dailyCache.usdToKrw;
  }
  if (isMemoryCacheFresh()) return memoryCache!.usdToKrw;
  if (!refreshPromise) {
    refreshPromise = refreshExchangeRateInternal();
  }
  return refreshPromise;
}

function scheduleRefreshIfStale(): void {
  const mode = resolveExchangeRateMode();
  if (mode === "daily_kst") {
    const dateKey = getKstDateKey();
    if (dailyCache?.dateKey === dateKey && dailyCache.source === "api") return;
  } else if (isMemoryCacheFresh() || refreshPromise) {
    return;
  }
  void getRealTimeExchangeRate().catch(() => {});
}

function resolveDailyKstUsdToKrw(): number {
  const dateKey = getKstDateKey();
  if (dailyCache && dailyCache.dateKey === dateKey && dailyCache.usdToKrw > 0) {
    return dailyCache.usdToKrw;
  }
  if (memoryCache && getKstDateKey(memoryCache.fetchedAt) === dateKey && memoryCache.usdToKrw > 0) {
    dailyCache = {
      dateKey,
      usdToKrw: memoryCache.usdToKrw,
      fetchedAt: memoryCache.fetchedAt,
      source: memoryCache.source,
    };
    scheduleRefreshIfStale();
    return dailyCache.usdToKrw;
  }
  if (dailyCache && dailyCache.usdToKrw > 0) {
    scheduleRefreshIfStale();
    return dailyCache.usdToKrw;
  }
  if (memoryCache && memoryCache.usdToKrw > 0) {
    dailyCache = {
      dateKey,
      usdToKrw: memoryCache.usdToKrw,
      fetchedAt: memoryCache.fetchedAt,
      source: memoryCache.source,
    };
    scheduleRefreshIfStale();
    return dailyCache.usdToKrw;
  }
  scheduleRefreshIfStale();
  return EXCHANGE_RATE_FALLBACK_KRW;
}

function resolveRealtimeUsdToKrw(): number {
  scheduleRefreshIfStale();
  if (isMemoryCacheFresh() && memoryCache) return memoryCache.usdToKrw;
  if (memoryCache && memoryCache.usdToKrw > 0) return memoryCache.usdToKrw;
  return EXCHANGE_RATE_FALLBACK_KRW;
}

/** sync 과금·영수증 — 모드별 단일 환율 (USD, 수수료 미포함) */
export function getCachedUsdToKrwRate(): number {
  return resolveExchangeRateMode() === "daily_kst"
    ? resolveDailyKstUsdToKrw()
    : resolveRealtimeUsdToKrw();
}

/** 과금·영수증 스냅샷 — USD→KRW×2% 단일 적용 */
export function resolveBillingExchangeRateSnapshot(): BillingExchangeRateSnapshot {
  const mode = resolveExchangeRateMode();
  const usdToKrw = getCachedUsdToKrwRate();
  const source =
    mode === "daily_kst"
      ? dailyCache?.source ?? memoryCache?.source ?? "fallback"
      : memoryCache?.source ?? "fallback";
  return {
    mode,
    dateKey: getKstDateKey(),
    usdToKrw,
    effectiveKrwPerUsd: usdToKrw * OVERSEAS_CARD_FEE_RATE,
    source,
  };
}

/** @deprecated resolveBillingExchangeRateSnapshot().effectiveKrwPerUsd 사용 */
export function getEffectiveKrwPerUsd(): number {
  return resolveBillingExchangeRateSnapshot().effectiveKrwPerUsd;
}

/** USD → KRW (effective rate = USD×KRW × 2% 수수료) */
export function convertUsdToKrw(
  usd: number,
  effectiveKrwPerUsd = resolveBillingExchangeRateSnapshot().effectiveKrwPerUsd
): number {
  if (!Number.isFinite(usd) || usd <= 0) return 0;
  return Math.round(usd * effectiveKrwPerUsd * 10) / 10;
}

export function formatExchangeRateLabel(snapshot: BillingExchangeRateSnapshot): string {
  const modeLabel =
    snapshot.mode === "daily_kst"
      ? `KST ${snapshot.dateKey} 고정`
      : "실시간(1h 캐시)";
  const sourceLabel = snapshot.source === "api" ? "API" : "fallback";
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
    valid: isMemoryCacheFresh() || dailyCache?.dateKey === snapshot.dateKey,
    usdToKrw: snapshot.usdToKrw,
    effectiveKrwPerUsd: snapshot.effectiveKrwPerUsd,
    source: snapshot.source,
    fetchedAt: dailyCache?.fetchedAt ?? memoryCache?.fetchedAt ?? null,
  };
}
