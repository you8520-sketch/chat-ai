import "server-only";

import type { Usage } from "@/lib/chatUsage";
import { convertUsdToKrw } from "@/lib/exchangeRate";
import {
  buildAdminBillingReceiptV2,
  formatAdminActualUsd,
  type AdminBillingReceiptV2,
  type AdminBillingReceiptV2Fx,
  type AdminReceiptExactness,
} from "@/lib/adminBillingReceiptV2";
import {
  ASYNC_FAMILY_LABELS,
  resolveAsyncTurnCoverage,
  type AsyncFamilyCoverageState,
  type AsyncFamilyExpectationState,
  type AsyncTurnCoverageResult,
  type TurnAttributableAsyncFamily,
} from "@/lib/asyncTurnCoverage";
import {
  isLedgerEventCostCoverageIncomplete,
  isLedgerEventCostExact,
  type ProviderCostLedgerRow,
} from "@/lib/providerCostLedger";
import type { SuggestedRepliesRecord } from "@/lib/suggestedReplies/types";
import type { StatusMetaRecord } from "@/lib/statusMeta/types";

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
  syncReceipt: AdminBillingReceiptV2;
  async: AdminBillingReceiptV3AsyncSection;
  wholeTurn: AdminBillingReceiptV3WholeTurnSection;
  excludedCostScopes: string[];
  historicalNote?: string;
};

