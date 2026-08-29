/**
 * Pure Published user-charge engine — deterministic, provider-independent.
 * Does NOT perform DB/network/clock side effects. Shadow/readiness only in this PR.
 */

import type { BillingFxSnapshot } from "@/lib/billingFxSnapshot";
import { validateBillingFxSnapshot } from "@/lib/billingFxSnapshot";
import {
  type NormalizedBillableUsage,
  type UserBillableUsageCoverage,
  validateNormalizedBillableUsage,
} from "@/lib/billingUsage";
import { convertUsdToKrw } from "@/lib/exchangeRate";
import {
  getModelPublishedPricingPolicy,
  type ModelPublishedPricingPolicy,
} from "@/lib/modelPublishedPricingPolicy";
import {
  resolvePublishedPricingExact,
  type PublishedModelPricing,
  type ResolvedPublishedPricing,
} from "@/lib/publishedModelPricing";

export const PUBLISHED_CHARGE_ROUNDING_POLICY_VERSION = "published_points_v1" as const;
export const CHARGE_SNAPSHOT_SCHEMA_VERSION = 1 as const;

export type PublishedChargeBlockedReason =
  | "unsupported_model"
  | "unsupported_cache_semantics"
  | "unsupported_pricing_tier"
  | "incomplete_usage_coverage"
  | "unknown_usage_coverage"
  | "invalid_usage"
  | "invalid_fx_snapshot"
  | "invalid_published_pricing";

export type PublishedChargeAdjustment =
  | { kind: "none" }
  | { kind: "waiver"; reason: string }
  | { kind: "self_funded_promo"; promoId: string; percent: number };

export type ComputePublishedUserChargeInput = {
  modelId: string;
  usage: NormalizedBillableUsage;
  usageCoverage: UserBillableUsageCoverage;
  fxSnapshot: BillingFxSnapshot;
  adjustment: PublishedChargeAdjustment;
  /** Diagnostic override — skips catalog lookup when provided. */
  resolvedPricing?: ResolvedPublishedPricing;
};

export type PublishedUserChargeSnapshot = {
  chargeSnapshotSchemaVersion: typeof CHARGE_SNAPSHOT_SCHEMA_VERSION;
  roundingPolicyVersion: typeof PUBLISHED_CHARGE_ROUNDING_POLICY_VERSION;
  requestedModelId: string;
  canonicalModelId: string;
  pricingVersion: number;
  publishedAt: string;
  billingReferenceInputUsdPerMillion: number;
  billingReferenceOutputUsdPerMillion: number;
  billingReferenceCacheReadUsdPerMillion: number | null;
  billingReferenceCacheWriteUsdPerMillion: number | null;
  targetMargin: number;
  minimumMarginFloor: number;
  promptTokens: number;
  standardInputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  visibleOutputTokens: number;
  reasoningTokens: number;
  billableOutputTokens: number;
  reasoningAccounting: NormalizedBillableUsage["reasoningAccounting"];
  usageCoverage: UserBillableUsageCoverage;
  fxMode: BillingFxSnapshot["mode"];
  fxDateKey: string;
  fxSource: BillingFxSnapshot["source"];
  usdToKrw: number;
  overseasFeeRate: number;
  effectiveKrwPerUsd: number;
  fxLocked: boolean;
  billingReferenceCostUsd: number;
  billingReferenceCostKrw: number;
  standardUserChargeKrw: number;
  adjustment: PublishedChargeAdjustment;
  finalUserChargeKrw: number;
  finalPoints: number;
};

export type PublishedUserChargeResult =
  | {
      status: "complete";
      snapshot: PublishedUserChargeSnapshot;
    }
  | {
      status: "blocked";
      reason: PublishedChargeBlockedReason;
      canonicalModelId?: string;
      finalPoints: null;
    };

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function chargePoints(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.ceil(n - 1e-9);
}

