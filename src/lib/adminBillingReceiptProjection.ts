/**
 * Admin-only billing receipt projection — exact provider settlement provenance.
 * Separates actualProviderCost / providerListCost / billingReferenceCost.
 * Never used for user charge or public receipt.
 */
import type { StageUsage } from "@/lib/ai";
import type { Usage } from "@/lib/chatUsage";
import {
  convertUsdToKrw,
  OVERSEAS_CARD_FEE_RATE,
  type BillingExchangeRateSnapshot,
} from "@/lib/exchangeRate";
import { isGeminiBillingStage } from "@/lib/stageBillableUsage";
import {
  resolveCatalogRatesForPrompt,
  resolveCheaperInferenceCatalogPricing,
} from "@/lib/cheaperInferenceCatalogPricing";
import { selectCatalogPricingTier } from "@/lib/catalogPricingTier";
import {
  type ActualTurnCostCoverage,
  resolveActualTurnCostCoverage,
} from "@/lib/shadowPricing";
import { isMeteredReceiptProvider } from "@/lib/billingDisplay";

export const ADMIN_BILLING_RECEIPT_SCHEMA_VERSION = 1 as const;

export type AdminActualCostCoverage = "complete" | "partial";
export type AdminSettlementDisplayStatus =
  | "SETTLED_EXACT"
  | "SETTLED_PARTIAL"
  | "ESTIMATED_ONLY"
  | "UNAVAILABLE";

export type AdminProviderCallAuditRow = {
  callIndex: number;
  purpose: string;
  provider: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  settledActualUsd: number | null;
  actualCostSource: string;
  providerReferenceListUsd: number | null;
  upstreamReportedUsd: number | null;
  includedInTurnTotal: boolean;
  settlementStatus: AdminSettlementDisplayStatus;
};

export type AdminBillingReceiptProjection = {
  schemaVersion: typeof ADMIN_BILLING_RECEIPT_SCHEMA_VERSION;
  userCharge: {
    modelId: string;
    modelLabel: string;
    inputTokens: number;
    outputTokens: number;
    outputChars: number;
    deductedPoints: number;
    pricingVersion: number | null;
    waived: boolean;
    waiverReason: string | null;
  };
  providerActualSettlement: {
    provider: string;
    actualProviderCostUsd: number | null;
    actualCostSource: string;
    /** Whole-turn settled actual coverage — not stage-only. */
    actualCostCoverage: AdminActualCostCoverage;
    stageSettlementCoverage: AdminActualCostCoverage;
    fxDateKey: string;
    fxMode: string;
    baseUsdKrw: number;
    effectiveKrwPerUsd: number;
    overseasCardFeeRate: number;
    /** Base FX (fee excluded). */
    baseActualKrw: number | null;
    /** Effective cash cost (single card-fee application via effective FX). */
    effectiveProviderCashCostKrw: number | null;
  };
  providerListReference: {
    providerListCostUsd: number | null;
    referenceSource: string;
    /** Base FX (fee excluded). */
    baseReferenceKrw: number | null;
    /** Effective FX (fee included). */
    effectiveReferenceKrw: number | null;
  };
  publishedBillingReference: {
    billingReferenceCostUsd: number | null;
    billingReferenceCostKrw: number | null;
    pricingVersion: number | null;
  };
  internalEconomics: {
    providerSavingsKrw: number | null;
    providerOverrunKrw: number | null;
    grossProfitKrw: number | null;
    realizedMargin: number | null;
    promoGivebackKrw: number | null;
    netPricingBufferDeltaKrw: number | null;
  } | null;
  providerCalls: AdminProviderCallAuditRow[];
};

function roundKrw(n: number): number {
  return Math.round(n * 10) / 10;
}

function isCostBearingStage(stage: StageUsage): boolean {
  return !isGeminiBillingStage(stage);
}

function isCheaperInferenceProvider(provider: string): boolean {
  return provider === "cheaperinference";
}

function resolveProviderListReferenceSource(provider: string): string {
  if (provider === "cheaperinference") return "cheaper_inference_catalog_reference_rates";
  if (provider === "openrouter") return "openrouter_model_list_rates";
  return "provider_reference_unavailable";
}

/** CI settled actual — authoritative for CheaperInference stages. */
function ciStageSettledActualUsd(stage: StageUsage): number | null {
  const billed = stage.cheaperInferenceBilledCostUsd;
  if (billed != null && billed > 0 && Number.isFinite(billed)) {
    return billed;
  }
  return null;
}

