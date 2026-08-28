/**
 * Premium model calibration evidence — provenance-separated snapshots.
 * Live provider state owner remains resolveCheaperInferenceCatalogPricing().
 */

import type { PublishedModelPricing } from "@/lib/publishedModelPricing";
import { resolveCheaperInferenceCatalogPricing } from "@/lib/cheaperInferenceCatalogPricing";
import {
  GEMINI31_BASE_TIER_PROMPT_THRESHOLD,
  GEMINI31_MODEL_ID,
  OPUS5_MODEL_ID,
} from "@/lib/premiumModelIds";
import { getModelShadowPricingPolicy } from "@/lib/modelShadowPricingPolicy";

export type PricingEvidenceSourceKind =
  | "provider_official_pricing"
  | "cheaper_inference_catalog_snapshot";

export type PricingEvidenceScope = {
  maxPromptTokens?: number;
  minPromptTokens?: number;
  cacheTtl?: "5m" | "1h";
};

export type PricingEvidence = {
  modelId: string;
  sourceKind: PricingEvidenceSourceKind;
  observedAt: string;
  sourceLabel: string;
  scope?: PricingEvidenceScope;
  inputUsdPerMillion?: number;
  outputUsdPerMillion?: number;
  cacheReadUsdPerMillion?: number | null;
  cacheWriteUsdPerMillion?: number | null;
  observedDiscountPercent?: number | null;
};

export { GEMINI31_MODEL_ID, OPUS5_MODEL_ID } from "@/lib/premiumModelIds";

/** Official provider base-tier reference — <=200k prompt tokens. */
export const GEMINI31_OFFICIAL_BASE_TIER_EVIDENCE: PricingEvidence = {
  modelId: GEMINI31_MODEL_ID,
  sourceKind: "provider_official_pricing",
  observedAt: "2026-08-28T00:00:00.000Z",
  sourceLabel: "Google Gemini 3.1 Pro Preview official list (base tier <=200k)",
  scope: { maxPromptTokens: GEMINI31_BASE_TIER_PROMPT_THRESHOLD },
  inputUsdPerMillion: 2,
  outputUsdPerMillion: 12,
  cacheReadUsdPerMillion: null,
  cacheWriteUsdPerMillion: null,
};

/** Historical CI observed discount — calibration only, not live pricing owner. */
export const GEMINI31_CI_OBSERVED_DISCOUNT_EVIDENCE: PricingEvidence = {
  modelId: GEMINI31_MODEL_ID,
  sourceKind: "cheaper_inference_catalog_snapshot",
  observedAt: "2026-08-28T00:00:00.000Z",
  sourceLabel: "CheaperInference catalog snapshot (historical observed discount)",
  scope: { maxPromptTokens: GEMINI31_BASE_TIER_PROMPT_THRESHOLD },
  inputUsdPerMillion: 1.4,
  outputUsdPerMillion: 8.4,
  observedDiscountPercent: 30,
};

export const OPUS5_OFFICIAL_BASE_EVIDENCE: PricingEvidence = {
  modelId: OPUS5_MODEL_ID,
  sourceKind: "provider_official_pricing",
  observedAt: "2026-08-28T00:00:00.000Z",
  sourceLabel: "Anthropic Claude Opus official list",
  inputUsdPerMillion: 5,
  outputUsdPerMillion: 25,
  cacheReadUsdPerMillion: 0.5,
  cacheWriteUsdPerMillion: 6.25,
  scope: { cacheTtl: "5m" },
};

export const OPUS5_CI_OBSERVED_DISCOUNT_EVIDENCE: PricingEvidence = {
  modelId: OPUS5_MODEL_ID,
  sourceKind: "cheaper_inference_catalog_snapshot",
  observedAt: "2026-08-28T00:00:00.000Z",
  sourceLabel: "CheaperInference catalog snapshot (historical observed discount)",
  inputUsdPerMillion: 3.5,
  outputUsdPerMillion: 17.5,
  observedDiscountPercent: 30,
};

