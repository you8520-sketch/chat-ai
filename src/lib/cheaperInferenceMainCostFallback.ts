import "server-only";

import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";
import {
  fetchAllUsageRequests,
  type CheaperInferenceUsageRequest,
} from "@/lib/cheaperInferenceUsage";
import {
  upsertReconciledProviderCost,
  type ReconciledProviderCostOutcome,
} from "@/lib/providerCostLedger";

/**
 * Canonical post-turn Main exact-cost fallback when CheaperInference stream
 * envelopes omit billing fields but the physical request succeeded.
 * Usage API lookup is accounting metadata only — never a second inference.
 */

export type MainCostUsageApiFallbackInput = {
  provider: string;
  providerRequestId?: string | null;
  model: string;
  streamBilledCostUsd?: number | null;
  outcome: "success" | "failed_without_usage" | "failed_with_usage";
  /** Physical request start (epoch ms) — narrows the usage API window. */
  requestStartedAtMs: number;
  requestKind?: string;
  fetchRequests?: typeof fetchAllUsageRequests;
  persistInTests?: boolean;
  db?: Database.Database;
};

export type MainCostUsageApiFallbackResult = {
  attempted: boolean;
  skippedReason?: string;
  lookupOk: boolean;
  requestFound: boolean;
  requestStatus?: string;
  billedCostUsd?: number;
  ledgerOutcome?: ReconciledProviderCostOutcome;
  message?: string;
};

function finiteNonNegative(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function normalizeProvider(provider: string): string {
  return provider.trim().toLowerCase();
}

function buildUsageLookupWindow(requestStartedAtMs: number): {
  windowStartIso: string;
  windowEndIso: string;
} {
  const startMs = Math.max(0, requestStartedAtMs - 2 * 60_000);
  const endMs = Date.now() + 60_000;
  return {
    windowStartIso: new Date(startMs).toISOString(),
    windowEndIso: new Date(endMs).toISOString(),
  };
}

export function shouldAttemptMainCostUsageApiFallback(
  input: Pick<
    MainCostUsageApiFallbackInput,
    "provider" | "providerRequestId" | "streamBilledCostUsd" | "outcome"
  >
): boolean {
  if (input.outcome !== "success") return false;
  if (normalizeProvider(input.provider) !== "cheaperinference") return false;
  const requestId = input.providerRequestId?.trim();
  if (!requestId) return false;
  if (finiteNonNegative(input.streamBilledCostUsd) > 0) return false;
  return true;
}

function findSettledUsageRequest(
  requests: CheaperInferenceUsageRequest[],
  providerRequestId: string
): CheaperInferenceUsageRequest | null {
  const match = requests.find((r) => r.requestId === providerRequestId);
  if (!match) return null;
  if (match.status !== "settled") return match;
  if (match.billedMicroUsd <= 0) return match;
  return match;
}

export async function enrichMainGenerationCostFromUsageApi(
  input: MainCostUsageApiFallbackInput
): Promise<MainCostUsageApiFallbackResult> {
  if (!shouldAttemptMainCostUsageApiFallback(input)) {
    return {
      attempted: false,
      skippedReason: "stream_exact_or_ineligible",
      lookupOk: false,
      requestFound: false,
    };
  }

  const providerRequestId = input.providerRequestId!.trim();
  const { windowStartIso, windowEndIso } = buildUsageLookupWindow(input.requestStartedAtMs);
  const fetchRequests = input.fetchRequests ?? fetchAllUsageRequests;

  const page = await fetchRequests({
    startAt: windowStartIso,
    endAt: windowEndIso,
    maxPages: 5,
  });

  if (!page.ok) {
    return {
      attempted: true,
      lookupOk: false,
      requestFound: false,
      message: page.message,
    };
  }

  const match = findSettledUsageRequest(page.value.requests, providerRequestId);
  if (!match) {
    return {
      attempted: true,
      lookupOk: true,
      requestFound: false,
      message: "provider request not in usage window",
    };
  }

  if (match.status !== "settled" || match.billedMicroUsd <= 0) {
    return {
      attempted: true,
      lookupOk: true,
      requestFound: true,
      requestStatus: match.status,
      message: "provider request not settled",
    };
  }

  const billedCostUsd = match.billedMicroUsd / 1_000_000;
  const db = input.db ?? getDb();
  const ledger = upsertReconciledProviderCost(
    {
      provider: "cheaperinference",
      providerRequestId,
      model: match.model ?? input.model,
      billedCostUsd,
      requestKind: input.requestKind ?? "main-rp-usage-api-fallback",
      eventTime: match.createdAt,
      persistInTests: input.persistInTests,
    },
    db
  );

  return {
    attempted: true,
    lookupOk: true,
    requestFound: true,
    requestStatus: match.status,
    billedCostUsd,
    ledgerOutcome: ledger.outcome,
  };
}

/** Fire-and-forget: never blocks user-visible stream completion. */
export function scheduleMainGenerationCostUsageApiFallback(
  input: MainCostUsageApiFallbackInput
): void {
  if (!shouldAttemptMainCostUsageApiFallback(input)) return;
  void enrichMainGenerationCostFromUsageApi(input).catch((error) => {
    console.warn(
      "[main-cost-usage-api-fallback] enrichment failed:",
      (error as Error).message
    );
  });
}
