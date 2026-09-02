import type { Usage } from "@/lib/chatUsage";
import { convertUsdToKrw } from "@/lib/exchangeRate";
import {
  isSyncExtractActualExact,
  type SyncActualCostCoverage,
} from "@/lib/syncExtractActualCost";
import type { ActualCostSource, ActualTurnCostCoverage } from "@/lib/shadowPricing";

export type AdminReceiptExactness = "settled" | "partial" | "estimated" | "unavailable";

export type AdminBillingReceiptV2UserCharge = {
  selectedModelLabel: string;
  selectedProvider: string;
  /** Delivered billing model when handoff identity differs from selected. */
  billingModelId?: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens?: number;
  savedOutputChars?: number;
  deductedPoints: number;
  billingWaived: boolean;
  waiverReason?: string;
  /** Admin-only — settled charge contract metadata from dispatcher. */
  billingContract?: "published_phase1" | "published_phase2" | "legacy";
  billingContractReason?: string;
  pricingVersion?: number | null;
  publishedFinalPoints?: number | null;
  settledDeductedPoints?: number;
};

export type AdminBillingReceiptV2AggregateApiTelemetry = {
  inputTokens: number;
  outputTokens: number;
  callCount?: number;
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
  /** V2 canonical KRW from USD × shadow FX snapshot. */
  actualProviderCostKrw?: number;
  actualCostSource?: ActualCostSource | string;
  actualCostCoverage?: SyncActualCostCoverage;
  exactness?: AdminReceiptExactness;
  platformFunded: true;
  userChargedPoints: 0;
  /** Legacy estimate at generation-time billing FX — not v2 canonical. */
  legacyStoredActualKrw?: number;
  legacyApiRawCostKrw?: number;
};

