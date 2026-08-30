import type { Usage } from "@/lib/chatUsage";
import {
  isSyncExtractActualExact,
  type SyncActualCostCoverage,
} from "@/lib/syncExtractActualCost";
import type { ActualCostSource, ActualTurnCostCoverage } from "@/lib/shadowPricing";

export type AdminReceiptExactness = "settled" | "partial" | "estimated" | "unavailable";

export type AdminBillingReceiptV2UserCharge = {
  modelLabel: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens?: number;
  savedOutputChars?: number;
  deductedPoints: number;
  billingWaived: boolean;
  waiverReason?: string;
};

export type AdminBillingReceiptV2MainActual = {
  actualProviderCostUsd?: number;
  actualProviderCostKrw: number;
  actualCostSource: ActualCostSource | string;
  actualTurnCostCoverage: ActualTurnCostCoverage;
  exactness: AdminReceiptExactness;
  provider: string;
  model: string;
};

export type AdminBillingReceiptV2ProviderReference = {
  providerListCostKrw: number;
  providerListCostStatus: string;
  providerSavingsKrw: number | null;
  providerOverrunKrw: number | null;
};

export type AdminBillingReceiptV2PublishedPricing = {
  billingReferenceCostKrw: number;
  billingReferenceCostUsd: number;
  billingReferenceInputUsdPerMillion: number;
  billingReferenceOutputUsdPerMillion: number;
  pricingVersion: number;
  targetMargin: number;
  minimumMarginFloor: number;
  standardUserChargeKrw: number;
};

export type AdminBillingReceiptV2Fx = {
  dateKey: string;
  baseUsdKrw: number;
  overseasFeeRate: number;
  effectiveKrwPerUsd: number;
  source: string;
  locked?: boolean;
};

export type AdminBillingReceiptV2SyncPlatformSpend = {
  status: "available" | "not_persisted" | "unavailable";
  groupLabel?: string;
  model?: string;
  modelLabel?: string;
  inputTokens?: number;
  outputTokens?: number;
  callCount?: number;
  postTurnSharedInitial?: boolean;
  actualProviderCostUsd?: number;
  actualProviderCostKrw?: number;
  actualCostSource?: ActualCostSource | string;
  actualCostCoverage?: SyncActualCostCoverage;
  exactness?: AdminReceiptExactness;
  platformFunded: true;
  userChargedPoints: 0;
  /** Legacy estimate — not exact settled actual. */
  legacyApiRawCostKrw?: number;
};

export type AdminBillingReceiptV2 = {
  scope: "captured_sync";
  snapshotAvailable: boolean;
  historicalNote?: string;
  userCharge: AdminBillingReceiptV2UserCharge;
  mainRp: {
    actual: AdminBillingReceiptV2MainActual | null;
    providerReference: AdminBillingReceiptV2ProviderReference | null;
    publishedPricing: AdminBillingReceiptV2PublishedPricing | null;
    marginPercent: number | null;
    marginScopeLabel: string;
  };
  syncPlatformSpend: AdminBillingReceiptV2SyncPlatformSpend;
  capturedSyncProviderSpendKrw: number | null;
  capturedSyncProviderSpendExact: boolean;
  fx: AdminBillingReceiptV2Fx | null;
  asyncDeferredFamilies: string[];
};

const SETTLED_ACTUAL_SOURCES = new Set<ActualCostSource>([
  "cheaper_inference_billed",
  "provider_reported",
]);

function resolveMainExactness(
  source: string,
  coverage: ActualTurnCostCoverage
): AdminReceiptExactness {
  if (SETTLED_ACTUAL_SOURCES.has(source as ActualCostSource) && coverage === "complete") {
    return "settled";
  }
  if (coverage === "partial") return "partial";
  if (
    source === "live_catalog_estimated" ||
    source === "published_fallback_estimated" ||
    source === "live_catalog_partial"
  ) {
    return "estimated";
  }
  return "unavailable";
}

function resolveSyncExactness(
  source: string | undefined,
  coverage: SyncActualCostCoverage | undefined
): AdminReceiptExactness {
  if (!source || source === "unavailable" || !coverage || coverage === "unavailable") {
    return "unavailable";
  }
  if (source === "cheaper_inference_billed" && coverage === "complete") {
    return "settled";
  }
  if (coverage === "partial") return "partial";
  return "estimated";
}

function mainMarginEligible(
  actual: AdminBillingReceiptV2MainActual,
  deductedPoints: number
): boolean {
  return (
    deductedPoints > 0 &&
    actual.exactness === "settled" &&
    actual.actualProviderCostKrw > 0
  );
}

/**
 * Pure admin receipt projection — consumes generation-time Usage snapshots only.
 * Scope: CAPTURED SYNC (main RP + persisted sync post-turn). No whole-turn economics.
 */
