/**
 * Published pricing applicability policy — canonical owner for tier/cache semantics.
 */

import {
  GEMINI31_BASE_TIER_PROMPT_THRESHOLD,
  GEMINI31_MODEL_ID,
  OPUS5_MODEL_ID,
} from "@/lib/premiumModelIds";
import { canonicalizePublishedModelId } from "@/lib/publishedModelAliases";

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
