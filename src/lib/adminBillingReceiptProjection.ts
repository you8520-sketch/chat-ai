/**
 * Admin-only billing receipt projection — exact provider settlement provenance.
 * Separates actualProviderCost / providerListCost / billingReferenceCost.
 * Never used for user charge or public receipt.
 */
import type { StageUsage } from "@/lib/ai";
import type { Usage } from "@/lib/chatUsage";
import {
  applyOverseasCardFee,
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
    actualCostCoverage: AdminActualCostCoverage;
    fxDateKey: string;
    fxMode: string;
    baseUsdKrw: number;
    effectiveKrwPerUsd: number;
    overseasCardFeeRate: number;
    baseActualKrw: number | null;
    effectiveProviderCashCostKrw: number | null;
  };
  providerListReference: {
    providerListCostUsd: number | null;
    referenceSource: string;
    baseReferenceKrw: number | null;
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

function roundUsd(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

function roundKrw(n: number): number {
  return Math.round(n * 10) / 10;
}

function isCostBearingStage(stage: StageUsage): boolean {
  return !isGeminiBillingStage(stage);
}

function stageSettledActualUsd(stage: StageUsage): number | null {
  const billed = stage.cheaperInferenceBilledCostUsd;
  if (billed != null && billed > 0 && Number.isFinite(billed)) {
    return billed;
  }
  return null;
}

function stageReferenceListUsd(stage: StageUsage): number | null {
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
  return usd > 0 ? roundUsd(usd) : null;
}

function settlementStatusForStage(stage: StageUsage): AdminSettlementDisplayStatus {
  if (stageSettledActualUsd(stage) != null) return "SETTLED_EXACT";
  if (stage.upstreamCostUsd != null && stage.upstreamCostUsd > 0) return "ESTIMATED_ONLY";
  return "UNAVAILABLE";
}

function actualCostSourceForStage(stage: StageUsage): string {
  if (stageSettledActualUsd(stage) != null) return "cheaper_inference_billed";
  if (stage.upstreamCostUsd != null && stage.upstreamCostUsd > 0) return "upstream_reported";
  return "unavailable";
}

export function aggregateTurnSettledActualUsd(stages: StageUsage[]): {
  totalUsd: number | null;
  coverage: AdminActualCostCoverage;
  settledCallCount: number;
  costBearingCallCount: number;
} {
  const costBearing = stages.filter(isCostBearingStage);
  if (costBearing.length === 0) {
    return { totalUsd: null, coverage: "partial", settledCallCount: 0, costBearingCallCount: 0 };
  }

  let sum = 0;
  let settledCount = 0;
  for (const stage of costBearing) {
    const settled = stageSettledActualUsd(stage);
    if (settled != null) {
      sum += settled;
      settledCount += 1;
    }
  }

  if (settledCount === 0) {
    return { totalUsd: null, coverage: "partial", settledCallCount: 0, costBearingCallCount: costBearing.length };
  }
  if (settledCount < costBearing.length) {
    return {
      totalUsd: roundUsd(sum),
      coverage: "partial",
      settledCallCount: settledCount,
      costBearingCallCount: costBearing.length,
    };
  }
  return {
    totalUsd: roundUsd(sum),
    coverage: "complete",
    settledCallCount: settledCount,
    costBearingCallCount: costBearing.length,
  };
}

export function buildAdminProviderCallAuditRows(opts: {
  stages: StageUsage[];
  provider: string;
  billableStageLabels: ReadonlySet<string>;
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
      settledActualUsd: stageSettledActualUsd(stage),
      actualCostSource: actualCostSourceForStage(stage),
      providerReferenceListUsd: stageReferenceListUsd(stage),
      upstreamReportedUsd:
        stage.upstreamCostUsd != null && stage.upstreamCostUsd > 0
          ? roundUsd(stage.upstreamCostUsd)
          : null,
      includedInTurnTotal: opts.billableStageLabels.has(stage.stage),
      settlementStatus: settlementStatusForStage(stage),
    });
  }
  return rows;
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
}): AdminBillingReceiptProjection {
  const { usage, stages, shadowPricing, exchangeRate } = opts;
  const effectiveRate = exchangeRate.effectiveKrwPerUsd;

  const turnActual = aggregateTurnSettledActualUsd(stages);
  const actualProviderCostUsd = turnActual.totalUsd;
  const actualCostCoverage = turnActual.coverage;

  let actualCostSource = "unavailable";
  if (actualProviderCostUsd != null) {
    actualCostSource =
      turnActual.settledCallCount === turnActual.costBearingCallCount &&
      turnActual.costBearingCallCount > 0
        ? "cheaper_inference_billed"
        : "cheaper_inference_billed_partial";
  } else if (shadowPricing?.actualCostSource) {
    actualCostSource = shadowPricing.actualCostSource;
  }

  const baseActualKrw =
    actualProviderCostUsd != null
      ? roundKrw(convertUsdToKrw(actualProviderCostUsd, effectiveRate))
      : shadowPricing?.actualProviderCostKrw != null && shadowPricing.actualProviderCostKrw > 0
        ? shadowPricing.actualProviderCostKrw
        : null;

  const effectiveProviderCashCostKrw =
    baseActualKrw != null ? roundKrw(applyOverseasCardFee(baseActualKrw)) : null;

  const providerListCostUsd =
    shadowPricing?.providerListCostKrw != null && shadowPricing.providerListCostKrw > 0
      ? roundUsd(shadowPricing.providerListCostKrw / effectiveRate)
      : null;

  const billingReferenceCostUsd =
    shadowPricing?.billingReferenceCostUsd != null && shadowPricing.billingReferenceCostUsd > 0
      ? roundUsd(shadowPricing.billingReferenceCostUsd)
      : shadowPricing?.billingReferenceCostKrw != null && shadowPricing.billingReferenceCostKrw > 0
        ? roundUsd(shadowPricing.billingReferenceCostKrw / effectiveRate)
        : null;

  const economicsComplete =
    actualCostCoverage === "complete" &&
    baseActualKrw != null &&
    providerListCostUsd != null &&
    (usage.cost ?? 0) > 0 &&
    !(usage.billingWaived && (usage.cost ?? 0) <= 0);

  const deductedPoints = usage.cost ?? 0;
  const internalEconomics = economicsComplete
    ? {
        providerSavingsKrw:
          providerListCostUsd != null && baseActualKrw != null
            ? roundKrw(Math.max(0, convertUsdToKrw(providerListCostUsd, effectiveRate) - baseActualKrw))
            : shadowPricing?.providerSavingsKrw ?? null,
        providerOverrunKrw:
          providerListCostUsd != null && baseActualKrw != null
            ? roundKrw(Math.max(0, baseActualKrw - convertUsdToKrw(providerListCostUsd, effectiveRate)))
            : shadowPricing?.providerOverrunKrw ?? null,
        grossProfitKrw:
          baseActualKrw != null ? roundKrw(deductedPoints - baseActualKrw) : null,
        realizedMargin:
          baseActualKrw != null && deductedPoints > 0
            ? roundUsd((deductedPoints - baseActualKrw) / deductedPoints)
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
      provider: opts.provider,
      actualProviderCostUsd,
      actualCostSource,
      actualCostCoverage,
      fxDateKey: exchangeRate.dateKey,
      fxMode: exchangeRate.mode,
      baseUsdKrw: exchangeRate.usdToKrw,
      effectiveKrwPerUsd: effectiveRate,
      overseasCardFeeRate: OVERSEAS_CARD_FEE_RATE,
      baseActualKrw,
      effectiveProviderCashCostKrw,
    },
    providerListReference: {
      providerListCostUsd,
      referenceSource: "cheaper_inference_catalog_reference_rates",
      baseReferenceKrw:
        providerListCostUsd != null
          ? roundKrw(convertUsdToKrw(providerListCostUsd, effectiveRate))
          : shadowPricing?.providerListCostKrw ?? null,
    },
    publishedBillingReference: {
      billingReferenceCostUsd,
      billingReferenceCostKrw: shadowPricing?.billingReferenceCostKrw ?? null,
      pricingVersion: shadowPricing?.pricingVersion ?? null,
    },
    internalEconomics,
    providerCalls: buildAdminProviderCallAuditRows({
      stages,
      provider: opts.provider,
      billableStageLabels: opts.billableStageLabels,
    }),
  };
}

/** True when admin receipt uses settled actual distinct from provider list/reference. */
export function adminActualReferenceConflated(projection: AdminBillingReceiptProjection): boolean {
  const actual = projection.providerActualSettlement.actualProviderCostUsd;
  const list = projection.providerListReference.providerListCostUsd;
  if (actual == null || list == null) return false;
  return Math.abs(actual - list) < 1e-9;
}
