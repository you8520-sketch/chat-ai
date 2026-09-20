/**
 * Price change classifier — maps diffs to event types and canonical actions.
 * Does not mutate pricing; decisions are applied by modelPricingTracker.
 */

import {
  MODEL_PRICING_LARGE_CHANGE_THRESHOLD,
  MODEL_PRICING_TRACKER_PHASE,
  type ModelPricingTrackerPhase,
} from "@/lib/modelPricingTrackingConfig";
import type { ModelPricingPolicy } from "@/lib/modelPricingPolicy";
import {
  maxRelativeRateDelta,
  snapshotBaselineRatesEqual,
  snapshotRatesEqual,
  type ModelPriceSnapshotRecord,
  type PriceRateSnapshot,
} from "@/lib/modelPriceSnapshot";
import type { PublishedModelPricing } from "@/lib/publishedModelPricing";

export type PriceChangeEventType =
  | "PROVIDER_NORMAL_BASELINE_CHANGED"
  | "PROVIDER_SCHEDULED_BASELINE_CHANGED"
  | "OFFICIAL_TEMP_PROMOTION_STARTED"
  | "OFFICIAL_TEMP_PROMOTION_ENDED"
  | "PROCUREMENT_TIER_CHANGED"
  | "CI_MARKET_DISCOUNT_CHANGED"
  | "CI_REFERENCE_CHANGED_UNVERIFIED"
  | "MODEL_ROUTING_CHANGED"
  | "MODEL_RETIRED"
  | "SOURCE_CONFLICT"
  | "PARSER_FAILURE";

export type PriceChangeAction =
  | "AUTO_APPLY_BASE"
  | "ACTIVATE_PROMOTION"
  | "END_PROMOTION"
  | "PROCUREMENT_ONLY"
  | "HOLD"
  | "OBSERVE_ONLY_LOG"
  | "ADMIN_ALERT";

export type ClassifiedPriceChange = {
  eventType: PriceChangeEventType;
  action: PriceChangeAction;
  decision: string;
  classification: string;
  oldFingerprint: string | null;
  newFingerprint: string | null;
  oldValues: Record<string, unknown>;
  newValues: Record<string, unknown>;
  effectiveAt: string | null;
  eventFingerprint: string;
};

function ratesPayload(rates: PriceRateSnapshot): Record<string, unknown> {
  return { ...rates };
}

function eventFingerprintParts(parts: Record<string, unknown>): string {
  return JSON.stringify(parts);
}

export function classifyCiCurrentChange(params: {
  modelId: string;
  previous: ModelPriceSnapshotRecord | null;
  current: ModelPriceSnapshotRecord;
}): ClassifiedPriceChange[] {
  const events: ClassifiedPriceChange[] = [];
  if (params.previous && snapshotRatesEqual(params.previous.rates, params.current.rates)) {
    return events;
  }

  const prev = params.previous?.rates ?? null;
  const next = params.current.rates;
  const discountChanged =
    prev != null && prev.discountPercent !== next.discountPercent;
  const procurementRatesChanged =
    prev != null &&
    (prev.inputUsdPerMillion !== next.inputUsdPerMillion ||
      prev.outputUsdPerMillion !== next.outputUsdPerMillion ||
      prev.cacheReadUsdPerMillion !== next.cacheReadUsdPerMillion ||
      prev.cacheWriteUsdPerMillion !== next.cacheWriteUsdPerMillion);
  const tierChanged = prev != null && prev.tierThreshold !== next.tierThreshold;

  if (tierChanged) {
    events.push({
      eventType: "PROCUREMENT_TIER_CHANGED",
      action: "PROCUREMENT_ONLY",
      decision: "procurement_and_realized_margin_only",
      classification: "tier_threshold_changed",
      oldFingerprint: params.previous?.rawFingerprint ?? null,
      newFingerprint: params.current.rawFingerprint,
      oldValues: prev ? ratesPayload(prev) : {},
      newValues: ratesPayload(next),
      effectiveAt: params.current.observedAt,
      eventFingerprint: eventFingerprintParts({
        type: "PROCUREMENT_TIER_CHANGED",
        modelId: params.modelId,
        old: prev?.tierThreshold,
        new: next.tierThreshold,
      }),
    });
  }

  if (discountChanged && !procurementRatesChanged) {
    events.push({
      eventType: "CI_MARKET_DISCOUNT_CHANGED",
      action: "PROCUREMENT_ONLY",
      decision: "procurement_and_realized_margin_only",
      classification: "ci_discount_percent_changed",
      oldFingerprint: params.previous?.rawFingerprint ?? null,
      newFingerprint: params.current.rawFingerprint,
      oldValues: { discountPercent: prev?.discountPercent ?? null },
      newValues: { discountPercent: next.discountPercent },
      effectiveAt: params.current.observedAt,
      eventFingerprint: eventFingerprintParts({
        type: "CI_MARKET_DISCOUNT_CHANGED",
        modelId: params.modelId,
        old: prev?.discountPercent,
        new: next.discountPercent,
      }),
    });
  } else if (procurementRatesChanged) {
    events.push({
      eventType: "CI_MARKET_DISCOUNT_CHANGED",
      action: "PROCUREMENT_ONLY",
      decision: "procurement_and_realized_margin_only",
      classification: "ci_current_rates_changed",
      oldFingerprint: params.previous?.rawFingerprint ?? null,
      newFingerprint: params.current.rawFingerprint,
      oldValues: prev ? ratesPayload(prev) : {},
      newValues: ratesPayload(next),
      effectiveAt: params.current.observedAt,
      eventFingerprint: eventFingerprintParts({
        type: "CI_MARKET_DISCOUNT_CHANGED",
        modelId: params.modelId,
        kind: "current_rates",
      }),
    });
  }

  return events;
}

