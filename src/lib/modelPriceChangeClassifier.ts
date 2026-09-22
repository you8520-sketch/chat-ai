/**
 * Price change classifier — maps diffs to event types and canonical actions.
 * Does not mutate pricing; decisions are applied by modelPricingTracker.
 */

import { MODEL_PRICING_LARGE_CHANGE_THRESHOLD } from "@/lib/modelPricingTrackingConfig";
import type { ModelPricingPolicy } from "@/lib/modelPricingPolicy";
import type { PriceSnapshotPricingMode } from "@/lib/modelPricingTrackingConfig";
import {
  maxRelativeRateDelta,
  snapshotBaselineRatesEqual,
  snapshotRatesEqual,
  type ModelPriceSnapshotRecord,
  type PriceRateSnapshot,
} from "@/lib/modelPriceSnapshot";
import type { PublishedModelPricing } from "@/lib/publishedModelPricing";

export type PriceChangeEventType =
  | "CI_REFERENCE_CHANGED_UNVERIFIED"
  | "OFFICIAL_TEMP_PROMOTION_STARTED"
  | "OFFICIAL_TEMP_PROMOTION_ENDED"
  | "OFFICIAL_PROVIDER_PRICE_CHANGED"
  | "OFFICIAL_PROVIDER_BASELINE_MISMATCH"
  | "PROCUREMENT_TIER_CHANGED"
  | "CI_MARKET_DISCOUNT_CHANGED"
  | "MODEL_ROUTING_CHANGED"
  | "MODEL_RETIRED"
  | "SOURCE_CONFLICT"
  | "PARSER_FAILURE";

export type PriceChangeAction =
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

/**
 * Canonical PRICE EVENT OCCURRENCE fingerprint owner.
 *
 * Transition events (rate/tier/routing/reference moves between COMPLETED snapshots):
 * - Identity = type + modelId + old/new state fingerprints + **previousObservedAt**
 *   (the last COMPLETED previous snapshot's observation time — the transition anchor).
 * - Current source `fetchedAt` is event metadata (`effectiveAt`) only; a fresh retry
 *   timestamp alone must not create a second business transition (A@t0→B@t1 vs B@t2).
 * - Return oscillation A→B→A→B preserves distinct occurrences because the anchor
 *   advances with each COMPLETED previous snapshot.
 *
 * Non-transition events use `occurrenceDiscriminator` (e.g. SOURCE_CONFLICT runDateKey,
 * PARSER_FAILURE runDateKey) — see each classifier branch.
 *
 * Identity derives from deterministic evidence only — never random ids.
 */
export function buildPriceChangeEventOccurrenceFingerprint(params: {
  eventType: PriceChangeEventType;
  modelId: string;
  oldFingerprint: string | null;
  newFingerprint: string | null;
  /** Last COMPLETED previous snapshot observation time — transition anchor. */
  previousObservedAt?: string | null;
  /** Stable discriminator for non-transition occurrence scoping. */
  occurrenceDiscriminator?: Record<string, unknown>;
}): string {
  return JSON.stringify({
    type: params.eventType,
    modelId: params.modelId,
    old: params.oldFingerprint,
    new: params.newFingerprint,
    ...(params.previousObservedAt !== undefined
      ? { previousObservedAt: params.previousObservedAt }
      : {}),
    ...(params.occurrenceDiscriminator ?? {}),
  });
}

