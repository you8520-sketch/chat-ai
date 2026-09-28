import type Database from "better-sqlite3";

import {
  ensureProviderCostLedgerSchema,
  isLedgerEventCostExact,
  resolveLedgerCostCenter,
  type ProviderCostLedgerRow,
  type ProviderCostCenter,
} from "@/lib/providerCostLedger";

/**
 * Internal quote-review marker, not an OpenRouter Enterprise eligibility rule.
 * OpenRouter does not publish a fixed Enterprise minimum-spend eligibility
 * threshold; contract minimums live in the applicable Order Form.
 */
export const OPENROUTER_CONTRACT_REVIEW_MONTHLY_USD = 25_000;
export const OPENROUTER_CONTRACT_WATCH_WINDOW_DAYS = 30;

const ADDRESSABLE_PROVIDERS = new Set(["cheaperinference", "openrouter"]);
const ADDRESSABLE_COST_CENTERS = new Set<ProviderCostCenter>([
  "chat_turn",
  "memory",
  "status_widget",
  "moderation",
  "profile",
  "trpg",
]);

export type OpenRouterContractWatchStatus =
  | "BELOW_REVIEW_MARKER"
  | "QUOTE_REVIEW";

export type OpenRouterContractWatchProjection = {
  status: OpenRouterContractWatchStatus;
  quoteReviewRecommended: boolean;
  reviewMarkerUsd: number;
  reviewMarkerKind: "internal_policy";
  windowDays: number;
  windowStart: string;
  windowEnd: string;
  settledExactUsd: number;
  exactCallCount: number;
  inexactCallCount: number;
  addressableCallCount: number;
  exactCallCoverageRatio: number | null;
  providers: string[];
  costCenters: ProviderCostCenter[];
  note: string;
};

function sqliteUtc(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function normalizeProvider(row: ProviderCostLedgerRow): string {
  return (row.actual_provider?.trim() || row.provider?.trim() || "").toLowerCase();
}

function isSpendBearingRow(row: ProviderCostLedgerRow): boolean {
  return (
    row.event_status === "settled" ||
    row.event_status === "failed_with_usage" ||
    row.event_status === "completed_without_exact_cost"
  );
}

/**
 * Read-only projection over the canonical physical provider ledger.
 *
 * Scope is deliberately conservative: current OpenRouter-compatible gateway
 * providers plus explicit text/RP cost centers. Image/asset/unknown costs are
 * excluded rather than guessed to be migratable.
 */
export function buildOpenRouterContractWatchProjection(
  db: Database.Database,
  now: Date = new Date(),
  opts?: { reviewMarkerUsd?: number; windowDays?: number }
): OpenRouterContractWatchProjection {
  ensureProviderCostLedgerSchema(db);

  const reviewMarkerUsd = Math.max(
    0,
    opts?.reviewMarkerUsd ?? OPENROUTER_CONTRACT_REVIEW_MONTHLY_USD
  );
  const windowDays = Math.max(
    1,
    Math.floor(opts?.windowDays ?? OPENROUTER_CONTRACT_WATCH_WINDOW_DAYS)
  );
  const windowEnd = now;
  const windowStart = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);

  const rows = db
    .prepare(
      `SELECT *
         FROM api_cost_ledger
        WHERE created_at >= ? AND created_at < ?
        ORDER BY id ASC`
    )
    .all(sqliteUtc(windowStart), sqliteUtc(windowEnd)) as ProviderCostLedgerRow[];

  let settledExactUsd = 0;
  let exactCallCount = 0;
  let inexactCallCount = 0;
  const providers = new Set<string>();
  const costCenters = new Set<ProviderCostCenter>();

  for (const row of rows) {
    if (!isSpendBearingRow(row)) continue;
    const provider = normalizeProvider(row);
    if (!ADDRESSABLE_PROVIDERS.has(provider)) continue;

    const center = resolveLedgerCostCenter(row);
    if (!ADDRESSABLE_COST_CENTERS.has(center)) continue;

    providers.add(provider);
    costCenters.add(center);

    if (isLedgerEventCostExact(row)) {
      settledExactUsd += Math.max(0, Number(row.actual_cost_usd) || 0);
      exactCallCount += 1;
    } else {
      inexactCallCount += 1;
    }
  }

  const addressableCallCount = exactCallCount + inexactCallCount;
  const settled = roundUsd(settledExactUsd);
  const quoteReviewRecommended = settled >= reviewMarkerUsd;

  return {
    status: quoteReviewRecommended ? "QUOTE_REVIEW" : "BELOW_REVIEW_MARKER",
    quoteReviewRecommended,
    reviewMarkerUsd,
    reviewMarkerKind: "internal_policy",
    windowDays,
    windowStart: sqliteUtc(windowStart),
    windowEnd: sqliteUtc(windowEnd),
    settledExactUsd: settled,
    exactCallCount,
    inexactCallCount,
    addressableCallCount,
    exactCallCoverageRatio:
      addressableCallCount > 0 ? exactCallCount / addressableCallCount : null,
    providers: [...providers].sort(),
    costCenters: [...costCenters].sort(),
    note:
      "Internal procurement review marker only. It does not assert OpenRouter Enterprise eligibility, a guaranteed discount, or a direct-contract price.",
  };
}