export function classifyCiReferenceChange(params: {
  policy: ModelPricingPolicy;
  published: PublishedModelPricing;
  previous: ModelPriceSnapshotRecord | null;
  current: ModelPriceSnapshotRecord;
  phase?: ModelPricingTrackerPhase;
}): ClassifiedPriceChange[] {
  const phase = params.phase ?? MODEL_PRICING_TRACKER_PHASE;
  const events: ClassifiedPriceChange[] = [];
  if (params.previous && snapshotRatesEqual(params.previous.rates, params.current.rates)) {
    return events;
  }

  const prev = params.previous?.rates ?? null;
  const next = params.current.rates;

  if (params.current.providerModelId !== params.policy.expectedProviderModelId) {
    events.push({
      eventType: "MODEL_ROUTING_CHANGED",
      action: "HOLD",
      decision: "model_identity_mismatch_hold",
      classification: "provider_model_id_changed",
      oldFingerprint: params.previous?.rawFingerprint ?? null,
      newFingerprint: params.current.rawFingerprint,
      oldValues: { providerModelId: params.previous?.providerModelId ?? params.policy.expectedProviderModelId },
      newValues: { providerModelId: params.current.providerModelId },
      effectiveAt: params.current.observedAt,
      eventFingerprint: eventFingerprintParts({
        type: "MODEL_ROUTING_CHANGED",
        modelId: params.policy.modelId,
        old: params.previous?.providerModelId,
        new: params.current.providerModelId,
      }),
    });
    return events;
  }

  if (prev == null) {
    return events;
  }

  const relativeDelta = maxRelativeRateDelta(prev, next);
  const isLarge = relativeDelta >= MODEL_PRICING_LARGE_CHANGE_THRESHOLD;
  const scheduled =
    params.current.validFrom != null &&
    params.current.validFrom !== params.current.observedAt;

  const publishedInput = params.published.billingReferenceInputUsdPerMillion;
  const publishedOutput = params.published.billingReferenceOutputUsdPerMillion;
  const matchesPublishedBaseline =
    next.inputUsdPerMillion === publishedInput && next.outputUsdPerMillion === publishedOutput;

  if (!matchesPublishedBaseline && !scheduled) {
    events.push({
      eventType: "CI_REFERENCE_CHANGED_UNVERIFIED",
      action: "HOLD",
      decision: "await_official_provider_corroboration",
      classification: "ci_reference_differs_from_active_published_baseline",
      oldFingerprint: params.previous?.rawFingerprint ?? null,
      newFingerprint: params.current.rawFingerprint,
      oldValues: ratesPayload(prev),
      newValues: ratesPayload(next),
      effectiveAt: params.current.observedAt,
      eventFingerprint: eventFingerprintParts({
        type: "CI_REFERENCE_CHANGED_UNVERIFIED",
        modelId: params.policy.modelId,
        newFingerprint: params.current.rawFingerprint,
      }),
    });
  }

  if (isLarge && !scheduled) {
    events.push({
      eventType: "PROVIDER_NORMAL_BASELINE_CHANGED",
      action: "HOLD",
      decision: "unexpected_large_change_admin_review",
      classification: "UNEXPECTED_LARGE_CHANGE",
      oldFingerprint: params.previous?.rawFingerprint ?? null,
      newFingerprint: params.current.rawFingerprint,
      oldValues: ratesPayload(prev),
      newValues: ratesPayload(next),
      effectiveAt: params.current.observedAt,
      eventFingerprint: eventFingerprintParts({
        type: "PROVIDER_NORMAL_BASELINE_CHANGED",
        modelId: params.policy.modelId,
        hold: "large_change",
      }),
    });
    return events;
  }

  const eventType: PriceChangeEventType = scheduled
    ? "PROVIDER_SCHEDULED_BASELINE_CHANGED"
    : "PROVIDER_NORMAL_BASELINE_CHANGED";

  const canAutoApply =
    phase === "AUTO_APPLY_SAFE_EVENTS" &&
    params.policy.autoApply &&
    matchesPublishedBaseline &&
    params.policy.baselineMode !== "FIXED_VERIFIED_REFERENCE";

  events.push({
    eventType,
    action: canAutoApply ? "AUTO_APPLY_BASE" : phase === "OBSERVE_ONLY" ? "OBSERVE_ONLY_LOG" : "HOLD",
    decision: canAutoApply
      ? "auto_apply_candidate"
      : phase === "OBSERVE_ONLY"
        ? "deferred_observe_only"
        : "auto_apply_disabled_by_policy",
    classification: scheduled ? "KNOWN_SCHEDULED_LARGE_CHANGE" : "verified_baseline_change",
    oldFingerprint: params.previous?.rawFingerprint ?? null,
    newFingerprint: params.current.rawFingerprint,
    oldValues: prev ? ratesPayload(prev) : {},
    newValues: ratesPayload(next),
    effectiveAt: params.current.validFrom ?? params.current.observedAt,
    eventFingerprint: eventFingerprintParts({
      type: eventType,
      modelId: params.policy.modelId,
      newFingerprint: params.current.rawFingerprint,
    }),
  });

  return events;
}

