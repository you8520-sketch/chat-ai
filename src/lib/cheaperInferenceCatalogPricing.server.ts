/**
 * CheaperInference /v1/models catalog parser — tier-aware.
 * Field names match https://cheaperinference.com/docs
 */

import {
  parseCatalogPricingTierBlock,
  positiveInteger,
  type CatalogPricingTierRates,
} from "@/lib/catalogPricingTier";
import {
  type CheaperInferenceCatalogPricing,
  updateCheaperInferenceCatalogPricing,
} from "@/lib/cheaperInferenceCatalogPricing";
import {
  CHEAPER_INFERENCE_BASE_URL,
  buildCheaperInferenceHeaders,
  resolveCheaperInferenceApiKey,
} from "@/lib/cheaperInferenceConfig";

const CATALOG_TTL_MS = 60_000;

let lastRefreshAt = 0;
let inFlight: Promise<boolean> | null = null;

export type CatalogModelPricingBlock = {
  input_per_million?: unknown;
  cache_read_input_per_million?: unknown;
  cache_write_input_per_million?: unknown;
  output_per_million?: unknown;
  reference_input_per_million?: unknown;
  reference_cache_read_input_per_million?: unknown;
  reference_cache_write_input_per_million?: unknown;
  reference_output_per_million?: unknown;
  discount_percent?: unknown;
  input_token_price_threshold?: unknown;
  above_threshold?: Record<string, unknown>;
};

export type CatalogModel = {
  id?: unknown;
  pricing?: CatalogModelPricingBlock;
};

function positiveNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseAboveThresholdBlock(
  block: Record<string, unknown> | undefined
): CatalogPricingTierRates | undefined {
  const parsed = parseCatalogPricingTierBlock(block);
  return parsed ?? undefined;
}

/** Exported for fixture tests — mirrors GET /v1/models item parsing. */
export function parseCatalogPricing(model: CatalogModel, fetchedAt: number): CheaperInferenceCatalogPricing | null {
  const modelId = typeof model.id === "string" ? model.id.trim().toLowerCase() : "";
  const pricing = model.pricing;
  if (!modelId || !pricing) return null;

  const inputUsdPerMillion = positiveNumber(pricing.input_per_million);
  const outputUsdPerMillion = positiveNumber(pricing.output_per_million);
  if (inputUsdPerMillion == null || outputUsdPerMillion == null) return null;

  const cacheReadUsdPerMillion =
    positiveNumber(pricing.cache_read_input_per_million) ?? inputUsdPerMillion * 0.1;
  const cacheWriteUsdPerMillion =
    positiveNumber(pricing.cache_write_input_per_million) ?? inputUsdPerMillion;
  const discountPercent = positiveNumber(pricing.discount_percent);
  const referenceInputUsdPerMillion = positiveNumber(pricing.reference_input_per_million);
  const referenceCacheReadUsdPerMillion = positiveNumber(pricing.reference_cache_read_input_per_million);
  const referenceCacheWriteUsdPerMillion = positiveNumber(pricing.reference_cache_write_input_per_million);
  const referenceOutputUsdPerMillion = positiveNumber(pricing.reference_output_per_million);
  const inputTokenPriceThreshold = positiveInteger(pricing.input_token_price_threshold);
  const aboveThreshold = parseAboveThresholdBlock(pricing.above_threshold);

  return {
    modelId,
    inputUsdPerMillion,
    cacheReadUsdPerMillion,
    cacheWriteUsdPerMillion,
    outputUsdPerMillion,
    ...(referenceInputUsdPerMillion != null ? { referenceInputUsdPerMillion } : {}),
    ...(referenceCacheReadUsdPerMillion != null ? { referenceCacheReadUsdPerMillion } : {}),
    ...(referenceCacheWriteUsdPerMillion != null ? { referenceCacheWriteUsdPerMillion } : {}),
    ...(referenceOutputUsdPerMillion != null ? { referenceOutputUsdPerMillion } : {}),
    ...(discountPercent != null ? { discountPercent } : {}),
    ...(inputTokenPriceThreshold != null ? { inputTokenPriceThreshold } : {}),
    ...(aboveThreshold ? { aboveThreshold } : {}),
    fetchedAt,
  };
}

async function refreshCatalog(): Promise<boolean> {
  let key: string;
  try {
    key = resolveCheaperInferenceApiKey();
  } catch {
    return false;
  }

  const response = await fetch(`${CHEAPER_INFERENCE_BASE_URL}/models`, {
    headers: buildCheaperInferenceHeaders(key),
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`CheaperInference catalog ${response.status}`);
  }

  const data = (await response.json()) as { data?: CatalogModel[] };
  const fetchedAt = Date.now();
  let updated = 0;
  for (const model of data.data ?? []) {
    const parsed = parseCatalogPricing(model, fetchedAt);
    if (!parsed) continue;
    updateCheaperInferenceCatalogPricing(parsed);
    updated += 1;
  }
  if (updated <= 0) throw new Error("CheaperInference catalog is empty");
  lastRefreshAt = fetchedAt;
  return true;
}

export async function refreshCheaperInferenceCatalogPricing(opts?: {
  force?: boolean;
}): Promise<boolean> {
  if (!opts?.force && Date.now() - lastRefreshAt < CATALOG_TTL_MS) {
    return true;
  }
  if (inFlight) return inFlight;

  inFlight = refreshCatalog()
    .catch((error) => {
      console.warn(
        "[CheaperInference pricing] live catalog refresh skipped:",
        (error as Error).message
      );
      return false;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}
