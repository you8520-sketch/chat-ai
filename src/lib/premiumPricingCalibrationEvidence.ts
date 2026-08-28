/**
 * Premium model calibration evidence — historical snapshots for Gemini 3.1 / Opus 5.
 * Live provider state owner remains resolveCheaperInferenceCatalogPricing().
 */

import type { PublishedModelPricing } from "@/lib/publishedModelPricing";
import { resolveCheaperInferenceCatalogPricing } from "@/lib/cheaperInferenceCatalogPricing";

export type PremiumEvidenceSourceKind =
  | "provider_public_model_page"
  | "provider_catalog_snapshot";

export type PremiumPricingCalibrationEvidence = {
  provider: "cheaper_inference";
  modelId: string;
  observedAt: string;
  sourceKind: PremiumEvidenceSourceKind;
  referenceInputUsdPerMillion: number;
  referenceOutputUsdPerMillion: number;
  observedCurrentInputUsdPerMillion: number;
  observedCurrentOutputUsdPerMillion: number;
  observedDiscountPercent: number | null;
  referenceCacheReadUsdPerMillion: number | null;
  referenceCacheWriteUsdPerMillion: number | null;
};

export const GEMINI31_MODEL_ID = "gemini-3.1-pro-preview";
export const OPUS5_MODEL_ID = "claude-opus-5";

export const PREMIUM_PRICING_CALIBRATION_EVIDENCE: Record<string, PremiumPricingCalibrationEvidence> = {
  [GEMINI31_MODEL_ID]: {
    provider: "cheaper_inference",
    modelId: GEMINI31_MODEL_ID,
    observedAt: "2026-08-28T00:00:00.000Z",
    sourceKind: "provider_catalog_snapshot",
    referenceInputUsdPerMillion: 2,
    referenceOutputUsdPerMillion: 12,
    observedCurrentInputUsdPerMillion: 1.4,
    observedCurrentOutputUsdPerMillion: 8.4,
    observedDiscountPercent: 30,
    referenceCacheReadUsdPerMillion: 0.5,
    referenceCacheWriteUsdPerMillion: 2,
  },
  [OPUS5_MODEL_ID]: {
    provider: "cheaper_inference",
    modelId: OPUS5_MODEL_ID,
    observedAt: "2026-08-28T00:00:00.000Z",
    sourceKind: "provider_catalog_snapshot",
    referenceInputUsdPerMillion: 5,
    referenceOutputUsdPerMillion: 25,
    observedCurrentInputUsdPerMillion: 3.5,
    observedCurrentOutputUsdPerMillion: 17.5,
    observedDiscountPercent: 30,
    referenceCacheReadUsdPerMillion: 0.5,
    referenceCacheWriteUsdPerMillion: 6.25,
  },
};

export type CacheEvidenceStatus = "VERIFIED" | "PARTIAL" | "UNAVAILABLE";

export type CacheEvidenceAudit = {
  status: CacheEvidenceStatus;
  publishedCacheReadUsdPerMillion: number | null;
  publishedCacheWriteUsdPerMillion: number | null;
  catalogCacheReadUsdPerMillion: number | null;
  catalogCacheWriteUsdPerMillion: number | null;
};

export function auditPremiumCacheEvidence(
  modelId: string,
  published: PublishedModelPricing
): CacheEvidenceAudit {
  const live = resolveCheaperInferenceCatalogPricing(modelId);
  const pubRead = published.billingReferenceCacheReadUsdPerMillion ?? null;
  const pubWrite = published.billingReferenceCacheWriteUsdPerMillion ?? null;
  const catRead = live?.referenceCacheReadUsdPerMillion ?? null;
  const catWrite = live?.referenceCacheWriteUsdPerMillion ?? null;

  if (catRead == null && catWrite == null) {
    return {
      status: "UNAVAILABLE",
      publishedCacheReadUsdPerMillion: pubRead,
      publishedCacheWriteUsdPerMillion: pubWrite,
      catalogCacheReadUsdPerMillion: catRead,
      catalogCacheWriteUsdPerMillion: catWrite,
    };
  }

  const readMatch = pubRead == null || catRead == null || pubRead === catRead;
  const writeMatch = pubWrite == null || catWrite == null || pubWrite === catWrite;
  const status: CacheEvidenceStatus =
    readMatch && writeMatch && catRead != null && catWrite != null
      ? "VERIFIED"
      : catRead != null || catWrite != null
        ? "PARTIAL"
        : "UNAVAILABLE";

  return {
    status,
    publishedCacheReadUsdPerMillion: pubRead,
    publishedCacheWriteUsdPerMillion: pubWrite,
    catalogCacheReadUsdPerMillion: catRead,
    catalogCacheWriteUsdPerMillion: catWrite,
  };
}

export function referenceEvidenceMatchesPublished(
  modelId: string,
  published: PublishedModelPricing
): boolean {
  const evidence = PREMIUM_PRICING_CALIBRATION_EVIDENCE[modelId];
  if (!evidence) return false;
  return (
    published.billingReferenceInputUsdPerMillion === evidence.referenceInputUsdPerMillion &&
    published.billingReferenceOutputUsdPerMillion === evidence.referenceOutputUsdPerMillion
  );
}

export type LiveReferenceDriftStatus = "MATCH" | "DRIFT" | "UNAVAILABLE";

export function evaluatePremiumLiveReferenceDrift(
  modelId: string,
  published: PublishedModelPricing
): {
  status: LiveReferenceDriftStatus;
  liveReferenceMatchesPublished: boolean | null;
  fetchedAt: number | null;
} {
  const live = resolveCheaperInferenceCatalogPricing(modelId);
  const liveInput = live?.referenceInputUsdPerMillion ?? null;
  const liveOutput = live?.referenceOutputUsdPerMillion ?? null;
  if (liveInput == null || liveOutput == null) {
    return { status: "UNAVAILABLE", liveReferenceMatchesPublished: null, fetchedAt: live?.fetchedAt ?? null };
  }
  const matches =
    liveInput === published.billingReferenceInputUsdPerMillion &&
    liveOutput === published.billingReferenceOutputUsdPerMillion;
  return {
    status: matches ? "MATCH" : "DRIFT",
    liveReferenceMatchesPublished: matches,
    fetchedAt: live?.fetchedAt ?? null,
  };
}