export function classifyParserFailure(params: {
  modelId: string;
  sourceKind: string;
  reason: string;
}): ClassifiedPriceChange {
  return {
    eventType: "PARSER_FAILURE",
    action: "ADMIN_ALERT",
    decision: "fail_closed_keep_active_price",
    classification: params.reason,
    oldFingerprint: null,
    newFingerprint: null,
    oldValues: {},
    newValues: { sourceKind: params.sourceKind },
    effectiveAt: null,
    eventFingerprint: eventFingerprintParts({
      type: "PARSER_FAILURE",
      modelId: params.modelId,
      sourceKind: params.sourceKind,
    }),
  };
}

export function classifySourceConflict(params: {
  modelId: string;
  ciReference: ModelPriceSnapshotRecord;
  publishedBaseline: ModelPriceSnapshotRecord;
}): ClassifiedPriceChange | null {
  if (snapshotBaselineRatesEqual(params.ciReference.rates, params.publishedBaseline.rates)) return null;
  return {
    eventType: "SOURCE_CONFLICT",
    action: "HOLD",
    decision: "source_conflict_keep_active_price",
    classification: "ci_reference_vs_published_baseline_mismatch",
    oldFingerprint: params.publishedBaseline.rawFingerprint,
    newFingerprint: params.ciReference.rawFingerprint,
    oldValues: ratesPayload(params.publishedBaseline.rates),
    newValues: ratesPayload(params.ciReference.rates),
    effectiveAt: null,
    eventFingerprint: eventFingerprintParts({
      type: "SOURCE_CONFLICT",
      modelId: params.modelId,
      published: params.publishedBaseline.rawFingerprint,
      ci: params.ciReference.rawFingerprint,
    }),
  };
}

export function resolveActionForPhase(
  action: PriceChangeAction,
  phase: ModelPricingTrackerPhase = MODEL_PRICING_TRACKER_PHASE
): PriceChangeAction {
  if (phase === "OBSERVE_ONLY" && action === "AUTO_APPLY_BASE") {
    return "OBSERVE_ONLY_LOG";
  }
  return action;
}
