import {
  formatAdminActualUsd,
  formatAdminKrwFromUsd,
  type AdminBillingReceiptV2,
  type AdminBillingReceiptV2Fx,
} from "@/lib/adminBillingReceiptV2";
import { formatPoints } from "@/lib/billingDisplay";
import type {
  AsyncFamilyCoverageState,
  AsyncFamilyExpectationState,
  AsyncTurnCoverageResult,
  TurnAttributableAsyncFamily,
} from "@/lib/asyncTurnCoverage";
import type { AdminBillingForensicMetadata } from "@/lib/adminBillingForensicMetadataShared";

export type AdminBillingReceiptV3WholeTurnCoverage =
  | "complete"
  | "pending"
  | "partial"
  | "unverifiable";

export type AdminBillingReceiptV3AsyncFamilySummary = {
  family: TurnAttributableAsyncFamily;
  label: string;
  expectationState: AsyncFamilyExpectationState;
  coverage: AsyncFamilyCoverageState;
  physicalCallCount: number;
  exactPhysicalCallCount: number;
  incompletePhysicalCallCount: number;
  knownActualCostUsd: number;
  exactActualCostUsd: number | null;
  taskPending?: boolean;
  taskFailed?: boolean;
  skipReason?: string;
};

export type AdminBillingReceiptV3AsyncSection = {
  coverage: AdminBillingReceiptV3WholeTurnCoverage;
  expectation: AsyncTurnCoverageResult;
  physicalCallCount: number;
  exactPhysicalCallCount: number;
  incompletePhysicalCallCount: number;
  knownActualCostUsd: number;
  exactActualCostUsd: number | null;
  unexpectedRowCount: number;
  unexpectedFamilies: string[];
  byFamily: AdminBillingReceiptV3AsyncFamilySummary[];
  events?: Array<{
    eventKey: string | null;
    family: string | null;
    eventStatus: string | null;
    actualCostUsd: number | null;
    actualCostSource: string | null;
    exact: boolean;
    incomplete: boolean;
  }>;
};

export type AdminBillingReceiptV3WholeTurnSection = {
  scope: "turn_attributable";
  coverage: AdminBillingReceiptV3WholeTurnCoverage;
  mainActualCostUsd: number | null;
  mainExact: boolean;
  syncActualCostUsd: number | null;
  syncExact: boolean;
  syncProvablyNone: boolean;
  asyncKnownActualCostUsd: number;
  asyncExactActualCostUsd: number | null;
  knownProviderSpendUsd: number;
  exactProviderSpendUsd: number | null;
  exactProviderSpendKrw: number | null;
  contributionMarginKrw: number | null;
  contributionMarginPercent: number | null;
  fx: AdminBillingReceiptV2Fx | null;
};

export type AdminBillingReceiptV3 = {
  version: 3;
  assistantMessageId: number;
  chatId: number;
  /** Exact visible character count from the scoped persisted Main RP text. */
  mainRpOutputVisibleChars: number | null;
  /**
   * Usage-based sync receipt. Null when no stored Usage snapshot exists —
   * settlement evidence lives in `forensic` only (Strategy B: nullable unavailable
   * sync section). Never fabricate Usage to fill this.
   */
  syncReceipt: AdminBillingReceiptV2 | null;
  async: AdminBillingReceiptV3AsyncSection;
  wholeTurn: AdminBillingReceiptV3WholeTurnSection;
  excludedCostScopes: string[];
  historicalNote?: string;
  /** Admin billing forensics — stored truth projection, no repricing. */
  forensic?: AdminBillingForensicMetadata;
};

/**
 * Main RP model identity — canonical stored-evidence resolution.
 *
 * Sources (scoped per generation by the receipt assembly):
 *  - syncReceipt.userCharge.selectedModelLabel — human-readable selected label
 *  - syncReceipt.userCharge.billingModelId — delivered billing model id when
 *    the handoff identity differs from the selected model
 *  - syncReceipt.mainRp.actual.model — actual delivered model id
 *
 * Rules:
 *  - selected == delivered  → `Main RP 모델: <selectedModelLabel>`
 *  - selected != delivered  → `선택 모델: <selected>` + `실제 처리 모델: <delivered>`
 *  - no usable stored evidence → `Main RP 모델: 확인 불가` (no guess / fallback /
 *    current-selection inference). A failed generation without its own stored
 *    Usage snapshot must never inherit a prior generation's model.
 */
export type AdminBillingReceiptV3MainRpModelIdentity =
  | { kind: "same"; selectedModelLabel: string }
  | { kind: "different"; selectedModelLabel: string; deliveredModel: string }
  | { kind: "unverified" };

