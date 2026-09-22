/**
 * Main RP pricing candidate band — READ-ONLY decision support (Phase B2C).
 * Computes safe target-margin bands from MARKET / PROCUREMENT / PRODUCT / ACTUAL evidence.
 * Never mutates published catalog, billing, or promotions.
 */

import type { BillingFxSnapshot } from "@/lib/billingFxSnapshot";
import { normalizeBillableUsage, type NormalizedBillableUsage } from "@/lib/billingUsage";
import {
  isPhase1PublishedBillingEnabled,
  isPhase1PublishedBillingModel,
  isPhase2DeepSeekPublishedBillingEnabled,
  isPhase2DeepSeekPublishedBillingModel,
} from "@/lib/chatBillingContractDispatch";
import type { ActualProductionEconomicsObservation } from "@/lib/mainRpPricingActualEconomics";
import type {
  ProcurementFreshnessState,
  ProcurementObservation,
  ProductionBillingContractLabel,
  RepresentativeEconomicsObservation,
} from "@/lib/mainRpPricingObservability";
import {
  getMarketBenchmarks,
  type MarketUsageBenchmark,
} from "@/lib/marketUsageBenchmarks";
import { REPRESENTATIVE_TRACKER_WORKLOAD } from "@/lib/modelPricingTracker";
import {
  getPublishedPricing,
  resolvePublishedPricingExact,
  type PublishedModelPricing,
  type ResolvedPublishedPricing,
} from "@/lib/publishedModelPricing";
import {
  computePublishedUserChargeFromResolvedPolicy,
  type PublishedUserChargeResult,
} from "@/lib/publishedUserCharge";

export const TARGET_MARGIN_BP_SCALE = 10_000 as const;
const MAX_TARGET_MARGIN_BP = TARGET_MARGIN_BP_SCALE - 1;

export type PricingCandidateStatus =
  | "READY"
  | "KEEP_CURRENT"
  | "HOLD_NO_HARD_MARKET_EVIDENCE"
  | "HOLD_PROCUREMENT_NOT_FRESH"
  | "HOLD_ACTUAL_REPRESENTATIVE_CONFLICT"
  | "NO_FEASIBLE_PRICE"
  | "UNAVAILABLE";

export type CandidateDirection =
  | "RAISE_TO_FLOOR"
  | "LOWER_TO_MARKET"
  | "KEEP_CURRENT"
  | "HOLD";

export type CandidateLiveApplicability =
  | "LIVE_PUBLISHED"
  | "DIRECT_SELECTION_ONLY"
  | "PUBLISHED_SHADOW_ONLY";

export type ActualCandidateSignal =
  | "CONFIRMS"
  | "CONFLICTS"
  | "NON_DECISIVE"
  | "NO_USAGE";

export type PricingCandidateMarketCase = {
  benchmarkId: string;
  competitorPoints: number;
  currentPoints: number | null;
  candidatePoints: number | null;
  pass: boolean | null;
};

export type PricingCandidateObservation = {
  domain: "CANDIDATE";
  status: PricingCandidateStatus;
  currentTargetMargin: number;
  minimumSafeTargetMargin: number | null;
  maximumCompetitiveTargetMargin: number | null;
  candidateTargetMargin: number | null;
  candidateDirection: CandidateDirection;
  representative: {
    currentPoints: number | null;
    candidatePoints: number | null;
    candidateProjectedMargin: number | null;
    floorPass: boolean | null;
  };
  market: {
    hardBenchmarkCount: number;
    allPass: boolean | null;
    cases: PricingCandidateMarketCase[];
  };
  actual: {
    monthKey: string | null;
    marginRate: number | null;
    exact: boolean;
    signal: ActualCandidateSignal;
  };
  procurementFreshness: ProcurementFreshnessState;
  liveApplicability: CandidateLiveApplicability;
  productionBillingContract: ProductionBillingContractLabel;
};

export type SafeBandDecisionInput = {
  currentTargetMargin: number;
  minimumMarginFloor: number;
  minimumSafeTargetMargin: number | null;
  maximumCompetitiveTargetMargin: number | null;
  procurementFreshness: ProcurementFreshnessState;
  hardBenchmarkCount: number;
  representativeFloorPass: boolean | null;
  actualSignal: ActualCandidateSignal;
};

export type SafeBandDecision = {
  status: PricingCandidateStatus;
  candidateTargetMargin: number | null;
  candidateDirection: CandidateDirection;
};