export function buildAdminBillingReceiptV2(usage: Usage): AdminBillingReceiptV2 {
  const shadow = usage.shadowPricing;
  const syncExtract = usage.statusWidgetExtract;
  const deductedPoints = usage.cost ?? 0;
  const billingWaived = usage.billingWaived === true || deductedPoints === 0;

  const userCharge: AdminBillingReceiptV2UserCharge = {
    modelLabel: usage.modelLabel ?? usage.model ?? "unknown",
    provider: usage.provider ?? "unknown",
    inputTokens: usage.apiInputTokens ?? usage.input ?? 0,
    outputTokens: usage.apiOutputTokens ?? usage.output ?? 0,
    reasoningTokens: usage.apiReasoningOutputTokens,
    savedOutputChars: usage.savedOutputChars,
    deductedPoints,
    billingWaived,
    waiverReason: usage.billingWaiverReason,
  };

  let mainActual: AdminBillingReceiptV2MainActual | null = null;
  let providerReference: AdminBillingReceiptV2ProviderReference | null = null;
  let publishedPricing: AdminBillingReceiptV2PublishedPricing | null = null;
  let fx: AdminBillingReceiptV2Fx | null = null;
  let snapshotAvailable = false;
  let historicalNote: string | undefined;

  if (shadow) {
    snapshotAvailable = true;
    const coverage = shadow.actualTurnCostCoverage ?? "complete";
    const exactness = resolveMainExactness(shadow.actualCostSource, coverage);
    mainActual = {
      actualProviderCostUsd: shadow.actualCostUsd,
      actualProviderCostKrw: shadow.actualProviderCostKrw,
      actualCostSource: shadow.actualCostSource,
      actualTurnCostCoverage: coverage,
      exactness,
      provider: usage.provider ?? "unknown",
      model: usage.model ?? "unknown",
    };
    providerReference = {
      providerListCostKrw: shadow.providerListCostKrw,
      providerListCostStatus: shadow.providerListCostStatus,
      providerSavingsKrw: shadow.providerSavingsKrw,
      providerOverrunKrw: shadow.providerOverrunKrw,
    };
    publishedPricing = {
      billingReferenceCostKrw: shadow.billingReferenceCostKrw,
      billingReferenceCostUsd: shadow.billingReferenceCostUsd,
      billingReferenceInputUsdPerMillion: shadow.billingReferenceInputUsdPerMillion,
      billingReferenceOutputUsdPerMillion: shadow.billingReferenceOutputUsdPerMillion,
      pricingVersion: shadow.pricingVersion,
      targetMargin: shadow.targetMargin,
      minimumMarginFloor: shadow.minimumMarginFloor,
      standardUserChargeKrw: shadow.standardUserChargeKrw,
    };
    fx = {
      ...shadow.fxSnapshot,
      locked: (shadow.fxSnapshot as { locked?: boolean }).locked,
    };
  } else if (usage.apiRawCostKrw != null || usage.upstreamCostUsd != null) {
    historicalNote = "이 턴에는 정확한 정산 스냅샷이 저장되지 않음";
  }

  const marginPercent =
    mainActual && mainMarginEligible(mainActual, deductedPoints)
      ? Math.round((1 - mainActual.actualProviderCostKrw / deductedPoints) * 100)
      : null;

  let syncPlatformSpend: AdminBillingReceiptV2SyncPlatformSpend;
  if (syncExtract) {
    const syncExactness = resolveSyncExactness(
      syncExtract.actualCostSource,
      syncExtract.actualCostCoverage
    );
    syncPlatformSpend = {
      status: "available",
      groupLabel:
        syncExtract.postTurnSharedInitial && (syncExtract.callCount ?? 1) === 1
          ? "공유 초기 (상태창 + 추천입력)"
          : syncExtract.postTurnSharedInitial
            ? "후처리 (공유 초기 포함)"
            : "상태창 추출",
      model: syncExtract.model,
      modelLabel: syncExtract.modelLabel,
      inputTokens: syncExtract.input,
      outputTokens: syncExtract.output,
      callCount: syncExtract.callCount,
      postTurnSharedInitial: syncExtract.postTurnSharedInitial,
      actualProviderCostUsd: syncExtract.actualProviderCostUsd,
      actualProviderCostKrw: syncExtract.actualProviderCostKrw,
      actualCostSource: syncExtract.actualCostSource,
      actualCostCoverage: syncExtract.actualCostCoverage,
      exactness: syncExactness,
      platformFunded: true,
      userChargedPoints: 0,
      legacyApiRawCostKrw: syncExtract.apiRawCostKrw,
    };
  } else {
    syncPlatformSpend = {
      status: "not_persisted",
      platformFunded: true,
      userChargedPoints: 0,
    };
  }

  let capturedSyncProviderSpendKrw: number | null = null;
  let capturedSyncProviderSpendExact = false;
  const mainKrw =
    mainActual?.exactness === "settled" ? mainActual.actualProviderCostKrw : null;
  const syncKrw =
    syncPlatformSpend.status === "available" &&
    syncPlatformSpend.exactness === "settled" &&
    syncPlatformSpend.actualProviderCostKrw != null
      ? syncPlatformSpend.actualProviderCostKrw
      : null;

  if (mainKrw != null && syncKrw != null) {
    capturedSyncProviderSpendKrw = Math.round((mainKrw + syncKrw) * 10) / 10;
    capturedSyncProviderSpendExact = true;
  } else if (mainKrw != null && syncPlatformSpend.status === "not_persisted") {
    capturedSyncProviderSpendKrw = null;
  }

  return {
    scope: "captured_sync",
    snapshotAvailable,
    historicalNote,
    userCharge,
    mainRp: {
      actual: mainActual,
      providerReference,
      publishedPricing,
      marginPercent,
      marginScopeLabel: "Main RP 기준 (플랫폼 후처리 미포함)",
    },
    syncPlatformSpend,
    capturedSyncProviderSpendKrw,
    capturedSyncProviderSpendExact,
    fx,
    asyncDeferredFamilies: [
      "Suggested Replies repair",
      "StatusMeta",
      "memory/summary",
    ],
  };
}

export function adminReceiptExactnessLabel(exactness: AdminReceiptExactness): string {
  switch (exactness) {
    case "settled":
      return "정산 확정";
    case "partial":
      return "부분 확정";
    case "estimated":
      return "추정";
    case "unavailable":
      return "미확정";
    default: {
      const _exhaustive: never = exactness;
      return _exhaustive;
    }
  }
}

export { isSyncExtractActualExact };
