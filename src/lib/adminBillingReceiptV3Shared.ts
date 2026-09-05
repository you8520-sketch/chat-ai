import {
  formatAdminActualUsd,
  formatAdminKrwFromUsd,
  type AdminBillingReceiptV2,
  type AdminBillingReceiptV2Fx,
} from "@/lib/adminBillingReceiptV2";
import {
  buildAdminReceiptTurnSummary,
  formatAdminReceiptTurnSummaryLines,
} from "@/lib/adminBillingReceiptTurnSummary";
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
  const summary = buildAdminReceiptTurnSummary(receipt);
  const fxRate = receipt.wholeTurn.fx?.effectiveKrwPerUsd ?? null;
  const fxSuffix = (usd: number | null | undefined): string => {
    const krw = formatAdminKrwFromUsd(usd, fxRate);
    return krw == null ? "" : ` (${krw})`;
  };
  const mainRpModelIdentity = resolveAdminBillingReceiptV3MainRpModelIdentity(receipt);
  const lines: string[] = [
    "Admin Receipt v3 · 턴 귀속 Provider 원가",
    ...formatAdminBillingReceiptV3MainRpModelLines(mainRpModelIdentity),
    ...formatAdminReceiptTurnSummaryLines(summary, { locale: "en" }),
    `coverage: ${wholeTurnCoverageLabel(receipt.wholeTurn.coverage)}`,
  ];
  if (receipt.historicalNote) lines.push(receipt.historicalNote);

  lines.push("", "[Main RP]");
  lines.push(
    `actual USD: ${formatAdminActualUsd(receipt.wholeTurn.mainActualCostUsd)}${fxSuffix(receipt.wholeTurn.mainActualCostUsd)} (${receipt.wholeTurn.mainExact ? "exact" : "not exact"})`
  );

  lines.push("", "[Sync Platform Spend]");
  if (receipt.syncReceipt == null) {
    lines.push("sync: unavailable — no stored Usage snapshot");
  } else if (receipt.wholeTurn.syncProvablyNone) {
    lines.push("sync: provably none");
  } else if (receipt.syncReceipt.syncPlatformSpend.status === "not_persisted") {
    lines.push("sync: snapshot not persisted");
  } else {
    lines.push(
      `actual USD: ${formatAdminActualUsd(receipt.wholeTurn.syncActualCostUsd)}${fxSuffix(receipt.wholeTurn.syncActualCostUsd)} (${receipt.wholeTurn.syncExact ? "exact" : "not exact"})`
    );
  }

  lines.push("", "[Async Turn-attributable]");
  lines.push(`coverage: ${wholeTurnCoverageLabel(receipt.async.coverage)}`);
  lines.push(`known USD: ${formatAdminActualUsd(receipt.async.knownActualCostUsd)}${fxSuffix(receipt.async.knownActualCostUsd)}`);
  lines.push(
    `exact USD: ${receipt.async.exactActualCostUsd != null ? formatAdminActualUsd(receipt.async.exactActualCostUsd) + fxSuffix(receipt.async.exactActualCostUsd) : "—"}`
  );
  for (const family of receipt.async.byFamily) {
    lines.push(
      `- ${family.label}: calls=${family.physicalCallCount}, known=${formatAdminActualUsd(family.knownActualCostUsd)}${fxSuffix(family.knownActualCostUsd)}, state=${family.expectationState}/${family.coverage}`
    );
  }

  lines.push("", "[Whole Turn]");
  lines.push(`known USD: ${formatAdminActualUsd(receipt.wholeTurn.knownProviderSpendUsd)}${fxSuffix(receipt.wholeTurn.knownProviderSpendUsd)}`);
  lines.push(
    `exact USD: ${receipt.wholeTurn.exactProviderSpendUsd != null ? formatAdminActualUsd(receipt.wholeTurn.exactProviderSpendUsd) + fxSuffix(receipt.wholeTurn.exactProviderSpendUsd) : "—"}`
  );
  lines.push(
    `exact KRW: ${receipt.wholeTurn.exactProviderSpendKrw != null ? `${receipt.wholeTurn.exactProviderSpendKrw} KRW` : "—"}`
  );
  if (receipt.wholeTurn.contributionMarginPercent != null) {
    lines.push(
      `turn-attributable margin: ${receipt.wholeTurn.contributionMarginPercent}% (${receipt.wholeTurn.contributionMarginKrw} KRW)`
    );
  }

  lines.push("", "[Excluded scopes]");
  lines.push(receipt.excludedCostScopes.join(", "));

  return lines.join("\n");
}