function targetMarginFromBasisPoints(bp: number): number {
  return bp / TARGET_MARGIN_BP_SCALE;
}

function basisPointsFromTargetMargin(targetMargin: number): number {
  return Math.round(targetMargin * TARGET_MARGIN_BP_SCALE);
}

function clampSearchBasisPoints(minimumMarginFloor: number): { minBp: number; maxBp: number } {
  const minBp = Math.max(0, Math.min(MAX_TARGET_MARGIN_BP, basisPointsFromTargetMargin(minimumMarginFloor)));
  return { minBp, maxBp: MAX_TARGET_MARGIN_BP };
}

function clonePricingWithTargetMargin(
  resolved: ResolvedPublishedPricing,
  targetMargin: number
): ResolvedPublishedPricing {
  return {
    ...resolved,
    pricing: {
      ...resolved.pricing,
      targetMargin,
    },
  };
}

function diagnosticChargeAtUsage(params: {
  resolved: ResolvedPublishedPricing;
  targetMargin: number;
  usage: NormalizedBillableUsage;
  fxSnapshot: BillingFxSnapshot;
}): PublishedUserChargeResult {
  return computePublishedUserChargeFromResolvedPolicy({
    requestedModelId: params.resolved.requestedModelId,
    resolvedPricing: clonePricingWithTargetMargin(params.resolved, params.targetMargin),
    usage: params.usage,
    usageCoverage: "complete",
    fxSnapshot: params.fxSnapshot,
    adjustment: { kind: "none" },
  });
}

function chargePointsFromResult(result: PublishedUserChargeResult): number | null {
  if (result.status !== "complete") return null;
  return result.snapshot.finalPoints;
}

function chargeKrwFromResult(result: PublishedUserChargeResult): number | null {
  if (result.status !== "complete") return null;
  return result.snapshot.finalUserChargeKrw;
}

function benchmarkToUsage(modelId: string, benchmark: MarketUsageBenchmark): NormalizedBillableUsage {
  return normalizeBillableUsage({
    modelId,
    promptTokens: benchmark.inputTokens,
    outputTokens: benchmark.displayedOutputTokens,
    reasoningTokens: benchmark.displayedReasoningTokens ?? 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  });
}

function representativeUsage(modelId: string): NormalizedBillableUsage {
  return normalizeBillableUsage({
    modelId,
    promptTokens: REPRESENTATIVE_TRACKER_WORKLOAD.promptTokens,
    outputTokens: REPRESENTATIVE_TRACKER_WORKLOAD.outputTokens,
    cacheReadTokens: REPRESENTATIVE_TRACKER_WORKLOAD.cacheReadTokens,
    cacheWriteTokens: REPRESENTATIVE_TRACKER_WORKLOAD.cacheWriteTokens,
  });
}

export function projectedRepresentativeMargin(params: {
  resolved: ResolvedPublishedPricing;
  targetMargin: number;
  fxSnapshot: BillingFxSnapshot;
  procurementCostKrw: number;
}): number | null {
  const result = diagnosticChargeAtUsage({
    resolved: params.resolved,
    targetMargin: params.targetMargin,
    usage: representativeUsage(params.resolved.requestedModelId),
    fxSnapshot: params.fxSnapshot,
  });
  const chargeKrw = chargeKrwFromResult(result);
  if (chargeKrw == null || chargeKrw <= 0) return null;
  return (chargeKrw - params.procurementCostKrw) / chargeKrw;
}

export function searchMinimumSafeTargetMargin(params: {
  resolved: ResolvedPublishedPricing;
  minimumMarginFloor: number;
  fxSnapshot: BillingFxSnapshot;
  procurementCostKrw: number;
}): number | null {
  const { minBp, maxBp } = clampSearchBasisPoints(params.minimumMarginFloor);
  const passes = (targetMargin: number): boolean => {
    const margin = projectedRepresentativeMargin({
      resolved: params.resolved,
      targetMargin,
      fxSnapshot: params.fxSnapshot,
      procurementCostKrw: params.procurementCostKrw,
    });
    return margin != null && margin >= params.minimumMarginFloor;
  };

  if (!passes(targetMarginFromBasisPoints(maxBp))) return null;

  let lo = minBp;
  let hi = maxBp;
  let answerBp: number | null = null;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (passes(targetMarginFromBasisPoints(mid))) {
      answerBp = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }
  return answerBp == null ? null : targetMarginFromBasisPoints(answerBp);
}

