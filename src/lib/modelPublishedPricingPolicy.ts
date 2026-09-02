/**
 * Published pricing applicability policy — canonical owner for tier/cache semantics.
 */

import {
  GEMINI31_BASE_TIER_PROMPT_THRESHOLD,
  GEMINI31_MODEL_ID,
  OPUS5_MODEL_ID,
} from "@/lib/premiumModelIds";
import { CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL } from "@/lib/chatModels";
import { canonicalizePublishedModelId } from "@/lib/publishedModelAliases";
import { getPublishedPricing } from "@/lib/publishedModelPricing";

export type PricingApplicability = "base_tier_only" | "tier_aware";

export type CacheSemanticStatus =
  | "verified"
  | "verified_5m"
  | "unverified"
  | "unknown"
  | "not_applicable";

export type OpusCacheTtlMode = "5M_ONLY" | "VARIABLE" | "UNKNOWN";

export type ModelPublishedPricingPolicy = {
  modelId: string;
  pricingApplicability: PricingApplicability;
  /** Published billing reference rates apply only when promptTokens <= this value. */
  publishedBaseTierMaxPromptTokens?: number;
  cacheSemanticStatus: CacheSemanticStatus;
  opusCacheTtlMode?: OpusCacheTtlMode;
};

/** Official Gemini 3.1 Pro Preview base-tier prompt threshold (tokens). */
export { GEMINI31_BASE_TIER_PROMPT_THRESHOLD } from "@/lib/premiumModelIds";

const GEMINI37_MODEL_ID = "gemini-3.7-flash";

const MODEL_PUBLISHED_PRICING_POLICIES: Record<string, ModelPublishedPricingPolicy> = {
  [GEMINI31_MODEL_ID]: {
    modelId: GEMINI31_MODEL_ID,
    pricingApplicability: "base_tier_only",
    publishedBaseTierMaxPromptTokens: GEMINI31_BASE_TIER_PROMPT_THRESHOLD,
    cacheSemanticStatus: "unverified",
  },
  [GEMINI37_MODEL_ID]: {
    modelId: GEMINI37_MODEL_ID,
    pricingApplicability: "tier_aware",
    cacheSemanticStatus: "unknown",
  },
  [OPUS5_MODEL_ID]: {
    modelId: OPUS5_MODEL_ID,
    pricingApplicability: "tier_aware",
    cacheSemanticStatus: "verified_5m",
    opusCacheTtlMode: "5M_ONLY",
  },
  [CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL]: {
    modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
    pricingApplicability: "tier_aware",
    /**
     * Class A sanitized production cache-read evidence (legacy outbound id deepseek-v4-pro
     * canonicalizes to 0813):
     * - data/shared-novel-prose-v2-luna-gemini-deepseek-metadata.json DeepSeek-A:
     *   prompt_tokens=12871, cached_tokens=12800, cache_write absent
     * - data/d2-live/REPORT.md sequential turns: cached_tokens=3072 stable
     * DeepSeek never reports cache_write_tokens > 0 in captured production usage.
     */
    cacheSemanticStatus: "verified",
  },
};

export function getModelPublishedPricingPolicy(modelId: string): ModelPublishedPricingPolicy | null {
  const canonical = canonicalizePublishedModelId(modelId);
  return MODEL_PUBLISHED_PRICING_POLICIES[canonical] ?? null;
}

export function requiresStrictCachePolicy(modelId: string): boolean {
  const policy = getModelPublishedPricingPolicy(modelId);
  return policy?.cacheSemanticStatus === "unverified";
}

export function isPublishedBaseTierOnly(modelId: string): boolean {
  const policy = getModelPublishedPricingPolicy(modelId);
  return policy?.pricingApplicability === "base_tier_only";
}

export function isCacheSemanticVerified(modelId: string): boolean {
  const policy = getModelPublishedPricingPolicy(modelId);
  if (!policy) return false;
  return policy.cacheSemanticStatus === "verified" || policy.cacheSemanticStatus === "verified_5m";
}

