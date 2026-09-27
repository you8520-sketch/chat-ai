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
  type CheaperInferenceCatalogMeta,
  type CheaperInferenceCatalogPricing,
  replaceCheaperInferenceCatalogSnapshot,
} from "@/lib/cheaperInferenceCatalogPricing";
import {
  CHEAPER_INFERENCE_BASE_URL,
  buildCheaperInferenceHeaders,
  resolveCheaperInferenceApiKey,
} from "@/lib/cheaperInferenceConfig";
import {
  CACHE_RATE_PROVENANCE_INPUT_FALLBACK,
  CACHE_RATE_PROVENANCE_REPORTED,
} from "@/lib/modelPricingTrackingConfig";

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
  type?: unknown;
  endpoint?: unknown;
  provider?: unknown;
  aliases?: unknown;
  capabilities?: unknown;
  streaming?: unknown;
  reasoning?: unknown;
  vision?: unknown;
  video?: unknown;
  pricing?: CatalogModelPricingBlock;
};

function optionalTrimmedString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = [...new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))];
  return items.length > 0 ? items : undefined;
}

function parseCatalogCapabilities(model: CatalogModel): CheaperInferenceCatalogPricing["catalogCapabilities"] {
  const raw =
    model.capabilities && typeof model.capabilities === "object" && !Array.isArray(model.capabilities)
      ? (model.capabilities as Record<string, unknown>)
      : {};
  const capabilities = {
    streaming: optionalBoolean(raw.streaming) ?? optionalBoolean(model.streaming),
    reasoning: optionalBoolean(raw.reasoning) ?? optionalBoolean(model.reasoning),
    vision: optionalBoolean(raw.vision) ?? optionalBoolean(model.vision),
    video: optionalBoolean(raw.video) ?? optionalBoolean(model.video),
  };
  return Object.values(capabilities).some((value) => value !== undefined)
    ? capabilities
    : undefined;
}

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
export function parseCatalogPricing(
  model: CatalogModel,
  fetchedAt: number,
  catalogMeta: CheaperInferenceCatalogMeta = {}
): CheaperInferenceCatalogPricing | null {
  const modelId = typeof model.id === "string" ? model.id.trim().toLowerCase() : "";
  const pricing = model.pricing;
  if (!modelId || !pricing) return null;
  const catalogType = optionalTrimmedString(model.type)?.toLowerCase();
  const catalogEndpoint = optionalTrimmedString(model.endpoint);
  const catalogProvider = optionalTrimmedString(model.provider);
  const catalogAliases = stringArray(model.aliases);
  const catalogCapabilities = parseCatalogCapabilities(model);

  const inputUsdPerMillion = positiveNumber(pricing.input_per_million);
  const outputUsdPerMillion = positiveNumber(pricing.output_per_million);
  if (inputUsdPerMillion == null || outputUsdPerMillion == null) return null;

  const reportedCacheReadUsdPerMillion = positiveNumber(
    pricing.cache_read_input_per_million
  );
  const reportedCacheWriteUsdPerMillion = positiveNumber(
    pricing.cache_write_input_per_million
  );
  const cacheReadUsdPerMillion =
    reportedCacheReadUsdPerMillion ?? inputUsdPerMillion * 0.1;
  const cacheWriteUsdPerMillion =
    reportedCacheWriteUsdPerMillion ?? inputUsdPerMillion;
  const cacheReadRateProvenance =
    reportedCacheReadUsdPerMillion != null
      ? CACHE_RATE_PROVENANCE_REPORTED
      : CACHE_RATE_PROVENANCE_INPUT_FALLBACK;
  const cacheWriteRateProvenance =
    reportedCacheWriteUsdPerMillion != null
      ? CACHE_RATE_PROVENANCE_REPORTED
      : CACHE_RATE_PROVENANCE_INPUT_FALLBACK;
  const discountPercent = positiveNumber(pricing.discount_percent);
  const referenceInputUsdPerMillion = positiveNumber(pricing.reference_input_per_million);
  const referenceCacheReadUsdPerMillion = positiveNumber(pricing.reference_cache_read_input_per_million);
  const referenceCacheWriteUsdPerMillion = positiveNumber(pricing.reference_cache_write_input_per_million);
  const referenceOutputUsdPerMillion = positiveNumber(pricing.reference_output_per_million);
  const inputTokenPriceThreshold = positiveInteger(pricing.input_token_price_threshold);
  const aboveThreshold = parseAboveThresholdBlock(pricing.above_threshold);

  return {
    modelId,
    ...(catalogType ? { catalogType } : {}),
    ...(catalogEndpoint ? { catalogEndpoint } : {}),
    ...(catalogProvider ? { catalogProvider } : {}),
    ...(catalogAliases ? { catalogAliases } : {}),
    ...(catalogCapabilities ? { catalogCapabilities } : {}),
    ...(catalogMeta.pricingVersion ? { catalogPricingVersion: catalogMeta.pricingVersion } : {}),
    ...(catalogMeta.pricingCheckedAt ? { catalogPricingCheckedAt: catalogMeta.pricingCheckedAt } : {}),
    ...(catalogMeta.pricingUpdatedAt ? { catalogPricingUpdatedAt: catalogMeta.pricingUpdatedAt } : {}),
    inputUsdPerMillion,
    cacheReadUsdPerMillion,
    cacheWriteUsdPerMillion,
    cacheReadRateProvenance,
    cacheWriteRateProvenance,
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

  const data = (await response.json()) as {
    data?: CatalogModel[];
    pricing_version?: unknown;
    pricing_checked_at?: unknown;
    pricing_updated_at?: unknown;
  };
  const catalogMeta: CheaperInferenceCatalogMeta = {
    ...(optionalTrimmedString(data.pricing_version)
      ? { pricingVersion: optionalTrimmedString(data.pricing_version) }
      : {}),
    ...(optionalTrimmedString(data.pricing_checked_at)
      ? { pricingCheckedAt: optionalTrimmedString(data.pricing_checked_at) }
      : {}),
    ...(optionalTrimmedString(data.pricing_updated_at)
      ? { pricingUpdatedAt: optionalTrimmedString(data.pricing_updated_at) }
      : {}),
  };
  const fetchedAt = Date.now();
  const parsedCatalog: CheaperInferenceCatalogPricing[] = [];
  for (const model of data.data ?? []) {
    const parsed = parseCatalogPricing(model, fetchedAt, catalogMeta);
    if (!parsed) continue;
    parsedCatalog.push(parsed);
  }
  if (parsedCatalog.length <= 0) throw new Error("CheaperInference catalog is empty");
  replaceCheaperInferenceCatalogSnapshot(parsedCatalog);
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

/** TEST-ONLY: reset TTL gate so the next refresh performs a live fetch attempt. */
export function resetCheaperInferenceCatalogRefreshForTest(): void {
  lastRefreshAt = 0;
  inFlight = null;
}