export function searchMaximumCompetitiveTargetMargin(params: {
  resolved: ResolvedPublishedPricing;
  minimumMarginFloor: number;
  fxSnapshot: BillingFxSnapshot;
  benchmarks: readonly MarketUsageBenchmark[];
}): number | null {
  if (params.benchmarks.length === 0) return null;

  const { minBp, maxBp } = clampSearchBasisPoints(params.minimumMarginFloor);

  const passes = (targetMargin: number): boolean => {
    for (const benchmark of params.benchmarks) {
      const usage = benchmarkToUsage(params.resolved.requestedModelId, benchmark);
      const result = diagnosticChargeAtUsage({
        resolved: params.resolved,
        targetMargin,
        usage,
        fxSnapshot: params.fxSnapshot,
      });
      const points = chargePointsFromResult(result);
      if (points == null || points > benchmark.competitorChargePoints) return false;
    }
    return true;
  };

  if (!passes(targetMarginFromBasisPoints(minBp))) return null;

  let lo = minBp;
  let hi = maxBp;
  let answerBp: number | null = null;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (passes(targetMarginFromBasisPoints(mid))) {
      answerBp = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return answerBp == null ? null : targetMarginFromBasisPoints(answerBp);
}

export function resolveActualCandidateSignal(
  actual: ActualProductionEconomicsObservation,
  minimumMarginFloor: number
): ActualCandidateSignal {
  if (actual.usageState === "NO_USAGE") return "NO_USAGE";
  if (actual.usageState === "FINANCE_UNAVAILABLE") return "NON_DECISIVE";
  if (!actual.realizedMarginExact || actual.paidRevenueKrw <= 0) return "NON_DECISIVE";
  if (actual.marginRate == null) return "NON_DECISIVE";
  return actual.marginRate >= minimumMarginFloor ? "CONFIRMS" : "CONFLICTS";
}

export function resolveCandidateLiveApplicability(
  modelId: string,
  contract: ProductionBillingContractLabel
): CandidateLiveApplicability {
  if (contract === "published_phase1_when_enabled") return "LIVE_PUBLISHED";
  if (contract === "published_phase2_when_direct_selected") return "DIRECT_SELECTION_ONLY";
  if (
    contract === "published_phase1_capable_legacy_fallback" ||
    contract === "published_phase2_capable_legacy_fallback" ||
    contract === "legacy_proportional_ci_catalog"
  ) {
    return "PUBLISHED_SHADOW_ONLY";
  }

  if (isPhase1PublishedBillingModel(modelId) && isPhase1PublishedBillingEnabled()) {
    return "LIVE_PUBLISHED";
  }
  if (isPhase2DeepSeekPublishedBillingModel(modelId) && isPhase2DeepSeekPublishedBillingEnabled()) {
    return "DIRECT_SELECTION_ONLY";
  }
  return "PUBLISHED_SHADOW_ONLY";
}

/** Pure band decision — used by production compose and deterministic regression fixtures. */
export function decideSafeBand(params: SafeBandDecisionInput): SafeBandDecision {
  const {
    currentTargetMargin,
    minimumSafeTargetMargin,
    maximumCompetitiveTargetMargin,
    procurementFreshness,
    hardBenchmarkCount,
    representativeFloorPass,
    actualSignal,
  } = params;

  if (procurementFreshness !== "FRESH") {
    return {
      status: "HOLD_PROCUREMENT_NOT_FRESH",
      candidateTargetMargin: null,
      candidateDirection: "HOLD",
    };
  }

  if (hardBenchmarkCount === 0) {
    return {
      status: "HOLD_NO_HARD_MARKET_EVIDENCE",
      candidateTargetMargin: null,
      candidateDirection: "HOLD",
    };
  }

  if (minimumSafeTargetMargin == null || maximumCompetitiveTargetMargin == null) {
    return {
      status: "UNAVAILABLE",
      candidateTargetMargin: null,
      candidateDirection: "HOLD",
    };
  }

  if (minimumSafeTargetMargin > maximumCompetitiveTargetMargin) {
    return {
      status: "NO_FEASIBLE_PRICE",
      candidateTargetMargin: null,
      candidateDirection: "HOLD",
    };
  }

  let candidateTargetMargin = currentTargetMargin;
  let candidateDirection: CandidateDirection = "KEEP_CURRENT";

  if (currentTargetMargin < minimumSafeTargetMargin) {
    candidateDirection = "RAISE_TO_FLOOR";
    candidateTargetMargin = minimumSafeTargetMargin;
  } else if (currentTargetMargin > maximumCompetitiveTargetMargin) {
    candidateDirection = "LOWER_TO_MARKET";
    candidateTargetMargin = maximumCompetitiveTargetMargin;
  }

  if (representativeFloorPass === true && actualSignal === "CONFLICTS") {
    return {
      status: "HOLD_ACTUAL_REPRESENTATIVE_CONFLICT",
      candidateTargetMargin: null,
      candidateDirection: "HOLD",
    };
  }

  if (candidateDirection === "KEEP_CURRENT") {
    return {
      status: "KEEP_CURRENT",
      candidateTargetMargin: currentTargetMargin,
      candidateDirection: "KEEP_CURRENT",
    };
  }

  return {
    status: "READY",
    candidateTargetMargin,
    candidateDirection,
  };
}

function buildMarketCases(params: {
  resolved: ResolvedPublishedPricing;
  fxSnapshot: BillingFxSnapshot;
  benchmarks: readonly MarketUsageBenchmark[];
  currentTargetMargin: number;
  candidateTargetMargin: number | null;
}): {
  cases: PricingCandidateMarketCase[];
  allPass: boolean | null;
} {
  const cases: PricingCandidateMarketCase[] = params.benchmarks.map((benchmark) => {
    const usage = benchmarkToUsage(params.resolved.requestedModelId, benchmark);
    const currentResult = diagnosticChargeAtUsage({
      resolved: params.resolved,
      targetMargin: params.currentTargetMargin,
      usage,
      fxSnapshot: params.fxSnapshot,
    });
    const currentPoints = chargePointsFromResult(currentResult);

    let candidatePoints: number | null = null;
    let pass: boolean | null = null;
    if (params.candidateTargetMargin != null) {
      const candidateResult = diagnosticChargeAtUsage({
        resolved: clonePricingWithTargetMargin(params.resolved, params.candidateTargetMargin),
        targetMargin: params.candidateTargetMargin,
        usage,
        fxSnapshot: params.fxSnapshot,
      });
      candidatePoints = chargePointsFromResult(candidateResult);
      pass =
        candidatePoints != null ? candidatePoints <= benchmark.competitorChargePoints : null;
    } else if (currentPoints != null) {
      pass = currentPoints <= benchmark.competitorChargePoints;
    }

    return {
      benchmarkId: benchmark.id,
      competitorPoints: benchmark.competitorChargePoints,
      currentPoints,
      candidatePoints,
      pass,
    };
  });

  if (cases.length === 0) return { cases, allPass: null };
  if (cases.some((row) => row.pass == null)) return { cases, allPass: null };
  return { cases, allPass: cases.every((row) => row.pass === true) };
}

/** Compose read-only candidate observation for one Main RP model. */
export function composePricingCandidateObservation(params: {
  modelId: string;
  fxSnapshot: BillingFxSnapshot;
  procurement: ProcurementObservation;
  representative: RepresentativeEconomicsObservation;
  actual: ActualProductionEconomicsObservation;
  productionBillingContract: ProductionBillingContractLabel;
  published?: PublishedModelPricing;
}): PricingCandidateObservation {
  const published = params.published ?? getPublishedPricing(params.modelId);
  const resolved = resolvePublishedPricingExact(params.modelId);
  const benchmarks = getMarketBenchmarks(params.modelId);
  const actualSignal = resolveActualCandidateSignal(params.actual, published.minimumMarginFloor);
  const liveApplicability = resolveCandidateLiveApplicability(
    params.modelId,
    params.productionBillingContract
  );

  if (resolved == null) {
    return {
      domain: "CANDIDATE",
      status: "UNAVAILABLE",
      currentTargetMargin: published.targetMargin,
      minimumSafeTargetMargin: null,
      maximumCompetitiveTargetMargin: null,
      candidateTargetMargin: null,
      candidateDirection: "HOLD",
      representative: {
        currentPoints: null,
        candidatePoints: null,
        candidateProjectedMargin: null,
        floorPass: null,
      },
      market: {
        hardBenchmarkCount: benchmarks.length,
        allPass: null,
        cases: [],
      },
      actual: {
        monthKey: params.actual.monthKey,
        marginRate: params.actual.marginRate,
        exact: params.actual.realizedMarginExact,
        signal: actualSignal,
      },
      procurementFreshness: params.procurement.ciFreshnessState,
      liveApplicability,
      productionBillingContract: params.productionBillingContract,
    };
  }

  const currentTargetMargin = published.targetMargin;
  const repUsage = representativeUsage(params.modelId);
  const currentRepResult = diagnosticChargeAtUsage({
    resolved,
    targetMargin: currentTargetMargin,
    usage: repUsage,
    fxSnapshot: params.fxSnapshot,
  });
  const currentPoints = chargePointsFromResult(currentRepResult);

  let minimumSafeTargetMargin: number | null = null;
  let maximumCompetitiveTargetMargin: number | null = null;

  if (
    params.procurement.ciFreshnessState === "FRESH" &&
    params.procurement.representativeProcurementCostKrw != null &&
    params.procurement.representativeProcurementCostKrw > 0
  ) {
    minimumSafeTargetMargin = searchMinimumSafeTargetMargin({
      resolved,
      minimumMarginFloor: published.minimumMarginFloor,
      fxSnapshot: params.fxSnapshot,
      procurementCostKrw: params.procurement.representativeProcurementCostKrw,
    });
  }

  if (benchmarks.length > 0) {
    maximumCompetitiveTargetMargin = searchMaximumCompetitiveTargetMargin({
      resolved,
      minimumMarginFloor: published.minimumMarginFloor,
      fxSnapshot: params.fxSnapshot,
      benchmarks,
    });
  }

  const currentProjectedMargin =
    params.procurement.representativeProcurementCostKrw != null &&
    params.procurement.representativeProcurementCostKrw > 0
      ? projectedRepresentativeMargin({
          resolved,
          targetMargin: currentTargetMargin,
          fxSnapshot: params.fxSnapshot,
          procurementCostKrw: params.procurement.representativeProcurementCostKrw,
        })
      : null;

  const representativeFloorPass =
    currentProjectedMargin != null
      ? currentProjectedMargin >= published.minimumMarginFloor
      : params.representative.underlyingFloorVerdict === "healthy"
        ? true
        : params.representative.underlyingFloorVerdict === "below_floor"
          ? false
          : null;

  const bandDecision = decideSafeBand({
    currentTargetMargin,
    minimumMarginFloor: published.minimumMarginFloor,
    minimumSafeTargetMargin,
    maximumCompetitiveTargetMargin,
    procurementFreshness: params.procurement.ciFreshnessState,
    hardBenchmarkCount: benchmarks.length,
    representativeFloorPass,
    actualSignal,
  });

  let candidatePoints: number | null = null;
  let candidateProjectedMargin: number | null = null;
  if (bandDecision.candidateTargetMargin != null) {
    const candidateResult = diagnosticChargeAtUsage({
      resolved,
      targetMargin: bandDecision.candidateTargetMargin,
      usage: repUsage,
      fxSnapshot: params.fxSnapshot,
    });
    candidatePoints = chargePointsFromResult(candidateResult);
    if (
      params.procurement.representativeProcurementCostKrw != null &&
      params.procurement.representativeProcurementCostKrw > 0
    ) {
      candidateProjectedMargin = projectedRepresentativeMargin({
        resolved,
        targetMargin: bandDecision.candidateTargetMargin,
        fxSnapshot: params.fxSnapshot,
        procurementCostKrw: params.procurement.representativeProcurementCostKrw,
      });
    }
  }

  const market = buildMarketCases({
    resolved,
    fxSnapshot: params.fxSnapshot,
    benchmarks,
    currentTargetMargin,
    candidateTargetMargin: bandDecision.candidateTargetMargin,
  });

  return {
    domain: "CANDIDATE",
    status: bandDecision.status,
    currentTargetMargin,
    minimumSafeTargetMargin,
    maximumCompetitiveTargetMargin,
    candidateTargetMargin: bandDecision.candidateTargetMargin,
    candidateDirection: bandDecision.candidateDirection,
    representative: {
      currentPoints,
      candidatePoints,
      candidateProjectedMargin,
      floorPass: representativeFloorPass,
    },
    market: {
      hardBenchmarkCount: benchmarks.length,
      allPass: market.allPass,
      cases: market.cases,
    },
    actual: {
      monthKey: params.actual.monthKey,
      marginRate: params.actual.marginRate,
      exact: params.actual.realizedMarginExact,
      signal: actualSignal,
    },
    procurementFreshness: params.procurement.ciFreshnessState,
    liveApplicability,
    productionBillingContract: params.productionBillingContract,
  };
}