export function validatePublishedModelPricingForLiveGrade(pricing: PublishedModelPricing): boolean {
  if (!Number.isFinite(pricing.billingReferenceInputUsdPerMillion) || pricing.billingReferenceInputUsdPerMillion <= 0) {
    return false;
  }
  if (!Number.isFinite(pricing.billingReferenceOutputUsdPerMillion) || pricing.billingReferenceOutputUsdPerMillion <= 0) {
    return false;
  }
  if (!Number.isFinite(pricing.targetMargin) || pricing.targetMargin < 0 || pricing.targetMargin >= 1) {
    return false;
  }
  if (!Number.isFinite(pricing.minimumMarginFloor) || pricing.minimumMarginFloor < 0 || pricing.minimumMarginFloor >= 1) {
    return false;
  }
  if (pricing.targetMargin < pricing.minimumMarginFloor) {
    return false;
  }
  if (!Number.isInteger(pricing.pricingVersion) || pricing.pricingVersion <= 0) {
    return false;
  }
  if (pricing.publishedBaseTierMaxPromptTokens != null) {
    if (!Number.isFinite(pricing.publishedBaseTierMaxPromptTokens) || pricing.publishedBaseTierMaxPromptTokens <= 0) {
      return false;
    }
  }
  if (pricing.billingReferenceCacheReadUsdPerMillion != null && pricing.billingReferenceCacheReadUsdPerMillion < 0) {
    return false;
  }
  if (pricing.billingReferenceCacheWriteUsdPerMillion != null && pricing.billingReferenceCacheWriteUsdPerMillion < 0) {
    return false;
  }
  return true;
}

function validateAdjustment(adjustment: PublishedChargeAdjustment): boolean {
  switch (adjustment.kind) {
    case "none":
      return true;
    case "waiver":
      return typeof adjustment.reason === "string" && adjustment.reason.length > 0;
    case "self_funded_promo":
      return (
        typeof adjustment.promoId === "string" &&
        adjustment.promoId.length > 0 &&
        Number.isFinite(adjustment.percent) &&
        adjustment.percent >= 0 &&
        adjustment.percent < 1
      );
    default: {
      const _exhaustive: never = adjustment;
      return _exhaustive;
    }
  }
}

function resolvePolicyForModel(
  canonicalModelId: string,
  pricing: PublishedModelPricing
): ModelPublishedPricingPolicy | null {
  return getModelPublishedPricingPolicy(canonicalModelId) ?? inferPolicyFromPricing(canonicalModelId, pricing);
}

function inferPolicyFromPricing(
  canonicalModelId: string,
  pricing: PublishedModelPricing
): ModelPublishedPricingPolicy | null {
  if (pricing.pricingApplicability === "base_tier_only" && pricing.publishedBaseTierMaxPromptTokens != null) {
    return {
      modelId: canonicalModelId,
      pricingApplicability: "base_tier_only",
      publishedBaseTierMaxPromptTokens: pricing.publishedBaseTierMaxPromptTokens,
      cacheSemanticStatus: "unknown",
    };
  }
  return null;
}

function evaluateTierGate(
  usage: NormalizedBillableUsage,
  policy: ModelPublishedPricingPolicy | null,
  pricing: PublishedModelPricing
): PublishedChargeBlockedReason | null {
  const maxPrompt =
    policy?.publishedBaseTierMaxPromptTokens ?? pricing.publishedBaseTierMaxPromptTokens;
  const baseTierOnly =
    policy?.pricingApplicability === "base_tier_only" || pricing.pricingApplicability === "base_tier_only";
  if (baseTierOnly && maxPrompt != null && usage.promptTokens > maxPrompt) {
    return "unsupported_pricing_tier";
  }
  return null;
}