function stageSettledActualUsd(stage: StageUsage, provider: string): number | null {
  if (isCheaperInferenceProvider(provider)) {
    return ciStageSettledActualUsd(stage);
  }
  return null;
}

function stageReferenceListUsd(stage: StageUsage, provider: string): number | null {
  if (!isCheaperInferenceProvider(provider)) return null;
  const catalog = resolveCheaperInferenceCatalogPricing(stage.model);
  if (!catalog) return null;
  const input = Math.max(0, stage.apiReportedInputTokens ?? stage.input ?? 0);
  const output = Math.max(0, stage.apiOutputTokens ?? stage.output ?? 0);
  const cacheRead = Math.max(0, stage.cacheReadTokens ?? stage.cachedContentTokens ?? 0);
  const cacheWrite = Math.max(0, stage.cacheWriteTokens ?? 0);
  const tier = selectCatalogPricingTier({
    promptTokens: input,
    inputTokenPriceThreshold: catalog.inputTokenPriceThreshold,
  });
  if (tier === "above_threshold" && !catalog.aboveThreshold) return null;
  const resolved = resolveCatalogRatesForPrompt(catalog, input);
  if (resolved.referenceInputUsdPerMillion == null || resolved.referenceOutputUsdPerMillion == null) {
    return null;
  }
  if (cacheRead > 0 && resolved.referenceCacheReadUsdPerMillion == null) return null;
  if (cacheWrite > 0 && resolved.referenceCacheWriteUsdPerMillion == null) return null;
  const standardInput = Math.max(0, input - cacheRead - cacheWrite);
  const usd =
    (standardInput / 1_000_000) * resolved.referenceInputUsdPerMillion +
    (resolved.referenceCacheReadUsdPerMillion != null
      ? (cacheRead / 1_000_000) * resolved.referenceCacheReadUsdPerMillion
      : 0) +
    (resolved.referenceCacheWriteUsdPerMillion != null
      ? (cacheWrite / 1_000_000) * resolved.referenceCacheWriteUsdPerMillion
      : 0) +
    (output / 1_000_000) * resolved.referenceOutputUsdPerMillion;
  return usd > 0 ? usd : null;
}

function settlementStatusForStage(
  stage: StageUsage,
  provider: string
): AdminSettlementDisplayStatus {
  if (stageSettledActualUsd(stage, provider) != null) return "SETTLED_EXACT";
  if (stage.upstreamCostUsd != null && stage.upstreamCostUsd > 0) return "ESTIMATED_ONLY";
  return "UNAVAILABLE";
}

function actualCostSourceForStage(stage: StageUsage, provider: string): string {
  if (stageSettledActualUsd(stage, provider) != null) return "cheaper_inference_billed";
  if (stage.upstreamCostUsd != null && stage.upstreamCostUsd > 0) return "upstream_reported";
  return "unavailable";
}

/** Stage-level settled USD sum — does NOT determine whole-turn coverage. */
export function summarizeStageSettledActualUsd(
  stages: StageUsage[],
  provider: string
): {
  totalSettledUsd: number | null;
  settledCallCount: number;
  costBearingCallCount: number;
  allStagesSettled: boolean;
} {
  const costBearing = stages.filter(isCostBearingStage);
  if (costBearing.length === 0) {
    return {
      totalSettledUsd: null,
      settledCallCount: 0,
      costBearingCallCount: 0,
      allStagesSettled: false,
    };
  }

  let sum = 0;
  let settledCount = 0;
  for (const stage of costBearing) {
    const settled = stageSettledActualUsd(stage, provider);
    if (settled != null) {
      sum += settled;
      settledCount += 1;
    }
  }

  return {
    totalSettledUsd: settledCount > 0 ? sum : null,
    settledCallCount: settledCount,
    costBearingCallCount: costBearing.length,
    allStagesSettled: settledCount === costBearing.length,
  };
}

/** @deprecated Use summarizeStageSettledActualUsd — legacy name for tests migrating. */
export function aggregateTurnSettledActualUsd(stages: StageUsage[]): {
  totalUsd: number | null;
  coverage: AdminActualCostCoverage;
  settledCallCount: number;
  costBearingCallCount: number;
} {
  const summary = summarizeStageSettledActualUsd(stages, "cheaperinference");
  return {
    totalUsd: summary.totalSettledUsd,
    coverage: summary.allStagesSettled ? "complete" : "partial",
    settledCallCount: summary.settledCallCount,
    costBearingCallCount: summary.costBearingCallCount,
  };
}

