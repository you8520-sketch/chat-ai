/**
 * Immutable Gemini 3.7 Flash calibration evidence — historical snapshot only.
 * NOT a live provider pricing owner. Runtime catalog owner remains
 * resolveCheaperInferenceCatalogPricing("gemini-3.7-flash").
 */

import type { PublishedModelPricing } from "@/lib/publishedModelPricing";
import { resolveCheaperInferenceCatalogPricing } from "@/lib/cheaperInferenceCatalogPricing";
import { GEMINI37_MODEL_ID } from "@/lib/gemini37PricingPolicy.constants";

export type ProviderRateEvidenceSourceKind =
  | "provider_public_model_page"
  | "provider_catalog_snapshot";

export type ProviderRateEvidence = {
  provider: "cheaper_inference";
  modelId: string;
  observedAt: string;
  sourceKind: ProviderRateEvidenceSourceKind;
  referenceInputUsdPerMillion: number;
  referenceOutputUsdPerMillion: number;
  observedCurrentInputUsdPerMillion: number;
  observedCurrentOutputUsdPerMillion: number;
  observedDiscountPercent: number;
};

/** Historical calibration evidence for why v2 reference rates were selected. */
export const GEMINI37_CALIBRATION_RATE_EVIDENCE: ProviderRateEvidence = {
  provider: "cheaper_inference",
  modelId: GEMINI37_MODEL_ID,
  observedAt: "2026-08-28T00:00:00.000Z",
  sourceKind: "provider_public_model_page",
  referenceInputUsdPerMillion: 0.375,
  referenceOutputUsdPerMillion: 1.875,
  observedCurrentInputUsdPerMillion: 0.2625,
  observedCurrentOutputUsdPerMillion: 1.3125,
  observedDiscountPercent: 30,
};

export const CACHE_POLICY_VERIFICATION =
  "not established by competitor benchmarks" as const;

export function calibrationReferenceEvidenceMatchesV2(published: PublishedModelPricing): boolean {
  return (
    published.billingReferenceInputUsdPerMillion ===
      GEMINI37_CALIBRATION_RATE_EVIDENCE.referenceInputUsdPerMillion &&
    published.billingReferenceOutputUsdPerMillion ===
      GEMINI37_CALIBRATION_RATE_EVIDENCE.referenceOutputUsdPerMillion
  );
}

export type LiveReferenceDriftStatus = "MATCH" | "DRIFT" | "UNAVAILABLE";

export type LiveReferenceDriftDiagnostic = {
  status: LiveReferenceDriftStatus;
  liveReferenceMatchesPublished: boolean | null;
  liveReferenceInputUsdPerMillion: number | null;
  liveReferenceOutputUsdPerMillion: number | null;
  inputDeviationPct: number | null;
  outputDeviationPct: number | null;
  fetchedAt: number | null;
};

function roundDeviationPct(published: number, live: number): number {
  if (published <= 0) return 0;
  return Math.round(((live - published) / published) * 1000) / 10;
}

export function evaluateLiveReferenceDrift(published: PublishedModelPricing): LiveReferenceDriftDiagnostic {
  const live = resolveCheaperInferenceCatalogPricing(GEMINI37_MODEL_ID);
  const liveInput = live?.referenceInputUsdPerMillion ?? null;
  const liveOutput = live?.referenceOutputUsdPerMillion ?? null;

  if (liveInput == null || liveOutput == null) {
    return {
      status: "UNAVAILABLE",
      liveReferenceMatchesPublished: null,
      liveReferenceInputUsdPerMillion: liveInput,
      liveReferenceOutputUsdPerMillion: liveOutput,
      inputDeviationPct: null,
      outputDeviationPct: null,
      fetchedAt: live?.fetchedAt ?? null,
    };
  }

  const inputMatches = liveInput === published.billingReferenceInputUsdPerMillion;
  const outputMatches = liveOutput === published.billingReferenceOutputUsdPerMillion;
  const matches = inputMatches && outputMatches;

  return {
    status: matches ? "MATCH" : "DRIFT",
    liveReferenceMatchesPublished: matches,
    liveReferenceInputUsdPerMillion: liveInput,
    liveReferenceOutputUsdPerMillion: liveOutput,
    inputDeviationPct: roundDeviationPct(published.billingReferenceInputUsdPerMillion, liveInput),
    outputDeviationPct: roundDeviationPct(published.billingReferenceOutputUsdPerMillion, liveOutput),
    fetchedAt: live?.fetchedAt ?? null,
  };
}
