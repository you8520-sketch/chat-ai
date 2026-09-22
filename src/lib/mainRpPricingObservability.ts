/**
 * Main RP pricing control-plane observability — read-only projection only.
 * Composes canonical owners; never mutates published BASE, billing, or promotions.
 */

import type { BillingFxSnapshot } from "@/lib/billingFxSnapshot";
import { normalizeBillableUsage } from "@/lib/billingUsage";
import {
  isPhase1PublishedBillingEnabled,
  isPhase1PublishedBillingModel,
  isPhase2DeepSeekPublishedBillingEnabled,
  isPhase2DeepSeekPublishedBillingModel,
} from "@/lib/chatBillingContractDispatch";
import { MAIN_RP_MODEL_IDS } from "@/lib/chatModels";
import { resolveCheaperInferenceCatalogPricing } from "@/lib/cheaperInferenceCatalogPricing";
import { getCachedDeepSeekOfficialPeakEvidence } from "@/lib/deepseekOfficialProviderPricing";
import {
  GEMINI37_CALIBRATION_RATE_EVIDENCE,
  evaluateLiveReferenceDrift,
} from "@/lib/gemini37CalibrationEvidence";
import { GEMINI37_MODEL_ID } from "@/lib/gemini37PricingPolicy.constants";
import {
  GEMINI31_OFFICIAL_BASE_TIER_EVIDENCE,
  type PricingEvidence,
} from "@/lib/premiumPricingCalibrationEvidence";
import { getModelPricingPolicy, type BaselineMode } from "@/lib/modelPricingPolicy";
import {
  evaluateTrackerMarginFloor,
  REPRESENTATIVE_TRACKER_WORKLOAD,
} from "@/lib/modelPricingTracker";
import {
  getMarketBenchmarks,
  type MarketUsageBenchmark,
} from "@/lib/marketUsageBenchmarks";
import { getPublishedPricing, type PublishedModelPricing } from "@/lib/publishedModelPricing";
import { computeOpenRouterTurnBilling } from "@/lib/pointsReasoningMargins";
import { resolveProcurementCostFromCatalog } from "@/lib/procurementCost";
import { computePublishedUserChargeWithSnapshot } from "@/lib/publishedUserCharge";
import { listActiveOfficialPromotionsForModel } from "@/lib/officialProviderPromotion";
import { resolveActiveSitePromotion } from "@/lib/sitePromotion";
import { previewShadowBillingFxSnapshot } from "@/lib/shadowBillingExchangeRate";

export type ProcurementCostProvenance =
  | "ACTUAL_UPSTREAM_BILLED"
  | "CI_CURRENT_ESTIMATE"
  | "UNSUPPORTED"
  | "UNKNOWN";

export type RealizedMarginDiagnosticStatus =
  | "healthy"
  | "below_floor"
  | "blocked"
  | "unavailable";

export type PricingSemanticDomain = "MARKET" | "PROVIDER" | "PROCUREMENT" | "PRODUCT" | "PROMOTION" | "MARGIN";

export type MarketBenchmarkObservation = {
  domain: "MARKET";
  benchmarkId: string | null;
  competitorService: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  outputChars: number | null;
  competitorPoints: number | null;
  observedAt: string | null;
  sourceLabel: string | null;
  comparabilityStatus: "hard_comparable" | "published_anchor" | "absent" | "stale";
  ourRepresentativeChargePoints: number | null;
  differenceVsBenchmarkPoints: number | null;
  benchmarkAgeLabel: string;
};

export type ProviderPriceObservation = {
  domain: "PROVIDER";
  officialInputUsdPerMillion: number | null;
  officialOutputUsdPerMillion: number | null;
  officialCacheReadUsdPerMillion: number | null;
  pricingMode: BaselineMode | "unknown";
  observedAt: string | null;
  sourceLabel: string | null;
  observerStatus: "OBSERVE_ONLY" | "cached" | "absent" | "unsupported";
};

