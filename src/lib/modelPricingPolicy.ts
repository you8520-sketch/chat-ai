/**
 * Model pricing policy — canonical owner for per-model baseline mode and auto-apply policy.
 * Margin fields (targetMargin, minimumMarginFloor, pricingVersion) remain in publishedModelPricing.ts.
 */

import { MAIN_RP_MODEL_IDS } from "@/lib/chatModels";
import { canonicalizePublishedModelId } from "@/lib/publishedModelAliases";
import {
  getPublishedPricing,
  listPublishedModelIds,
  type PublishedModelPricing,
} from "@/lib/publishedModelPricing";

export type BaselineMode =
  | "PROVIDER_STANDARD"
  | "PROVIDER_PEAK"
  | "FIXED_VERIFIED_REFERENCE";

export type ModelPricingPolicy = {
  modelId: string;
  provider: "cheaperinference" | "openrouter" | "unknown";
  baselineMode: BaselineMode;
  /** When false, verified baseline changes are classified but not auto-applied. */
  autoApply: boolean;
  /** Expected upstream model identity from CI /models — routing drift detection. */
  expectedProviderModelId: string;
  pricingMode: "standard" | "tier_aware";
};

const DEFAULT_POLICIES: Record<string, Omit<ModelPricingPolicy, "modelId">> = {
  "deepseek-v4-pro-0813": {
    provider: "cheaperinference",
    baselineMode: "PROVIDER_PEAK",
    autoApply: false,
    expectedProviderModelId: "deepseek-v4-pro-0813",
    pricingMode: "tier_aware",
  },
  "deepseek-v4.1-flash": {
    provider: "cheaperinference",
    baselineMode: "PROVIDER_PEAK",
    autoApply: false,
    expectedProviderModelId: "deepseek-v4.1-flash",
    pricingMode: "standard",
  },
  "gemini-3.1-pro-preview": {
    provider: "cheaperinference",
    baselineMode: "PROVIDER_STANDARD",
    autoApply: false,
    expectedProviderModelId: "gemini-3.1-pro-preview",
    pricingMode: "tier_aware",
  },
  "gemini-3.7-flash": {
    provider: "cheaperinference",
    baselineMode: "PROVIDER_STANDARD",
    autoApply: false,
    expectedProviderModelId: "gemini-3.7-flash",
    pricingMode: "tier_aware",
  },
  "gpt-5.6-terra": {
    provider: "cheaperinference",
    baselineMode: "PROVIDER_STANDARD",
    autoApply: false,
    expectedProviderModelId: "gpt-5.6-terra",
    pricingMode: "standard",
  },
  "claude-opus-5": {
    provider: "cheaperinference",
    baselineMode: "PROVIDER_STANDARD",
    autoApply: false,
    expectedProviderModelId: "claude-opus-5",
    pricingMode: "tier_aware",
  },
};

function inferProvider(modelId: string): ModelPricingPolicy["provider"] {
  if (modelId.includes("/")) return "openrouter";
  return "cheaperinference";
}

export function getModelPricingPolicy(modelId: string): ModelPricingPolicy | null {
  const canonical = canonicalizePublishedModelId(modelId);
  const explicit = DEFAULT_POLICIES[canonical];
  if (explicit) {
    return { modelId: canonical, ...explicit };
  }
  if (!listPublishedModelIds().includes(canonical)) return null;
  return {
    modelId: canonical,
    provider: inferProvider(canonical),
    baselineMode: "PROVIDER_STANDARD",
    autoApply: false,
    expectedProviderModelId: canonical,
    pricingMode: "standard",
  };
}

/** Models tracked daily — Main RP picker + published catalog entries with explicit policy. */
export function listTrackedModelIds(): string[] {
  const ids = new Set<string>(MAIN_RP_MODEL_IDS);
  for (const id of listPublishedModelIds()) {
    if (getModelPricingPolicy(id)) ids.add(id);
  }
  return [...ids].sort();
}

export function getModelPricingPolicyWithPublished(
  modelId: string
): { policy: ModelPricingPolicy; published: PublishedModelPricing } | null {
  const policy = getModelPricingPolicy(modelId);
  if (!policy) return null;
  return { policy, published: getPublishedPricing(policy.modelId) };
}
