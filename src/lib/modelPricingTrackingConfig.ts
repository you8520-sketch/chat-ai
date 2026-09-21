/**
 * Model pricing auto-tracker — canonical config owner.
 * Phase A (OBSERVE_ONLY): snapshot + classify only; no BASE mutation or notices.
 */

import { CHEAPER_INFERENCE_BASE_URL } from "@/lib/cheaperInferenceConfig";

/**
 * Phase A is OBSERVE_ONLY and has no activation owner. AUTO_APPLY semantics
 * return in Phase B together with official provider adapters and an
 * activation safety gate; no dormant auto-apply branch is kept here.
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
  | "published_billing_baseline";

/**
 * What the source actually provided — never a product-policy decision.
 * `provider_standard` / `provider_peak` are reserved for OFFICIAL provider
 * evidence (Phase B adapters). CI catalog values are procurement-side quotes;
 * published rows carry no per-row provenance evidence in Phase A (`unknown`).
 */
export type PriceSnapshotPricingMode =
  | "procurement_current"
  | "procurement_reference"
  | "provider_standard"
  | "provider_peak"
  | "unknown";

/**
 * The shared CI catalog parser synthesizes cache rates when the source omits
 * them (`cache_read = input * 0.1`, `cache_write = input`). Phase A cannot
 * distinguish an explicit provider quote from that parser-derived fallback, so
 * prepared/derived cache prices are explicitly UNVERIFIED provenance and cache
 * price auto-application is a Phase B blocker. Live billing keeps its
 * existing resilient-cache fallback behavior unchanged.
 */
export const CACHE_RATE_PROVENANCE_UNVERIFIED = "CACHE_RATE_PROVENANCE_UNVERIFIED" as const;
