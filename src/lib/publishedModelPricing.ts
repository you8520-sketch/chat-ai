/**
 * Published Model Pricing — canonical owner for billing reference cost & target margins.
 *
 * Shadow mode only (Phase 2): actual user deduction still uses legacy `points.ts` path.
 * New helpers are used for shadow simulation, admin diagnostics, and future cutover.
 *
 * PricingVersion: increment when published rates/margins change. Stored per-message in usage JSON
 * for reproducible history. Live CheaperInference discount NEVER mutates this.
 */

export type PublishedModelPricing = {
  modelId: string;
  /** KRW per input token — published undiscounted reference (stable) */
  referenceInputRateKrw: number;
  /** KRW per output token — published undiscounted reference */
  referenceOutputRateKrw: number;
  /** KRW per cache read token (optional, defaults to input*discount if missing) */
  referenceCacheReadRateKrw?: number;
  referenceCacheWriteRateKrw?: number;
  targetMargin: number; // 0..0.95 gross margin
  minimumMarginFloor: number;
  pricingVersion: number;
  publishedAt: string; // ISO
  /** admin-controlled user promotion (separate from provider discount) */
  promo?: {
    percent: number; // 0..0.9
    startsAt: string;
    endsAt: string;
    allowBelowMarginFloor: boolean;
  };
  /** market benchmark for admin comparison only — never caps billing */
  marketBenchmark?: {
    outputChars: number;
    points: number;
  };
  marketUsageBenchmark?: {
    inputTokens: number;
    outputTokens: number;
    userChargePoints: number;
    sourceLabel: string;
  };
};

/** USD → KRW effective rate at publish time (snapshot for reference calc) */
const EFFECTIVE_KRW_PER_USD_SNAPSHOT = 1530 * 1.02; // ~1560.6 — matches TARGET_MARGIN_TUNING_RATE

function usdPerMToKrwPerToken(usdPerM: number): number {
  return (usdPerM / 1_000_000) * EFFECTIVE_KRW_PER_USD_SNAPSHOT;
}

/**
 * Initial published catalog — seeded from legacy fallback snapshots (undiscounted list).
 * Values are KRW per token; reference rates are stable, NOT live-discounted.
 * Existing simple-point rates (Muse/DeepSeek/Gemini36) are carried as KRW/token directly.
 */
