export type CheaperInferenceCatalogPricing = {
  modelId: string;
  /** Current customer-facing discounted rate */
  inputUsdPerMillion: number;
  cacheReadUsdPerMillion: number;
  cacheWriteUsdPerMillion: number;
  outputUsdPerMillion: number;
  /** Undiscounted list/reference rate — canonical for providerListCost */
  referenceInputUsdPerMillion?: number;
  referenceCacheReadUsdPerMillion?: number;
  referenceCacheWriteUsdPerMillion?: number;
  referenceOutputUsdPerMillion?: number;
  discountPercent?: number;
  fetchedAt: number;
};

const pricingByModel = new Map<string, CheaperInferenceCatalogPricing>();

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

export function clearCheaperInferenceCatalogPricingForTest(): void {
  pricingByModel.clear();
}
