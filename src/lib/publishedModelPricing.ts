/**
 * Published Model Pricing — canonical owner for billing reference USD rates & target margins.
 * Source-of-truth is USD per million. KRW is computed via daily KST FX (not baked-in).
 */

import { canonicalizePublishedModelId, normalizePublishedModelId } from "@/lib/publishedModelAliases";

export type PublishedModelPricing = {
  modelId: string;
  billingReferenceInputUsdPerMillion: number;
  billingReferenceOutputUsdPerMillion: number;
  billingReferenceCacheReadUsdPerMillion?: number;
  billingReferenceCacheWriteUsdPerMillion?: number;
  targetMargin: number;
  minimumMarginFloor: number;
  pricingVersion: number;
  publishedAt: string;
  /** Shadow-only: published rates apply only at or below this prompt size. */
  pricingApplicability?: "base_tier_only";
  publishedBaseTierMaxPromptTokens?: number;
  promo?: {
    percent: number;
    startsAt: string;
    endsAt: string;
    allowBelowMarginFloor: boolean;
  };
  marketBenchmark?: { outputChars: number; points: number };
};

const PUBLISHED_CATALOG: Record<string, PublishedModelPricing> = {
  "claude-opus-5": {
    modelId: "claude-opus-5",
    billingReferenceInputUsdPerMillion: 5,
    billingReferenceOutputUsdPerMillion: 25,
    billingReferenceCacheReadUsdPerMillion: 0.5,
    billingReferenceCacheWriteUsdPerMillion: 6.25,
    targetMargin: 0.08,
    minimumMarginFloor: 0.05,
    pricingVersion: 2,
    publishedAt: "2026-08-28T15:00:00.000Z",
  },
  "anthropic/claude-opus-4.5": {
    modelId: "anthropic/claude-opus-4.5",
    billingReferenceInputUsdPerMillion: 5,
    billingReferenceOutputUsdPerMillion: 25,
    targetMargin: 0.25,
    minimumMarginFloor: 0.15,
    pricingVersion: 1,
    publishedAt: "2026-08-28T00:00:00.000Z",
    marketBenchmark: { outputChars: 1800, points: 250 },
  },
  "deepseek-v4-pro-0813": {
    modelId: "deepseek-v4-pro-0813",
    billingReferenceInputUsdPerMillion: 0.66,
    billingReferenceOutputUsdPerMillion: 1.98,
    billingReferenceCacheReadUsdPerMillion: 0.022,
    targetMargin: 0.5,
    minimumMarginFloor: 0.4,
    pricingVersion: 2,
    publishedAt: "2026-09-02T09:00:00.000Z",
  },
  "meta/muse-spark-1.1": {
    modelId: "meta/muse-spark-1.1",
    billingReferenceInputUsdPerMillion: 0.435,
    billingReferenceOutputUsdPerMillion: 0.87,
    targetMargin: 0.55,
    minimumMarginFloor: 0.4,
    pricingVersion: 1,
    publishedAt: "2026-08-28T00:00:00.000Z",
  },
  "google/gemini-3.6-flash": {
    modelId: "google/gemini-3.6-flash",
    billingReferenceInputUsdPerMillion: 0.5,
    billingReferenceOutputUsdPerMillion: 2.5,
    targetMargin: 0.45,
    minimumMarginFloor: 0.3,
    pricingVersion: 1,
    publishedAt: "2026-08-28T00:00:00.000Z",
  },
  "gemini-3.1-pro-preview": {
    modelId: "gemini-3.1-pro-preview",
    billingReferenceInputUsdPerMillion: 2,
    billingReferenceOutputUsdPerMillion: 12,
    targetMargin: 0.09,
    minimumMarginFloor: 0.05,
    pricingVersion: 2,
    publishedAt: "2026-08-28T15:00:00.000Z",
    pricingApplicability: "base_tier_only",
    publishedBaseTierMaxPromptTokens: 200_000,
  },
  "gemini-3.7-flash": {
    modelId: "gemini-3.7-flash",
    billingReferenceInputUsdPerMillion: 0.375,
    billingReferenceOutputUsdPerMillion: 1.875,
    targetMargin: 0.55,
    minimumMarginFloor: 0.5,
    pricingVersion: 2,
    publishedAt: "2026-08-28T14:00:00.000Z",
  },
  "qwen-3-8-max": {
    modelId: "qwen-3-8-max",
    billingReferenceInputUsdPerMillion: 1.4,
    billingReferenceOutputUsdPerMillion: 4.2,
    targetMargin: 0.5,
    minimumMarginFloor: 0.35,
    pricingVersion: 1,
    publishedAt: "2026-08-28T00:00:00.000Z",
  },
  "z-ai/glm-5.2": {
    modelId: "z-ai/glm-5.2",
    billingReferenceInputUsdPerMillion: 0.532,
    billingReferenceOutputUsdPerMillion: 1.672,
    targetMargin: 0.5,
    minimumMarginFloor: 0.35,
    pricingVersion: 1,
    publishedAt: "2026-08-28T00:00:00.000Z",
  },
  "glm-5.2": {
    modelId: "glm-5.2",
    billingReferenceInputUsdPerMillion: 0.532,
    billingReferenceOutputUsdPerMillion: 1.672,
    targetMargin: 0.5,
    minimumMarginFloor: 0.35,
    pricingVersion: 1,
    publishedAt: "2026-08-28T00:00:00.000Z",
  },
  "moonshotai/kimi-k3": {
    modelId: "moonshotai/kimi-k3",
    billingReferenceInputUsdPerMillion: 3,
    billingReferenceOutputUsdPerMillion: 15,
    targetMargin: 0.4,
    minimumMarginFloor: 0.25,
    pricingVersion: 1,
    publishedAt: "2026-08-28T00:00:00.000Z",
  },
  "deepseek-v4-flash-0731": {
    modelId: "deepseek-v4-flash-0731",
    billingReferenceInputUsdPerMillion: 0.098,
    billingReferenceOutputUsdPerMillion: 0.196,
    targetMargin: 0.55,
    minimumMarginFloor: 0.4,
    pricingVersion: 1,
    publishedAt: "2026-08-28T00:00:00.000Z",
  },
  "gpt-5.6-luna": {
    modelId: "gpt-5.6-luna",
    billingReferenceInputUsdPerMillion: 0.08,
    billingReferenceOutputUsdPerMillion: 0.48,
    targetMargin: 0.5,
    minimumMarginFloor: 0.35,
    pricingVersion: 1,
    publishedAt: "2026-08-28T00:00:00.000Z",
  },
  "gpt-5.6-terra": {
    modelId: "gpt-5.6-terra",
    billingReferenceInputUsdPerMillion: 2.5,
    billingReferenceOutputUsdPerMillion: 15,
    targetMargin: 0.3,
    minimumMarginFloor: 0.15,
    pricingVersion: 1,
    publishedAt: "2026-08-28T00:00:00.000Z",
  },
};

