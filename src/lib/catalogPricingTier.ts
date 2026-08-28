/**
 * CheaperInference tiered catalog pricing — tier selection by total prompt tokens.
 * @see https://cheaperinference.com/docs — pricing.above_threshold / input_token_price_threshold
 */

export type CatalogPricingTierRates = {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  cacheReadUsdPerMillion?: number;
  cacheWriteUsdPerMillion?: number;
  referenceInputUsdPerMillion?: number;
  referenceCacheReadUsdPerMillion?: number;
  referenceCacheWriteUsdPerMillion?: number;
  referenceOutputUsdPerMillion?: number;
};

export type CatalogPricingTierSelection = "base" | "above_threshold";

export function isAboveCatalogPricingThreshold(promptTokens: number, threshold: number): boolean {
  return promptTokens > threshold;
}

export function selectCatalogPricingTier(params: {
  promptTokens: number;
  inputTokenPriceThreshold?: number;
}): CatalogPricingTierSelection {
  const threshold = params.inputTokenPriceThreshold;
  if (threshold == null || threshold <= 0) return "base";
  return isAboveCatalogPricingThreshold(params.promptTokens, threshold) ? "above_threshold" : "base";
}

export function parseCatalogPricingTierBlock(
  block: Record<string, unknown> | undefined
): CatalogPricingTierRates | null {
  if (!block) return null;
  const inputUsdPerMillion = positiveNumber(block.input_per_million);
  const outputUsdPerMillion = positiveNumber(block.output_per_million);
  if (inputUsdPerMillion == null || outputUsdPerMillion == null) return null;

  const cacheReadUsdPerMillion = positiveNumber(block.cache_read_input_per_million);
  const cacheWriteUsdPerMillion = positiveNumber(block.cache_write_input_per_million);
  const referenceInputUsdPerMillion = positiveNumber(block.reference_input_per_million);
  const referenceCacheReadUsdPerMillion = positiveNumber(block.reference_cache_read_input_per_million);
  const referenceCacheWriteUsdPerMillion = positiveNumber(block.reference_cache_write_input_per_million);
  const referenceOutputUsdPerMillion = positiveNumber(block.reference_output_per_million);

  return {
    inputUsdPerMillion,
    outputUsdPerMillion,
    ...(cacheReadUsdPerMillion != null ? { cacheReadUsdPerMillion } : {}),
    ...(cacheWriteUsdPerMillion != null ? { cacheWriteUsdPerMillion } : {}),
    ...(referenceInputUsdPerMillion != null ? { referenceInputUsdPerMillion } : {}),
    ...(referenceCacheReadUsdPerMillion != null ? { referenceCacheReadUsdPerMillion } : {}),
    ...(referenceCacheWriteUsdPerMillion != null ? { referenceCacheWriteUsdPerMillion } : {}),
    ...(referenceOutputUsdPerMillion != null ? { referenceOutputUsdPerMillion } : {}),
  };
}

function positiveNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 && Number.isInteger(parsed) ? parsed : null;
}