/**
 * Production-evidenced models where absent cache_write reporting means proven zero
 * (Class A DeepSeek: cache_write never reported > 0; no published cache-write rate).
 */
export function isPublishedCacheWriteAbsentProvenZero(modelId: string): boolean {
  const canonical = canonicalizePublishedModelId(modelId);
  const policy = getModelPublishedPricingPolicy(canonical);
  if (!policy || policy.cacheSemanticStatus !== "verified") return false;
  try {
    const pricing = getPublishedPricing(canonical);
    return pricing.billingReferenceCacheWriteUsdPerMillion == null;
  } catch {
    return false;
  }
}

export const PUBLISHED_POLICY_SCHEMA_VERSION = 1 as const;

export type PublishedApplicabilitySnapshot = {
  publishedPolicySchemaVersion: typeof PUBLISHED_POLICY_SCHEMA_VERSION;
  pricingApplicability: PricingApplicability | "not_applicable";
  publishedBaseTierMaxPromptTokens: number | null;
  cacheSemanticStatus: CacheSemanticStatus;
  opusCacheTtlMode: OpusCacheTtlMode | null;
};

export function buildPublishedApplicabilitySnapshot(
  canonicalModelId: string,
  pricing: {
    pricingApplicability?: "base_tier_only";
    publishedBaseTierMaxPromptTokens?: number;
  }
): PublishedApplicabilitySnapshot {
  const policy = getModelPublishedPricingPolicy(canonicalModelId);
  if (policy) {
    return {
      publishedPolicySchemaVersion: PUBLISHED_POLICY_SCHEMA_VERSION,
      pricingApplicability: policy.pricingApplicability,
      publishedBaseTierMaxPromptTokens: policy.publishedBaseTierMaxPromptTokens ?? null,
      cacheSemanticStatus: policy.cacheSemanticStatus,
      opusCacheTtlMode: policy.opusCacheTtlMode ?? null,
    };
  }
  if (pricing.pricingApplicability === "base_tier_only" && pricing.publishedBaseTierMaxPromptTokens != null) {
    return {
      publishedPolicySchemaVersion: PUBLISHED_POLICY_SCHEMA_VERSION,
      pricingApplicability: "base_tier_only",
      publishedBaseTierMaxPromptTokens: pricing.publishedBaseTierMaxPromptTokens,
      cacheSemanticStatus: "unknown",
      opusCacheTtlMode: null,
    };
  }
  return {
    publishedPolicySchemaVersion: PUBLISHED_POLICY_SCHEMA_VERSION,
    pricingApplicability: "not_applicable",
    publishedBaseTierMaxPromptTokens: null,
    cacheSemanticStatus: "unknown",
    opusCacheTtlMode: null,
  };
}

export function evaluateTierEligibilityFromApplicabilitySnapshot(
  usage: { promptTokens: number },
  applicability: PublishedApplicabilitySnapshot
): boolean {
  if (applicability.pricingApplicability !== "base_tier_only") return true;
  if (applicability.publishedBaseTierMaxPromptTokens == null) return true;
  return usage.promptTokens <= applicability.publishedBaseTierMaxPromptTokens;
}

export function evaluateCacheEligibilityFromApplicabilitySnapshot(
  usage: { cacheReadTokens: number; cacheWriteTokens: number },
  applicability: PublishedApplicabilitySnapshot,
  cacheReadRate: number | null,
  cacheWriteRate: number | null
): boolean {
  const hasCacheUsage = usage.cacheReadTokens > 0 || usage.cacheWriteTokens > 0;
  if (!hasCacheUsage) return true;
  if (applicability.cacheSemanticStatus === "unverified" || applicability.cacheSemanticStatus === "unknown") {
    return false;
  }
  if (usage.cacheReadTokens > 0 && cacheReadRate == null) return false;
  if (usage.cacheWriteTokens > 0 && cacheWriteRate == null) return false;
  return true;
}