function transitionEventFingerprint(params: {
  eventType: PriceChangeEventType;
  modelId: string;
  previous: ModelPriceSnapshotRecord | null;
  newFingerprint: string;
}): string {
  return buildPriceChangeEventOccurrenceFingerprint({
    eventType: params.eventType,
    modelId: params.modelId,
    oldFingerprint: params.previous?.rawFingerprint ?? null,
    newFingerprint: params.newFingerprint,
    previousObservedAt: params.previous?.observedAt ?? null,
  });
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
      eventFingerprint: transitionEventFingerprint({
        eventType: "PROCUREMENT_TIER_CHANGED",
        modelId: params.modelId,
        previous: params.previous,
        newFingerprint: params.current.rawFingerprint,
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
      eventFingerprint: transitionEventFingerprint({
        eventType: "CI_MARKET_DISCOUNT_CHANGED",
        modelId: params.modelId,
        previous: params.previous,
        newFingerprint: params.current.rawFingerprint,
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
      eventFingerprint: transitionEventFingerprint({
        eventType: "CI_MARKET_DISCOUNT_CHANGED",
        modelId: params.modelId,
        previous: params.previous,
        newFingerprint: params.current.rawFingerprint,
      }),
    });
  }

  return events;
}

/**
 * CI reference classification owner (Phase A).
 *
 * CI `reference_*` is a PROCUREMENT-side quote, not official provider evidence.
 * Official provider PEAK transitions use `OFFICIAL_PROVIDER_PRICE_CHANGED`.
 */
export function classifyCiReferenceChange(params: {
  policy: ModelPricingPolicy;
  published: PublishedModelPricing;
  previous: ModelPriceSnapshotRecord | null;
  current: ModelPriceSnapshotRecord;
}): ClassifiedPriceChange[] {
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
      eventFingerprint: transitionEventFingerprint({
        eventType: "MODEL_ROUTING_CHANGED",
        modelId: params.policy.modelId,
        previous: params.previous,
        newFingerprint: params.current.rawFingerprint,
      }),
    });
    return events;
  }

  if (prev == null) {
    return events;
  }

  const relativeDelta = maxRelativeRateDelta(prev, next);
  const isLarge = relativeDelta >= MODEL_PRICING_LARGE_CHANGE_THRESHOLD;

  events.push({
    eventType: "CI_REFERENCE_CHANGED_UNVERIFIED",
    action: "HOLD",
    decision: "await_official_provider_corroboration",
    // The event OWNER stays CI-unverified even for large moves; the large
    // change is only surfaced in the classification detail.
    classification: isLarge ? "UNEXPECTED_LARGE_CHANGE" : "ci_reference_changed_unverified",
    oldFingerprint: params.previous?.rawFingerprint ?? null,
    newFingerprint: params.current.rawFingerprint,
    oldValues: ratesPayload(prev),
    newValues: ratesPayload(next),
    effectiveAt: params.current.observedAt,
    eventFingerprint: transitionEventFingerprint({
      eventType: "CI_REFERENCE_CHANGED_UNVERIFIED",
      modelId: params.policy.modelId,
      previous: params.previous,
      newFingerprint: params.current.rawFingerprint,
    }),
  });

  return events;
}

/** Official provider PEAK transition — same semantic domain as previous official PEAK. */
export function classifyOfficialProviderPeakChange(params: {
  modelId: string;
  previous: ModelPriceSnapshotRecord | null;
  current: ModelPriceSnapshotRecord;
}): ClassifiedPriceChange[] {
  const events: ClassifiedPriceChange[] = [];
  if (params.current.pricingMode !== "provider_peak") return events;
  if (params.previous && snapshotBaselineRatesEqual(params.previous.rates, params.current.rates)) {
    return events;
  }
  if (params.previous == null) return events;

  const prev = params.previous.rates;
  const next = params.current.rates;
  const relativeDelta = maxRelativeRateDelta(prev, next);
  const isLarge = relativeDelta >= MODEL_PRICING_LARGE_CHANGE_THRESHOLD;

  events.push({
    eventType: "OFFICIAL_PROVIDER_PRICE_CHANGED",
    action: "HOLD",
    decision: "official_provider_peak_changed_hold",
    classification: isLarge ? "UNEXPECTED_LARGE_CHANGE" : "official_provider_peak_changed",
    oldFingerprint: params.previous.rawFingerprint,
    newFingerprint: params.current.rawFingerprint,
    oldValues: ratesPayload(prev),
    newValues: ratesPayload(next),
    effectiveAt: params.current.observedAt,
    eventFingerprint: transitionEventFingerprint({
      eventType: "OFFICIAL_PROVIDER_PRICE_CHANGED",
      modelId: params.modelId,
      previous: params.previous,
      newFingerprint: params.current.rawFingerprint,
    }),
  });
  return events;
}

/**
 * Official provider PEAK vs published product baseline — same semantic domain
 * when product policy baselineMode is PROVIDER_PEAK (published rates are PEAK).
 */