function evaluateCacheGate(
  usage: NormalizedBillableUsage,
  policy: ModelPublishedPricingPolicy | null,
  pricing: PublishedModelPricing
): PublishedChargeBlockedReason | null {
  const hasCacheUsage = usage.cacheReadTokens > 0 || usage.cacheWriteTokens > 0;
  if (!hasCacheUsage) return null;

  const cacheStatus = policy?.cacheSemanticStatus ?? "unknown";
  if (cacheStatus === "unverified" || cacheStatus === "unknown") {
    return "unsupported_cache_semantics";
  }

  if (usage.cacheReadTokens > 0 && pricing.billingReferenceCacheReadUsdPerMillion == null) {
    return "unsupported_cache_semantics";
  }
  if (usage.cacheWriteTokens > 0 && pricing.billingReferenceCacheWriteUsdPerMillion == null) {
    return "unsupported_cache_semantics";
  }

  return null;
}

function computeBillingReferenceCostUsd(
  usage: NormalizedBillableUsage,
  pricing: PublishedModelPricing
): number {
  const cacheReadRate = pricing.billingReferenceCacheReadUsdPerMillion ?? 0;
  const cacheWriteRate = pricing.billingReferenceCacheWriteUsdPerMillion ?? 0;
  return (
    (usage.standardInputTokens / 1_000_000) * pricing.billingReferenceInputUsdPerMillion +
    (usage.cacheReadTokens / 1_000_000) * cacheReadRate +
    (usage.cacheWriteTokens / 1_000_000) * cacheWriteRate +
    (usage.billableOutputTokens / 1_000_000) * pricing.billingReferenceOutputUsdPerMillion
  );
}

function buildSnapshot(
  input: ComputePublishedUserChargeInput,
  resolved: ResolvedPublishedPricing
): PublishedUserChargeSnapshot {
  const { usage, usageCoverage, fxSnapshot, adjustment } = input;
  const pricing = resolved.pricing;
  const billingReferenceCostUsd = computeBillingReferenceCostUsd(usage, pricing);
  const billingReferenceCostKrw = round1(convertUsdToKrw(billingReferenceCostUsd, fxSnapshot.effectiveKrwPerUsd));
  const clampedMargin = Math.min(0.95, Math.max(0, pricing.targetMargin));
  const standardUserChargeKrw = round1(billingReferenceCostKrw / (1 - clampedMargin));

  let finalUserChargeKrw = standardUserChargeKrw;
  switch (adjustment.kind) {
    case "none":
      break;
    case "waiver":
      finalUserChargeKrw = 0;
      break;
    case "self_funded_promo":
      finalUserChargeKrw = round1(standardUserChargeKrw * (1 - adjustment.percent));
      break;
    default: {
      const _exhaustive: never = adjustment;
      throw new Error(`Unhandled adjustment: ${String(_exhaustive)}`);
    }
  }

  const finalPoints = chargePoints(finalUserChargeKrw);

  return {
    chargeSnapshotSchemaVersion: CHARGE_SNAPSHOT_SCHEMA_VERSION,
    roundingPolicyVersion: PUBLISHED_CHARGE_ROUNDING_POLICY_VERSION,
    requestedModelId: input.modelId,
    canonicalModelId: resolved.canonicalModelId,
    pricingVersion: pricing.pricingVersion,
    publishedAt: pricing.publishedAt,
    billingReferenceInputUsdPerMillion: pricing.billingReferenceInputUsdPerMillion,
    billingReferenceOutputUsdPerMillion: pricing.billingReferenceOutputUsdPerMillion,
    billingReferenceCacheReadUsdPerMillion: pricing.billingReferenceCacheReadUsdPerMillion ?? null,
    billingReferenceCacheWriteUsdPerMillion: pricing.billingReferenceCacheWriteUsdPerMillion ?? null,
    targetMargin: pricing.targetMargin,
    minimumMarginFloor: pricing.minimumMarginFloor,
    promptTokens: usage.promptTokens,
    standardInputTokens: usage.standardInputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    visibleOutputTokens: usage.visibleOutputTokens,
    reasoningTokens: usage.reasoningTokens,
    billableOutputTokens: usage.billableOutputTokens,
    reasoningAccounting: usage.reasoningAccounting,
    usageCoverage,
    fxMode: fxSnapshot.mode,
    fxDateKey: fxSnapshot.dateKey,
    fxSource: fxSnapshot.source,
    usdToKrw: fxSnapshot.usdToKrw,
    overseasFeeRate: fxSnapshot.overseasFeeRate,
    effectiveKrwPerUsd: fxSnapshot.effectiveKrwPerUsd,
    fxLocked: fxSnapshot.locked,
    billingReferenceCostUsd,
    billingReferenceCostKrw,
    standardUserChargeKrw,
    adjustment,
    finalUserChargeKrw,
    finalPoints,
  };
}

