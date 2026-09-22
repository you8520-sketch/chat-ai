/**
 * Main RP pricing control-plane observability — read-only projection only.
 * Composes canonical owners; never mutates published BASE, billing, or promotions.
 */

import type Database from "better-sqlite3";
import type { BillingFxSnapshot } from "@/lib/billingFxSnapshot";
import { normalizeBillableUsage } from "@/lib/billingUsage";
import {
  isPhase1PublishedBillingEnabled,
  isPhase1PublishedBillingModel,
  isPhase2DeepSeekPublishedBillingEnabled,
  isPhase2DeepSeekPublishedBillingModel,
} from "@/lib/chatBillingContractDispatch";
import { MAIN_RP_MODEL_IDS } from "@/lib/chatModels";
import {
  resolveCheaperInferenceCatalogPricing,
  type CheaperInferenceCatalogPricing,
} from "@/lib/cheaperInferenceCatalogPricing";
import { getCachedDeepSeekOfficialPeakEvidence } from "@/lib/deepseekOfficialProviderPricing";
import {
  GEMINI37_CALIBRATION_RATE_EVIDENCE,
  evaluateLiveReferenceDrift,
} from "@/lib/gemini37CalibrationEvidence";
import { GEMINI37_MODEL_ID } from "@/lib/gemini37PricingPolicy.constants";
import type { ModelPriceSnapshotRecord } from "@/lib/modelPriceSnapshot";
import {
  GEMINI31_OFFICIAL_BASE_TIER_EVIDENCE,
  type PricingEvidence,
} from "@/lib/premiumPricingCalibrationEvidence";
import { getModelPricingPolicy, type BaselineMode } from "@/lib/modelPricingPolicy";
import {
  evaluateTrackerMarginFloor,
  REPRESENTATIVE_TRACKER_WORKLOAD,
} from "@/lib/modelPricingTracker";
import { readLatestSnapshot } from "@/lib/modelPricingTrackerPersistence";
import { MODEL_PRICING_TRACKER_TIMEZONE } from "@/lib/modelPricingTrackingConfig";
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

export type RealizedMarginRevenueUnit =
  | "published_krw"
  | "legacy_points_proxy"
  | "unavailable";

export type PricingSemanticDomain = "MARKET" | "PROVIDER" | "PROCUREMENT" | "PRODUCT" | "PROMOTION" | "MARGIN";

export type MarketComparabilityStatus =
  | "hard_comparable"
  | "published_anchor"
  | "opaque"
  | "absent";

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
  comparabilityStatus: MarketComparabilityStatus;
  /** OUR charge at the benchmark token workload (same-workload only). */
  ourChargeAtBenchmarkPoints: number | null;
  ourBenchmarkWorkloadLabel: string | null;
  differenceVsBenchmarkPoints: number | null;
  benchmarkAgeLabel: string;
};

export type ProviderEvidenceStatus =
  | "persisted_live"
  | "live_cached_supplemental"
  | "historical_evidence"
  | "unsupported"
  | "absent";

export type ProviderPriceObservation = {
  domain: "PROVIDER";
  officialInputUsdPerMillion: number | null;
  officialOutputUsdPerMillion: number | null;
  officialCacheReadUsdPerMillion: number | null;
  pricingMode: BaselineMode | "unknown";
  observedAt: string | null;
  sourceLabel: string | null;
  evidenceStatus: ProviderEvidenceStatus;
};

export type ProcurementFreshnessState = "FRESH" | "STALE" | "ABSENT";

export type ProcurementEvidenceSource =
  | "persisted_tracker_completed"
  | "live_catalog_cache"
  | "none";

export type ProcurementObservation = {
  domain: "PROCUREMENT";
  ciInputUsdPerMillion: number | null;
  ciOutputUsdPerMillion: number | null;
  ciCacheReadUsdPerMillion: number | null;
  ciDiscountPercent: number | null;
  ciObservedAt: string | null;
  ciFreshnessState: ProcurementFreshnessState;
  ciEvidenceSource: ProcurementEvidenceSource;
  actualUpstreamBilledUsd: number | null;
  provenance: ProcurementCostProvenance;
  representativeProcurementCostKrw: number | null;
};