/** @deprecated Use GEMINI31_OFFICIAL_BASE_TIER_EVIDENCE — kept for calibration fixture builder */
export const PREMIUM_PRICING_CALIBRATION_EVIDENCE = {
  [GEMINI31_MODEL_ID]: {
    provider: "cheaper_inference" as const,
    modelId: GEMINI31_MODEL_ID,
    observedAt: GEMINI31_CI_OBSERVED_DISCOUNT_EVIDENCE.observedAt,
    sourceKind: "provider_catalog_snapshot" as const,
    referenceInputUsdPerMillion: GEMINI31_OFFICIAL_BASE_TIER_EVIDENCE.inputUsdPerMillion!,
    referenceOutputUsdPerMillion: GEMINI31_OFFICIAL_BASE_TIER_EVIDENCE.outputUsdPerMillion!,
    observedCurrentInputUsdPerMillion: GEMINI31_CI_OBSERVED_DISCOUNT_EVIDENCE.inputUsdPerMillion!,
    observedCurrentOutputUsdPerMillion: GEMINI31_CI_OBSERVED_DISCOUNT_EVIDENCE.outputUsdPerMillion!,
    observedDiscountPercent: GEMINI31_CI_OBSERVED_DISCOUNT_EVIDENCE.observedDiscountPercent ?? null,
    referenceCacheReadUsdPerMillion: null,
    referenceCacheWriteUsdPerMillion: null,
  },
  [OPUS5_MODEL_ID]: {
    provider: "cheaper_inference" as const,
    modelId: OPUS5_MODEL_ID,
    observedAt: OPUS5_CI_OBSERVED_DISCOUNT_EVIDENCE.observedAt,
    sourceKind: "provider_catalog_snapshot" as const,
    referenceInputUsdPerMillion: OPUS5_OFFICIAL_BASE_EVIDENCE.inputUsdPerMillion!,
    referenceOutputUsdPerMillion: OPUS5_OFFICIAL_BASE_EVIDENCE.outputUsdPerMillion!,
    observedCurrentInputUsdPerMillion: OPUS5_CI_OBSERVED_DISCOUNT_EVIDENCE.inputUsdPerMillion!,
    observedCurrentOutputUsdPerMillion: OPUS5_CI_OBSERVED_DISCOUNT_EVIDENCE.outputUsdPerMillion!,
    observedDiscountPercent: OPUS5_CI_OBSERVED_DISCOUNT_EVIDENCE.observedDiscountPercent ?? null,
    referenceCacheReadUsdPerMillion: OPUS5_OFFICIAL_BASE_EVIDENCE.cacheReadUsdPerMillion ?? null,
    referenceCacheWriteUsdPerMillion: OPUS5_OFFICIAL_BASE_EVIDENCE.cacheWriteUsdPerMillion ?? null,
  },
};

export type CacheEvidenceStatus =
  | "VERIFIED"
  | "VERIFIED_5M"
  | "PARTIAL"
  | "UNVERIFIED"
  | "UNAVAILABLE";

export type CacheEvidenceAudit = {
  status: CacheEvidenceStatus;
  publishedCacheReadUsdPerMillion: number | null;
  publishedCacheWriteUsdPerMillion: number | null;
  catalogCacheReadUsdPerMillion: number | null;
  catalogCacheWriteUsdPerMillion: number | null;
  note?: string;
};

export function auditPremiumCacheEvidence(
  modelId: string,
  published: PublishedModelPricing
): CacheEvidenceAudit {
  const policy = getModelShadowPricingPolicy(modelId);
  if (policy?.cachePolicyStatus === "unverified") {
    return {
      status: "UNVERIFIED",
      publishedCacheReadUsdPerMillion: published.billingReferenceCacheReadUsdPerMillion ?? null,
      publishedCacheWriteUsdPerMillion: published.billingReferenceCacheWriteUsdPerMillion ?? null,
      catalogCacheReadUsdPerMillion: null,
      catalogCacheWriteUsdPerMillion: null,
      note: "Gemini cache semantics not verified — storage/TTL differs from per-million write fields",
    };
  }

  const live = resolveCheaperInferenceCatalogPricing(modelId);
  const pubRead = published.billingReferenceCacheReadUsdPerMillion ?? null;
  const pubWrite = published.billingReferenceCacheWriteUsdPerMillion ?? null;
  const catRead = live?.referenceCacheReadUsdPerMillion ?? null;
  const catWrite = live?.referenceCacheWriteUsdPerMillion ?? null;

  if (policy?.cachePolicyStatus === "verified_5m") {
    const readOk = pubRead == null || pubRead === 0.5;
    const writeOk = pubWrite == null || pubWrite === 6.25;
    return {
      status: readOk && writeOk ? "VERIFIED_5M" : "PARTIAL",
      publishedCacheReadUsdPerMillion: pubRead,
      publishedCacheWriteUsdPerMillion: pubWrite,
      catalogCacheReadUsdPerMillion: catRead,
      catalogCacheWriteUsdPerMillion: catWrite,
      note: "Production cache_control uses Anthropic ephemeral default (~5m TTL)",
    };
  }

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

export function referenceEvidenceMatchesPublishedBaseTier(
  modelId: string,
  published: PublishedModelPricing
): boolean {
  const evidence =
    modelId === GEMINI31_MODEL_ID
      ? GEMINI31_OFFICIAL_BASE_TIER_EVIDENCE
      : modelId === OPUS5_MODEL_ID
        ? OPUS5_OFFICIAL_BASE_EVIDENCE
        : null;
  if (!evidence?.inputUsdPerMillion || !evidence.outputUsdPerMillion) return false;
  return (
    published.billingReferenceInputUsdPerMillion === evidence.inputUsdPerMillion &&
    published.billingReferenceOutputUsdPerMillion === evidence.outputUsdPerMillion
  );
}

/** @deprecated use referenceEvidenceMatchesPublishedBaseTier */
export function referenceEvidenceMatchesPublished(
  modelId: string,
  published: PublishedModelPricing
): boolean {
  return referenceEvidenceMatchesPublishedBaseTier(modelId, published);
}

export function evaluateAboveThresholdReferenceVerified(modelId: string): boolean {
  if (modelId !== GEMINI31_MODEL_ID) return true;
  const live = resolveCheaperInferenceCatalogPricing(modelId);
  if (!live?.inputTokenPriceThreshold || !live.aboveThreshold) return false;
  return (
    live.aboveThreshold.referenceInputUsdPerMillion != null &&
    live.aboveThreshold.referenceOutputUsdPerMillion != null
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