export type AdminBillingReceiptV2 = {
  scope: "captured_sync";
  snapshotAvailable: boolean;
  historicalNote?: string;
  userCharge: AdminBillingReceiptV2UserCharge;
  aggregateApiTelemetry: AdminBillingReceiptV2AggregateApiTelemetry | null;
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

function isCheaperInferenceProvider(provider: string): boolean {
  return provider.trim().toLowerCase() === "cheaperinference";
}

function resolveMainExactness(
  source: string,
  coverage: ActualTurnCostCoverage,
  provider: string
): AdminReceiptExactness {
  if (coverage === "partial") return "partial";

  if (coverage === "complete") {
    if (source === "cheaper_inference_billed") {
      return "settled";
    }
    if (source === "provider_reported") {
      if (isCheaperInferenceProvider(provider)) {
        return "estimated";
      }
      return "settled";
    }
  }

  if (
    source === "live_catalog_estimated" ||
    source === "published_fallback_estimated" ||
    source === "live_catalog_partial"
  ) {
    return "estimated";
  }
  if (SETTLED_ACTUAL_SOURCES.has(source as ActualCostSource) && coverage === "complete") {
    return "settled";
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

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function resolveDeliveredMainModel(
  usage: Usage,
  shadow: Usage["shadowPricing"] | undefined
): string {
  if (shadow?.modelId) return shadow.modelId;
  if (usage.adultRouting?.actualModel) return usage.adultRouting.actualModel;
  return usage.model ?? "unknown";
}

function resolveDeliveredMainProvider(
  usage: Usage,
  shadow: Usage["shadowPricing"] | undefined
): string {
  if (shadow?.provider) return shadow.provider;
  if (usage.adultRouting?.actualProvider) return usage.adultRouting.actualProvider;
  return usage.provider ?? "unknown";
}

function resolveSyncV2Krw(
  syncUsd: number | undefined,
  fx: AdminBillingReceiptV2Fx | null
): number | undefined {
  if (syncUsd == null || !(syncUsd > 0) || fx == null) return undefined;
  return round1(convertUsdToKrw(syncUsd, fx.effectiveKrwPerUsd));
}

/** Admin audit USD — preserve stored precision; avoid rounding small values to $0.0000. */
export function formatAdminActualUsd(value: number | undefined | null): string {
  if (value == null || !(value > 0)) return "—";
  const trimmed = value.toFixed(8).replace(/\.?0+$/, "");
  return `$${trimmed}`;
}

function formatKrwLine(value: number | undefined | null): string {
  if (value == null || !(value > 0)) return "—";
  return `${value} KRW`;
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

  const billingInput = usage.input ?? 0;
  const billingOutput = usage.output ?? 0;
  const deliveredModelId = resolveDeliveredMainModel(usage, shadow);
  const selectedModelLabel = usage.modelLabel ?? usage.model ?? "unknown";

  const userCharge: AdminBillingReceiptV2UserCharge = {
    selectedModelLabel,
    selectedProvider: usage.provider ?? "unknown",
    billingModelId:
      deliveredModelId !== (usage.model ?? "") ? deliveredModelId : undefined,
    inputTokens: billingInput,
    outputTokens: billingOutput,
    reasoningTokens: usage.apiReasoningOutputTokens,
    savedOutputChars: usage.savedOutputChars,
    deductedPoints,
    billingWaived,
    waiverReason: usage.billingWaiverReason,
    ...(usage.billingContractDispatch
      ? {
          billingContract: usage.billingContractDispatch.billingContract,
          billingContractReason: usage.billingContractDispatch.billingContractReason,
          pricingVersion: usage.billingContractDispatch.pricingVersion,
          publishedFinalPoints: usage.billingContractDispatch.publishedFinalPoints,
          settledDeductedPoints: usage.billingContractDispatch.settledDeductedPoints,
        }
      : {}),
  };

  const aggregateApiTelemetry =
    usage.apiInputTokens != null &&
    usage.apiOutputTokens != null &&
    (usage.apiInputTokens !== billingInput ||
      usage.apiOutputTokens !== billingOutput ||
      usage.statusWidgetExtract != null)
      ? {
          inputTokens: usage.apiInputTokens,
          outputTokens: usage.apiOutputTokens,
          callCount: usage.apiCallCount,
        }
      : null;

  let mainActual: AdminBillingReceiptV2MainActual | null = null;
  let providerReference: AdminBillingReceiptV2ProviderReference | null = null;
  let publishedPricing: AdminBillingReceiptV2PublishedPricing | null = null;
  let fx: AdminBillingReceiptV2Fx | null = null;
  let snapshotAvailable = false;
  let historicalNote: string | undefined;

  if (shadow) {
    snapshotAvailable = true;
    const coverage = shadow.actualTurnCostCoverage ?? "complete";
    const deliveredProvider = resolveDeliveredMainProvider(usage, shadow);
    const exactness = resolveMainExactness(shadow.actualCostSource, coverage, deliveredProvider);
    mainActual = {
      actualProviderCostUsd: shadow.actualCostUsd,
      actualProviderCostKrw: shadow.actualProviderCostKrw,
      actualCostSource: shadow.actualCostSource,
      actualTurnCostCoverage: coverage,
      exactness,
      provider: deliveredProvider,
      model: deliveredModelId,
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
    const syncV2Krw = resolveSyncV2Krw(syncExtract.actualProviderCostUsd, fx);
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
      actualProviderCostKrw: syncV2Krw,
      actualCostSource: syncExtract.actualCostSource,
      actualCostCoverage: syncExtract.actualCostCoverage,
      exactness: syncExactness,
      platformFunded: true,
      userChargedPoints: 0,
      legacyStoredActualKrw: syncExtract.actualProviderCostKrw,
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
    syncPlatformSpend.actualProviderCostKrw != null &&
    fx != null
      ? syncPlatformSpend.actualProviderCostKrw
      : null;

  if (mainKrw != null && syncKrw != null) {
    capturedSyncProviderSpendKrw = round1(mainKrw + syncKrw);
    capturedSyncProviderSpendExact = true;
  } else if (mainKrw != null && syncPlatformSpend.status === "not_persisted") {
    capturedSyncProviderSpendKrw = null;
  }

  return {
    scope: "captured_sync",
    snapshotAvailable,
    historicalNote,
    userCharge,
    aggregateApiTelemetry,
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

export function formatAdminBillingReceiptV2Text(receipt: AdminBillingReceiptV2): string {
  const lines: string[] = [
    "Admin Receipt v2 · 동기 수집 범위 (async 제외)",
  ];
  if (receipt.historicalNote) lines.push(receipt.historicalNote);

  lines.push("", "[사용자 청구]");
  lines.push(`선택 모델: ${receipt.userCharge.selectedModelLabel}`);
  if (receipt.userCharge.billingModelId) {
    lines.push(`청구 기준 모델: ${receipt.userCharge.billingModelId}`);
  }
  lines.push(
    `과금 입력/출력: ${receipt.userCharge.inputTokens} / ${receipt.userCharge.outputTokens}`
  );
  if (receipt.userCharge.reasoningTokens != null && receipt.userCharge.reasoningTokens > 0) {
    lines.push(`reasoning: ${receipt.userCharge.reasoningTokens}`);
  }
  if (receipt.userCharge.savedOutputChars != null && receipt.userCharge.savedOutputChars > 0) {
    lines.push(`저장 RP: ${receipt.userCharge.savedOutputChars}자`);
  }
  lines.push(
    receipt.userCharge.billingWaived
      ? "포인트 차감: 0 P (면제)"
      : `포인트 차감: ${receipt.userCharge.deductedPoints} P`
  );

  if (receipt.aggregateApiTelemetry) {
    lines.push("", "[Captured API telemetry · Main + sync aggregate]");
    lines.push(
      `API 입력/출력: ${receipt.aggregateApiTelemetry.inputTokens} / ${receipt.aggregateApiTelemetry.outputTokens}`
    );
    if (receipt.aggregateApiTelemetry.callCount != null) {
      lines.push(`API callCount: ${receipt.aggregateApiTelemetry.callCount}`);
    }
  }

  if (receipt.mainRp.actual) {
    lines.push("", "[Main RP — Provider Actual]");
    lines.push(`provider: ${receipt.mainRp.actual.provider}`);
    lines.push(`model: ${receipt.mainRp.actual.model}`);
    lines.push(`actual USD: ${formatAdminActualUsd(receipt.mainRp.actual.actualProviderCostUsd)}`);
    lines.push(`actual KRW: ${formatKrwLine(receipt.mainRp.actual.actualProviderCostKrw)}`);
    lines.push(`source: ${receipt.mainRp.actual.actualCostSource}`);
    lines.push(`coverage: ${receipt.mainRp.actual.actualTurnCostCoverage}`);
    lines.push(`확정 상태: ${adminReceiptExactnessLabel(receipt.mainRp.actual.exactness)}`);
  }

  if (receipt.mainRp.providerReference) {
    lines.push("", "[Main RP — Provider Reference]");
    lines.push(
      `list cost: ${formatKrwLine(receipt.mainRp.providerReference.providerListCostKrw)} (실제 결제액 아님)`
    );
    lines.push(`list status: ${receipt.mainRp.providerReference.providerListCostStatus}`);
  }

  if (receipt.mainRp.publishedPricing) {
    lines.push("", "[Published User Pricing]");
    lines.push(
      `billing reference: ${formatKrwLine(receipt.mainRp.publishedPricing.billingReferenceCostKrw)}`
    );
    lines.push(
      `input rate: $${receipt.mainRp.publishedPricing.billingReferenceInputUsdPerMillion}/M`
    );
    lines.push(
      `output rate: $${receipt.mainRp.publishedPricing.billingReferenceOutputUsdPerMillion}/M`
    );
    lines.push(`pricing v: ${receipt.mainRp.publishedPricing.pricingVersion}`);
    lines.push(
      `published standard: ${formatKrwLine(receipt.mainRp.publishedPricing.standardUserChargeKrw)}`
    );
  }

  if (receipt.mainRp.marginPercent != null) {
    lines.push(`${receipt.mainRp.marginScopeLabel}: ${receipt.mainRp.marginPercent}%`);
  }

  lines.push("", "[플랫폼 부담 후처리]");
  if (receipt.syncPlatformSpend.status === "not_persisted") {
    lines.push("sync platform spend: NOT PERSISTED / unavailable");
  } else if (receipt.syncPlatformSpend.status === "available") {
    lines.push(`group: ${receipt.syncPlatformSpend.groupLabel ?? "—"}`);
    lines.push(`model: ${receipt.syncPlatformSpend.modelLabel ?? receipt.syncPlatformSpend.model ?? "—"}`);
    lines.push(
      `tokens: ${receipt.syncPlatformSpend.inputTokens ?? 0} / ${receipt.syncPlatformSpend.outputTokens ?? 0}`
    );
    lines.push(`callCount: ${receipt.syncPlatformSpend.callCount ?? 1} (aggregate)`);
    lines.push(
      `actual USD: ${formatAdminActualUsd(receipt.syncPlatformSpend.actualProviderCostUsd)}`
    );
    lines.push(
      `actual KRW (v2): ${formatKrwLine(receipt.syncPlatformSpend.actualProviderCostKrw)}`
    );
    if (receipt.syncPlatformSpend.exactness) {
      lines.push(
        `확정 상태: ${adminReceiptExactnessLabel(receipt.syncPlatformSpend.exactness)}`
      );
    }
    lines.push("user charged: 0 P (platform funded)");
    if (
      receipt.syncPlatformSpend.legacyStoredActualKrw != null &&
      receipt.syncPlatformSpend.legacyStoredActualKrw > 0 &&
      receipt.syncPlatformSpend.legacyStoredActualKrw !==
        receipt.syncPlatformSpend.actualProviderCostKrw
    ) {
      lines.push(
        `legacy stored sync KRW: ${formatKrwLine(receipt.syncPlatformSpend.legacyStoredActualKrw)} (legacy estimate ≠ v2 canonical)`
      );
    }
    if (receipt.syncPlatformSpend.legacyApiRawCostKrw != null) {
      lines.push(
        `legacy apiRawCostKrw: ${formatKrwLine(receipt.syncPlatformSpend.legacyApiRawCostKrw)} (legacy estimate ≠ exact settled)`
      );
    }
  }

  if (receipt.capturedSyncProviderSpendKrw != null) {
    lines.push(
      `CAPTURED_SYNC_PROVIDER_SPEND: ${formatKrwLine(receipt.capturedSyncProviderSpendKrw)}`
    );
  }

  if (receipt.fx) {
    lines.push("", "[FX Snapshot]");
    lines.push(`KST date: ${receipt.fx.dateKey}`);
    lines.push(`base USD/KRW: ${receipt.fx.baseUsdKrw}`);
    lines.push(`overseas fee: ${Math.round(receipt.fx.overseasFeeRate * 100)}%`);
    lines.push(`effective KRW/USD: ${receipt.fx.effectiveKrwPerUsd}`);
    lines.push(`source: ${receipt.fx.source}`);
  }

  lines.push("", "[비동기 범위 제외]");
  lines.push(`현재 receipt 범위 밖 — ${receipt.asyncDeferredFamilies.join(", ")}`);

  return lines.join("\n");
}

export { isSyncExtractActualExact };
