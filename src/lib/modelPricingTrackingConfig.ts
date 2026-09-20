/**
 * Model pricing auto-tracker — canonical config owner.
 * Phase A (OBSERVE_ONLY): snapshot + classify only; no BASE mutation or notices.
 */

export type ModelPricingTrackerPhase = "OBSERVE_ONLY" | "AUTO_APPLY_SAFE_EVENTS";

/** Current deployment phase — do not enable AUTO_APPLY without evidence review. */
export const MODEL_PRICING_TRACKER_PHASE: ModelPricingTrackerPhase =
  process.env.MODEL_PRICING_TRACKER_PHASE === "AUTO_APPLY_SAFE_EVENTS"
    ? "AUTO_APPLY_SAFE_EVENTS"
    : "OBSERVE_ONLY";

/** Relative rate change above this fraction triggers UNEXPECTED_LARGE_CHANGE hold (when unscheduled). */
export const MODEL_PRICING_LARGE_CHANGE_THRESHOLD = 0.25;

export const MODEL_PRICING_TRACKER_TIMEZONE = "Asia/Seoul";

export const CHEAPER_INFERENCE_MODELS_SOURCE_URL = "https://cheaperinference.com/v1/models";

export type PriceSnapshotSourceKind =
  | "cheaper_inference_models_current"
  | "cheaper_inference_models_reference"
  | "published_billing_baseline";

export type PriceSnapshotPricingMode =
  | "procurement_current"
  | "procurement_reference"
  | "provider_standard"
  | "provider_peak";