export function computePublishedUserChargeWithSnapshot(
  input: ComputePublishedUserChargeInput
): PublishedUserChargeResult {
  if (!validateNormalizedBillableUsage(input.usage)) {
    return { status: "blocked", reason: "invalid_usage", finalPoints: null };
  }
  if (!validateBillingFxSnapshot(input.fxSnapshot)) {
    return { status: "blocked", reason: "invalid_fx_snapshot", finalPoints: null };
  }
  if (!validateAdjustment(input.adjustment)) {
    return { status: "blocked", reason: "invalid_usage", finalPoints: null };
  }

  switch (input.usageCoverage) {
    case "partial":
      return { status: "blocked", reason: "incomplete_usage_coverage", finalPoints: null };
    case "unknown":
      return { status: "blocked", reason: "unknown_usage_coverage", finalPoints: null };
    case "complete":
      break;
    default: {
      const _exhaustive: never = input.usageCoverage;
      return { status: "blocked", reason: "unknown_usage_coverage", finalPoints: null };
    }
  }

  const resolved =
    input.resolvedPricing ??
    resolvePublishedPricingExact(input.modelId);
  if (!resolved) {
    return { status: "blocked", reason: "unsupported_model", finalPoints: null };
  }
  if (!validatePublishedModelPricingForLiveGrade(resolved.pricing)) {
    return {
      status: "blocked",
      reason: "invalid_published_pricing",
      canonicalModelId: resolved.canonicalModelId,
      finalPoints: null,
    };
  }

  const policy = resolvePolicyForModel(resolved.canonicalModelId, resolved.pricing);
  const tierBlock = evaluateTierGate(input.usage, policy, resolved.pricing);
  if (tierBlock) {
    return {
      status: "blocked",
      reason: tierBlock,
      canonicalModelId: resolved.canonicalModelId,
      finalPoints: null,
    };
  }

  const cacheBlock = evaluateCacheGate(input.usage, policy, resolved.pricing);
  if (cacheBlock) {
    return {
      status: "blocked",
      reason: cacheBlock,
      canonicalModelId: resolved.canonicalModelId,
      finalPoints: null,
    };
  }

  const snapshot = buildSnapshot(input, resolved);
  if (
    !Number.isFinite(snapshot.billingReferenceCostUsd) ||
    !Number.isFinite(snapshot.billingReferenceCostKrw) ||
    !Number.isFinite(snapshot.standardUserChargeKrw) ||
    !Number.isFinite(snapshot.finalUserChargeKrw) ||
    !Number.isFinite(snapshot.finalPoints) ||
    snapshot.finalPoints < 0
  ) {
    return {
      status: "blocked",
      reason: "invalid_usage",
      canonicalModelId: resolved.canonicalModelId,
      finalPoints: null,
    };
  }

  return { status: "complete", snapshot };
}

export function isPublishedUserChargeSnapshot(value: unknown): value is PublishedUserChargeSnapshot {
  if (value == null || typeof value !== "object") return false;
  const s = value as PublishedUserChargeSnapshot;
  return (
    s.chargeSnapshotSchemaVersion === CHARGE_SNAPSHOT_SCHEMA_VERSION &&
    typeof s.canonicalModelId === "string" &&
    typeof s.pricingVersion === "number" &&
    typeof s.finalPoints === "number" &&
    Number.isInteger(s.finalPoints)
  );
}