export type AuxiliaryProviderCostEvidence = {
  purpose: string;
  provider: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  settledActualUsd: number | null;
  actualCostSource: string;
  settlementStatus: AdminSettlementDisplayStatus;
  upstreamReportedUsd: number | null;
};

export function resolveStatusWidgetAuxiliaryCost(
  widget: Usage["statusWidgetExtract"]
): AuxiliaryProviderCostEvidence | null {
  if (!widget) return null;

  const cheaperBilled = (widget as { cheaperInferenceBilledCostUsd?: number })
    .cheaperInferenceBilledCostUsd;
  if (cheaperBilled != null && cheaperBilled > 0 && Number.isFinite(cheaperBilled)) {
    return {
      purpose: "status_widget_extract",
      provider: "cheaperinference",
      modelId: widget.model,
      inputTokens: widget.input,
      outputTokens: widget.output,
      settledActualUsd: cheaperBilled,
      actualCostSource: "cheaper_inference_billed",
      settlementStatus: "SETTLED_EXACT",
      upstreamReportedUsd: widget.upstreamCostUsd ?? null,
    };
  }

  if (
    widget.upstreamCostUsd != null &&
    widget.upstreamCostUsd > 0 &&
    !widget.estimated
  ) {
    return {
      purpose: "status_widget_extract",
      provider: "openrouter",
      modelId: widget.model,
      inputTokens: widget.input,
      outputTokens: widget.output,
      settledActualUsd: widget.upstreamCostUsd,
      actualCostSource: "provider_reported",
      settlementStatus: "SETTLED_EXACT",
      upstreamReportedUsd: widget.upstreamCostUsd,
    };
  }

  return {
    purpose: "status_widget_extract",
    provider: "unknown",
    modelId: widget.model,
    inputTokens: widget.input,
    outputTokens: widget.output,
    settledActualUsd: null,
    actualCostSource: widget.estimated ? "estimated_catalog" : "unavailable",
    settlementStatus: widget.estimated ? "ESTIMATED_ONLY" : "UNAVAILABLE",
    upstreamReportedUsd: widget.upstreamCostUsd ?? null,
  };
}

/** Canonical whole-turn actual cost coverage owner for admin receipt. */
export function resolveWholeTurnActualCostCoverage(opts: {
  mainTurnCoverage: ActualTurnCostCoverage;
  stageSummary: ReturnType<typeof summarizeStageSettledActualUsd>;
  auxiliary: AuxiliaryProviderCostEvidence | null;
}): AdminActualCostCoverage {
  if (opts.mainTurnCoverage === "partial") return "partial";
  if (!opts.stageSummary.allStagesSettled) return "partial";
  if (opts.auxiliary != null && opts.auxiliary.settlementStatus !== "SETTLED_EXACT") {
    return "partial";
  }
  if (opts.stageSummary.costBearingCallCount === 0 && opts.auxiliary?.settledActualUsd == null) {
    return "partial";
  }
  return "complete";
}

