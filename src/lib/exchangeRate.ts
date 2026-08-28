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

export function resolveExchangeRateMode(): ExchangeRateMode {
  const raw = (process.env.EXCHANGE_RATE_MODE ?? "daily_kst").trim().toLowerCase();
  return raw === "realtime" ? "realtime" : "daily_kst";
}

const EXCHANGE_API_URL = "https://open.er-api.com/v6/latest/USD";
const FETCH_TIMEOUT_MS = 8000;

type RateCache = {
  usdToKrw: number;
  fetchedAt: number;
  source: "api_daily" | "previous_daily_snapshot" | "emergency_fallback";
};

type DailyRateCache = {
  dateKey: string;
  usdToKrw: number;
  fetchedAt: number;
  source: "api_daily" | "previous_daily_snapshot" | "emergency_fallback";
};

export type BillingExchangeRateSnapshot = {
  mode: ExchangeRateMode;
  dateKey: string;
  usdToKrw: number;
  effectiveKrwPerUsd: number;
  source: "api_daily" | "previous_daily_snapshot" | "emergency_fallback" | "api" | "fallback";
  overseasFeeRate?: number;
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
  if (!res.ok) throw new Error(`Exchange API HTTP ${res.status}`);
  const data = (await res.json()) as { rates?: { KRW?: number } };
  const krw = data?.rates?.KRW;
  if (typeof krw !== "number" || !Number.isFinite(krw) || krw <= 0) throw new Error("Exchange API: invalid KRW rate");
  return krw;
}

function applyFetchedRate(usdToKrw: number, source: DailyRateCache["source"], fetchedAt = Date.now()): number {
  memoryCache = { usdToKrw, fetchedAt, source };
  // daily lock is set only via ensureDailySnapshot — not here
  return usdToKrw;
}

async function ensureDailySnapshot(dateKey: string): Promise<DailyRateCache> {
  if (dailyCache?.dateKey === dateKey) return dailyCache;
  // Try fresh fetch
  try {
    const usdToKrw = await fetchUsdToKrwFromApi();
    const snap: DailyRateCache = { dateKey, usdToKrw, fetchedAt: Date.now(), source: "api_daily" };
    dailyCache = snap;
    memoryCache = { usdToKrw, fetchedAt: snap.fetchedAt, source: "api_daily" };
    return snap;
  } catch {
    if (dailyCache && dailyCache.dateKey !== dateKey) {
      // carry previous successful daily
      const snap: DailyRateCache = { dateKey, usdToKrw: dailyCache.usdToKrw, fetchedAt: Date.now(), source: "previous_daily_snapshot" };
      dailyCache = snap;
      return snap;
    }
    if (memoryCache) {
      const snap: DailyRateCache = { dateKey, usdToKrw: memoryCache.usdToKrw, fetchedAt: Date.now(), source: "previous_daily_snapshot" };
      dailyCache = snap;
      return snap;
    }
    const snap: DailyRateCache = { dateKey, usdToKrw: EXCHANGE_RATE_FALLBACK_KRW, fetchedAt: Date.now(), source: "emergency_fallback" };
    dailyCache = snap;
    memoryCache = { usdToKrw: EXCHANGE_RATE_FALLBACK_KRW, fetchedAt: snap.fetchedAt, source: "emergency_fallback" };
    return snap;
  }
}

async function refreshExchangeRateInternal(): Promise<number> {
  const dateKey = getKstDateKey();
  const snap = await ensureDailySnapshot(dateKey);
  return snap.usdToKrw;
}

/**
 * USD→KRW 실시간 환율 (수수료 미포함).
 * daily_kst에서는 하루 하나의 snapshot만 확정 — same-day drift 없음.
 */
export async function getRealTimeExchangeRate(): Promise<number> {
  const dateKey = getKstDateKey();
  if (resolveExchangeRateMode() === "daily_kst" && dailyCache?.dateKey === dateKey) {
    return dailyCache.usdToKrw;
  }
  if (isMemoryCacheFresh() && resolveExchangeRateMode() === "realtime" && memoryCache) return memoryCache.usdToKrw;
  if (!refreshPromise) refreshPromise = refreshExchangeRateInternal().finally(() => { refreshPromise = null; });
  return refreshPromise;
}

function resolveDailyKstUsdToKrw(): number {
  const dateKey = getKstDateKey();
  if (dailyCache?.dateKey === dateKey) return dailyCache.usdToKrw;
  // lazy init without blocking — return previous or fallback, refresh in background non-blocking for shadow
  void ensureDailySnapshot(dateKey).catch(() => {});
  if (dailyCache) return dailyCache.usdToKrw;
  if (memoryCache) return memoryCache.usdToKrw;
  return EXCHANGE_RATE_FALLBACK_KRW;
}

function resolveRealtimeUsdToKrw(): number {
  if (isMemoryCacheFresh() && memoryCache) return memoryCache.usdToKrw;
  if (memoryCache) return memoryCache.usdToKrw;
  return EXCHANGE_RATE_FALLBACK_KRW;
}

/** sync 과금·영수증 — 모드별 단일 환율 (USD, 수수료 미포함) */
export function getCachedUsdToKrwRate(): number {
  return resolveExchangeRateMode() === "daily_kst" ? resolveDailyKstUsdToKrw() : resolveRealtimeUsdToKrw();
}

/** 과금·영수증 스냅샷 — USD→KRW×2% 단일 적용, 동일 턴에서는 1 snapshot만 사용 */
export function resolveBillingExchangeRateSnapshot(): BillingExchangeRateSnapshot {
  const mode = resolveExchangeRateMode();
  const usdToKrw = getCachedUsdToKrwRate();
  const dateKey = getKstDateKey();
  // Ensure daily lock exists; source reflects actual lock source
  let source: BillingExchangeRateSnapshot["source"] = "emergency_fallback";
  if (dailyCache?.dateKey === dateKey) source = dailyCache.source;
  else if (memoryCache) source = memoryCache.source as BillingExchangeRateSnapshot["source"];
  return {
    mode,
    dateKey,
    usdToKrw,
    effectiveKrwPerUsd: applyOverseasCardFee(usdToKrw),
    source,
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
  const sourceLabel = snapshot.source === "api_daily" ? "API" : snapshot.source === "previous_daily_snapshot" ? "previous" : "fallback";
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
    overseasFeeRate: snapshot.overseasFeeRate,
    fetchedAt: dailyCache?.fetchedAt ?? memoryCache?.fetchedAt ?? null,
  };
}

// Test injection — does not affect production behavior when unused
export function _setExchangeRateForTest(opts: { dateKey: string; usdToKrw: number; source: DailyRateCache["source"] }): void {
  dailyCache = { dateKey: opts.dateKey, usdToKrw: opts.usdToKrw, fetchedAt: Date.now(), source: opts.source };
  memoryCache = { usdToKrw: opts.usdToKrw, fetchedAt: Date.now(), source: opts.source };
}
export function _clearExchangeRateCacheForTest(): void {
  dailyCache = null;
  memoryCache = null;
}