const PUBLISHED_CATALOG: Record<string, PublishedModelPricing> = {
  // Opus 5 — CheaperInference fallback snapshot 3.5/17.5 USD/M
  "claude-opus-5": {
    modelId: "claude-opus-5",
    referenceInputRateKrw: usdPerMToKrwPerToken(3.5),
    referenceOutputRateKrw: usdPerMToKrwPerToken(17.5),
    referenceCacheReadRateKrw: usdPerMToKrwPerToken(0.35),
    referenceCacheWriteRateKrw: usdPerMToKrwPerToken(4.375),
    targetMargin: 0.25,
    minimumMarginFloor: 0.15,
    pricingVersion: 1,
    publishedAt: "2026-08-28T00:00:00.000Z",
    marketBenchmark: { outputChars: 1800, points: 250 },
    marketUsageBenchmark: { inputTokens: 63749, outputTokens: 3629, userChargePoints: 741.5, sourceLabel: "competitor observed Opus5" },
  },
  // Opus 4.5 also maps to same (alias)
  "anthropic/claude-opus-4.5": {
    modelId: "anthropic/claude-opus-4.5",
    referenceInputRateKrw: usdPerMToKrwPerToken(5),
    referenceOutputRateKrw: usdPerMToKrwPerToken(25),
    targetMargin: 0.25,
    minimumMarginFloor: 0.15,
    pricingVersion: 1,
    publishedAt: "2026-08-28T00:00:00.000Z",
    marketBenchmark: { outputChars: 1800, points: 250 },
  },
  // DeepSeek V4 Pro — CI fallback 0.3045/0.609 USD/M
  "deepseek-v4-pro-0813": {
    modelId: "deepseek-v4-pro-0813",
    referenceInputRateKrw: usdPerMToKrwPerToken(0.3045),
    referenceOutputRateKrw: usdPerMToKrwPerToken(0.609),
    referenceCacheReadRateKrw: usdPerMToKrwPerToken(0.231),
    referenceCacheWriteRateKrw: usdPerMToKrwPerToken(0.3045),
    targetMargin: 0.45,
    minimumMarginFloor: 0.3,
    pricingVersion: 1,
    publishedAt: "2026-08-28T00:00:00.000Z",
  },
  "deepseek-v4-pro": {
    modelId: "deepseek-v4-pro",
    referenceInputRateKrw: usdPerMToKrwPerToken(0.3045),
    referenceOutputRateKrw: usdPerMToKrwPerToken(0.609),
    targetMargin: 0.45,
    minimumMarginFloor: 0.3,
    pricingVersion: 1,
    publishedAt: "2026-08-28T00:00:00.000Z",
  },
  // Muse Spark 1.1 — legacy simple-point already KRW/token
  "meta/muse-spark-1.1": {
    modelId: "meta/muse-spark-1.1",
    referenceInputRateKrw: 0.0042,
    referenceOutputRateKrw: 0.0062,
    targetMargin: 0.55,
    minimumMarginFloor: 0.4,
    pricingVersion: 1,
    publishedAt: "2026-08-28T00:00:00.000Z",
  },
  // Gemini 3.6 Flash
  "google/gemini-3.6-flash": {
    modelId: "google/gemini-3.6-flash",
    referenceInputRateKrw: 0.0042,
    referenceOutputRateKrw: 0.0209,
    targetMargin: 0.45,
    minimumMarginFloor: 0.3,
    pricingVersion: 1,
    publishedAt: "2026-08-28T00:00:00.000Z",
  },
  // Gemini 3.1 Pro Preview — CI fallback 1.4/8.4 USD/M
  "gemini-3.1-pro-preview": {
    modelId: "gemini-3.1-pro-preview",
    referenceInputRateKrw: usdPerMToKrwPerToken(1.4),
    referenceOutputRateKrw: usdPerMToKrwPerToken(8.4),
    referenceCacheReadRateKrw: usdPerMToKrwPerToken(0.4375),
    referenceCacheWriteRateKrw: usdPerMToKrwPerToken(1.4),
    targetMargin: 0.2,
    minimumMarginFloor: 0.1,
    pricingVersion: 1,
    publishedAt: "2026-08-28T00:00:00.000Z",
    marketUsageBenchmark: { inputTokens: 40689, outputTokens: 4307, userChargePoints: 244.2, sourceLabel: "competitor observed Gemini31" },
  },
  "google/gemini-3.1-pro-preview": {
    modelId: "google/gemini-3.1-pro-preview",
    referenceInputRateKrw: usdPerMToKrwPerToken(1.4),
    referenceOutputRateKrw: usdPerMToKrwPerToken(8.4),
    targetMargin: 0.2,
    minimumMarginFloor: 0.1,
    pricingVersion: 1,
    publishedAt: "2026-08-28T00:00:00.000Z",
    marketUsageBenchmark: { inputTokens: 40689, outputTokens: 4307, userChargePoints: 244.2, sourceLabel: "competitor observed Gemini31" },
  },
  // Gemini 3.7 Flash — CI fallback 0.53/2.63 USD/M (shadow cost-based, billing still tier table)
  "gemini-3.7-flash": {
    modelId: "gemini-3.7-flash",
    referenceInputRateKrw: usdPerMToKrwPerToken(0.53),
    referenceOutputRateKrw: usdPerMToKrwPerToken(2.63),
    targetMargin: 0.4,
    minimumMarginFloor: 0.25,
    pricingVersion: 1,
    publishedAt: "2026-08-28T00:00:00.000Z",
  },
  // Qwen 3.8 Max — CI fallback 1.4/4.2
  "qwen-3-8-max": {
    modelId: "qwen-3-8-max",
    referenceInputRateKrw: usdPerMToKrwPerToken(1.4),
    referenceOutputRateKrw: usdPerMToKrwPerToken(4.2),
    targetMargin: 0.5,
    minimumMarginFloor: 0.35,
    pricingVersion: 1,
    publishedAt: "2026-08-28T00:00:00.000Z",
  },
  // GLM 5.2 — 0.532/1.672
  "z-ai/glm-5.2": {
    modelId: "z-ai/glm-5.2",
    referenceInputRateKrw: usdPerMToKrwPerToken(0.532),
    referenceOutputRateKrw: usdPerMToKrwPerToken(1.672),
    targetMargin: 0.5,
    minimumMarginFloor: 0.35,
    pricingVersion: 1,
    publishedAt: "2026-08-28T00:00:00.000Z",
  },
  "glm-5.2": {
    modelId: "glm-5.2",
    referenceInputRateKrw: usdPerMToKrwPerToken(0.532),
    referenceOutputRateKrw: usdPerMToKrwPerToken(1.672),
    targetMargin: 0.5,
    minimumMarginFloor: 0.35,
    pricingVersion: 1,
    publishedAt: "2026-08-28T00:00:00.000Z",
  },
  // Kimi K3 — 3/15
  "moonshotai/kimi-k3": {
    modelId: "moonshotai/kimi-k3",
    referenceInputRateKrw: usdPerMToKrwPerToken(3),
    referenceOutputRateKrw: usdPerMToKrwPerToken(15),
    targetMargin: 0.4,
    minimumMarginFloor: 0.25,
    pricingVersion: 1,
    publishedAt: "2026-08-28T00:00:00.000Z",
  },
  // DeepSeek V4 Flash
  "deepseek-v4-flash-0731": {
    modelId: "deepseek-v4-flash-0731",
    referenceInputRateKrw: usdPerMToKrwPerToken(0.098),
    referenceOutputRateKrw: usdPerMToKrwPerToken(0.196),
    targetMargin: 0.55,
    minimumMarginFloor: 0.4,
    pricingVersion: 1,
    publishedAt: "2026-08-28T00:00:00.000Z",
  },
  // GPT-5.6 Luna/Terra
  "gpt-5.6-luna": {
    modelId: "gpt-5.6-luna",
    referenceInputRateKrw: usdPerMToKrwPerToken(0.08),
    referenceOutputRateKrw: usdPerMToKrwPerToken(0.48),
    targetMargin: 0.5,
    minimumMarginFloor: 0.35,
    pricingVersion: 1,
    publishedAt: "2026-08-28T00:00:00.000Z",
  },
  "gpt-5.6-terra": {
    modelId: "gpt-5.6-terra",
    referenceInputRateKrw: usdPerMToKrwPerToken(2.5),
    referenceOutputRateKrw: usdPerMToKrwPerToken(15),
    targetMargin: 0.3,
    minimumMarginFloor: 0.15,
    pricingVersion: 1,
    publishedAt: "2026-08-28T00:00:00.000Z",
  },
};