const GENERIC_PUBLISHED: PublishedModelPricing = {
  modelId: "__generic__",
  billingReferenceInputUsdPerMillion: 0.4,
  billingReferenceOutputUsdPerMillion: 0.4,
  targetMargin: 0.4,
  minimumMarginFloor: 0.25,
  pricingVersion: 1,
  publishedAt: "2026-08-28T00:00:00.000Z",
};

function normalizeId(id: string): string {
  return normalizePublishedModelId(id);
}

export type ResolvedPublishedPricing = {
  requestedModelId: string;
  canonicalModelId: string;
  pricing: PublishedModelPricing;
};

export function resolvePublishedPricingExact(modelId: string): ResolvedPublishedPricing | null {
  const requestedModelId = modelId.trim();
  const canonicalModelId = canonicalizePublishedModelId(requestedModelId);
  const pricing = PUBLISHED_CATALOG[canonicalModelId];
  if (!pricing) return null;
  if (pricing.modelId !== canonicalModelId) return null;
  return { requestedModelId, canonicalModelId, pricing };
}

export function getPublishedPricing(modelId: string): PublishedModelPricing {
  const canonical = canonicalizePublishedModelId(modelId);
  return PUBLISHED_CATALOG[canonical] ?? { ...GENERIC_PUBLISHED, modelId: canonical };
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

/** Exact catalog entries for integrity regression tests. */
export function listExactPublishedCatalogEntries(): ResolvedPublishedPricing[] {
  return listPublishedModelIds().map((canonicalModelId) => ({
    requestedModelId: canonicalModelId,
    canonicalModelId,
    pricing: PUBLISHED_CATALOG[canonicalModelId],
  }));
}

export function _setPublishedPricingForTest(entry: PublishedModelPricing, catalogKey?: string): void {
  PUBLISHED_CATALOG[catalogKey ?? normalizeId(entry.modelId)] = entry;
}
