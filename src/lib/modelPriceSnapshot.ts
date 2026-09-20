/**
 * Runtime price snapshot builder — captures CI catalog + published baseline without mutation.
 */

import { createHash } from "node:crypto";
import type { CheaperInferenceCatalogPricing } from "@/lib/cheaperInferenceCatalogPricing";
import {
  CHEAPER_INFERENCE_MODELS_SOURCE_URL,
  type PriceSnapshotPricingMode,
  type PriceSnapshotSourceKind,
} from "@/lib/modelPricingTrackingConfig";
import type { ModelPricingPolicy } from "@/lib/modelPricingPolicy";
import type { PublishedModelPricing } from "@/lib/publishedModelPricing";

export type PriceRateSnapshot = {
  inputUsdPerMillion: number | null;
  outputUsdPerMillion: number | null;
  cacheReadUsdPerMillion: number | null;
  cacheWriteUsdPerMillion: number | null;
  tierThreshold: number | null;
  discountPercent: number | null;
};

export type ModelPriceSnapshotRecord = {
  provider: string;
  modelId: string;
  providerModelId: string;
  pricingMode: PriceSnapshotPricingMode;
  sourceKind: PriceSnapshotSourceKind;
  sourceUrl: string;
  rates: PriceRateSnapshot;
  rawFingerprint: string;
  observedAt: string;
  validFrom: string | null;
  validUntil: string | null;
};

function stableJson(value: unknown): string {
  return JSON.stringify(value, Object.keys(value as object).sort());
}

export function fingerprintRates(payload: Record<string, unknown>): string {
  return createHash("sha256").update(stableJson(payload)).digest("hex");
}

function finiteOrNull(value: number | undefined | null): number | null {
  return value != null && Number.isFinite(value) && value > 0 ? value : null;
}

export function buildCiCurrentSnapshot(params: {
  policy: ModelPricingPolicy;
  catalog: CheaperInferenceCatalogPricing;
  observedAt: string;
}): ModelPriceSnapshotRecord {
  const { catalog, policy, observedAt } = params;
  const rates: PriceRateSnapshot = {
    inputUsdPerMillion: finiteOrNull(catalog.inputUsdPerMillion),
    outputUsdPerMillion: finiteOrNull(catalog.outputUsdPerMillion),
    cacheReadUsdPerMillion: finiteOrNull(catalog.cacheReadUsdPerMillion),
    cacheWriteUsdPerMillion: finiteOrNull(catalog.cacheWriteUsdPerMillion),
    tierThreshold: catalog.inputTokenPriceThreshold ?? null,
    discountPercent: catalog.discountPercent ?? null,
  };
  return {
    provider: policy.provider,
    modelId: policy.modelId,
    providerModelId: catalog.modelId,
    pricingMode: "procurement_current",
    sourceKind: "cheaper_inference_models_current",
    sourceUrl: CHEAPER_INFERENCE_MODELS_SOURCE_URL,
    rates,
    rawFingerprint: fingerprintRates({
      kind: "ci_current",
      modelId: policy.modelId,
      providerModelId: catalog.modelId,
      ...rates,
    }),
    observedAt,
    validFrom: null,
    validUntil: null,
  };
}

export function buildCiReferenceSnapshot(params: {
  policy: ModelPricingPolicy;
  catalog: CheaperInferenceCatalogPricing;
  observedAt: string;
}): ModelPriceSnapshotRecord | null {
  const { catalog, policy, observedAt } = params;
  const input = finiteOrNull(catalog.referenceInputUsdPerMillion);
  const output = finiteOrNull(catalog.referenceOutputUsdPerMillion);
  if (input == null || output == null) return null;

  const rates: PriceRateSnapshot = {
    inputUsdPerMillion: input,
    outputUsdPerMillion: output,
    cacheReadUsdPerMillion: finiteOrNull(catalog.referenceCacheReadUsdPerMillion),
    cacheWriteUsdPerMillion: finiteOrNull(catalog.referenceCacheWriteUsdPerMillion),
    tierThreshold: catalog.inputTokenPriceThreshold ?? null,
    discountPercent: null,
  };
  return {
    provider: policy.provider,
    modelId: policy.modelId,
    providerModelId: catalog.modelId,
    pricingMode:
      policy.baselineMode === "PROVIDER_PEAK" ? "provider_peak" : "provider_standard",
    sourceKind: "cheaper_inference_models_reference",
    sourceUrl: CHEAPER_INFERENCE_MODELS_SOURCE_URL,
    rates,
    rawFingerprint: fingerprintRates({
      kind: "ci_reference",
      modelId: policy.modelId,
      providerModelId: catalog.modelId,
      ...rates,
    }),
    observedAt,
    validFrom: null,
    validUntil: null,
  };
}