export type BuildAdminBillingReceiptV3Input = {
  usage: Usage;
  assistantMessageId: number;
  chatId: number;
  suggestedRepliesRecord: SuggestedRepliesRecord | null;
  statusMetaRecord: StatusMetaRecord | null;
  ledgerRows: ProviderCostLedgerRow[];
  /** True when turn predates #769 ledger instrumentation. */
  preLedgerHistorical?: boolean;
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function finiteUsd(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function filterAsyncLedgerRows(rows: ProviderCostLedgerRow[]): {
  relevant: ProviderCostLedgerRow[];
  unexpected: ProviderCostLedgerRow[];
} {
  const relevant: ProviderCostLedgerRow[] = [];
  const unexpected: ProviderCostLedgerRow[] = [];
  for (const row of rows) {
    if (row.execution_phase !== "async_post_turn") {
      unexpected.push(row);
      continue;
    }
    if (row.funding_class !== "platform_funded") {
      unexpected.push(row);
      continue;
    }
    relevant.push(row);
  }
  return { relevant, unexpected };
}

function resolveFamilyCoverage(
  expectationState: AsyncFamilyExpectationState,
  rows: ProviderCostLedgerRow[],
  hasStarted: boolean,
  hasIncomplete: boolean,
  allExact: boolean
): AsyncFamilyCoverageState {
  if (expectationState === "unverifiable") return "unverifiable";
  if (expectationState === "pending" || hasStarted) return "pending";
  if (expectationState === "not_expected") return "complete";
  if (rows.length === 0 && expectationState === "terminal") {
    return "partial";
  }
  if (hasIncomplete) return "partial";
  if (allExact || rows.length === 0) return "complete";
  return "partial";
}

function resolveAsyncSection(input: {
  usage: Usage;
  suggestedRepliesRecord: SuggestedRepliesRecord | null;
  statusMetaRecord: StatusMetaRecord | null;
  ledgerRows: ProviderCostLedgerRow[];
}): AdminBillingReceiptV3AsyncSection {
  const { relevant, unexpected } = filterAsyncLedgerRows(input.ledgerRows);
  const expectation = resolveAsyncTurnCoverage({
    usage: input.usage,
    suggestedRepliesRecord: input.suggestedRepliesRecord,
    statusMetaRecord: input.statusMetaRecord,
    ledgerAsyncRows: relevant,
  });

  const rowsByFamily = new Map<TurnAttributableAsyncFamily, ProviderCostLedgerRow[]>();
  for (const family of Object.keys(ASYNC_FAMILY_LABELS) as TurnAttributableAsyncFamily[]) {
    rowsByFamily.set(family, []);
  }
  for (const row of relevant) {
    const family = row.family;
    if (family === "suggested_replies_repair" || family === "status_meta" || family === "memory_relationship") {
      rowsByFamily.get(family)!.push(row);
    } else if (family) {
      unexpected.push(row);
    }
  }

  const byFamily: AdminBillingReceiptV3AsyncFamilySummary[] = expectation.families.map(
    (familyExpectation) => {
      const rows = rowsByFamily.get(familyExpectation.family) ?? [];
      const exactRows = rows.filter((row) => isLedgerEventCostExact(row));
      const incompleteRows = rows.filter((row) => isLedgerEventCostCoverageIncomplete(row));
      const hasStarted = rows.some((row) => row.event_status === "started");
      const knownUsd = rows.reduce((sum, row) => {
        if (isLedgerEventCostExact(row)) {
          return sum + finiteUsd(row.actual_cost_usd);
        }
        return sum;
      }, 0);
      const allExact =
        rows.length > 0 && rows.every((row) => isLedgerEventCostExact(row));
      const familyCoverage = resolveFamilyCoverage(
        familyExpectation.expectationState,
        rows,
        hasStarted,
        incompleteRows.length > 0,
        allExact
      );
      return {
        family: familyExpectation.family,
        label: familyExpectation.label,
        expectationState: familyExpectation.expectationState,
        coverage: familyCoverage,
        physicalCallCount: rows.length,
        exactPhysicalCallCount: exactRows.length,
        incompletePhysicalCallCount: incompleteRows.length,
        knownActualCostUsd: knownUsd,
        exactActualCostUsd:
          familyExpectation.expectationState === "not_expected"
            ? 0
            : rows.length === 0 && familyExpectation.expectationState === "terminal"
              ? null
              : allExact
                ? knownUsd
                : null,
        taskPending: familyExpectation.taskPending,
        taskFailed: familyExpectation.taskFailed,
        skipReason: familyExpectation.skipReason,
      };
    }
  );

  const physicalCallCount = relevant.length;
  const exactPhysicalCallCount = relevant.filter((row) => isLedgerEventCostExact(row)).length;
  const incompletePhysicalCallCount = relevant.filter((row) =>
    isLedgerEventCostCoverageIncomplete(row)
  ).length;
  const knownActualCostUsd = relevant.reduce(
    (sum, row) => (isLedgerEventCostExact(row) ? sum + finiteUsd(row.actual_cost_usd) : sum),
    0
  );
  const hasStarted = relevant.some((row) => row.event_status === "started");
  const hasIncomplete = incompletePhysicalCallCount > 0;
  const allPhysicalExact =
    physicalCallCount > 0 && relevant.every((row) => isLedgerEventCostExact(row));

  let coverage: AdminBillingReceiptV3WholeTurnCoverage;
  if (unexpected.length > 0) {
    coverage = "unverifiable";
  } else if (
    expectation.overallCoverage === "pending" ||
    hasStarted ||
    byFamily.some((f) => f.coverage === "pending" || f.expectationState === "pending")
  ) {
    coverage = "pending";
  } else if (expectation.unverifiableFamilies.length > 0) {
    coverage = "unverifiable";
  } else if (
    hasIncomplete ||
    byFamily.some((f) => f.coverage === "partial") ||
    byFamily.some(
      (f) =>
        f.expectationState === "terminal" &&
        f.physicalCallCount === 0 &&
        f.family !== "memory_relationship"
    )
  ) {
    coverage = "partial";
  } else if (
    byFamily.every(
      (f) =>
        f.coverage === "complete" &&
        (f.exactActualCostUsd != null || f.expectationState === "not_expected")
    )
  ) {
    coverage = "complete";
  } else {
    coverage = "partial";
  }

  const exactActualCostUsd =
    coverage === "complete" && allPhysicalExact
      ? knownActualCostUsd
      : allPhysicalExact && physicalCallCount > 0
        ? knownActualCostUsd
        : null;

  const unexpectedFamilies = [
    ...new Set(
      unexpected.map((row) => row.family).filter((family): family is string => Boolean(family))
    ),
  ];

  return {
    coverage,
    expectation,
    physicalCallCount,
    exactPhysicalCallCount,
    incompletePhysicalCallCount,
    knownActualCostUsd,
    exactActualCostUsd,
    unexpectedRowCount: unexpected.length,
    unexpectedFamilies,
    byFamily,
    events: relevant.map((row) => ({
      eventKey: row.event_key,
      family: row.family,
      eventStatus: row.event_status,
      actualCostUsd: row.actual_cost_usd,
      actualCostSource: row.actual_cost_source,
      exact: isLedgerEventCostExact(row),
      incomplete: isLedgerEventCostCoverageIncomplete(row),
    })),
  };
}

function resolveMainUsd(syncReceipt: AdminBillingReceiptV2): {
  usd: number | null;
  exact: boolean;
} {
  const actual = syncReceipt.mainRp.actual;
  if (!actual || actual.exactness !== "settled") {
    return { usd: null, exact: false };
  }
  return { usd: finiteUsd(actual.actualProviderCostUsd), exact: true };
}

function resolveSyncUsd(syncReceipt: AdminBillingReceiptV2): {
  usd: number | null;
  exact: boolean;
  provablyNone: boolean;
} {
  const sync = syncReceipt.syncPlatformSpend;
  if (sync.status === "not_persisted") {
    return { usd: null, exact: false, provablyNone: true };
  }
  if (sync.status !== "available" || sync.exactness !== "settled") {
    return { usd: null, exact: false, provablyNone: false };
  }
  return {
    usd: finiteUsd(sync.actualProviderCostUsd),
    exact: true,
    provablyNone: false,
  };
}

/** Canonical whole-turn FX owner — parent turn shadow FX, sum USD first. */
export function projectWholeTurnExactKrw(
  exactUsd: number | null,
  fx: AdminBillingReceiptV2Fx | null
): number | null {
  if (exactUsd == null || !(exactUsd > 0) || fx == null) return null;
  return round1(convertUsdToKrw(exactUsd, fx.effectiveKrwPerUsd));
}

/** Canonical whole-turn aggregation + exactness owner. */
export function buildAdminBillingReceiptV3(
  input: BuildAdminBillingReceiptV3Input
): AdminBillingReceiptV3 {
  const syncReceipt = buildAdminBillingReceiptV2(input.usage);
  const asyncSection = resolveAsyncSection({
    usage: input.usage,
    suggestedRepliesRecord: input.suggestedRepliesRecord,
    statusMetaRecord: input.statusMetaRecord,
    ledgerRows: input.ledgerRows,
  });

  const main = resolveMainUsd(syncReceipt);
  const sync = resolveSyncUsd(syncReceipt);
  const fx = syncReceipt.fx;

  const knownProviderSpendUsd =
    (main.usd ?? 0) + (sync.usd ?? 0) + asyncSection.knownActualCostUsd;

  const mainExact = main.exact;
  const syncExact = sync.exact || sync.provablyNone;
  const asyncExact =
    asyncSection.coverage === "complete" && asyncSection.exactActualCostUsd != null;
  const wholeTurnCoverage: AdminBillingReceiptV3WholeTurnCoverage =
    asyncSection.coverage === "unverifiable"
      ? "unverifiable"
      : asyncSection.coverage === "pending"
        ? "pending"
        : !mainExact || !syncExact
          ? "partial"
          : asyncSection.coverage === "partial"
            ? "partial"
            : asyncExact
              ? "complete"
              : "partial";

  const exactProviderSpendUsd =
    wholeTurnCoverage === "complete"
      ? (main.usd ?? 0) + (sync.usd ?? 0) + (asyncSection.exactActualCostUsd ?? 0)
      : null;

  const exactProviderSpendKrw = projectWholeTurnExactKrw(exactProviderSpendUsd, fx);

  const deductedPoints = syncReceipt.userCharge.deductedPoints;
  const marginEligible =
    wholeTurnCoverage === "complete" &&
    exactProviderSpendKrw != null &&
    deductedPoints > 0 &&
    mainExact &&
    syncExact &&
    asyncExact &&
    asyncSection.unexpectedRowCount === 0;

  const contributionMarginKrw = marginEligible
    ? round1(deductedPoints - exactProviderSpendKrw!)
    : null;
  const contributionMarginPercent =
    marginEligible && deductedPoints > 0
      ? Math.round(((deductedPoints - exactProviderSpendKrw!) / deductedPoints) * 100)
      : null;

  const historicalNote =
    input.preLedgerHistorical && input.ledgerRows.length === 0
      ? "이 턴은 async ledger/coverage 도입 이전 데이터라 전체 턴 원가를 확정할 수 없음"
      : syncReceipt.historicalNote;

  return {
    version: 3,
    assistantMessageId: input.assistantMessageId,
    chatId: input.chatId,
    syncReceipt,
    async: asyncSection,
    wholeTurn: {
      scope: "turn_attributable",
      coverage: wholeTurnCoverage,
      mainActualCostUsd: main.usd,
      mainExact,
      syncActualCostUsd: sync.usd,
      syncExact,
      syncProvablyNone: sync.provablyNone,
      asyncKnownActualCostUsd: asyncSection.knownActualCostUsd,
      asyncExactActualCostUsd: asyncSection.exactActualCostUsd,
      knownProviderSpendUsd,
      exactProviderSpendUsd,
      exactProviderSpendKrw,
      contributionMarginKrw,
      contributionMarginPercent,
      fx,
    },
    excludedCostScopes: [
      "rolling_summary_batch",
      "episodic_batch",
      "chat_level_lorebook_maintenance",
      "multi_turn_batch_allocation",
    ],
    historicalNote,
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
  const lines: string[] = [
    "Admin Receipt v3 · 턴 귀속 Provider 원가",
    `coverage: ${wholeTurnCoverageLabel(receipt.wholeTurn.coverage)}`,
  ];
  if (receipt.historicalNote) lines.push(receipt.historicalNote);

  lines.push("", "[Main RP]");
  lines.push(
    `actual USD: ${formatAdminActualUsd(receipt.wholeTurn.mainActualCostUsd)} (${receipt.wholeTurn.mainExact ? "exact" : "not exact"})`
  );

  lines.push("", "[Sync Platform Spend]");
  if (receipt.wholeTurn.syncProvablyNone) {
    lines.push("sync: none persisted");
  } else {
    lines.push(
      `actual USD: ${formatAdminActualUsd(receipt.wholeTurn.syncActualCostUsd)} (${receipt.wholeTurn.syncExact ? "exact" : "not exact"})`
    );
  }

  lines.push("", "[Async Turn-attributable]");
  lines.push(`coverage: ${wholeTurnCoverageLabel(receipt.async.coverage)}`);
  lines.push(`known USD: ${formatAdminActualUsd(receipt.async.knownActualCostUsd)}`);
  lines.push(
    `exact USD: ${receipt.async.exactActualCostUsd != null ? formatAdminActualUsd(receipt.async.exactActualCostUsd) : "—"}`
  );
  for (const family of receipt.async.byFamily) {
    lines.push(
      `- ${family.label}: calls=${family.physicalCallCount}, known=${formatAdminActualUsd(family.knownActualCostUsd)}, state=${family.expectationState}/${family.coverage}`
    );
  }

  lines.push("", "[Whole Turn]");
  lines.push(`known USD: ${formatAdminActualUsd(receipt.wholeTurn.knownProviderSpendUsd)}`);
  lines.push(
    `exact USD: ${receipt.wholeTurn.exactProviderSpendUsd != null ? formatAdminActualUsd(receipt.wholeTurn.exactProviderSpendUsd) : "—"}`
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

export type { AdminReceiptExactness };
