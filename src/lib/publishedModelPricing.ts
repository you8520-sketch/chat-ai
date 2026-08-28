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
  /** KRW per input token — billing reference (stable, independent of provider list) */
  billingReferenceInputRateKrw: number;
  /** KRW per output token — billing reference */
  billingReferenceOutputRateKrw: number;
  billingReferenceCacheReadRateKrw?: number;
  billingReferenceCacheWriteRateKrw?: number;
  targetMargin: number;
  minimumMarginFloor: number;
  pricingVersion: number;
  publishedAt: string;
  promo?: {
    percent: number;
    startsAt: string;
    endsAt: string;
    allowBelowMarginFloor: boolean;
  };
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

const EFFECTIVE_KRW_PER_USD_SNAPSHOT = 1530 * 1.02;

function usdPerMToKrwPerToken(usdPerM: number): number {
  return (usdPerM / 1_000_000) * EFFECTIVE_KRW_PER_USD_SNAPSHOT;
}

const PUBLISHED_CATALOG: Record<string, PublishedModelPricing> = {
  "claude-opus-5": {
    modelId: "claude-opus-5",
    billingReferenceInputRateKrw: usdPerMToKrwPerToken(3.5),
    billingReferenceOutputRateKrw: usdPerMToKrwPerToken(17.5),
    billingReferenceCacheReadRateKrw: usdPerMToKrwPerToken(0.35),
    billingReferenceCacheWriteRateKrw: usdPerMToKrwPerToken(4.375),
    targetMargin: 0.25,
    minimumMarginFloor: 0.15,
    pricingVersion: 1,
    publishedAt: "2026-08-28T00:00:00.000Z",
    marketBenchmark: { outputChars: 1800, points: 250 },
    marketUsageBenchmark: { inputTokens: 63749, outputTokens: 3629, userChargePoints: 741.5, sourceLabel: "competitor observed Opus5" },
  },
  "anthropic/claude-opus-4.5": {
    modelId: "anthropic/claude-opus-4.5",
    billingReferenceInputRateKrw: usdPerMToKrwPerToken(5),
    billingReferenceOutputRateKrw: usdPerMToKrwPerToken(25),
    targetMargin: 0.25,
    minimumMarginFloor: 0.15,
    pricingVersion: 1,
    publishedAt: "2026-08-28T00:00:00.000Z",
    marketBenchmark: { outputChars: 1800, points: 250 },
  },
  "deepseek-v4-pro-0813": {
    modelId: "deepseek-v4-pro-0813",
    billingReferenceInputRateKrw: usdPerMToKrwPerToken(0.3045),
    billingReferenceOutputRateKrw: usdPerMToKrwPerToken(0.609),
    billingReferenceCacheReadRateKrw: usdPerMToKrwPerToken(0.231),
    billingReferenceCacheWriteRateKrw: usdPerMToKrwPerToken(0.3045),
    targetMargin: 0.45,
    minimumMarginFloor: 0.3,
    pricingVersion: 1,
    publishedAt: "2026-08-28T00:00:00.000Z",
  },
  "deepseek-v4-pro": {
    modelId: "deepseek-v4-pro",
    billingReferenceInputRateKrw: usdPerMToKrwPerToken(0.3045),
    billingReferenceOutputRateKrw: usdPerMToKrwPerToken(0.609),
    targetMargin: 0.45,
    minimumMarginFloor: 0.3,
    pricingVersion: 1,
    publishedAt: "2026-08-28T00:00:00.000Z",
  },
  "meta/muse-spark-1.1": {
    modelId: "meta/muse-spark-1.1",
    billingReferenceInputRateKrw: 0.0042,
    billingReferenceOutputRateKrw: 0.0062,
    targetMargin: 0.55,
    minimumMarginFloor: 0.4,
    pricingVersion: 1,
    publishedAt: "2026-08-28T00:00:00.000Z",
  },
  "google/gemini-3.6-flash": {
    modelId: "google/gemini-3.6-flash",
    billingReferenceInputRateKrw: 0.0042,
    billingReferenceOutputRateKrw: 0.0209,
    targetMargin: 0.45,
    minimumMarginFloor: 0.3,
    pricingVersion: 1,
    publishedAt: "2026-08-28T00:00:00.000Z",
  },
  "gemini-3.1-pro-preview": {
    modelId: "gemini-3.1-pro-preview",
    billingReferenceInputRateKrw: usdPerMToKrwPerToken(1.4),
    billingReferenceOutputRateKrw: usdPerMToKrwPerToken(8.4),
    billingReferenceCacheReadRateKrw: usdPerMToKrwPerToken(0.4375),
    billingReferenceCacheWriteRateKrw: usdPerMToKrwPerToken(1.4),
    targetMargin: 0.2,
    minimumMarginFloor: 0.1,
    pricingVersion: 1,
    publishedAt: "2026-08-28T00:00:00.000Z",
    marketUsageBenchmark: { inputTokens: 40689, outputTokens: 4307, userChargePoints: 244.2, sourceLabel: "competitor observed Gemini31" },
  },
  "google/gemini-3.1-pro-preview": {
    modelId: "google/gemini-3.1-pro-preview",
    billingReferenceInputRateKrw: usdPerMToKrwPerToken(1.4),
    billingReferenceOutputRateKrw: usdPerMToKrwPerToken(8.4),
    targetMargin: 0.2,
    minimumMarginFloor: 0.1,
    pricingVersion: 1,
    publishedAt: "2026-08-28T00:00:00.000Z",
    marketUsageBenchmark: { inputTokens: 40689, outputTokens: 4307, userChargePoints: 244.2, sourceLabel: "competitor observed Gemini31" },
  },
  "gemini-3.7-flash": {
    modelId: "gemini-3.7-flash",
    billingReferenceInputRateKrw: usdPerMToKrwPerToken(0.53),
    billingReferenceOutputRateKrw: usdPerMToKrwPerToken(2.63),
    targetMargin: 0.4,
    minimumMarginFloor: 0.25,
    pricingVersion: 1,
    publishedAt: "2026-08-28T00:00:00.000Z",
  },
  "qwen-3-8-max": {
    modelId: "qwen-3-8-max",
    billingReferenceInputRateKrw: usdPerMToKrwPerToken(1.4),
    billingReferenceOutputRateKrw: usdPerMToKrwPerToken(4.2),
    targetMargin: 0.5,
    minimumMarginFloor: 0.35,
    pricingVersion: 1,
    publishedAt: "2026-08-28T00:00:00.000Z",
  },
  "z-ai/glm-5.2": {
    modelId: "z-ai/glm-5.2",
    billingReferenceInputRateKrw: usdPerMToKrwPerToken(0.532),
    billingReferenceOutputRateKrw: usdPerMToKrwPerToken(1.672),
    targetMargin: 0.5,
    minimumMarginFloor: 0.35,
    pricingVersion: 1,
    publishedAt: "2026-08-28T00:00:00.000Z",
  },
  "glm-5.2": {
    modelId: "glm-5.2",
    billingReferenceInputRateKrw: usdPerMToKrwPerToken(0.532),
    billingReferenceOutputRateKrw: usdPerMToKrwPerToken(1.672),
    targetMargin: 0.5,
    minimumMarginFloor: 0.35,
    pricingVersion: 1,
    publishedAt: "2026-08-28T00:00:00.000Z",
  },
  "moonshotai/kimi-k3": {
    modelId: "moonshotai/kimi-k3",
    billingReferenceInputRateKrw: usdPerMToKrwPerToken(3),
    billingReferenceOutputRateKrw: usdPerMToKrwPerToken(15),
    targetMargin: 0.4,
    minimumMarginFloor: 0.25,
    pricingVersion: 1,
    publishedAt: "2026-08-28T00:00:00.000Z",
  },
  "deepseek-v4-flash-0731": {
    modelId: "deepseek-v4-flash-0731",
    billingReferenceInputRateKrw: usdPerMToKrwPerToken(0.098),
    billingReferenceOutputRateKrw: usdPerMToKrwPerToken(0.196),
    targetMargin: 0.55,
    minimumMarginFloor: 0.4,
    pricingVersion: 1,
    publishedAt: "2026-08-28T00:00:00.000Z",
  },
  "gpt-5.6-luna": {
    modelId: "gpt-5.6-luna",
    billingReferenceInputRateKrw: usdPerMToKrwPerToken(0.08),
    billingReferenceOutputRateKrw: usdPerMToKrwPerToken(0.48),
    targetMargin: 0.5,
    minimumMarginFloor: 0.35,
    pricingVersion: 1,
    publishedAt: "2026-08-28T00:00:00.000Z",
  },
  "gpt-5.6-terra": {
    modelId: "gpt-5.6-terra",
    billingReferenceInputRateKrw: usdPerMToKrwPerToken(2.5),
    billingReferenceOutputRateKrw: usdPerMToKrwPerToken(15),
    targetMargin: 0.3,
    minimumMarginFloor: 0.15,
    pricingVersion: 1,
    publishedAt: "2026-08-28T00:00:00.000Z",
  },
};

const GENERIC_PUBLISHED: PublishedModelPricing = {
  modelId: "__generic__",
  billingReferenceInputRateKrw: usdPerMToKrwPerToken(0.4),
  billingReferenceOutputRateKrw: usdPerMToKrwPerToken(0.4),
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

export function listPublishedModelIds(): string[] {
  return Object.keys(PUBLISHED_CATALOG);
}

export function _setPublishedPricingForTest(entry: PublishedModelPricing): void {
  PUBLISHED_CATALOG[normalizeId(entry.modelId)] = entry;
}
