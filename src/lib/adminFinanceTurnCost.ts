/**
 * Whole-turn provider cost for Admin Finance — mirrors Receipt V3 provenance in KRW.
 * ONE physical provider cost → ONE accounting cost (no usage+ledger double count).
 * Amount (knownApiCostKrw) and coverage (exactness) are returned together — fail-closed.
 */

import type { Usage } from "@/lib/chatUsage";
import {
  buildAdminBillingReceiptV2,
  type AdminReceiptExactness,
} from "@/lib/adminBillingReceiptV2";
import { convertUsdToKrw } from "@/lib/exchangeRate";
import {
  isLedgerEventCostExact,
  isLedgerEventCostCoverageIncomplete,
  type ProviderCostLedgerRow,
} from "@/lib/providerCostLedger";

const ASYNC_TURN_FAMILIES = new Set([
  "suggested_replies_repair",
  "status_meta",
  "memory_relationship",
]);

const SYNC_LEDGER_FAMILIES = new Set([
  "post_turn_shared_initial",
  "status_widget_extract",
]);

export type StatusWidgetExtractFinanceSource = "usage" | "ledger" | "none";

/** Per-generation KRW counted from one ledger physical event (pre-tax). */
export type LedgerCostContribution = {
  /** Delivered model id of the physical event (registry label mapping is caller-owned). */
  model: string;
  krw: number;
  exact: boolean;
};

/** Whole-turn finance cost coverage — aligned with AdminReceiptExactness aggregation. */
export type FinanceTurnCostCoverage = "complete" | "partial" | "estimated" | "unavailable";

export type MessageTurnProviderCost = {
  /** Known reference cost (exact portions + eligible estimate references for display). */
  knownApiCostKrw: number;
  /** @deprecated alias for knownApiCostKrw */
  totalEligibleKrw: number;
  /** Whole-turn exact settled cost — null unless coverage is complete. */
  exactApiCostKrw: number | null;
  coverage: FinanceTurnCostCoverage;
  realizedMarginExact: boolean;
  hasIncompleteProviderCost: boolean;
  hasEstimatedProviderCost: boolean;
  mainGenerationKrw: number;
  syncPostTurnKrw: number;
  asyncPostTurnKrw: number;
  statusWidgetExtractFinanceSource: StatusWidgetExtractFinanceSource;
  /**
   * Ledger physical events counted into knownApiCostKrw, split by their OWN
   * delivered model. One assistant message may carry several generations with
   * different models; this is the immutable generation provenance for model
   * attribution (never the mutable current message model).
   */
  ledgerCostContributions: LedgerCostContribution[];
  /**
   * Usage-snapshot-sourced KRW counted into knownApiCostKrw (turns with no
   * canonical ledger owner). Attributed to the current message model.
   */
  usageFallbackKrw: number;
  familyKrw: {
    main_generation: number;
    post_turn_shared_initial: number;
    status_widget_extract: number;
    suggested_replies_repair: number;
    status_meta: number;
    memory_relationship: number;
  };
};

type CostComponent = {
  knownKrw: number;
  exactKrw: number;
  exactness: AdminReceiptExactness | "none";
  hasIncomplete: boolean;
  /** KRW of this component sourced from the usage snapshot (no ledger owner). */
  usageFallbackKrw: number;
};

function ledgerRowModel(row: ProviderCostLedgerRow): string {
  return (row.actual_model ?? "").trim() || (row.model ?? "").trim() || "";
}

