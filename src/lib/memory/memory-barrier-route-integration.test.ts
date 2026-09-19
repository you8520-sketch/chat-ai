import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  countPlayableHistoryTurns,
  rawRecentTurnsToHistory,
  resolveMemoryCoverageGap,
  resolveProviderRawPoolExchangeCount,
  resolveProviderRawTrimFloorExchanges,
  type DialogueTurn,
} from "@/lib/hybridMemory";
import { HISTORY_TOKEN_BUDGET } from "@/lib/contextTrack";
import { trimProviderHistoryToBudget } from "@/lib/providerHistoryPolicy";
import { gateChatOnSummaryBarrier } from "./memory-barrier-route-gate";

type RouteTurnState = {
  providerBootstrapCount: number;
  pointsDeducted: number;
  assistantFinalized: boolean;
  userRowsInserted: number;
  httpStatus: number | null;
  body: Record<string, unknown> | null;
  memoryCoverageGap: number | null;
};

/** Mirrors chat route pre-bootstrap contract when summary barrier fails. */
function simulateChatRouteBarrierGate(
  barrier: Parameters<typeof gateChatOnSummaryBarrier>[0],
  opts?: {
    completedTurns?: number;
    summarizedThrough?: number;
  }
): RouteTurnState {
  const state: RouteTurnState = {
    providerBootstrapCount: 0,
    pointsDeducted: 0,
    assistantFinalized: false,
    userRowsInserted: 0,
    httpStatus: null,
    body: null,
    memoryCoverageGap: null,
  };

  const gate = gateChatOnSummaryBarrier(barrier);
  if (!gate.proceed) {
    state.httpStatus = gate.response.status;
    state.body = gate.response.body;
    return state;
  }

  state.providerBootstrapCount += 1;
  state.pointsDeducted += 10;
  state.assistantFinalized = true;
  state.userRowsInserted += 1;

  if (opts) {
    const completedTurns = opts.completedTurns ?? 0;
    const summarizedThrough = gate.summarizedThrough ?? opts.summarizedThrough ?? 0;
    const pool = resolveProviderRawPoolExchangeCount({
      memoryFeatureEnabled: true,
      completedTurns,
      summarizedTurnCount: summarizedThrough,
    });
    const floor = resolveProviderRawTrimFloorExchanges(completedTurns - summarizedThrough);
    const turns: DialogueTurn[] = Array.from({ length: completedTurns }, (_, i) => ({
      user: `u${i + 1}`,
      assistant: `a${i + 1}`,
    }));
    const full = rawRecentTurnsToHistory(turns, pool, {
      memoryFeatureEnabled: true,
      summarizedTurnCount: summarizedThrough,
    });
    const trimmed = trimProviderHistoryToBudget(full, HISTORY_TOKEN_BUDGET, {
      minRealPlayableExchanges: floor,
      protectOpening: false,
    });
    const kept = countPlayableHistoryTurns(trimmed);
    const firstRawPlayableTurn = completedTurns - kept + 1;
    state.memoryCoverageGap = resolveMemoryCoverageGap({
      firstRawPlayableTurn,
      summarizedTurnCount: summarizedThrough,
    });
  }

  return state;
}

describe("F8 route barrier failure contract", () => {
  it("SUMMARY_BARRIER_FAILED => 503 retryable, billing waived, zero provider bootstrap", () => {
    const state = simulateChatRouteBarrierGate({
      ok: false,
      reason: "SUMMARY_BARRIER_FAILED",
      pendingRange: "1~5",
    });

    assert.equal(state.httpStatus, 503);
    assert.equal(state.providerBootstrapCount, 0);
    assert.equal(state.pointsDeducted, 0);
    assert.equal(state.assistantFinalized, false);
    assert.equal(state.userRowsInserted, 0);
    assert.equal(state.body?.code, "SUMMARY_BARRIER_FAILED");
    assert.equal(state.body?.billingWaived, true);
    assert.equal(state.body?.retryable, true);
  });

  it("healthy barrier proceeds to provider bootstrap path", () => {
    const state = simulateChatRouteBarrierGate({
      ok: true,
      summarizedThrough: 5,
    });
    assert.equal(state.httpStatus, null);
    assert.equal(state.providerBootstrapCount, 1);
    assert.equal(state.assistantFinalized, true);
    assert.equal(state.userRowsInserted, 1);
  });
});

describe("BARRIER-F barrier failure memory-hole prevention", () => {
  it("BARRIER-F1 summary=0 completed=6 provider failure → Main RP dispatch = 0", () => {
    const state = simulateChatRouteBarrierGate({
      ok: false,
      reason: "SUMMARY_BARRIER_FAILED",
      pendingRange: "1~5",
    });
    assert.equal(state.providerBootstrapCount, 0, "no Main RP dispatch on barrier failure");
    assert.equal(state.userRowsInserted, 0, "fail-closed before user bootstrap");
  });

  it("BARRIER-F2 failed barrier OR gap=0 — proceeding path has gap=0 when barrier succeeds", () => {
    const failed = simulateChatRouteBarrierGate(
      { ok: false, reason: "SUMMARY_BARRIER_FAILED", pendingRange: "1~5" },
      { completedTurns: 6, summarizedThrough: 0 }
    );
    assert.equal(failed.providerBootstrapCount, 0);

    const recovered = simulateChatRouteBarrierGate(
      { ok: true, summarizedThrough: 5 },
      { completedTurns: 6, summarizedThrough: 5 }
    );
    assert.equal(recovered.providerBootstrapCount, 1);
    assert.equal(recovered.memoryCoverageGap, 0);
  });

  it("BARRIER-F3 retry after failure — no duplicate user row contract", () => {
    const first = simulateChatRouteBarrierGate({
      ok: false,
      reason: "SUMMARY_BARRIER_FAILED",
      pendingRange: "1~5",
    });
    const retry = simulateChatRouteBarrierGate({
      ok: true,
      summarizedThrough: 5,
    });
    assert.equal(first.userRowsInserted, 0);
    assert.equal(retry.userRowsInserted, 1);
    assert.equal(retry.providerBootstrapCount, 1);
  });

  it("BARRIER-F4 normal unsummarized=5 — nonblocking proceeds with RAW5 gap=0", () => {
    const state = simulateChatRouteBarrierGate(
      { ok: true, summarizedThrough: 0 },
      { completedTurns: 5, summarizedThrough: 0 }
    );
    assert.equal(state.providerBootstrapCount, 1);
    assert.equal(state.memoryCoverageGap, 0);
  });

  it("BARRIER-F5 after summary success — RAW4 gap=0 on next turn", () => {
    const state = simulateChatRouteBarrierGate(
      { ok: true, summarizedThrough: 5 },
      { completedTurns: 6, summarizedThrough: 5 }
    );
    assert.equal(state.memoryCoverageGap, 0);
    assert.equal(state.providerBootstrapCount, 1);
  });
});