export type ProductionBillingContractLabel =
  | "published_phase1_when_enabled"
  | "published_phase1_capable_legacy_fallback"
  | "published_phase2_when_direct_selected"
  | "published_phase2_capable_legacy_fallback"
  | "legacy_proportional_ci_catalog";

export type ProductObservation = {
  domain: "PRODUCT";
  publishedInputUsdPerMillion: number;
  publishedOutputUsdPerMillion: number;
  publishedCacheReadUsdPerMillion: number | null;
  publishedCacheWriteUsdPerMillion: number | null;
  pricingVersion: number;
  publishedAt: string;
  productionBillingContract: ProductionBillingContractLabel;
  productionBillingContractNotes: string | null;
  representativePublishedChargePoints: number | null;
  representativeLegacyChargePoints: number | null;
  representativeProductionChargePoints: number | null;
  representativeProductionChargeKrw: number | null;
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
  realizedMarginRevenueUnit: RealizedMarginRevenueUnit;
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
  generatedAt: string;
  fxSnapshot: BillingFxSnapshot;
  trackerPhase: "OBSERVE_ONLY";
  models: MainRpPricingObservabilityRow[];
};

function kstDateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: MODEL_PRICING_TRACKER_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
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

function resolveProductionBillingContractSemantic(modelId: string): {
  contract: ProductionBillingContractLabel;
  notes: string | null;
  usesPublishedPath: boolean;
} {
  if (isPhase1PublishedBillingModel(modelId)) {
    if (isPhase1PublishedBillingEnabled()) {
      return {
        contract: "published_phase1_when_enabled",
        notes: null,
        usesPublishedPath: true,
      };
    }
    return {
      contract: "published_phase1_capable_legacy_fallback",
      notes: "PHASE1_PUBLISHED_BILLING_ENABLED off — live turns use legacy proportional CI-catalog billing.",
      usesPublishedPath: false,
    };
  }
  if (isPhase2DeepSeekPublishedBillingModel(modelId)) {
    if (isPhase2DeepSeekPublishedBillingEnabled()) {
      return {
        contract: "published_phase2_when_direct_selected",
        notes:
          "Published Phase2 applies only on direct DeepSeek selection; refusal fallback and non-direct paths may use legacy.",
        usesPublishedPath: true,
      };
    }
    return {
      contract: "published_phase2_capable_legacy_fallback",
      notes:
        "PHASE2_DEEPSEEK_PUBLISHED_BILLING_ENABLED off or not direct-selected — legacy proportional billing.",
      usesPublishedPath: false,
    };
  }
  return {
    contract: "legacy_proportional_ci_catalog",
    notes: null,
    usesPublishedPath: false,
  };
}

