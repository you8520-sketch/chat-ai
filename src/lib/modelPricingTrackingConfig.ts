/**
 * Model pricing auto-tracker — canonical config owner.
 * Phase A (OBSERVE_ONLY): snapshot + classify only; no BASE mutation or notices.
 */

import { CHEAPER_INFERENCE_BASE_URL } from "@/lib/cheaperInferenceConfig";

/**
 * Phase A/B1 is OBSERVE_ONLY and has no activation owner. AUTO_APPLY semantics
 * return in a later phase together with an activation safety gate; no dormant
 * auto-apply branch is kept here.
 */
export type ModelPricingTrackerPhase = "OBSERVE_ONLY";

/** Current deployment phase. */
export const MODEL_PRICING_TRACKER_PHASE: ModelPricingTrackerPhase = "OBSERVE_ONLY";

/** Relative rate change above this fraction triggers UNEXPECTED_LARGE_CHANGE hold (when unscheduled). */
export const MODEL_PRICING_LARGE_CHANGE_THRESHOLD = 0.25;

export const MODEL_PRICING_TRACKER_TIMEZONE = "Asia/Seoul";

/**
 * Provenance for tracker snapshots — must be the SAME identity the runtime
 * catalog fetcher requests (cheaperInferenceCatalogPricing.server.ts builds
 * `${CHEAPER_INFERENCE_BASE_URL}/models`). Never hardcode a second URL here.
 */
export const CHEAPER_INFERENCE_MODELS_SOURCE_URL = `${CHEAPER_INFERENCE_BASE_URL}/models`;

export type PriceSnapshotSourceKind =
  | "cheaper_inference_models_current"
  | "cheaper_inference_models_reference"
  | "published_billing_baseline"
  | "official_provider_pricing";

/** Official DeepSeek provider pricing docs — structured table, no JSON endpoint. */
export const DEEPSEEK_OFFICIAL_PRICING_SOURCE_URL =
  "https://api-docs.deepseek.com/quick_start/pricing/";

/**
 * What the source actually provided — never a product-policy decision.
 * `provider_standard` / `provider_peak` are assigned only from OFFICIAL provider
 * evidence adapters. CI catalog values are procurement-side quotes;
 * published rows carry no per-row provenance evidence in Phase A (`unknown`).
 */
export type PriceSnapshotPricingMode =
  | "procurement_current"
  | "procurement_reference"
  | "provider_standard"
  | "provider_peak"
  | "unknown";

/**
 * CI cache-rate provenance is independent from the effective numeric rate.
 * Effective fallback arithmetic remains unchanged; this metadata answers only
 * whether CI explicitly reported the cache price or the parser derived it.
 *
 * Historical snapshots written before provenance capture cannot be recovered
 * reliably, so they stay UNVERIFIED instead of being guessed.
 */
export const CACHE_RATE_PROVENANCE_REPORTED = "reported" as const;
export const CACHE_RATE_PROVENANCE_INPUT_FALLBACK = "input_rate_fallback" as const;
export const CACHE_RATE_PROVENANCE_UNVERIFIED = "unknown_legacy" as const;
export type CacheRateProvenance =
  | typeof CACHE_RATE_PROVENANCE_REPORTED
  | typeof CACHE_RATE_PROVENANCE_INPUT_FALLBACK
  | typeof CACHE_RATE_PROVENANCE_UNVERIFIED;
