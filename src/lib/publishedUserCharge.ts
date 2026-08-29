/**
 * Pure Published user-charge engine — deterministic, provider-independent.
 * Does NOT perform DB/network/clock side effects. Shadow/readiness only in this PR.
 */

import {
  type BillingFxSnapshot,
  validateBillingFxSnapshot,
  validateBillingFxSnapshotForLiveGrade,
} from "@/lib/billingFxSnapshot";
import {
  type NormalizedBillableUsage,
  type UserBillableUsageCoverage,
  validateNormalizedBillableUsage,
} from "@/lib/billingUsage";
import {
  buildPublishedApplicabilitySnapshot,
  evaluateCacheEligibilityFromApplicabilitySnapshot,
  evaluateTierEligibilityFromApplicabilitySnapshot,
  getModelPublishedPricingPolicy,
  type ModelPublishedPricingPolicy,
  type PublishedApplicabilitySnapshot,
  PUBLISHED_POLICY_SCHEMA_VERSION,
} from "@/lib/modelPublishedPricingPolicy";
import { canonicalizePublishedModelId } from "@/lib/publishedModelAliases";
import {
  ceilPublishedChargePoints,
  convertUsdToKrwPure,
  PUBLISHED_CHARGE_ROUNDING_POLICY_VERSION,
  roundKrwTenths,
} from "@/lib/publishedChargeRounding";
import {
  resolvePublishedPricingExact,
  type PublishedModelPricing,
  type ResolvedPublishedPricing,
} from "@/lib/publishedModelPricing";

export { PUBLISHED_CHARGE_ROUNDING_POLICY_VERSION } from "@/lib/publishedChargeRounding";
export { PUBLISHED_POLICY_SCHEMA_VERSION } from "@/lib/modelPublishedPricingPolicy";
export type { PublishedApplicabilitySnapshot } from "@/lib/modelPublishedPricingPolicy";

export const CHARGE_SNAPSHOT_SCHEMA_VERSION = 1 as const;

const ISO_UTC_MS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export type PublishedChargeBlockedReason =
  | "unsupported_model"
  | "unsupported_cache_semantics"
  | "unsupported_pricing_tier"
  | "incomplete_usage_coverage"
  | "unknown_usage_coverage"
  | "invalid_usage"
  | "invalid_fx_snapshot"
  | "invalid_published_pricing"
  | "invalid_adjustment"
  | "model_pricing_identity_mismatch";

export type PublishedChargeAdjustment =
  | { kind: "none" }
  | { kind: "waiver"; reason: string }
  | { kind: "self_funded_promo"; promoId: string; percent: number };

/** Live-safe public input — exact catalog resolution mandatory. */
export type ComputePublishedUserChargeInput = {
  modelId: string;
  usage: NormalizedBillableUsage;
  usageCoverage: UserBillableUsageCoverage;
  fxSnapshot: BillingFxSnapshot;
  adjustment: PublishedChargeAdjustment;
};

/**
 * INTERNAL / DIAGNOSTIC — NOT LIVE-SAFE.
 * For shadow generic compat, pricing overrides, and snapshot promo recomputation only.
 * Must NOT be imported by route.ts or chatBillingSettlement.ts.
 */