function computeCanonicalChargeAtWorkload(params: {
  modelId: string;
  promptTokens: number;
  outputTokens: number;
  fxSnapshot: BillingFxSnapshot;
}): {
  publishedPoints: number | null;
  publishedChargeKrw: number | null;
  legacyPoints: number;
  contract: ProductionBillingContractLabel;
  contractNotes: string | null;
  usesPublishedPath: boolean;
} {
  const contractInfo = resolveProductionBillingContractSemantic(params.modelId);
  const usage = normalizeBillableUsage({
    modelId: params.modelId,
    promptTokens: params.promptTokens,
    outputTokens: params.outputTokens,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
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
  const publishedChargeKrw =
    published.status === "complete" ? published.snapshot.finalUserChargeKrw : null;

  const legacyPoints = computeOpenRouterTurnBilling({
    modelId: params.modelId,
    inputTokens: params.promptTokens,
    outputTokens: params.outputTokens,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    apiPromptTokens: params.promptTokens,
    apiCompletionTokens: params.outputTokens,
  }).total;

  return {
    publishedPoints,
    publishedChargeKrw,
    legacyPoints,
    contract: contractInfo.contract,
    contractNotes: contractInfo.notes,
    usesPublishedPath: contractInfo.usesPublishedPath,
  };
}

function marketObservation(params: {
  modelId: string;
  published: PublishedModelPricing;
  fxSnapshot: BillingFxSnapshot;
}): MarketBenchmarkObservation {
  const benchmarks = getMarketBenchmarks(params.modelId);
  const primary: MarketUsageBenchmark | undefined = benchmarks[0];
  if (primary) {
    const charge = computeCanonicalChargeAtWorkload({
      modelId: params.modelId,
      promptTokens: primary.inputTokens,
      outputTokens: primary.displayedOutputTokens,
      fxSnapshot: params.fxSnapshot,
    });
    // MARKET compares published BASE at the benchmark workload — not tracker 10k/2k.
    const ourPoints = charge.publishedPoints ?? charge.legacyPoints;
    const diff =
      ourPoints != null ? ourPoints - primary.competitorChargePoints : null;
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
      ourChargeAtBenchmarkPoints: ourPoints,
      ourBenchmarkWorkloadLabel: `${primary.inputTokens.toLocaleString()} prompt / ${primary.displayedOutputTokens.toLocaleString()} output`,
      differenceVsBenchmarkPoints: diff,
      benchmarkAgeLabel: "UNKNOWN",
    };
  }

  const anchor = params.published.marketBenchmark;
  if (anchor) {
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
      ourChargeAtBenchmarkPoints: null,
      ourBenchmarkWorkloadLabel: null,
      differenceVsBenchmarkPoints: null,
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
    ourChargeAtBenchmarkPoints: null,
    ourBenchmarkWorkloadLabel: null,
    differenceVsBenchmarkPoints: null,
    benchmarkAgeLabel: "UNKNOWN",
  };
}

function catalogFromCiCurrentSnapshot(snapshot: ModelPriceSnapshotRecord): CheaperInferenceCatalogPricing {
  const inputUsdPerMillion = snapshot.rates.inputUsdPerMillion ?? 0;
  const outputUsdPerMillion = snapshot.rates.outputUsdPerMillion ?? 0;
  return {
    modelId: snapshot.modelId,
    inputUsdPerMillion,
    outputUsdPerMillion,
    cacheReadUsdPerMillion: snapshot.rates.cacheReadUsdPerMillion ?? inputUsdPerMillion * 0.1,
    cacheWriteUsdPerMillion: snapshot.rates.cacheWriteUsdPerMillion ?? inputUsdPerMillion,
    referenceInputUsdPerMillion: undefined,
    referenceOutputUsdPerMillion: undefined,
    discountPercent: snapshot.rates.discountPercent ?? undefined,
    fetchedAt: Date.parse(snapshot.observedAt),
  };
}

function resolveProcurementFreshness(
  observedAt: string | null,
  now: Date
): ProcurementFreshnessState {
  if (!observedAt) return "ABSENT";
  const observedMs = Date.parse(observedAt);
  if (!Number.isFinite(observedMs)) return "ABSENT";
  return kstDateKey(new Date(observedMs)) === kstDateKey(now) ? "FRESH" : "STALE";
}

function providerObservation(
  modelId: string,
  db: Database.Database | null | undefined
): ProviderPriceObservation {
  const policy = getModelPricingPolicy(modelId);
  const persisted =
    db != null ? readLatestSnapshot(db, modelId, "official_provider_pricing") : null;
  const cached = getCachedDeepSeekOfficialPeakEvidence(modelId);

  if (persisted) {
    return {
      domain: "PROVIDER",
      officialInputUsdPerMillion: persisted.rates.inputUsdPerMillion,
      officialOutputUsdPerMillion: persisted.rates.outputUsdPerMillion,
      officialCacheReadUsdPerMillion: persisted.rates.cacheReadUsdPerMillion,
      pricingMode: policy?.baselineMode ?? "PROVIDER_PEAK",
      observedAt: persisted.observedAt,
      sourceLabel: persisted.sourceUrl,
      evidenceStatus: "persisted_live",
    };
  }

  if (cached) {
    const cachedMs = Date.parse(cached.observedAt);
    const isSupplemental =
      persisted == null &&
      Number.isFinite(cachedMs);
    return {
      domain: "PROVIDER",
      officialInputUsdPerMillion: cached.inputUsdPerMillion,
      officialOutputUsdPerMillion: cached.outputUsdPerMillion,
      officialCacheReadUsdPerMillion: cached.cacheReadUsdPerMillion,
      pricingMode: policy?.baselineMode ?? "PROVIDER_PEAK",
      observedAt: cached.observedAt,
      sourceLabel: cached.sourceUrl,
      evidenceStatus: isSupplemental ? "live_cached_supplemental" : "live_cached_supplemental",
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
      evidenceStatus: "historical_evidence",
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
    evidenceStatus: "unsupported",
  };
}

function procurementObservation(params: {
  modelId: string;
  fxSnapshot: BillingFxSnapshot;
  now: Date;
  db: Database.Database | null | undefined;
  upstreamCostUsd?: number | null;
}): ProcurementObservation {
  const persistedCi =
    params.db != null
      ? readLatestSnapshot(params.db, params.modelId, "cheaper_inference_models_current")
      : null;
  const liveCatalog = resolveCheaperInferenceCatalogPricing(params.modelId);

  if (params.upstreamCostUsd != null && params.upstreamCostUsd > 0) {
    const krw = params.upstreamCostUsd * params.fxSnapshot.effectiveKrwPerUsd;
    const rates = persistedCi ?? liveCatalog;
    return {
      domain: "PROCUREMENT",
      ciInputUsdPerMillion: rates
        ? persistedCi
          ? persistedCi.rates.inputUsdPerMillion
          : liveCatalog?.inputUsdPerMillion ?? null
        : null,
      ciOutputUsdPerMillion: rates
        ? persistedCi
          ? persistedCi.rates.outputUsdPerMillion
          : liveCatalog?.outputUsdPerMillion ?? null
        : null,
      ciCacheReadUsdPerMillion: persistedCi?.rates.cacheReadUsdPerMillion ?? liveCatalog?.cacheReadUsdPerMillion ?? null,
      ciDiscountPercent: persistedCi?.rates.discountPercent ?? liveCatalog?.discountPercent ?? null,
      ciObservedAt: persistedCi?.observedAt ?? (liveCatalog ? new Date(liveCatalog.fetchedAt).toISOString() : null),
      ciFreshnessState: persistedCi
        ? resolveProcurementFreshness(persistedCi.observedAt, params.now)
        : liveCatalog
          ? "STALE"
          : "ABSENT",
      ciEvidenceSource: persistedCi ? "persisted_tracker_completed" : liveCatalog ? "live_catalog_cache" : "none",
      actualUpstreamBilledUsd: params.upstreamCostUsd,
      provenance: "ACTUAL_UPSTREAM_BILLED",
      representativeProcurementCostKrw: krw,
    };
  }

  let catalog: CheaperInferenceCatalogPricing | null = null;
  let ciObservedAt: string | null = null;
  let ciEvidenceSource: ProcurementEvidenceSource = "none";
  let ciFreshnessState: ProcurementFreshnessState = "ABSENT";

  if (persistedCi) {
    catalog = catalogFromCiCurrentSnapshot(persistedCi);
    ciObservedAt = persistedCi.observedAt;
    ciEvidenceSource = "persisted_tracker_completed";
    ciFreshnessState = resolveProcurementFreshness(persistedCi.observedAt, params.now);
  } else if (liveCatalog) {
    catalog = liveCatalog;
    ciObservedAt = new Date(liveCatalog.fetchedAt).toISOString();
    ciEvidenceSource = "live_catalog_cache";
    ciFreshnessState = "STALE";
  }

  if (!catalog) {
    return {
      domain: "PROCUREMENT",
      ciInputUsdPerMillion: null,
      ciOutputUsdPerMillion: null,
      ciCacheReadUsdPerMillion: null,
      ciDiscountPercent: null,
      ciObservedAt: null,
      ciFreshnessState: "ABSENT",
      ciEvidenceSource: "none",
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
    ciInputUsdPerMillion: catalog.inputUsdPerMillion,
    ciOutputUsdPerMillion: catalog.outputUsdPerMillion,
    ciCacheReadUsdPerMillion: catalog.cacheReadUsdPerMillion ?? null,
    ciDiscountPercent: catalog.discountPercent ?? null,
    ciObservedAt,
    ciFreshnessState,
    ciEvidenceSource,
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
  publishedChargeKrw: number | null;
  legacyPoints: number;
  productionPoints: number | null;
  contract: ProductionBillingContractLabel;
  contractNotes: string | null;
  usesPublishedPath: boolean;
} {
  const charge = computeCanonicalChargeAtWorkload({
    modelId: params.modelId,
    promptTokens: REPRESENTATIVE_TRACKER_WORKLOAD.promptTokens,
    outputTokens: REPRESENTATIVE_TRACKER_WORKLOAD.outputTokens,
    fxSnapshot: params.fxSnapshot,
  });
  const productionPoints = charge.usesPublishedPath ? charge.publishedPoints : charge.legacyPoints;
  return {
    publishedPoints: charge.publishedPoints,
    publishedChargeKrw: charge.publishedChargeKrw,
    legacyPoints: charge.legacyPoints,
    productionPoints,
    contract: charge.contract,
    contractNotes: charge.contractNotes,
    usesPublishedPath: charge.usesPublishedPath,
  };
}

function marginObservation(params: {
  modelId: string;
  published: PublishedModelPricing;
  fxSnapshot: BillingFxSnapshot;
  procurement: ProcurementObservation;
  productionChargePoints: number | null;
  productionChargeKrw: number | null;
  usesPublishedPath: boolean;
  db: Database.Database | null | undefined;
}): MarginObservation {
  const persistedCi =
    params.db != null
      ? readLatestSnapshot(params.db, params.modelId, "cheaper_inference_models_current")
      : null;
  const catalog =
    persistedCi != null
      ? catalogFromCiCurrentSnapshot(persistedCi)
      : resolveCheaperInferenceCatalogPricing(params.modelId);

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
  let revenueUnit: RealizedMarginRevenueUnit = "unavailable";

  if (
    params.usesPublishedPath &&
    params.productionChargeKrw != null &&
    params.productionChargeKrw > 0 &&
    params.procurement.representativeProcurementCostKrw != null &&
    params.procurement.provenance === "CI_CURRENT_ESTIMATE"
  ) {
    realizedMargin =
      (params.productionChargeKrw - params.procurement.representativeProcurementCostKrw) /
      params.productionChargeKrw;
    revenueUnit = "published_krw";
  } else if (
    params.procurement.provenance === "ACTUAL_UPSTREAM_BILLED" &&
    params.productionChargeKrw != null &&
    params.productionChargeKrw > 0 &&
    params.procurement.representativeProcurementCostKrw != null
  ) {
    realizedMargin =
      (params.productionChargeKrw - params.procurement.representativeProcurementCostKrw) /
      params.productionChargeKrw;
    revenueUnit = "published_krw";
  } else if (
    !params.usesPublishedPath &&
    params.productionChargePoints != null &&
    params.productionChargePoints > 0 &&
    params.procurement.representativeProcurementCostKrw != null &&
    params.procurement.provenance === "CI_CURRENT_ESTIMATE"
  ) {
    realizedMargin =
      (params.productionChargePoints - params.procurement.representativeProcurementCostKrw) /
      params.productionChargePoints;
    provenance = "CI_CURRENT_ESTIMATE";
    revenueUnit = "legacy_points_proxy";
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
    realizedMarginRevenueUnit: revenueUnit,
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
  db: Database.Database | null | undefined;
}): Gemini37MarginFloorRootCauseReport {
  const plausible: Gemini37MarginFloorRootCauseHypothesis[] = [];
  const notes: string[] = [];
  const breached = params.margin.trackerMarginFloorBreached === true;

  const calibration = GEMINI37_CALIBRATION_RATE_EVIDENCE;
  const persistedCi =
    params.db != null
      ? readLatestSnapshot(params.db, GEMINI37_MODEL_ID, "cheaper_inference_models_current")
      : null;
  const catalog =
    persistedCi != null
      ? catalogFromCiCurrentSnapshot(persistedCi)
      : resolveCheaperInferenceCatalogPricing(GEMINI37_MODEL_ID);
  const liveDrift = evaluateLiveReferenceDrift(params.published);

  if (catalog) {
    const calibrationDiscount = calibration.observedDiscountPercent;
    const liveDiscount = catalog.discountPercent;
    if (liveDiscount != null && liveDiscount < calibrationDiscount - 1) {
      plausible.push("A_ci_procurement_rise_or_discount_shrink");
      notes.push(
        `CI discount ${liveDiscount}% is below calibration snapshot ${calibrationDiscount}%.`
      );
    }
    if (
      catalog.inputUsdPerMillion > params.published.billingReferenceInputUsdPerMillion * 1.05 ||
      catalog.outputUsdPerMillion > params.published.billingReferenceOutputUsdPerMillion * 1.05
    ) {
      plausible.push("B_published_base_below_procurement");
      notes.push(
        "CI rates exceed published BASE reference — competitive BASE vs procurement gap."
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
      `Tier-aware policy; live reference drift=${liveDrift.status}; cache policy unknown.`
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

function buildModelRow(
  modelId: string,
  fxSnapshot: BillingFxSnapshot,
  nowIso: string,
  now: Date,
  db: Database.Database | null | undefined
): MainRpPricingObservabilityRow {
  const published = getPublishedPricing(modelId);
  const charges = representativeCharges({ modelId, fxSnapshot });
  const procurement = procurementObservation({ modelId, fxSnapshot, now, db });
  const product: ProductObservation = {
    domain: "PRODUCT",
    publishedInputUsdPerMillion: published.billingReferenceInputUsdPerMillion,
    publishedOutputUsdPerMillion: published.billingReferenceOutputUsdPerMillion,
    publishedCacheReadUsdPerMillion: published.billingReferenceCacheReadUsdPerMillion ?? null,
    publishedCacheWriteUsdPerMillion: published.billingReferenceCacheWriteUsdPerMillion ?? null,
    pricingVersion: published.pricingVersion,
    publishedAt: published.publishedAt,
    productionBillingContract: charges.contract,
    productionBillingContractNotes: charges.contractNotes,
    representativePublishedChargePoints: charges.publishedPoints,
    representativeLegacyChargePoints: charges.legacyPoints,
    representativeProductionChargePoints: charges.productionPoints,
    representativeProductionChargeKrw: charges.publishedChargeKrw,
    representativeWorkloadLabel: `${REPRESENTATIVE_TRACKER_WORKLOAD.promptTokens} prompt / ${REPRESENTATIVE_TRACKER_WORKLOAD.outputTokens} output (uncached)`,
  };
  const margin = marginObservation({
    modelId,
    published,
    fxSnapshot,
    procurement,
    productionChargePoints: charges.productionPoints,
    productionChargeKrw: charges.usesPublishedPath ? charges.publishedChargeKrw : null,
    usesPublishedPath: charges.usesPublishedPath,
    db,
  });
  const row: MainRpPricingObservabilityRow = {
    modelId,
    market: marketObservation({ modelId, published, fxSnapshot }),
    provider: providerObservation(modelId, db),
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
      db,
    });
  }
  return row;
}

/** Build read-only Main RP control-plane projection for admin observability. */
export function buildMainRpPricingObservabilityProjection(params?: {
  fxSnapshot?: BillingFxSnapshot;
  now?: Date;
  db?: Database.Database | null;
}): MainRpPricingObservabilityProjection {
  const fxSnapshot = params?.fxSnapshot ?? previewShadowBillingFxSnapshot();
  const now = params?.now ?? new Date();
  const nowIso = now.toISOString();
  return {
    generatedAt: nowIso,
    fxSnapshot,
    trackerPhase: "OBSERVE_ONLY",
    models: MAIN_RP_MODEL_IDS.map((modelId) =>
      buildModelRow(modelId, fxSnapshot, nowIso, now, params?.db ?? null)
    ),
  };
}

export function listMainRpObservabilityModelIds(): readonly string[] {
  return MAIN_RP_MODEL_IDS;
}
