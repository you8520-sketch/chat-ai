/**
 * Model pricing auto-tracker — canonical config owner.
 * Phase A (OBSERVE_ONLY): snapshot + classify only; no BASE mutation or notices.
 */

import { CHEAPER_INFERENCE_BASE_URL } from "@/lib/cheaperInferenceConfig";

export type ModelPricingTrackerPhase = "OBSERVE_ONLY" | "AUTO_APPLY_SAFE_EVENTS";

/** Current deployment phase — do not enable AUTO_APPLY without evidence review. */
export const MODEL_PRICING_TRACKER_PHASE: ModelPricingTrackerPhase =
  process.env.MODEL_PRICING_TRACKER_PHASE === "AUTO_APPLY_SAFE_EVENTS"
    ? "AUTO_APPLY_SAFE_EVENTS"
    : "OBSERVE_ONLY";

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