export function resolveAdminBillingReceiptV3MainRpModelIdentity(
  receipt: AdminBillingReceiptV3
): AdminBillingReceiptV3MainRpModelIdentity {
  const sync = receipt.syncReceipt;
  if (!sync) return { kind: "unverified" };

  const selectedModelLabel = sync.userCharge.selectedModelLabel?.trim() || "";
  const billingModelId = sync.userCharge.billingModelId?.trim() || "";
  const mainActualModel = sync.mainRp?.actual?.model?.trim() || "";

  // Delivered identity from stored evidence only — never inferred from the
  // current selection or another generation.
  const deliveredModel = mainActualModel || billingModelId || "";

  if (!selectedModelLabel && !deliveredModel) return { kind: "unverified" };
  // Without a stored delivered-model identity we cannot prove same/different.
  if (!deliveredModel) return { kind: "unverified" };

  // billingModelId is stored by the V2 builder only when the delivered billing
  // model differs from the selected model — canonical mismatch signal.
  if (billingModelId) {
    return {
      kind: "different",
      selectedModelLabel: selectedModelLabel || deliveredModel,
      deliveredModel,
    };
  }
  return {
    kind: "same",
    selectedModelLabel: selectedModelLabel || deliveredModel,
  };
}

export function formatAdminBillingReceiptV3MainRpModelLines(
  identity: AdminBillingReceiptV3MainRpModelIdentity
): string[] {
  switch (identity.kind) {
    case "same":
      return [`Main RP 모델: ${identity.selectedModelLabel}`];
    case "different":
      return [
        `선택 모델: ${identity.selectedModelLabel}`,
        `실제 처리 모델: ${identity.deliveredModel}`,
      ];
    case "unverified":
      return ["Main RP 모델: 확인 불가"];
    default: {
      const _exhaustive: never = identity;
      return _exhaustive;
    }
  }
}

/**
 * Compact Admin Receipt view model — ONE canonical display owner.
 *
 * The default receipt shows only what a decision needs:
 *  - mainRp: model + actual cost + provenance label
 *  - userCharge: deducted points (published-final duplication removed when equal)
 *  - auxiliaryCalls: only jobs that actually ran (zero-call / missing-record rows
 *    are hidden from the default display; the underlying forensic data is kept)
 *
 * Every UI section resolves from this view model, never from raw DB/forensic
 * objects independently. ONE RESPONSIBILITY = ONE CANONICAL DISPLAY OWNER.
 */

export type AdminReceiptAuxiliaryCall = {
  label: string;
  model: string | null;
  calls: number;
  result: "success" | "failed" | "partial";
  costUsd: number | null;
};

export type AdminReceiptMainRpCost = {
  /** Delivered model label when known. */
  model: string | null;
  /** Actual provider cost USD, or null when not provable. */
  costUsd: number | null;
  /** Stored actual cost source — CI billed / provider reported / catalog estimated. */
  provenance: string | null;
  /** Human-readable provenance label matching the stored evidence. */
  provenanceLabel: string | null;
};

export type AdminReceiptCompactViewModel = {
  mainRp: AdminReceiptMainRpCost;
  deductedPoints: number | null;
  auxiliaryCalls: AdminReceiptAuxiliaryCall[];
  /** True when a complete, same-provenance turn total is provable. */
  hasCompleteTotal: boolean;
  /** Complete total USD when hasCompleteTotal, else null. */
  completeTotalUsd: number | null;
  contextSummaryAvailable: boolean;
};

/** Map a stored actual-cost source to an evidence-true Korean label. */
export function resolveMainRpCostProvenanceLabel(source: string | null | undefined): string | null {
  switch (source) {
    case "cheaper_inference_billed":
      return "CI 실제 청구 원가";
    case "provider_reported":
      return "Provider 실제 청구 원가";
    case "live_catalog_estimated":
    case "published_fallback_estimated":
      return "Published 기준 추정 원가";
    case "unavailable":
      return null;
    default:
      return source ? `원가 출처: ${source}` : null;
  }
}

