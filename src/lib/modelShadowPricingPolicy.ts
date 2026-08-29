/**
 * Shadow pricing applicability — thin compatibility re-export.
 * Canonical policy data lives in modelPublishedPricingPolicy.ts.
 */

export type {
  CacheSemanticStatus as CachePolicyStatus,
  ModelPublishedPricingPolicy as ModelShadowPricingPolicy,
  OpusCacheTtlMode,
  PricingApplicability,
} from "@/lib/modelPublishedPricingPolicy";

export {
  GEMINI31_BASE_TIER_PROMPT_THRESHOLD,
  getModelPublishedPricingPolicy as getModelShadowPricingPolicy,
  isPublishedBaseTierOnly,
  requiresStrictCachePolicy,
} from "@/lib/modelPublishedPricingPolicy";