export function buildPublishedBaselineSnapshot(params: {
  policy: ModelPricingPolicy;
  published: PublishedModelPricing;
  observedAt: string;
}): ModelPriceSnapshotRecord {
  const { policy, published, observedAt } = params;
  const rates: PriceRateSnapshot = {
    inputUsdPerMillion: finiteOrNull(published.billingReferenceInputUsdPerMillion),
    outputUsdPerMillion: finiteOrNull(published.billingReferenceOutputUsdPerMillion),
    cacheReadUsdPerMillion: finiteOrNull(published.billingReferenceCacheReadUsdPerMillion),
    cacheWriteUsdPerMillion: finiteOrNull(published.billingReferenceCacheWriteUsdPerMillion),
    tierThreshold: published.publishedBaseTierMaxPromptTokens ?? null,
    discountPercent: null,
  };
  return {
    provider: policy.provider,
    modelId: policy.modelId,
    providerModelId: policy.expectedProviderModelId,
    pricingMode: "provider_standard",
    sourceKind: "published_billing_baseline",
    sourceUrl: "code:publishedModelPricing.ts",
    rates,
    rawFingerprint: fingerprintRates({
      kind: "published_baseline",
      modelId: policy.modelId,
      pricingVersion: published.pricingVersion,
      ...rates,
    }),
    observedAt,
    validFrom: published.publishedAt,
    validUntil: null,
  };
}

export function snapshotRatesEqual(a: PriceRateSnapshot, b: PriceRateSnapshot): boolean {
  return (
    a.inputUsdPerMillion === b.inputUsdPerMillion &&
    a.outputUsdPerMillion === b.outputUsdPerMillion &&
    a.cacheReadUsdPerMillion === b.cacheReadUsdPerMillion &&
    a.cacheWriteUsdPerMillion === b.cacheWriteUsdPerMillion &&
    a.tierThreshold === b.tierThreshold &&
    a.discountPercent === b.discountPercent
  );
}

/** Billing baseline equivalence — ignores tier/discount metadata used for procurement classification. */
export function snapshotBaselineRatesEqual(a: PriceRateSnapshot, b: PriceRateSnapshot): boolean {
  return (
    a.inputUsdPerMillion === b.inputUsdPerMillion &&
    a.outputUsdPerMillion === b.outputUsdPerMillion &&
    a.cacheReadUsdPerMillion === b.cacheReadUsdPerMillion &&
    a.cacheWriteUsdPerMillion === b.cacheWriteUsdPerMillion
  );
}

export function maxRelativeRateDelta(prev: PriceRateSnapshot, next: PriceRateSnapshot): number {
  const pairs: Array<[number | null, number | null]> = [
    [prev.inputUsdPerMillion, next.inputUsdPerMillion],
    [prev.outputUsdPerMillion, next.outputUsdPerMillion],
    [prev.cacheReadUsdPerMillion, next.cacheReadUsdPerMillion],
    [prev.cacheWriteUsdPerMillion, next.cacheWriteUsdPerMillion],
  ];
  let max = 0;
  for (const [oldRate, newRate] of pairs) {
    if (oldRate == null || newRate == null || oldRate <= 0) continue;
    const delta = Math.abs(newRate - oldRate) / oldRate;
    if (delta > max) max = delta;
  }
  return max;
}