/** Build the canonical compact view model from a receipt. */
export function buildAdminReceiptCompactViewModel(
  receipt: AdminBillingReceiptV3
): AdminReceiptCompactViewModel {
  const sync = receipt.syncReceipt;
  const mainActual = sync?.mainRp?.actual ?? null;
  const mainRpModelIdentity = resolveAdminBillingReceiptV3MainRpModelIdentity(receipt);

  const mainRp: AdminReceiptMainRpCost = {
    model:
      mainRpModelIdentity.kind === "same"
        ? mainRpModelIdentity.selectedModelLabel
        : mainRpModelIdentity.kind === "different"
          ? mainRpModelIdentity.deliveredModel
          : null,
    costUsd:
      mainActual?.exactness === "settled" && mainActual.actualProviderCostUsd != null
        ? mainActual.actualProviderCostUsd
        : receipt.wholeTurn.mainActualCostUsd,
    provenance: mainActual?.actualCostSource ?? null,
    provenanceLabel: resolveMainRpCostProvenanceLabel(mainActual?.actualCostSource),
  };

  const auxiliaryCalls: AdminReceiptAuxiliaryCall[] = [];
  // Sync platform spend (status widget extraction) is a real auxiliary provider call.
  const syncSpend = sync?.syncPlatformSpend;
  if (syncSpend?.status === "available" && (syncSpend.callCount ?? 1) > 0) {
    auxiliaryCalls.push({
      label: "상태창 위젯",
      model: syncSpend.modelLabel ?? syncSpend.model ?? null,
      calls: syncSpend.callCount ?? 1,
      result: syncSpend.exactness === "settled" ? "success" : "partial",
      costUsd:
        syncSpend.actualProviderCostUsd != null && syncSpend.actualProviderCostUsd > 0
          ? syncSpend.actualProviderCostUsd
          : null,
    });
  }
  for (const family of receipt.async.byFamily) {
    // Only show jobs that actually made a physical provider call.
    if (family.physicalCallCount <= 0) continue;
    const result: AdminReceiptAuxiliaryCall["result"] = family.taskFailed
      ? "failed"
      : family.coverage === "complete"
        ? "success"
        : "partial";
    auxiliaryCalls.push({
      label: family.label,
      model: null,
      calls: family.physicalCallCount,
      result,
      costUsd: family.knownActualCostUsd > 0 ? family.knownActualCostUsd : null,
    });
  }

  // Complete total is provable only when whole-turn coverage is complete and
  // exact (includes Main RP + sync + async, all settled).
  const hasCompleteTotal = receipt.wholeTurn.coverage === "complete";
  const completeTotalUsd = hasCompleteTotal ? receipt.wholeTurn.exactProviderSpendUsd : null;

  return {
    mainRp,
    deductedPoints:
      sync != null
        ? (sync.userCharge.settledDeductedPoints ?? sync.userCharge.deductedPoints)
        : receipt.forensic?.chargeEvidenceSettledPoints ?? null,
    auxiliaryCalls,
    hasCompleteTotal,
    completeTotalUsd,
    contextSummaryAvailable: false,
  };
}

export function wholeTurnCoverageLabel(
  coverage: AdminBillingReceiptV3WholeTurnCoverage
): string {
  switch (coverage) {
    case "complete":
      return "확정";
    case "pending":
      return "처리 중";
    case "partial":
      return "부분 수집";
    case "unverifiable":
      return "검증 불가";
    default: {
      const _exhaustive: never = coverage;
      return _exhaustive;
    }
  }
}

export function formatAdminBillingReceiptV3Text(receipt: AdminBillingReceiptV3): string {
  const fxRate = receipt.wholeTurn.fx?.effectiveKrwPerUsd ?? null;
  const fxSuffix = (usd: number | null | undefined): string => {
    const krw = formatAdminKrwFromUsd(usd, fxRate);
    return krw == null ? "" : ` (${krw})`;
  };
  const mainRpModelIdentity = resolveAdminBillingReceiptV3MainRpModelIdentity(receipt);
  const vm = buildAdminReceiptCompactViewModel(receipt);

  const lines: string[] = [
    "Admin Receipt v3",
    ...formatAdminBillingReceiptV3MainRpModelLines(mainRpModelIdentity),
  ];
  if (receipt.historicalNote) lines.push(receipt.historicalNote);

  lines.push("", "[Main RP]");
  if (vm.mainRp.provenanceLabel && vm.mainRp.costUsd != null) {
    lines.push(
      `${vm.mainRp.provenanceLabel}: ${formatAdminActualUsd(vm.mainRp.costUsd)}${fxSuffix(vm.mainRp.costUsd)}`
    );
  }

  if (receipt.syncReceipt != null) {
    lines.push("", "[차감]");
    lines.push(
      `실제 차감: ${vm.deductedPoints != null ? `${formatPoints(vm.deductedPoints)} P` : "확인 불가"}`
    );
  }

  if (vm.auxiliaryCalls.length > 0) {
    lines.push("", "[이번 턴 보조 호출]");
    for (const call of vm.auxiliaryCalls) {
      const cost = call.costUsd != null ? ` · ${formatAdminActualUsd(call.costUsd)}${fxSuffix(call.costUsd)}` : "";
      lines.push(`${call.label}: ${call.calls}회 ${call.result === "success" ? "성공" : call.result}${cost}`);
    }
  }

  if (vm.hasCompleteTotal && vm.completeTotalUsd != null) {
    lines.push("", "[이번 턴 확인 원가]");
    lines.push(`합계: ${formatAdminActualUsd(vm.completeTotalUsd)}${fxSuffix(vm.completeTotalUsd)}`);
  }

  return lines.join("\n");
}
