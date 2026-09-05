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
  const lines: string[] = [
    "Admin Receipt v3 · 턴 귀속 Provider 원가",
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