export type ProcurementObservation = {
  domain: "PROCUREMENT";
  ciCurrentInputUsdPerMillion: number | null;
  ciCurrentOutputUsdPerMillion: number | null;
  ciCurrentCacheReadUsdPerMillion: number | null;
  ciDiscountPercent: number | null;
  ciCatalogFetchedAt: string | null;
  actualUpstreamBilledUsd: number | null;
  provenance: ProcurementCostProvenance;
  representativeProcurementCostKrw: number | null;
};

export type ProductObservation = {
  domain: "PRODUCT";
  publishedInputUsdPerMillion: number;
  publishedOutputUsdPerMillion: number;
  publishedCacheReadUsdPerMillion: number | null;
  publishedCacheWriteUsdPerMillion: number | null;
  pricingVersion: number;
  publishedAt: string;
  productionBillingContract:
    | "published_phase1"
    | "published_phase2"
    | "legacy_proportional_ci_catalog"
    | "unknown";
  representativePublishedChargePoints: number | null;
  representativeLegacyChargePoints: number | null;
  representativeProductionChargePoints: number | null;
  representativeWorkloadLabel: string;
};

export type PromotionObservation = {
  domain: "PROMOTION";
  sitePromotionActive: boolean;
  siteDiscountPercent: number | null;
  sitePromotionEndsAt: string | null;
  officialPromotionCount: number;
  officialPromotionSummary: string | null;
};

export type MarginObservation = {
  domain: "MARGIN";
  targetMargin: number;
  minimumMarginFloor: number;
  realizedMargin: number | null;
  realizedMarginProvenance: ProcurementCostProvenance;
  trackerAlignedRealizedMargin: number | null;
  status: RealizedMarginDiagnosticStatus;
  trackerMarginFloorBreached: boolean | null;
};

export type Gemini37MarginFloorRootCauseHypothesis =
  | "A_ci_procurement_rise_or_discount_shrink"
  | "B_published_base_below_procurement"
  | "C_proportional_token_semantic_mismatch"
  | "D_representative_workload_mismatch"
  | "E_cache_or_tier_semantics";

export type Gemini37MarginFloorRootCauseReport = {
  classification: "ROOT_CAUSE_UNCONFIRMED" | "MULTIFACTOR_OBSERVED";
  observedMarginFloorBreach: boolean;
  plausibleHypotheses: Gemini37MarginFloorRootCauseHypothesis[];
  notes: string[];
};

export type MainRpPricingObservabilityRow = {
  modelId: string;
  market: MarketBenchmarkObservation;
  provider: ProviderPriceObservation;
  procurement: ProcurementObservation;
  product: ProductObservation;
  promotion: PromotionObservation;
  margin: MarginObservation;
  gemini37RootCause?: Gemini37MarginFloorRootCauseReport;
};

export type MainRpPricingObservabilityProjection = {
  mainHead: string;
  generatedAt: string;
  fxSnapshot: BillingFxSnapshot;
  trackerPhase: "OBSERVE_ONLY";
  models: MainRpPricingObservabilityRow[];
};

const MAIN_HEAD = "f13ea612fc942418a0271f05db209b76ecc077c2";

function resolveProductionBillingContract(modelId: string): ProductObservation["productionBillingContract"] {
  if (isPhase1PublishedBillingModel(modelId) && isPhase1PublishedBillingEnabled()) {
    return "published_phase1";
  }
  if (isPhase2DeepSeekPublishedBillingModel(modelId) && isPhase2DeepSeekPublishedBillingEnabled()) {
    return "published_phase2";
  }
  if (
    isPhase1PublishedBillingModel(modelId) ||
    isPhase2DeepSeekPublishedBillingModel(modelId)
  ) {
    return "legacy_proportional_ci_catalog";
  }
  return "legacy_proportional_ci_catalog";
}

