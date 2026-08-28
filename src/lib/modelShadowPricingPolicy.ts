/**
 * Shadow pricing applicability — strictness for premium v2 models.
 * Legacy models without an entry keep historical fallback behavior.
 */

import { GEMINI31_MODEL_ID, OPUS5_MODEL_ID, GEMINI31_BASE_TIER_PROMPT_THRESHOLD } from "@/lib/premiumModelIds";

export type PricingApplicability = "base_tier_only" | "tier_aware";

export type CachePolicyStatus = "none" | "unverified" | "verified_5m" | "verified";

export type OpusCacheTtlMode = "5M_ONLY" | "VARIABLE" | "UNKNOWN";

export type ModelShadowPricingPolicy = {
  modelId: string;
  pricingApplicability: PricingApplicability;
  /** Published billing reference rates apply only when promptTokens <= this value. */
  publishedBaseTierMaxPromptTokens?: number;
  cachePolicyStatus: CachePolicyStatus;
  opusCacheTtlMode?: OpusCacheTtlMode;
};

/** Official Gemini 3.1 Pro Preview base-tier prompt threshold (tokens). */
export { GEMINI31_BASE_TIER_PROMPT_THRESHOLD } from "@/lib/premiumModelIds";

const MODEL_SHADOW_PRICING_POLICIES: Record<string, ModelShadowPricingPolicy> = {
  [GEMINI31_MODEL_ID]: {
    modelId: GEMINI31_MODEL_ID,
    pricingApplicability: "base_tier_only",
    publishedBaseTierMaxPromptTokens: GEMINI31_BASE_TIER_PROMPT_THRESHOLD,
    cachePolicyStatus: "unverified",
  },
  [OPUS5_MODEL_ID]: {
    modelId: OPUS5_MODEL_ID,
    pricingApplicability: "tier_aware",
    cachePolicyStatus: "verified_5m",
    opusCacheTtlMode: "5M_ONLY",
  },
};

export function getModelShadowPricingPolicy(modelId: string): ModelShadowPricingPolicy | null {
  return MODEL_SHADOW_PRICING_POLICIES[modelId.trim().toLowerCase()] ?? null;
}

export function requiresStrictCachePolicy(modelId: string): boolean {
  const policy = getModelShadowPricingPolicy(modelId);
  return policy?.cachePolicyStatus === "unverified";
}

export function isPublishedBaseTierOnly(modelId: string): boolean {
  const policy = getModelShadowPricingPolicy(modelId);
  return policy?.pricingApplicability === "base_tier_only";
}