export function classifyOfficialProviderBaselineMismatch(params: {
  modelId: string;
  officialPeak: ModelPriceSnapshotRecord;
  publishedBaseline: ModelPriceSnapshotRecord;
  runDateKey: string;
}): ClassifiedPriceChange | null {
  if (params.officialPeak.pricingMode !== "provider_peak") return null;
  if (snapshotBaselineRatesEqual(params.officialPeak.rates, params.publishedBaseline.rates)) {
    return null;
  }
  return {
    eventType: "OFFICIAL_PROVIDER_BASELINE_MISMATCH",
    action: "HOLD",
    decision: "official_provider_peak_vs_published_hold",
    classification: "official_provider_peak_vs_published_baseline_mismatch",
    oldFingerprint: params.publishedBaseline.rawFingerprint,
    newFingerprint: params.officialPeak.rawFingerprint,
    oldValues: ratesPayload(params.publishedBaseline.rates),
    newValues: ratesPayload(params.officialPeak.rates),
    effectiveAt: params.officialPeak.observedAt,
    eventFingerprint: buildPriceChangeEventOccurrenceFingerprint({
      eventType: "OFFICIAL_PROVIDER_BASELINE_MISMATCH",
      modelId: params.modelId,
      oldFingerprint: params.publishedBaseline.rawFingerprint,
      newFingerprint: params.officialPeak.rawFingerprint,
      occurrenceDiscriminator: { runDateKey: params.runDateKey },
    }),
  };
}

export function classifyParserFailure(params: {
  modelId: string;
  sourceKind: string;
  reason: string;
  runDateKey: string;
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
    // One canonical PARSER_FAILURE occurrence per model/source/reason/KST day.
    // Same-day retry dedupes; next-day recurrence is a new occurrence.
    // Detailed per-attempt incidents remain in model_pricing_admin_events.
    eventFingerprint: buildPriceChangeEventOccurrenceFingerprint({
      eventType: "PARSER_FAILURE",
      modelId: params.modelId,
      oldFingerprint: null,
      newFingerprint: null,
      occurrenceDiscriminator: {
        sourceKind: params.sourceKind,
        reason: params.reason,
        runDateKey: params.runDateKey,
      },
    }),
  };
}

const PROCUREMENT_PRICING_MODES = new Set<PriceSnapshotPricingMode>([
  "procurement_current",
  "procurement_reference",
]);

const PROVIDER_PRICING_MODES = new Set<PriceSnapshotPricingMode>([
  "provider_standard",
  "provider_peak",
]);

/**
 * SOURCE_CONFLICT applies only when two observations claim the same semantic
 * pricing domain. CI procurement quotes and the product stable published
 * baseline are intentionally different domains in Phase A.
 */
export function areComparableSourceConflictDomains(
  left: ModelPriceSnapshotRecord,
  right: ModelPriceSnapshotRecord
): boolean {
  const leftProcurement = PROCUREMENT_PRICING_MODES.has(left.pricingMode);
  const rightProcurement = PROCUREMENT_PRICING_MODES.has(right.pricingMode);
  const leftPublishedBaseline = left.sourceKind === "published_billing_baseline";
  const rightPublishedBaseline = right.sourceKind === "published_billing_baseline";

  if (leftProcurement && rightPublishedBaseline) return false;
  if (rightProcurement && leftPublishedBaseline) return false;

  if (PROVIDER_PRICING_MODES.has(left.pricingMode) && PROVIDER_PRICING_MODES.has(right.pricingMode)) {
    return left.pricingMode === right.pricingMode;
  }

  if (left.sourceKind === right.sourceKind) return true;

  return false;
}

export function classifySourceConflict(params: {
  modelId: string;
  ciReference: ModelPriceSnapshotRecord;
  publishedBaseline: ModelPriceSnapshotRecord;
  runDateKey: string;
}): ClassifiedPriceChange | null {
  if (!areComparableSourceConflictDomains(params.ciReference, params.publishedBaseline)) {
    return null;
  }
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
    effectiveAt: params.ciReference.observedAt,
    // Source-condition observation (published vs CI reference at run time), not a
    // completed-to-completed transition. One occurrence per KST day per fingerprint pair.
    eventFingerprint: buildPriceChangeEventOccurrenceFingerprint({
      eventType: "SOURCE_CONFLICT",
      modelId: params.modelId,
      oldFingerprint: params.publishedBaseline.rawFingerprint,
      newFingerprint: params.ciReference.rawFingerprint,
      occurrenceDiscriminator: { runDateKey: params.runDateKey },
    }),
  };
}