export type ComputePublishedUserChargeFromResolvedPolicyInput = {
  requestedModelId: string;
  resolvedPricing: ResolvedPublishedPricing;
  usage: NormalizedBillableUsage;
  usageCoverage: UserBillableUsageCoverage;
  fxSnapshot: BillingFxSnapshot;
  adjustment: PublishedChargeAdjustment;
  /** Diagnostic-only: allow unlocked FX snapshots. */
  allowUnlockedFx?: boolean;
  /** When set, resolved canonical id must match this identity (snapshot replay). */
  expectedCanonicalModelId?: string;
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
  applicability: PublishedApplicabilitySnapshot;
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

const NUMERIC_TOLERANCE = 1e-6;

function isValidIsoTimestamp(value: string): boolean {
  if (!value || typeof value !== "string") return false;
  if (!ISO_UTC_MS_RE.test(value)) return false;
  return Number.isFinite(Date.parse(value));
}

function isValidUsdRate(rate: number): boolean {
  return Number.isFinite(rate) && rate > 0;
}

function isValidOptionalCacheRate(rate: number | undefined | null): boolean {
  if (rate == null) return true;
  return Number.isFinite(rate) && rate >= 0;
}

export function validatePublishedModelPricingForLiveGrade(pricing: PublishedModelPricing): boolean {
  if (!isValidUsdRate(pricing.billingReferenceInputUsdPerMillion)) return false;
  if (!isValidUsdRate(pricing.billingReferenceOutputUsdPerMillion)) return false;
  if (!Number.isFinite(pricing.targetMargin) || pricing.targetMargin < 0 || pricing.targetMargin >= 1) {
    return false;
  }
  if (!Number.isFinite(pricing.minimumMarginFloor) || pricing.minimumMarginFloor < 0 || pricing.minimumMarginFloor >= 1) {
    return false;
  }
  if (pricing.targetMargin < pricing.minimumMarginFloor) return false;
  if (!Number.isSafeInteger(pricing.pricingVersion) || pricing.pricingVersion <= 0) return false;
  if (!isValidIsoTimestamp(pricing.publishedAt)) return false;
  if (pricing.publishedBaseTierMaxPromptTokens != null) {
    if (!Number.isSafeInteger(pricing.publishedBaseTierMaxPromptTokens) || pricing.publishedBaseTierMaxPromptTokens <= 0) {
      return false;
    }
  }
  if (!isValidOptionalCacheRate(pricing.billingReferenceCacheReadUsdPerMillion)) return false;
  if (!isValidOptionalCacheRate(pricing.billingReferenceCacheWriteUsdPerMillion)) return false;
  if (pricing.modelId !== pricing.modelId.trim()) return false;
  return true;
}

export function validateAdjustment(adjustment: PublishedChargeAdjustment): boolean {
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

export function validateResolvedPricingIdentity(
  requestedModelId: string,
  resolved: ResolvedPublishedPricing,
  expectedCanonicalModelId?: string
): boolean {
  if (resolved.pricing.modelId !== resolved.canonicalModelId) return false;
  const canonicalFromRequest = canonicalizePublishedModelId(requestedModelId);
  if (expectedCanonicalModelId != null && resolved.canonicalModelId !== expectedCanonicalModelId) {
    return false;
  }
  if (expectedCanonicalModelId == null && canonicalFromRequest !== resolved.canonicalModelId) {
    return false;
  }
  return true;
}

function validateApplicabilitySnapshotStructure(applicability: PublishedApplicabilitySnapshot): boolean {
  if (applicability.publishedPolicySchemaVersion !== PUBLISHED_POLICY_SCHEMA_VERSION) return false;
  switch (applicability.pricingApplicability) {
    case "base_tier_only":
    case "tier_aware":
    case "not_applicable":
      break;
    default:
      return false;
  }
  switch (applicability.cacheSemanticStatus) {
    case "verified":
    case "verified_5m":
    case "unverified":
    case "unknown":
    case "not_applicable":
      break;
    default:
      return false;
  }
  if (
    applicability.publishedBaseTierMaxPromptTokens != null &&
    (!Number.isSafeInteger(applicability.publishedBaseTierMaxPromptTokens) ||
      applicability.publishedBaseTierMaxPromptTokens <= 0)
  ) {
    return false;
  }
  if (applicability.opusCacheTtlMode != null) {
    switch (applicability.opusCacheTtlMode) {
      case "5M_ONLY":
      case "VARIABLE":
      case "UNKNOWN":
        break;
      default:
        return false;
    }
  }
  return true;
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
  requestedModelId: string,
  resolved: ResolvedPublishedPricing,
  usage: NormalizedBillableUsage,
  usageCoverage: UserBillableUsageCoverage,
  fxSnapshot: BillingFxSnapshot,
  adjustment: PublishedChargeAdjustment
): PublishedUserChargeSnapshot {
  const pricing = resolved.pricing;
  const applicability = buildPublishedApplicabilitySnapshot(resolved.canonicalModelId, pricing);
  const billingReferenceCostUsd = computeBillingReferenceCostUsd(usage, pricing);
  const billingReferenceCostKrw = roundKrwTenths(
    convertUsdToKrwPure(billingReferenceCostUsd, fxSnapshot.effectiveKrwPerUsd)
  );
  const standardUserChargeKrw = roundKrwTenths(
    billingReferenceCostKrw / (1 - pricing.targetMargin)
  );

  let finalUserChargeKrw = standardUserChargeKrw;
  switch (adjustment.kind) {
    case "none":
      break;
    case "waiver":
      finalUserChargeKrw = 0;
      break;
    case "self_funded_promo":
      finalUserChargeKrw = roundKrwTenths(standardUserChargeKrw * (1 - adjustment.percent));
      break;
    default: {
      const _exhaustive: never = adjustment;
      throw new Error(`Unhandled adjustment: ${String(_exhaustive)}`);
    }
  }

  const finalPoints = ceilPublishedChargePoints(finalUserChargeKrw);

  return {
    chargeSnapshotSchemaVersion: CHARGE_SNAPSHOT_SCHEMA_VERSION,
    roundingPolicyVersion: PUBLISHED_CHARGE_ROUNDING_POLICY_VERSION,
    requestedModelId,
    canonicalModelId: resolved.canonicalModelId,
    pricingVersion: pricing.pricingVersion,
    publishedAt: pricing.publishedAt,
    billingReferenceInputUsdPerMillion: pricing.billingReferenceInputUsdPerMillion,
    billingReferenceOutputUsdPerMillion: pricing.billingReferenceOutputUsdPerMillion,
    billingReferenceCacheReadUsdPerMillion: pricing.billingReferenceCacheReadUsdPerMillion ?? null,
    billingReferenceCacheWriteUsdPerMillion: pricing.billingReferenceCacheWriteUsdPerMillion ?? null,
    targetMargin: pricing.targetMargin,
    minimumMarginFloor: pricing.minimumMarginFloor,
    applicability,
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

function computePublishedUserChargeCore(
  requestedModelId: string,
  resolved: ResolvedPublishedPricing,
  usage: NormalizedBillableUsage,
  usageCoverage: UserBillableUsageCoverage,
  fxSnapshot: BillingFxSnapshot,
  adjustment: PublishedChargeAdjustment,
  opts: { liveGradeFx: boolean }
): PublishedUserChargeResult {
  if (!validateNormalizedBillableUsage(usage)) {
    return { status: "blocked", reason: "invalid_usage", finalPoints: null };
  }

  const fxValid = opts.liveGradeFx
    ? validateBillingFxSnapshotForLiveGrade(fxSnapshot)
    : validateBillingFxSnapshot(fxSnapshot, { requireLocked: false });
  if (!fxValid) {
    return { status: "blocked", reason: "invalid_fx_snapshot", finalPoints: null };
  }

  if (!validateAdjustment(adjustment)) {
    return { status: "blocked", reason: "invalid_adjustment", finalPoints: null };
  }

  switch (usageCoverage) {
    case "partial":
      return { status: "blocked", reason: "incomplete_usage_coverage", finalPoints: null };
    case "unknown":
      return { status: "blocked", reason: "unknown_usage_coverage", finalPoints: null };
    case "complete":
      break;
    default: {
      const _exhaustive: never = usageCoverage;
      return { status: "blocked", reason: "unknown_usage_coverage", finalPoints: null };
    }
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
  const tierBlock = evaluateTierGate(usage, policy, resolved.pricing);
  if (tierBlock) {
    return {
      status: "blocked",
      reason: tierBlock,
      canonicalModelId: resolved.canonicalModelId,
      finalPoints: null,
    };
  }

  const cacheBlock = evaluateCacheGate(usage, policy, resolved.pricing);
  if (cacheBlock) {
    return {
      status: "blocked",
      reason: cacheBlock,
      canonicalModelId: resolved.canonicalModelId,
      finalPoints: null,
    };
  }

  const snapshot = buildSnapshot(
    requestedModelId,
    resolved,
    usage,
    usageCoverage,
    fxSnapshot,
    adjustment
  );

  if (
    !Number.isFinite(snapshot.billingReferenceCostUsd) ||
    !Number.isFinite(snapshot.billingReferenceCostKrw) ||
    !Number.isFinite(snapshot.standardUserChargeKrw) ||
    !Number.isFinite(snapshot.finalUserChargeKrw) ||
    !Number.isFinite(snapshot.finalPoints) ||
    snapshot.finalPoints < 0 ||
    !Number.isInteger(snapshot.finalPoints)
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

/** Live-safe public owner — always exact-resolves catalog pricing. */
export function computePublishedUserChargeWithSnapshot(
  input: ComputePublishedUserChargeInput
): PublishedUserChargeResult {
  const resolved = resolvePublishedPricingExact(input.modelId);
  if (!resolved) {
    return { status: "blocked", reason: "unsupported_model", finalPoints: null };
  }

  if (!validateResolvedPricingIdentity(input.modelId, resolved)) {
    return {
      status: "blocked",
      reason: "model_pricing_identity_mismatch",
      canonicalModelId: resolved.canonicalModelId,
      finalPoints: null,
    };
  }

  return computePublishedUserChargeCore(
    input.modelId,
    resolved,
    input.usage,
    input.usageCoverage,
    input.fxSnapshot,
    input.adjustment,
    { liveGradeFx: true }
  );
}

/**
 * INTERNAL / DIAGNOSTIC — NOT LIVE-SAFE.
 * Shadow generic compat, pricing overrides, snapshot promo recomputation.
 */
export function computePublishedUserChargeFromResolvedPolicy(
  input: ComputePublishedUserChargeFromResolvedPolicyInput
): PublishedUserChargeResult {
  if (
    !validateResolvedPricingIdentity(
      input.requestedModelId,
      input.resolvedPricing,
      input.expectedCanonicalModelId
    )
  ) {
    return {
      status: "blocked",
      reason: "model_pricing_identity_mismatch",
      canonicalModelId: input.resolvedPricing.canonicalModelId,
      finalPoints: null,
    };
  }

  const fxValid = input.allowUnlockedFx
    ? validateBillingFxSnapshot(input.fxSnapshot, { requireLocked: false })
    : validateBillingFxSnapshotForLiveGrade(input.fxSnapshot);

  if (!fxValid) {
    return { status: "blocked", reason: "invalid_fx_snapshot", finalPoints: null };
  }

  return computePublishedUserChargeCore(
    input.requestedModelId,
    input.resolvedPricing,
    input.usage,
    input.usageCoverage,
    input.fxSnapshot,
    input.adjustment,
    { liveGradeFx: !input.allowUnlockedFx }
  );
}

function snapshotUsageFromSnapshot(snapshot: PublishedUserChargeSnapshot): NormalizedBillableUsage {
  return {
    promptTokens: snapshot.promptTokens,
    cacheReadTokens: snapshot.cacheReadTokens,
    cacheWriteTokens: snapshot.cacheWriteTokens,
    standardInputTokens: snapshot.standardInputTokens,
    visibleOutputTokens: snapshot.visibleOutputTokens,
    reasoningTokens: snapshot.reasoningTokens,
    billableOutputTokens: snapshot.billableOutputTokens,
    reasoningAccounting: snapshot.reasoningAccounting,
  };
}

function snapshotFxFromSnapshot(snapshot: PublishedUserChargeSnapshot): BillingFxSnapshot {
  return {
    mode: snapshot.fxMode,
    dateKey: snapshot.fxDateKey,
    usdToKrw: snapshot.usdToKrw,
    effectiveKrwPerUsd: snapshot.effectiveKrwPerUsd,
    source: snapshot.fxSource,
    overseasFeeRate: snapshot.overseasFeeRate,
    locked: snapshot.fxLocked,
  };
}

function approxEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= NUMERIC_TOLERANCE;
}

function pricingFromSnapshot(snapshot: PublishedUserChargeSnapshot): PublishedModelPricing {
  return {
    modelId: snapshot.canonicalModelId,
    billingReferenceInputUsdPerMillion: snapshot.billingReferenceInputUsdPerMillion,
    billingReferenceOutputUsdPerMillion: snapshot.billingReferenceOutputUsdPerMillion,
    billingReferenceCacheReadUsdPerMillion: snapshot.billingReferenceCacheReadUsdPerMillion ?? undefined,
    billingReferenceCacheWriteUsdPerMillion: snapshot.billingReferenceCacheWriteUsdPerMillion ?? undefined,
    targetMargin: snapshot.targetMargin,
    minimumMarginFloor: snapshot.minimumMarginFloor,
    pricingVersion: snapshot.pricingVersion,
    publishedAt: snapshot.publishedAt,
  };
}

/** Structural snapshot shape — diagnostic-tolerant (no live-grade eligibility). */
export function validatePublishedChargeSnapshotStructure(
  value: unknown
): value is PublishedUserChargeSnapshot {
  if (value == null || typeof value !== "object") return false;
  const s = value as PublishedUserChargeSnapshot;

  if (s.chargeSnapshotSchemaVersion !== CHARGE_SNAPSHOT_SCHEMA_VERSION) return false;
  if (s.roundingPolicyVersion !== PUBLISHED_CHARGE_ROUNDING_POLICY_VERSION) return false;
  if (typeof s.requestedModelId !== "string" || s.requestedModelId.length === 0) return false;
  if (typeof s.canonicalModelId !== "string" || s.canonicalModelId.length === 0) return false;
  if (!Number.isSafeInteger(s.pricingVersion) || s.pricingVersion <= 0) return false;
  if (typeof s.publishedAt !== "string" || !isValidIsoTimestamp(s.publishedAt)) return false;
  if (!isValidUsdRate(s.billingReferenceInputUsdPerMillion)) return false;
  if (!isValidUsdRate(s.billingReferenceOutputUsdPerMillion)) return false;
  if (!isValidOptionalCacheRate(s.billingReferenceCacheReadUsdPerMillion)) return false;
  if (!isValidOptionalCacheRate(s.billingReferenceCacheWriteUsdPerMillion)) return false;
  if (!Number.isFinite(s.targetMargin) || s.targetMargin < 0 || s.targetMargin >= 1) return false;
  if (!Number.isFinite(s.minimumMarginFloor) || s.minimumMarginFloor < 0 || s.minimumMarginFloor >= 1) return false;
  if (s.applicability == null || !validateApplicabilitySnapshotStructure(s.applicability)) return false;
  if (s.usageCoverage !== "complete" && s.usageCoverage !== "partial" && s.usageCoverage !== "unknown") {
    return false;
  }
  if (s.fxMode !== "daily_kst") return false;
  if (typeof s.fxDateKey !== "string") return false;
  if (s.fxSource !== "api_daily" && s.fxSource !== "previous_daily_snapshot" && s.fxSource !== "emergency_fallback") {
    return false;
  }
  if (!Number.isFinite(s.usdToKrw) || s.usdToKrw <= 0) return false;
  if (!Number.isFinite(s.effectiveKrwPerUsd) || s.effectiveKrwPerUsd <= 0) return false;
  if (!Number.isFinite(s.overseasFeeRate) || s.overseasFeeRate < 0) return false;
  if (typeof s.fxLocked !== "boolean") return false;
  if (!Number.isFinite(s.billingReferenceCostUsd) || !Number.isFinite(s.billingReferenceCostKrw)) return false;
  if (!Number.isFinite(s.standardUserChargeKrw) || !Number.isFinite(s.finalUserChargeKrw)) return false;
  if (!Number.isInteger(s.finalPoints) || s.finalPoints < 0) return false;
  if (!validateAdjustment(s.adjustment)) return false;

  return validateNormalizedBillableUsage(snapshotUsageFromSnapshot(s));
}

/** Arithmetic coherence from embedded snapshot values only. */
export function validatePublishedChargeSnapshotArithmetic(snapshot: PublishedUserChargeSnapshot): boolean {
  const usage = snapshotUsageFromSnapshot(snapshot);
  if (!validateNormalizedBillableUsage(usage)) return false;

  const pricing = pricingFromSnapshot(snapshot);
  if (!validatePublishedModelPricingForLiveGrade(pricing)) return false;

  const expectedCostUsd = computeBillingReferenceCostUsd(usage, pricing);
  if (!approxEqual(expectedCostUsd, snapshot.billingReferenceCostUsd)) return false;

  const expectedCostKrw = roundKrwTenths(
    convertUsdToKrwPure(expectedCostUsd, snapshot.effectiveKrwPerUsd)
  );
  if (!approxEqual(expectedCostKrw, snapshot.billingReferenceCostKrw)) return false;

  const expectedStandard = roundKrwTenths(expectedCostKrw / (1 - snapshot.targetMargin));
  if (!approxEqual(expectedStandard, snapshot.standardUserChargeKrw)) return false;

  let expectedFinalKrw = expectedStandard;
  switch (snapshot.adjustment.kind) {
    case "none":
      break;
    case "waiver":
      expectedFinalKrw = 0;
      break;
    case "self_funded_promo":
      if (!validateAdjustment(snapshot.adjustment)) return false;
      expectedFinalKrw = roundKrwTenths(expectedStandard * (1 - snapshot.adjustment.percent));
      break;
    default: {
      const _exhaustive: never = snapshot.adjustment;
      return _exhaustive;
    }
  }
  if (!approxEqual(expectedFinalKrw, snapshot.finalUserChargeKrw)) return false;

  const expectedPoints = ceilPublishedChargePoints(expectedFinalKrw);
  if (snapshot.finalPoints !== expectedPoints) return false;

  const fxSnapshot = snapshotFxFromSnapshot(snapshot);
  if (!validateBillingFxSnapshot(fxSnapshot, { requireLocked: snapshot.fxLocked })) return false;

  return true;
}

/** Policy eligibility from embedded applicability only — no current policy map lookup. */
export function validateEmbeddedPublishedApplicability(snapshot: PublishedUserChargeSnapshot): boolean {
  if (!validateApplicabilitySnapshotStructure(snapshot.applicability)) return false;

  const usage = snapshotUsageFromSnapshot(snapshot);
  if (!evaluateTierEligibilityFromApplicabilitySnapshot(usage, snapshot.applicability)) {
    return false;
  }

  return evaluateCacheEligibilityFromApplicabilitySnapshot(
    usage,
    snapshot.applicability,
    snapshot.billingReferenceCacheReadUsdPerMillion,
    snapshot.billingReferenceCacheWriteUsdPerMillion
  );
}

/** Diagnostic snapshot validator — structure + arithmetic, not persistence-ready. */
export function isPublishedUserChargeSnapshot(value: unknown): value is PublishedUserChargeSnapshot {
  if (!validatePublishedChargeSnapshotStructure(value)) return false;
  return validatePublishedChargeSnapshotArithmetic(value);
}

/** Live-grade / persistence-ready charge snapshot validator. */
export function isLiveGradePublishedUserChargeSnapshot(
  value: unknown
): value is PublishedUserChargeSnapshot {
  if (!isPublishedUserChargeSnapshot(value)) return false;
  const s = value;
  if (s.usageCoverage !== "complete") return false;
  if (s.fxLocked !== true) return false;
  if (canonicalizePublishedModelId(s.requestedModelId) !== s.canonicalModelId) return false;
  return validateEmbeddedPublishedApplicability(s);
}

/** Recompute cost/points for adversarial tamper tests — uses snapshot embedded rates only. */
export function recomputeSnapshotTotalsFromEmbeddedValues(
  snapshot: PublishedUserChargeSnapshot
): PublishedUserChargeSnapshot {
  const usage = snapshotUsageFromSnapshot(snapshot);
  const pricing = pricingFromSnapshot(snapshot);
  const billingReferenceCostUsd = computeBillingReferenceCostUsd(usage, pricing);
  const billingReferenceCostKrw = roundKrwTenths(
    convertUsdToKrwPure(billingReferenceCostUsd, snapshot.effectiveKrwPerUsd)
  );
  const standardUserChargeKrw = roundKrwTenths(
    billingReferenceCostKrw / (1 - snapshot.targetMargin)
  );
  let finalUserChargeKrw = standardUserChargeKrw;
  switch (snapshot.adjustment.kind) {
    case "none":
      break;
    case "waiver":
      finalUserChargeKrw = 0;
      break;
    case "self_funded_promo":
      finalUserChargeKrw = roundKrwTenths(standardUserChargeKrw * (1 - snapshot.adjustment.percent));
      break;
    default: {
      const _exhaustive: never = snapshot.adjustment;
      throw new Error(`Unhandled adjustment: ${String(_exhaustive)}`);
    }
  }
  return {
    ...snapshot,
    billingReferenceCostUsd,
    billingReferenceCostKrw,
    standardUserChargeKrw,
    finalUserChargeKrw,
    finalPoints: ceilPublishedChargePoints(finalUserChargeKrw),
  };
}
