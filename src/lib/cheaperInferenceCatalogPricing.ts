import type { CacheRateProvenance } from "@/lib/modelPricingTrackingConfig";
import type { CatalogPricingTierRates, CatalogPricingTierSelection } from "@/lib/catalogPricingTier";
import { selectCatalogPricingTier } from "@/lib/catalogPricingTier";

export type ResolvedCatalogRates = {
  tier: CatalogPricingTierSelection;
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  cacheReadUsdPerMillion?: number;
  cacheWriteUsdPerMillion?: number;
  referenceInputUsdPerMillion?: number;
  referenceCacheReadUsdPerMillion?: number;
  referenceCacheWriteUsdPerMillion?: number;
  referenceOutputUsdPerMillion?: number;
};

export function resolveCatalogRatesForPrompt(
  catalog: CheaperInferenceCatalogPricing,
  promptTokens: number
): ResolvedCatalogRates {
  const tier = selectCatalogPricingTier({
    promptTokens,
    inputTokenPriceThreshold: catalog.inputTokenPriceThreshold,
  });
  if (tier === "above_threshold" && catalog.aboveThreshold) {
    const above = catalog.aboveThreshold;
    return {
      tier,
      inputUsdPerMillion: above.inputUsdPerMillion,
      outputUsdPerMillion: above.outputUsdPerMillion,
      cacheReadUsdPerMillion: above.cacheReadUsdPerMillion,
      cacheWriteUsdPerMillion: above.cacheWriteUsdPerMillion,
      referenceInputUsdPerMillion: above.referenceInputUsdPerMillion,
      referenceCacheReadUsdPerMillion: above.referenceCacheReadUsdPerMillion,
      referenceCacheWriteUsdPerMillion: above.referenceCacheWriteUsdPerMillion,
      referenceOutputUsdPerMillion: above.referenceOutputUsdPerMillion,
    };
  }
  return {
    tier: "base",
    inputUsdPerMillion: catalog.inputUsdPerMillion,
    outputUsdPerMillion: catalog.outputUsdPerMillion,
    cacheReadUsdPerMillion: catalog.cacheReadUsdPerMillion,
    cacheWriteUsdPerMillion: catalog.cacheWriteUsdPerMillion,
    referenceInputUsdPerMillion: catalog.referenceInputUsdPerMillion,
    referenceCacheReadUsdPerMillion: catalog.referenceCacheReadUsdPerMillion,
    referenceCacheWriteUsdPerMillion: catalog.referenceCacheWriteUsdPerMillion,
    referenceOutputUsdPerMillion: catalog.referenceOutputUsdPerMillion,
  };
}

export type CheaperInferenceCatalogCapabilities = {
  streaming?: boolean;
  reasoning?: boolean;
  vision?: boolean;
  video?: boolean;
};

export type CheaperInferenceCatalogMeta = {
  pricingVersion?: string;
  pricingCheckedAt?: string;
  pricingUpdatedAt?: string;
};

export type CheaperInferenceCatalogPricing = {
  modelId: string;
  /** Provider catalog identity/capability evidence — never a product routing decision. */
  catalogType?: string;
  catalogEndpoint?: string;
  catalogProvider?: string;
  catalogAliases?: string[];
  catalogCapabilities?: CheaperInferenceCatalogCapabilities;
  catalogPricingVersion?: string;
  catalogPricingCheckedAt?: string;
  catalogPricingUpdatedAt?: string;
  /** Current customer-facing discounted rate — base tier */
  inputUsdPerMillion: number;
  cacheReadUsdPerMillion: number;
  cacheWriteUsdPerMillion: number;
  cacheReadRateProvenance?: CacheRateProvenance;
  cacheWriteRateProvenance?: CacheRateProvenance;
  outputUsdPerMillion: number;
  /** Undiscounted list/reference rate — canonical for providerListCost (base tier) */
  referenceInputUsdPerMillion?: number;
  referenceCacheReadUsdPerMillion?: number;
  referenceCacheWriteUsdPerMillion?: number;
  referenceOutputUsdPerMillion?: number;
  /** Total prompt tokens at or below this value use base-tier rates. */
  inputTokenPriceThreshold?: number;
  /** Above-threshold tier — from pricing.above_threshold in CI /v1/models */
  aboveThreshold?: CatalogPricingTierRates;
  discountPercent?: number;
  fetchedAt: number;
};

const pricingByModel = new Map<string, CheaperInferenceCatalogPricing>();
let latestSuccessfulCatalogSnapshot: CheaperInferenceCatalogPricing[] = [];

function normalizeModelId(modelId: string): string {
  return modelId.trim().toLowerCase();
}

export function resolveCheaperInferenceCatalogPricing(
  modelId: string
): CheaperInferenceCatalogPricing | null {
  return pricingByModel.get(normalizeModelId(modelId)) ?? null;
}

export function updateCheaperInferenceCatalogPricing(
  pricing: CheaperInferenceCatalogPricing
): void {
  pricingByModel.set(normalizeModelId(pricing.modelId), {
    ...pricing,
    modelId: normalizeModelId(pricing.modelId),
  });
}

/**
 * Exact model inventory from the latest successful /v1/models response.
 * This is intentionally separate from the resilient per-model cache: a model
 * absent from the newest provider catalog must not remain a discovery signal
 * merely because its last known price is still useful as a fallback.
 */
export function replaceCheaperInferenceCatalogSnapshot(
  pricing: readonly CheaperInferenceCatalogPricing[]
): void {
  latestSuccessfulCatalogSnapshot = pricing
    .map((row) => ({ ...row, modelId: normalizeModelId(row.modelId) }))
    .sort((a, b) => a.modelId.localeCompare(b.modelId));
  for (const row of latestSuccessfulCatalogSnapshot) {
    updateCheaperInferenceCatalogPricing(row);
  }
}

export function listLatestCheaperInferenceCatalogSnapshot(): CheaperInferenceCatalogPricing[] {
  return latestSuccessfulCatalogSnapshot.map((row) => ({ ...row }));
}

export function clearCheaperInferenceCatalogPricingForTest(): void {
  pricingByModel.clear();
  latestSuccessfulCatalogSnapshot = [];
}