export function buildAdminProviderCallAuditRows(opts: {
  stages: StageUsage[];
  provider: string;
  billableStageLabels: ReadonlySet<string>;
  auxiliary?: AuxiliaryProviderCostEvidence | null;
}): AdminProviderCallAuditRow[] {
  let index = 0;
  const rows: AdminProviderCallAuditRow[] = [];
  for (const stage of opts.stages) {
    if (!isCostBearingStage(stage)) continue;
    index += 1;
    rows.push({
      callIndex: index,
      purpose: stage.stage,
      provider: opts.provider,
      modelId: stage.model,
      inputTokens: Math.max(0, stage.apiReportedInputTokens ?? stage.input ?? 0),
      outputTokens: Math.max(0, stage.apiOutputTokens ?? stage.output ?? 0),
      cacheReadTokens: Math.max(0, stage.cacheReadTokens ?? stage.cachedContentTokens ?? 0),
      cacheWriteTokens: Math.max(0, stage.cacheWriteTokens ?? 0),
      reasoningTokens: Math.max(0, stage.apiReasoningOutputTokens ?? 0),
      settledActualUsd: stageSettledActualUsd(stage, opts.provider),
      actualCostSource: actualCostSourceForStage(stage, opts.provider),
      providerReferenceListUsd: stageReferenceListUsd(stage, opts.provider),
      upstreamReportedUsd:
        stage.upstreamCostUsd != null && stage.upstreamCostUsd > 0
          ? stage.upstreamCostUsd
          : null,
      includedInTurnTotal: opts.billableStageLabels.has(stage.stage),
      settlementStatus: settlementStatusForStage(stage, opts.provider),
    });
  }

  if (opts.auxiliary) {
    index += 1;
    rows.push({
      callIndex: index,
      purpose: opts.auxiliary.purpose,
      provider: opts.auxiliary.provider,
      modelId: opts.auxiliary.modelId,
      inputTokens: opts.auxiliary.inputTokens,
      outputTokens: opts.auxiliary.outputTokens,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
      settledActualUsd: opts.auxiliary.settledActualUsd,
      actualCostSource: opts.auxiliary.actualCostSource,
      providerReferenceListUsd: null,
      upstreamReportedUsd: opts.auxiliary.upstreamReportedUsd,
      includedInTurnTotal: opts.auxiliary.settlementStatus === "SETTLED_EXACT",
      settlementStatus: opts.auxiliary.settlementStatus,
    });
  }

  return rows;
}

function sumWholeTurnSettledActualUsd(
  stageSummary: ReturnType<typeof summarizeStageSettledActualUsd>,
  auxiliary: AuxiliaryProviderCostEvidence | null
): number | null {
  let sum = 0;
  let hasAny = false;
  if (stageSummary.totalSettledUsd != null) {
    sum += stageSummary.totalSettledUsd;
    hasAny = true;
  }
  if (auxiliary?.settledActualUsd != null) {
    sum += auxiliary.settledActualUsd;
    hasAny = true;
  }
  return hasAny ? sum : null;
}