function benchmarkAgeLabel(observedAt: string | null): string {
  if (!observedAt) return "UNKNOWN";
  const ms = Date.parse(observedAt);
  if (!Number.isFinite(ms)) return "UNKNOWN";
  const days = Math.floor((Date.now() - ms) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "same-day";
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.floor(days / 30)}mo (stale)`;
  return `${Math.floor(days / 365)}y (stale)`;
}

function marketObservation(params: {
  modelId: string;
  published: PublishedModelPricing;
  representativeChargePoints: number | null;
}): MarketBenchmarkObservation {
  const benchmarks = getMarketBenchmarks(params.modelId);
  const primary: MarketUsageBenchmark | undefined = benchmarks[0];
  if (primary) {
    const diff =
      params.representativeChargePoints != null
        ? params.representativeChargePoints - primary.competitorChargePoints
        : null;
    return {
      domain: "MARKET",
      benchmarkId: primary.id,
      competitorService: primary.sourceLabel,
      inputTokens: primary.inputTokens,
      outputTokens: primary.displayedOutputTokens,
      outputChars: primary.visibleChars ?? null,
      competitorPoints: primary.competitorChargePoints,
      observedAt: null,
      sourceLabel: primary.sourceLabel,
      comparabilityStatus: "hard_comparable",
      ourRepresentativeChargePoints: params.representativeChargePoints,
      differenceVsBenchmarkPoints: diff,
      benchmarkAgeLabel: "UNKNOWN",
    };
  }

  const anchor = params.published.marketBenchmark;
  if (anchor) {
    const diff =
      params.representativeChargePoints != null
        ? params.representativeChargePoints - anchor.points
        : null;
    return {
      domain: "MARKET",
      benchmarkId: "published_market_anchor",
      competitorService: "published catalog anchor",
      inputTokens: null,
      outputTokens: null,
      outputChars: anchor.outputChars,
      competitorPoints: anchor.points,
      observedAt: params.published.publishedAt,
      sourceLabel: "publishedModelPricing.marketBenchmark",
      comparabilityStatus: "published_anchor",
      ourRepresentativeChargePoints: params.representativeChargePoints,
      differenceVsBenchmarkPoints: diff,
      benchmarkAgeLabel: benchmarkAgeLabel(params.published.publishedAt),
    };
  }

  return {
    domain: "MARKET",
    benchmarkId: null,
    competitorService: null,
    inputTokens: null,
    outputTokens: null,
    outputChars: null,
    competitorPoints: null,
    observedAt: null,
    sourceLabel: null,
    comparabilityStatus: "absent",
    ourRepresentativeChargePoints: params.representativeChargePoints,
    differenceVsBenchmarkPoints: null,
    benchmarkAgeLabel: "UNKNOWN",
  };
}

function providerObservation(modelId: string): ProviderPriceObservation {
  const policy = getModelPricingPolicy(modelId);
  const officialPeak = getCachedDeepSeekOfficialPeakEvidence(modelId);
  if (officialPeak) {
    return {
      domain: "PROVIDER",
      officialInputUsdPerMillion: officialPeak.inputUsdPerMillion,
      officialOutputUsdPerMillion: officialPeak.outputUsdPerMillion,
      officialCacheReadUsdPerMillion: officialPeak.cacheReadUsdPerMillion,
      pricingMode: policy?.baselineMode ?? "PROVIDER_PEAK",
      observedAt: officialPeak.observedAt,
      sourceLabel: officialPeak.sourceUrl,
      observerStatus: "cached",
    };
  }

  let evidence: PricingEvidence | null = null;
  if (modelId === "gemini-3.1-pro-preview") {
    evidence = GEMINI31_OFFICIAL_BASE_TIER_EVIDENCE;
  } else if (modelId === GEMINI37_MODEL_ID) {
    evidence = {
      modelId: GEMINI37_MODEL_ID,
      sourceKind: "provider_official_pricing",
      observedAt: GEMINI37_CALIBRATION_RATE_EVIDENCE.observedAt,
      sourceLabel: "Gemini 3.7 calibration reference (historical provider page snapshot)",
      inputUsdPerMillion: GEMINI37_CALIBRATION_RATE_EVIDENCE.referenceInputUsdPerMillion,
      outputUsdPerMillion: GEMINI37_CALIBRATION_RATE_EVIDENCE.referenceOutputUsdPerMillion,
    };
  }

  if (evidence) {
    return {
      domain: "PROVIDER",
      officialInputUsdPerMillion: evidence.inputUsdPerMillion ?? null,
      officialOutputUsdPerMillion: evidence.outputUsdPerMillion ?? null,
      officialCacheReadUsdPerMillion: evidence.cacheReadUsdPerMillion ?? null,
      pricingMode: policy?.baselineMode ?? "PROVIDER_STANDARD",
      observedAt: evidence.observedAt,
      sourceLabel: evidence.sourceLabel,
      observerStatus: "absent",
    };
  }

  return {
    domain: "PROVIDER",
    officialInputUsdPerMillion: null,
    officialOutputUsdPerMillion: null,
    officialCacheReadUsdPerMillion: null,
    pricingMode: policy?.baselineMode ?? "unknown",
    observedAt: null,
    sourceLabel: null,
    observerStatus: "unsupported",
  };
}

function procurementObservation(params: {
  modelId: string;
  fxSnapshot: BillingFxSnapshot;
  upstreamCostUsd?: number | null;
}): ProcurementObservation {
  const catalog = resolveCheaperInferenceCatalogPricing(params.modelId);
  if (params.upstreamCostUsd != null && params.upstreamCostUsd > 0) {
    const krw = params.upstreamCostUsd * params.fxSnapshot.effectiveKrwPerUsd;
    return {
      domain: "PROCUREMENT",
      ciCurrentInputUsdPerMillion: catalog?.inputUsdPerMillion ?? null,
      ciCurrentOutputUsdPerMillion: catalog?.outputUsdPerMillion ?? null,
      ciCurrentCacheReadUsdPerMillion: catalog?.cacheReadUsdPerMillion ?? null,
      ciDiscountPercent: catalog?.discountPercent ?? null,
      ciCatalogFetchedAt: catalog ? new Date(catalog.fetchedAt).toISOString() : null,
      actualUpstreamBilledUsd: params.upstreamCostUsd,
      provenance: "ACTUAL_UPSTREAM_BILLED",
      representativeProcurementCostKrw: krw,
    };
  }

  if (!catalog) {
    return {
      domain: "PROCUREMENT",
      ciCurrentInputUsdPerMillion: null,
      ciCurrentOutputUsdPerMillion: null,
      ciCurrentCacheReadUsdPerMillion: null,
      ciDiscountPercent: null,
      ciCatalogFetchedAt: null,
      actualUpstreamBilledUsd: null,
      provenance: "UNKNOWN",
      representativeProcurementCostKrw: null,
    };
  }

  const procurement = resolveProcurementCostFromCatalog({
    modelId: params.modelId,
    promptTokens: REPRESENTATIVE_TRACKER_WORKLOAD.promptTokens,
    outputTokens: REPRESENTATIVE_TRACKER_WORKLOAD.outputTokens,
    cacheReadTokens: REPRESENTATIVE_TRACKER_WORKLOAD.cacheReadTokens,
    cacheWriteTokens: REPRESENTATIVE_TRACKER_WORKLOAD.cacheWriteTokens,
    effectiveKrwPerUsd: params.fxSnapshot.effectiveKrwPerUsd,
    catalog,
  });

  return {
    domain: "PROCUREMENT",
    ciCurrentInputUsdPerMillion: catalog.inputUsdPerMillion,
    ciCurrentOutputUsdPerMillion: catalog.outputUsdPerMillion,
    ciCurrentCacheReadUsdPerMillion: catalog.cacheReadUsdPerMillion ?? null,
    ciDiscountPercent: catalog.discountPercent ?? null,
    ciCatalogFetchedAt: new Date(catalog.fetchedAt).toISOString(),
    actualUpstreamBilledUsd: null,
    provenance: "CI_CURRENT_ESTIMATE",
    representativeProcurementCostKrw: procurement?.procurementCostKrw ?? null,
  };
}

function representativeCharges(params: {
  modelId: string;
  fxSnapshot: BillingFxSnapshot;
}): {
  publishedPoints: number | null;
  legacyPoints: number | null;
  productionPoints: number | null;
  contract: ProductObservation["productionBillingContract"];
} {
  const usage = normalizeBillableUsage({
    modelId: params.modelId,
    promptTokens: REPRESENTATIVE_TRACKER_WORKLOAD.promptTokens,
    outputTokens: REPRESENTATIVE_TRACKER_WORKLOAD.outputTokens,
    cacheReadTokens: REPRESENTATIVE_TRACKER_WORKLOAD.cacheReadTokens,
    cacheWriteTokens: REPRESENTATIVE_TRACKER_WORKLOAD.cacheWriteTokens,
  });

  const published = computePublishedUserChargeWithSnapshot({
    modelId: params.modelId,
    usage,
    usageCoverage: "complete",
    fxSnapshot: params.fxSnapshot,
    adjustment: { kind: "none" },
  });
  const publishedPoints =
    published.status === "complete" ? published.snapshot.finalPoints : null;

  const legacyPoints = computeOpenRouterTurnBilling({
    modelId: params.modelId,
    inputTokens: REPRESENTATIVE_TRACKER_WORKLOAD.promptTokens,
    outputTokens: REPRESENTATIVE_TRACKER_WORKLOAD.outputTokens,
    cacheReadTokens: REPRESENTATIVE_TRACKER_WORKLOAD.cacheReadTokens,
    cacheWriteTokens: REPRESENTATIVE_TRACKER_WORKLOAD.cacheWriteTokens,
    apiPromptTokens: REPRESENTATIVE_TRACKER_WORKLOAD.promptTokens,
    apiCompletionTokens: REPRESENTATIVE_TRACKER_WORKLOAD.outputTokens,
  }).total;

  const contract = resolveProductionBillingContract(params.modelId);
  const productionPoints =
    contract === "published_phase1" || contract === "published_phase2"
      ? publishedPoints
      : legacyPoints;

  return { publishedPoints, legacyPoints, productionPoints, contract };
}

function marginObservation(params: {
  modelId: string;
  published: PublishedModelPricing;
  fxSnapshot: BillingFxSnapshot;
  procurement: ProcurementObservation;
  productionChargePoints: number | null;
}): MarginObservation {
  const catalog = resolveCheaperInferenceCatalogPricing(params.modelId);
  const trackerEval =
    catalog != null
      ? evaluateTrackerMarginFloor({
          modelId: params.modelId,
          catalog,
          minimumMarginFloor: params.published.minimumMarginFloor,
          effectiveKrwPerUsd: params.fxSnapshot.effectiveKrwPerUsd,
          publishedInputUsdPerMillion: params.published.billingReferenceInputUsdPerMillion,
          publishedOutputUsdPerMillion: params.published.billingReferenceOutputUsdPerMillion,
          targetMargin: params.published.targetMargin,
        })
      : null;

  let realizedMargin: number | null = null;
  let provenance: ProcurementCostProvenance = params.procurement.provenance;
  if (
    params.procurement.provenance === "ACTUAL_UPSTREAM_BILLED" &&
    params.productionChargePoints != null &&
    params.productionChargePoints > 0 &&
    params.procurement.representativeProcurementCostKrw != null
  ) {
    realizedMargin =
      (params.productionChargePoints - params.procurement.representativeProcurementCostKrw) /
      params.productionChargePoints;
  } else if (
    params.procurement.provenance === "CI_CURRENT_ESTIMATE" &&
    params.productionChargePoints != null &&
    params.productionChargePoints > 0 &&
    params.procurement.representativeProcurementCostKrw != null
  ) {
    realizedMargin =
      (params.productionChargePoints - params.procurement.representativeProcurementCostKrw) /
      params.productionChargePoints;
  } else {
    provenance = "UNKNOWN";
  }

  let status: RealizedMarginDiagnosticStatus = "unavailable";
  if (trackerEval != null) {
    status = trackerEval.breached ? "below_floor" : "healthy";
  } else if (realizedMargin != null) {
    status =
      realizedMargin < params.published.minimumMarginFloor ? "below_floor" : "healthy";
  }

  return {
    domain: "MARGIN",
    targetMargin: params.published.targetMargin,
    minimumMarginFloor: params.published.minimumMarginFloor,
    realizedMargin,
    realizedMarginProvenance: provenance,
    trackerAlignedRealizedMargin: trackerEval?.realizedMargin ?? null,
    status,
    trackerMarginFloorBreached: trackerEval?.breached ?? null,
  };
}

function diagnoseGemini37MarginFloorRootCause(params: {
  published: PublishedModelPricing;
  procurement: ProcurementObservation;
  margin: MarginObservation;
  product: ProductObservation;
}): Gemini37MarginFloorRootCauseReport {
  const plausible: Gemini37MarginFloorRootCauseHypothesis[] = [];
  const notes: string[] = [];
  const breached = params.margin.trackerMarginFloorBreached === true;

  const calibration = GEMINI37_CALIBRATION_RATE_EVIDENCE;
  const catalog = resolveCheaperInferenceCatalogPricing(GEMINI37_MODEL_ID);
  const liveDrift = evaluateLiveReferenceDrift(params.published);

  if (catalog) {
    const calibrationDiscount = calibration.observedDiscountPercent;
    const liveDiscount = catalog.discountPercent;
    if (
      liveDiscount != null &&
      liveDiscount < calibrationDiscount - 1
    ) {
      plausible.push("A_ci_procurement_rise_or_discount_shrink");
      notes.push(
        `Live CI discount ${liveDiscount}% is below calibration snapshot ${calibrationDiscount}%.`
      );
    }
    if (
      catalog.inputUsdPerMillion > params.published.billingReferenceInputUsdPerMillion * 1.05 ||
      catalog.outputUsdPerMillion > params.published.billingReferenceOutputUsdPerMillion * 1.05
    ) {
      plausible.push("B_published_base_below_procurement");
      notes.push(
        "CI current rates exceed published BASE reference — competitive BASE vs procurement gap."
      );
    }
  }

  if (
    params.product.representativePublishedChargePoints != null &&
    params.product.representativeLegacyChargePoints != null &&
    params.product.representativePublishedChargePoints !==
      params.product.representativeLegacyChargePoints
  ) {
    plausible.push("C_proportional_token_semantic_mismatch");
    notes.push(
      `Published charge ${params.product.representativePublishedChargePoints}P vs legacy proportional ${params.product.representativeLegacyChargePoints}P at tracker workload.`
    );
  }

  const primaryBenchmark = getMarketBenchmarks(GEMINI37_MODEL_ID)[0];
  if (primaryBenchmark && catalog) {
    const fx = previewShadowBillingFxSnapshot().effectiveKrwPerUsd;
    const benchmarkProcurement = resolveProcurementCostFromCatalog({
      modelId: GEMINI37_MODEL_ID,
      promptTokens: primaryBenchmark.inputTokens,
      outputTokens: primaryBenchmark.displayedOutputTokens,
      effectiveKrwPerUsd: fx,
      catalog,
    });
    const billingRefUsd =
      (primaryBenchmark.inputTokens / 1_000_000) *
        params.published.billingReferenceInputUsdPerMillion +
      (primaryBenchmark.displayedOutputTokens / 1_000_000) *
        params.published.billingReferenceOutputUsdPerMillion;
    const userChargeKrw = (billingRefUsd * fx) / (1 - params.published.targetMargin);
    const benchmarkMargin =
      benchmarkProcurement && userChargeKrw > 0
        ? (userChargeKrw - benchmarkProcurement.procurementCostKrw) / userChargeKrw
        : null;
    const benchmarkBreached =
      benchmarkMargin != null && benchmarkMargin < params.published.minimumMarginFloor;
    if (breached && benchmarkMargin != null && !benchmarkBreached) {
      plausible.push("D_representative_workload_mismatch");
      notes.push(
        `Tracker 10k/2k uncached breaches; primary benchmark workload margin ${(benchmarkMargin * 100).toFixed(1)}% is above floor.`
      );
    }
  }

  const policy = getModelPricingPolicy(GEMINI37_MODEL_ID);
  if (policy?.pricingMode === "tier_aware") {
    plausible.push("E_cache_or_tier_semantics");
    notes.push(
      `Tier-aware policy; live reference drift=${liveDrift.status}; cache policy ${"unknown"}.`
    );
  }

  if (breached && plausible.length === 0) {
    notes.push("Margin-floor breach flagged by tracker; no single hypothesis dominates.");
  }

  return {
    classification: plausible.length <= 1 ? "ROOT_CAUSE_UNCONFIRMED" : "MULTIFACTOR_OBSERVED",
    observedMarginFloorBreach: breached,
    plausibleHypotheses: plausible,
    notes,
  };
}

function promotionObservation(modelId: string, nowIso: string): PromotionObservation {
  const site = resolveActiveSitePromotion(modelId, nowIso);
  const official = listActiveOfficialPromotionsForModel(modelId, nowIso);
  return {
    domain: "PROMOTION",
    sitePromotionActive: site != null,
    siteDiscountPercent: site?.siteDiscountPercent ?? null,
    sitePromotionEndsAt: site?.endsAt ?? null,
    officialPromotionCount: official.length,
    officialPromotionSummary:
      official.length > 0
        ? official
            .map(
              (row) =>
                `${row.provider} ${row.officialDiscountPct}% (${row.officialStart}→${row.officialEnd})`
            )
            .join("; ")
        : null,
  };
}

function buildModelRow(modelId: string, fxSnapshot: BillingFxSnapshot, nowIso: string): MainRpPricingObservabilityRow {
  const published = getPublishedPricing(modelId);
  const charges = representativeCharges({ modelId, fxSnapshot });
  const procurement = procurementObservation({ modelId, fxSnapshot });
  const product: ProductObservation = {
    domain: "PRODUCT",
    publishedInputUsdPerMillion: published.billingReferenceInputUsdPerMillion,
    publishedOutputUsdPerMillion: published.billingReferenceOutputUsdPerMillion,
    publishedCacheReadUsdPerMillion: published.billingReferenceCacheReadUsdPerMillion ?? null,
    publishedCacheWriteUsdPerMillion: published.billingReferenceCacheWriteUsdPerMillion ?? null,
    pricingVersion: published.pricingVersion,
    publishedAt: published.publishedAt,
    productionBillingContract: charges.contract,
    representativePublishedChargePoints: charges.publishedPoints,
    representativeLegacyChargePoints: charges.legacyPoints,
    representativeProductionChargePoints: charges.productionPoints,
    representativeWorkloadLabel: `${REPRESENTATIVE_TRACKER_WORKLOAD.promptTokens} prompt / ${REPRESENTATIVE_TRACKER_WORKLOAD.outputTokens} output (uncached)`,
  };
  const margin = marginObservation({
    modelId,
    published,
    fxSnapshot,
    procurement,
    productionChargePoints: charges.productionPoints,
  });
  const row: MainRpPricingObservabilityRow = {
    modelId,
    market: marketObservation({
      modelId,
      published,
      representativeChargePoints: charges.productionPoints,
    }),
    provider: providerObservation(modelId),
    procurement,
    product,
    promotion: promotionObservation(modelId, nowIso),
    margin,
  };
  if (modelId === GEMINI37_MODEL_ID) {
    row.gemini37RootCause = diagnoseGemini37MarginFloorRootCause({
      published,
      procurement,
      margin,
      product,
    });
  }
  return row;
}

/** Build read-only Main RP control-plane projection for admin observability. */
export function buildMainRpPricingObservabilityProjection(params?: {
  fxSnapshot?: BillingFxSnapshot;
  now?: Date;
}): MainRpPricingObservabilityProjection {
  const fxSnapshot = params?.fxSnapshot ?? previewShadowBillingFxSnapshot();
  const nowIso = (params?.now ?? new Date()).toISOString();
  return {
    mainHead: MAIN_HEAD,
    generatedAt: nowIso,
    fxSnapshot,
    trackerPhase: "OBSERVE_ONLY",
    models: MAIN_RP_MODEL_IDS.map((modelId) => buildModelRow(modelId, fxSnapshot, nowIso)),
  };
}

export function listMainRpObservabilityModelIds(): readonly string[] {
  return MAIN_RP_MODEL_IDS;
}