const GENERIC_PUBLISHED: PublishedModelPricing = {
  modelId: "__generic__",
  referenceInputRateKrw: usdPerMToKrwPerToken(0.4),
  referenceOutputRateKrw: usdPerMToKrwPerToken(0.4),
  targetMargin: 0.4,
  minimumMarginFloor: 0.25,
  pricingVersion: 1,
  publishedAt: "2026-08-28T00:00:00.000Z",
};

function normalizeId(id: string): string {
  return id.trim().toLowerCase();
}

export function getPublishedPricing(modelId: string): PublishedModelPricing {
  const n = normalizeId(modelId);
  return PUBLISHED_CATALOG[n] ?? { ...GENERIC_PUBLISHED, modelId: n };
}

export function getTargetMargin(modelId: string): number {
  return getPublishedPricing(modelId).targetMargin;
}

export function getMinimumMarginFloor(modelId: string): number {
  return getPublishedPricing(modelId).minimumMarginFloor;
}

export function getPublishedPricingVersion(modelId: string): number {
  return getPublishedPricing(modelId).pricingVersion;
}

export function isPromoActive(p: PublishedModelPricing, now: Date = new Date()): boolean {
  if (!p.promo) return false;
  const s = new Date(p.promo.startsAt).getTime();
  const e = new Date(p.promo.endsAt).getTime();
  const t = now.getTime();
  return t >= s && t <= e && p.promo.percent > 0;
}

export function getActivePromoPercent(modelId: string, now: Date = new Date()): number {
  const p = getPublishedPricing(modelId);
  return isPromoActive(p, now) ? p.promo!.percent : 0;
}

/** List all published modelIds (for admin diagnostics) */
export function listPublishedModelIds(): string[] {
  return Object.keys(PUBLISHED_CATALOG);
}

/** For tests: override catalog entry */
export function _setPublishedPricingForTest(entry: PublishedModelPricing): void {
  PUBLISHED_CATALOG[normalizeId(entry.modelId)] = entry;
}