export function buildAdminBillingReceiptProjection(opts: {
  usage: Usage;
  stages: StageUsage[];
  billableStageLabels: ReadonlySet<string>;
  provider: string;
  modelId: string;
  modelLabel: string;
  exchangeRate: BillingExchangeRateSnapshot;
  shadowPricing?: Usage["shadowPricing"];
  mainTurnCoverage?: ActualTurnCostCoverage;
}): AdminBillingReceiptProjection {
  const { usage, stages, shadowPricing, exchangeRate, provider } = opts;
  const baseFx = exchangeRate.usdToKrw;
  const effectiveRate = exchangeRate.effectiveKrwPerUsd;

  const stageSummary = summarizeStageSettledActualUsd(stages, provider);
  const auxiliary = resolveStatusWidgetAuxiliaryCost(usage.statusWidgetExtract);
  const mainTurnCoverage =
    opts.mainTurnCoverage ??
    resolveActualTurnCostCoverage({
      totalStageCount: stages.filter(isCostBearingStage).length,
    });

  const stageSettlementCoverage: AdminActualCostCoverage = stageSummary.allStagesSettled
    ? "complete"
    : "partial";
  const actualCostCoverage = resolveWholeTurnActualCostCoverage({
    mainTurnCoverage,
    stageSummary,
    auxiliary,
  });

  const actualProviderCostUsd = sumWholeTurnSettledActualUsd(stageSummary, auxiliary);

  let actualCostSource = "unavailable";
  if (actualProviderCostUsd != null) {
    if (actualCostCoverage === "complete") {
      actualCostSource = isCheaperInferenceProvider(provider)
        ? "cheaper_inference_billed"
        : "provider_settled";
    } else {
      actualCostSource = "settled_partial";
    }
  } else if (shadowPricing?.actualCostSource) {
    actualCostSource = shadowPricing.actualCostSource;
  }

  const baseActualKrw =
    actualProviderCostUsd != null ? roundKrw(actualProviderCostUsd * baseFx) : null;

  const effectiveProviderCashCostKrw =
    actualProviderCostUsd != null
      ? roundKrw(convertUsdToKrw(actualProviderCostUsd, effectiveRate))
      : null;

  const providerListCostUsd =
    shadowPricing?.providerListCostKrw != null && shadowPricing.providerListCostKrw > 0
      ? shadowPricing.providerListCostKrw / effectiveRate
      : null;

  const billingReferenceCostUsd =
    shadowPricing?.billingReferenceCostUsd != null && shadowPricing.billingReferenceCostUsd > 0
      ? shadowPricing.billingReferenceCostUsd
      : shadowPricing?.billingReferenceCostKrw != null && shadowPricing.billingReferenceCostKrw > 0
        ? shadowPricing.billingReferenceCostKrw / effectiveRate
        : null;

  const baseReferenceKrw =
    providerListCostUsd != null ? roundKrw(providerListCostUsd * baseFx) : null;
  const effectiveReferenceKrw =
    providerListCostUsd != null
      ? roundKrw(convertUsdToKrw(providerListCostUsd, effectiveRate))
      : shadowPricing?.providerListCostKrw ?? null;

  const deductedPoints = usage.cost ?? 0;
  const economicsComplete =
    actualCostCoverage === "complete" &&
    effectiveProviderCashCostKrw != null &&
    effectiveReferenceKrw != null &&
    deductedPoints > 0 &&
    !(usage.billingWaived && deductedPoints <= 0);

  const internalEconomics = economicsComplete
    ? {
        providerSavingsKrw: roundKrw(
          Math.max(0, (effectiveReferenceKrw ?? 0) - (effectiveProviderCashCostKrw ?? 0))
        ),
        providerOverrunKrw: roundKrw(
          Math.max(0, (effectiveProviderCashCostKrw ?? 0) - (effectiveReferenceKrw ?? 0))
        ),
        grossProfitKrw: roundKrw(deductedPoints - (effectiveProviderCashCostKrw ?? 0)),
        realizedMargin:
          effectiveProviderCashCostKrw != null && deductedPoints > 0
            ? Math.round(((deductedPoints - effectiveProviderCashCostKrw) / deductedPoints) * 1000) /
              1000
            : null,
        promoGivebackKrw: shadowPricing?.promoGivebackKrw ?? null,
        netPricingBufferDeltaKrw: shadowPricing?.netPricingBufferDeltaKrw ?? null,
      }
    : null;

  return {
    schemaVersion: ADMIN_BILLING_RECEIPT_SCHEMA_VERSION,
    userCharge: {
      modelId: opts.modelId,
      modelLabel: opts.modelLabel,
      inputTokens: usage.input,
      outputTokens: usage.output,
      outputChars: usage.savedOutputChars ?? 0,
      deductedPoints,
      pricingVersion: shadowPricing?.pricingVersion ?? null,
      waived: Boolean(usage.billingWaived && deductedPoints <= 0),
      waiverReason: usage.billingWaiverReason ?? null,
    },
    providerActualSettlement: {
      provider,
      actualProviderCostUsd,
      actualCostSource,
      actualCostCoverage,
      stageSettlementCoverage,
      fxDateKey: exchangeRate.dateKey,
      fxMode: exchangeRate.mode,
      baseUsdKrw: baseFx,
      effectiveKrwPerUsd: effectiveRate,
      overseasCardFeeRate: OVERSEAS_CARD_FEE_RATE,
      baseActualKrw,
      effectiveProviderCashCostKrw,
    },
    providerListReference: {
      providerListCostUsd,
      referenceSource: resolveProviderListReferenceSource(provider),
      baseReferenceKrw,
      effectiveReferenceKrw,
    },
    publishedBillingReference: {
      billingReferenceCostUsd,
      billingReferenceCostKrw: shadowPricing?.billingReferenceCostKrw ?? null,
      pricingVersion: shadowPricing?.pricingVersion ?? null,
    },
    internalEconomics,
    providerCalls: buildAdminProviderCallAuditRows({
      stages,
      provider,
      billableStageLabels: opts.billableStageLabels,
      auxiliary,
    }),
  };
}

/** Reproduce double card fee — true when effective ≈ applyOverseasCardFee(base). */
export function reproducesDoubleCardFee(projection: AdminBillingReceiptProjection): boolean {
  const base = projection.providerActualSettlement.baseActualKrw;
  const effective = projection.providerActualSettlement.effectiveProviderCashCostKrw;
  if (base == null || effective == null || base <= 0) return false;
  const doubled = roundKrw(base * (1 + projection.providerActualSettlement.overseasCardFeeRate));
  return Math.abs(effective - doubled) < 0.05;
}

export function isMeteredAdminReceiptProvider(provider: string): boolean {
  return isMeteredReceiptProvider(provider);
}
