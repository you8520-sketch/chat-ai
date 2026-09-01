/**
 * Whole-turn provider cost for Admin Finance — mirrors Receipt V3 provenance in KRW.
 * ONE physical provider cost → ONE accounting cost (no usage+ledger double count).
 */

import type { Usage } from "@/lib/chatUsage";
import { buildAdminBillingReceiptV2 } from "@/lib/adminBillingReceiptV2";
import { convertUsdToKrw } from "@/lib/exchangeRate";
import {
  isLedgerEventCostExact,
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

export type MessageTurnProviderCost = {
  mainGenerationKrw: number;
  syncPostTurnKrw: number;
  asyncPostTurnKrw: number;
  totalEligibleKrw: number;
  statusWidgetExtractFinanceSource: StatusWidgetExtractFinanceSource;
  /** Per-family KRW included in Finance (0 when not present / not exact). */
  familyKrw: {
    main_generation: number;
    post_turn_shared_initial: number;
    status_widget_extract: number;
    suggested_replies_repair: number;
    status_meta: number;
    memory_relationship: number;
  };
};

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

function resolveMainGenerationKrw(usage: Usage): number {
  const receipt = buildAdminBillingReceiptV2(usage);
  const main = receipt.mainRp.actual;
  if (main?.exactness === "settled" && main.actualProviderCostKrw > 0) {
    return round1(main.actualProviderCostKrw);
  }
  if (usage.mainApiRawCostKrw != null && usage.mainApiRawCostKrw > 0) {
    return round1(usage.mainApiRawCostKrw);
  }
  const syncExtract = usage.statusWidgetExtract;
  const syncLegacyKrw = syncExtract
    ? finiteNonNegative(syncExtract.apiRawCostKrw)
    : 0;
  const aggregate = finiteNonNegative(usage.apiRawCostKrw);
  if (aggregate > 0 && syncLegacyKrw > 0 && aggregate >= syncLegacyKrw) {
    return round1(aggregate - syncLegacyKrw);
  }
  return round1(aggregate);
}

function resolveSyncPostTurnKrw(
  usage: Usage,
  ledgerRows: ProviderCostLedgerRow[]
): { krw: number; source: StatusWidgetExtractFinanceSource } {
  const receipt = buildAdminBillingReceiptV2(usage);
  const sync = receipt.syncPlatformSpend;
  if (
    sync.status === "available" &&
    sync.exactness === "settled" &&
    sync.actualProviderCostKrw != null &&
    sync.actualProviderCostKrw > 0
  ) {
    return { krw: round1(sync.actualProviderCostKrw), source: "usage" };
  }

  const syncLedgerKrw = ledgerRows.reduce((sum, row) => {
    if (row.execution_phase !== "sync_post_turn") return sum;
    if (row.funding_class !== "platform_funded") return sum;
    const family = row.family?.trim() ?? "";
    if (!SYNC_LEDGER_FAMILIES.has(family)) return sum;
    return sum + ledgerExactCostKrw(row);
  }, 0);

  if (syncLedgerKrw > 0) {
    return { krw: round1(syncLedgerKrw), source: "ledger" };
  }

  return { krw: 0, source: "none" };
}

function resolveAsyncPostTurnKrw(ledgerRows: ProviderCostLedgerRow[]): {
  totalKrw: number;
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
  for (const row of ledgerRows) {
    if (row.execution_phase !== "async_post_turn") continue;
    if (row.funding_class !== "platform_funded") continue;
    const family = row.family?.trim() ?? "";
    if (!ASYNC_TURN_FAMILIES.has(family)) continue;
    const krw = ledgerExactCostKrw(row);
    if (krw <= 0) continue;
    byFamily[family as keyof typeof byFamily] += krw;
  }
  return {
    totalKrw: round1(
      byFamily.suggested_replies_repair +
        byFamily.status_meta +
        byFamily.memory_relationship
    ),
    byFamily: {
      suggested_replies_repair: round1(byFamily.suggested_replies_repair),
      status_meta: round1(byFamily.status_meta),
      memory_relationship: round1(byFamily.memory_relationship),
    },
  };
}

/** Canonical whole-turn eligible provider cost for one assistant message (KRW, pre-tax). */
export function resolveMessageTurnProviderCostKrw(
  usage: Usage,
  ledgerRows: ProviderCostLedgerRow[] = []
): MessageTurnProviderCost {
  const mainGenerationKrw = resolveMainGenerationKrw(usage);
  const sync = resolveSyncPostTurnKrw(usage, ledgerRows);
  const asyncCost = resolveAsyncPostTurnKrw(ledgerRows);

  const syncKrw = sync.krw;
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
    main_generation: mainGenerationKrw,
    post_turn_shared_initial: round1(postTurnSharedInitialKrw),
    status_widget_extract: round1(statusWidgetExtractKrw),
    suggested_replies_repair: asyncCost.byFamily.suggested_replies_repair,
    status_meta: asyncCost.byFamily.status_meta,
    memory_relationship: asyncCost.byFamily.memory_relationship,
  };

  return {
    mainGenerationKrw,
    syncPostTurnKrw: syncKrw,
    asyncPostTurnKrw: asyncCost.totalKrw,
    totalEligibleKrw: round1(mainGenerationKrw + syncKrw + asyncCost.totalKrw),
    statusWidgetExtractFinanceSource: sync.source,
    familyKrw,
  };
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
    if (row.execution_phase !== "async_post_turn") continue;
    if (row.funding_class !== "platform_funded") continue;
    const family = row.family?.trim() ?? "";
    if (!ASYNC_TURN_FAMILIES.has(family)) continue;
    if (isLedgerEventCostExact(row)) {
      asyncUsd += finiteNonNegative(row.actual_cost_usd);
    } else if (row.event_status !== "started") {
      asyncExact = false;
    }
  }

  const fx = receipt.fx;
  if (fx == null) return null;
  if (mainUsd <= 0 && syncUsd <= 0 && asyncUsd <= 0) return null;
  if (receipt.mainRp.actual?.exactness !== "settled") return null;
  if (
    receipt.syncPlatformSpend.status === "available" &&
    receipt.syncPlatformSpend.exactness !== "settled"
  ) {
    return null;
  }
  if (!asyncExact && asyncUsd <= 0) return null;

  const totalUsd = mainUsd + syncUsd + asyncUsd;
  return totalUsd > 0 ? round1(convertUsdToKrw(totalUsd, fx.effectiveKrwPerUsd)) : null;
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