function finiteNonNegative(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function ledgerExactCostKrw(row: ProviderCostLedgerRow): number {
  if (!isLedgerEventCostExact(row)) return 0;
  const usd = finiteNonNegative(row.actual_cost_usd);
  const fx = finiteNonNegative(row.exchange_rate_krw_per_usd);
  if (usd <= 0 || fx <= 0) return 0;
  return round1(usd * fx);
}

function isRelevantAsyncLedgerRow(row: ProviderCostLedgerRow): boolean {
  if (row.execution_phase !== "async_post_turn") return false;
  if (row.funding_class !== "platform_funded") return false;
  const family = row.family?.trim() ?? "";
  return ASYNC_TURN_FAMILIES.has(family);
}

function isRelevantSyncLedgerRow(row: ProviderCostLedgerRow): boolean {
  if (row.execution_phase !== "sync_post_turn") return false;
  if (row.funding_class !== "platform_funded") return false;
  const family = row.family?.trim() ?? "";
  return SYNC_LEDGER_FAMILIES.has(family);
}

function mergeFinanceCoverage(
  current: FinanceTurnCostCoverage,
  next: FinanceTurnCostCoverage
): FinanceTurnCostCoverage {
  if (current === next) return current;
  const set = new Set([current, next]);
  if (set.has("partial")) return "partial";
  if (set.has("unavailable")) return "unavailable";
  if (set.has("estimated")) return "estimated";
  return "complete";
}

function coverageFromComponents(
  main: CostComponent,
  sync: CostComponent,
  asyncCost: CostComponent
): FinanceTurnCostCoverage {
  if (main.hasIncomplete || sync.hasIncomplete || asyncCost.hasIncomplete) {
    return "partial";
  }
  const mainEstimated =
    main.exactness === "estimated" ||
    main.exactness === "partial" ||
    (main.knownKrw > 0 && main.exactness !== "settled" && main.exactness !== "none");
  const syncEstimated =
    sync.exactness === "estimated" ||
    sync.exactness === "partial" ||
    (sync.knownKrw > 0 && sync.exactness !== "settled" && sync.exactness !== "none");
  if (mainEstimated || syncEstimated) {
    return "estimated";
  }
  if (
    main.exactness === "unavailable" &&
    sync.exactness === "none" &&
    asyncCost.knownKrw === 0 &&
    !asyncCost.hasIncomplete
  ) {
    return "unavailable";
  }
  const mainOk = main.exactness === "settled" || main.exactness === "none";
  const syncOk =
    sync.exactness === "settled" ||
    sync.exactness === "none" ||
    (sync.knownKrw === 0 && sync.exactness === "unavailable");
  const asyncOk =
    asyncCost.exactness === "settled" ||
    (asyncCost.knownKrw === 0 && !asyncCost.hasIncomplete);
  if (mainOk && syncOk && asyncOk) {
    return "complete";
  }
  return "partial";
}

/**
 * Canonical main-RP actual cost projection.
 * Ledger-first: when a main_generation ledger row exists, it is the single
 * accounting owner (settled exact). Legacy turns with no main ledger row fall
 * back to the persisted usage/shadowPricing snapshot. The two are NEVER summed.
 */
function resolveMainGenerationComponent(
  usage: Usage,
  ledgerRows: ProviderCostLedgerRow[],
  contributions: LedgerCostContribution[]
): CostComponent {
  let ledgerExactKrw = 0;
  let ledgerEstimateKrw = 0;
  let ledgerPresent = false;
  for (const row of ledgerRows) {
    if (row.execution_phase !== "main_generation") continue;
    ledgerPresent = true;
    if (isLedgerEventCostExact(row)) {
      const usd = finiteNonNegative(row.actual_cost_usd);
      const fx = finiteNonNegative(row.exchange_rate_krw_per_usd);
      if (usd > 0 && fx > 0) {
        const krw = round1(usd * fx);
        ledgerExactKrw += krw;
        contributions.push({ model: ledgerRowModel(row), krw, exact: true });
      }
    } else {
      // Not-yet-settled main request: keep the ledger-owned estimate/reference
      // (cost_krw is already KRW). Never falls back to usage for a turn that
      // already has a canonical main ledger row.
      const reference = round1(finiteNonNegative(row.cost_krw));
      if (reference > 0) {
        ledgerEstimateKrw += reference;
        contributions.push({ model: ledgerRowModel(row), krw: reference, exact: false });
      }
    }
  }

  if (ledgerPresent) {
    const known = round1(ledgerExactKrw + ledgerEstimateKrw);
    if (ledgerExactKrw > 0 && ledgerEstimateKrw <= 0) {
      // Ledger owns main cost as settled exact; usage is diagnostics only.
      return {
        knownKrw: known,
        exactKrw: known,
        exactness: "settled",
        hasIncomplete: false,
        usageFallbackKrw: 0,
      };
    }
    if (known > 0) {
      // Ledger-owned estimate/reference: known cost, not yet exact. The
      // estimate is replaced (never added to) when remote settlement lands.
      return {
        knownKrw: known,
        exactKrw: 0,
        exactness: "estimated",
        hasIncomplete: false,
        usageFallbackKrw: 0,
      };
    }
    return {
      knownKrw: 0,
      exactKrw: 0,
      exactness: "unavailable",
      hasIncomplete: true,
      usageFallbackKrw: 0,
    };
  }

  // Legacy fallback: no main_generation ledger row exists for this turn.
  const receipt = buildAdminBillingReceiptV2(usage);
  const main = receipt.mainRp.actual;
  if (main?.exactness === "settled" && main.actualProviderCostKrw > 0) {
    const known = round1(main.actualProviderCostKrw);
    return {
      knownKrw: known,
      exactKrw: known,
      exactness: "settled",
      hasIncomplete: false,
      usageFallbackKrw: known,
    };
  }

  let fallbackKrw = 0;
  if (usage.mainApiRawCostKrw != null && usage.mainApiRawCostKrw > 0) {
    fallbackKrw = round1(usage.mainApiRawCostKrw);
  } else {
    const syncExtract = usage.statusWidgetExtract;
    const syncLegacyKrw = syncExtract
      ? finiteNonNegative(syncExtract.apiRawCostKrw)
      : 0;
    const aggregate = finiteNonNegative(usage.apiRawCostKrw);
    if (aggregate > 0 && syncLegacyKrw > 0 && aggregate >= syncLegacyKrw) {
      fallbackKrw = round1(aggregate - syncLegacyKrw);
    } else {
      fallbackKrw = round1(aggregate);
    }
  }

  if (fallbackKrw <= 0) {
    return {
      knownKrw: 0,
      exactKrw: 0,
      exactness: main?.exactness ?? "unavailable",
      hasIncomplete: main?.exactness === "partial" || main?.exactness === "unavailable",
      usageFallbackKrw: 0,
    };
  }

  const exactness = main?.exactness ?? "estimated";
  return {
    knownKrw: fallbackKrw,
    exactKrw: 0,
    exactness,
    hasIncomplete: exactness === "partial" || exactness === "unavailable",
    usageFallbackKrw: fallbackKrw,
  };
}

function resolveSyncPostTurnComponent(
  usage: Usage,
  ledgerRows: ProviderCostLedgerRow[],
  contributions: LedgerCostContribution[]
): CostComponent & { source: StatusWidgetExtractFinanceSource } {
  const receipt = buildAdminBillingReceiptV2(usage);
  const sync = receipt.syncPlatformSpend;
  if (sync.status === "available") {
    if (
      sync.exactness === "settled" &&
      sync.actualProviderCostKrw != null &&
      sync.actualProviderCostKrw > 0
    ) {
      const known = round1(sync.actualProviderCostKrw);
      return {
        knownKrw: known,
        exactKrw: known,
        exactness: "settled",
        hasIncomplete: false,
        usageFallbackKrw: known,
        source: "usage",
      };
    }
    if (sync.exactness === "partial") {
      const known = finiteNonNegative(sync.legacyApiRawCostKrw ?? sync.legacyStoredActualKrw);
      return {
        knownKrw: known,
        exactKrw: 0,
        exactness: "partial",
        hasIncomplete: true,
        usageFallbackKrw: known,
        source: "usage",
      };
    }
    if (sync.exactness === "estimated") {
      const estimateKrw = finiteNonNegative(
        sync.legacyApiRawCostKrw ?? sync.legacyStoredActualKrw ?? sync.actualProviderCostKrw
      );
      return {
        knownKrw: round1(estimateKrw),
        exactKrw: 0,
        exactness: "estimated",
        hasIncomplete: false,
        usageFallbackKrw: round1(estimateKrw),
        source: "usage",
      };
    }
    return {
      knownKrw: 0,
      exactKrw: 0,
      exactness: "unavailable",
      hasIncomplete: true,
      usageFallbackKrw: 0,
      source: "usage",
    };
  }

  let syncLedgerExactKrw = 0;
  let syncLedgerHasIncomplete = false;
  for (const row of ledgerRows) {
    if (!isRelevantSyncLedgerRow(row)) continue;
    if (isLedgerEventCostExact(row)) {
      const krw = ledgerExactCostKrw(row);
      syncLedgerExactKrw += krw;
      contributions.push({ model: ledgerRowModel(row), krw, exact: true });
    } else if (isLedgerEventCostCoverageIncomplete(row)) {
      syncLedgerHasIncomplete = true;
    }
  }

  if (syncLedgerExactKrw > 0 || syncLedgerHasIncomplete) {
    return {
      knownKrw: round1(syncLedgerExactKrw),
      exactKrw: round1(syncLedgerExactKrw),
      exactness: syncLedgerHasIncomplete ? "partial" : "settled",
      hasIncomplete: syncLedgerHasIncomplete,
      usageFallbackKrw: 0,
      source: "ledger",
    };
  }

  return {
    knownKrw: 0,
    exactKrw: 0,
    exactness: "none",
    hasIncomplete: false,
    usageFallbackKrw: 0,
    source: "none",
  };
}

function resolveAsyncPostTurnComponent(
  ledgerRows: ProviderCostLedgerRow[],
  contributions: LedgerCostContribution[]
): CostComponent & {
  byFamily: Pick<
    MessageTurnProviderCost["familyKrw"],
    "suggested_replies_repair" | "status_meta" | "memory_relationship"
  >;
} {
  const byFamily = {
    suggested_replies_repair: 0,
    status_meta: 0,
    memory_relationship: 0,
  };
  let exactKrw = 0;
  let hasIncomplete = false;
  let hasRelevant = false;

  for (const row of ledgerRows) {
    if (!isRelevantAsyncLedgerRow(row)) continue;
    hasRelevant = true;
    const family = row.family?.trim() ?? "";
    if (isLedgerEventCostExact(row)) {
      const krw = ledgerExactCostKrw(row);
      exactKrw += krw;
      byFamily[family as keyof typeof byFamily] += krw;
      contributions.push({ model: ledgerRowModel(row), krw, exact: true });
    } else if (isLedgerEventCostCoverageIncomplete(row)) {
      hasIncomplete = true;
    }
  }

  return {
    knownKrw: round1(exactKrw),
    exactKrw: round1(exactKrw),
    exactness: hasRelevant
      ? hasIncomplete
        ? "partial"
        : "settled"
      : "none",
    hasIncomplete,
    usageFallbackKrw: 0,
    byFamily: {
      suggested_replies_repair: round1(byFamily.suggested_replies_repair),
      status_meta: round1(byFamily.status_meta),
      memory_relationship: round1(byFamily.memory_relationship),
    },
  };
}

/** Canonical whole-turn provider cost for one assistant message (KRW, pre-tax). */
export function resolveMessageTurnProviderCostKrw(
  usage: Usage,
  ledgerRows: ProviderCostLedgerRow[] = []
): MessageTurnProviderCost {
  const ledgerCostContributions: LedgerCostContribution[] = [];
  const main = resolveMainGenerationComponent(usage, ledgerRows, ledgerCostContributions);
  const sync = resolveSyncPostTurnComponent(usage, ledgerRows, ledgerCostContributions);
  const asyncCost = resolveAsyncPostTurnComponent(ledgerRows, ledgerCostContributions);
  const usageFallbackKrw = round1(
    main.usageFallbackKrw + sync.usageFallbackKrw + asyncCost.usageFallbackKrw
  );

  const coverage = coverageFromComponents(main, sync, asyncCost);
  const hasIncompleteProviderCost =
    main.hasIncomplete || sync.hasIncomplete || asyncCost.hasIncomplete;
  const hasEstimatedProviderCost =
    (main.knownKrw > 0 && main.exactness !== "settled" && main.exactness !== "none") ||
    sync.exactness === "estimated" ||
    coverage === "estimated";
  const realizedMarginExact = coverage === "complete";

  const knownApiCostKrw = round1(main.knownKrw + sync.knownKrw + asyncCost.knownKrw);
  const exactApiCostKrw = realizedMarginExact ? knownApiCostKrw : null;

  const syncKrw = sync.knownKrw;
  const extract = usage.statusWidgetExtract;
  let postTurnSharedInitialKrw = 0;
  let statusWidgetExtractKrw = 0;
  if (syncKrw > 0) {
    if (extract?.postTurnSharedInitial === true) {
      postTurnSharedInitialKrw = syncKrw;
    } else if (extract != null || sync.source === "ledger") {
      statusWidgetExtractKrw = syncKrw;
    }
  }

  const familyKrw = {
    main_generation: main.knownKrw,
    post_turn_shared_initial: round1(postTurnSharedInitialKrw),
    status_widget_extract: round1(statusWidgetExtractKrw),
    suggested_replies_repair: asyncCost.byFamily.suggested_replies_repair,
    status_meta: asyncCost.byFamily.status_meta,
    memory_relationship: asyncCost.byFamily.memory_relationship,
  };

  return {
    knownApiCostKrw,
    totalEligibleKrw: knownApiCostKrw,
    exactApiCostKrw,
    coverage,
    realizedMarginExact,
    hasIncompleteProviderCost,
    hasEstimatedProviderCost,
    mainGenerationKrw: main.knownKrw,
    syncPostTurnKrw: sync.knownKrw,
    asyncPostTurnKrw: asyncCost.knownKrw,
    statusWidgetExtractFinanceSource: sync.source,
    ledgerCostContributions,
    usageFallbackKrw,
    familyKrw,
  };
}

export function mergeFinanceTurnCostCoverage(
  left: FinanceTurnCostCoverage,
  right: FinanceTurnCostCoverage
): FinanceTurnCostCoverage {
  return mergeFinanceCoverage(left, right);
}

/** Receipt V3 whole-turn exact KRW for scope-alignment fixtures (null when not complete). */
export function resolveReceiptV3ExactProviderSpendKrw(
  usage: Usage,
  ledgerRows: ProviderCostLedgerRow[]
): number | null {
  const receipt = buildAdminBillingReceiptV2(usage);
  const mainUsd =
    receipt.mainRp.actual?.exactness === "settled"
      ? finiteNonNegative(receipt.mainRp.actual.actualProviderCostUsd)
      : 0;
  const syncUsd =
    receipt.syncPlatformSpend.status === "available" &&
    receipt.syncPlatformSpend.exactness === "settled"
      ? finiteNonNegative(receipt.syncPlatformSpend.actualProviderCostUsd)
      : 0;

  let asyncUsd = 0;
  let asyncExact = true;
  for (const row of ledgerRows) {
    if (!isRelevantAsyncLedgerRow(row)) continue;
    if (isLedgerEventCostExact(row)) {
      asyncUsd += finiteNonNegative(row.actual_cost_usd);
    } else if (isLedgerEventCostCoverageIncomplete(row) || row.event_status === "started") {
      asyncExact = false;
    }
  }

  const fx = receipt.fx;
  if (fx == null) return null;
  if (receipt.mainRp.actual?.exactness !== "settled") return null;
  if (
    receipt.syncPlatformSpend.status === "available" &&
    receipt.syncPlatformSpend.exactness !== "settled"
  ) {
    return null;
  }
  if (!asyncExact) return null;

  const totalUsd = mainUsd + syncUsd + asyncUsd;
  if (totalUsd <= 0) return null;
  return round1(convertUsdToKrw(totalUsd, fx.effectiveKrwPerUsd));
}

export function groupLedgerRowsByAssistantMessageId(
  rows: ProviderCostLedgerRow[]
): Map<number, ProviderCostLedgerRow[]> {
  const map = new Map<number, ProviderCostLedgerRow[]>();
  for (const row of rows) {
    const id = row.assistant_message_id;
    if (id == null || !Number.isFinite(id)) continue;
    const list = map.get(id) ?? [];
    list.push(row);
    map.set(id, list);
  }
  return map;
}
