import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HISTORY_TOKEN_BUDGET } from "@/lib/contextTrack";
import {
  RAW_HISTORY_COMPLETE_EXCHANGES,
  rawRecentTurnsToHistory,
  resolveProviderRawPoolExchangeCount,
  resolveProviderRawTrimFloorExchanges,
  resolveSummaryHealthState,
  type DialogueTurn,
} from "@/lib/hybridMemory";
import { trimProviderHistoryToBudget } from "@/lib/providerHistoryPolicy";
import { estimateTokens } from "@/lib/tokenEstimate";

function makeTurns(count: number): DialogueTurn[] {
  return Array.from({ length: count }, (_, i) => ({
    user: `user-${i + 1}:${"가".repeat(200)}`,
    assistant: `assistant-${i + 1}:${"나".repeat(2500)}`,
  }));
}

describe("summary health + bounded provider injection", () => {
  it("TEST 7 — healthy steady state uses RAW4 pool and trim floor", () => {
    assert.equal(
      resolveSummaryHealthState({ completedTurns: 18, summarizedTurnCount: 15 }),
      "SUMMARY_HEALTHY"
    );
    const pool = resolveProviderRawPoolExchangeCount({
      memoryFeatureEnabled: true,
      completedTurns: 18,
      summarizedTurnCount: 15,
    });
    assert.equal(pool, RAW_HISTORY_COMPLETE_EXCHANGES);
    assert.equal(resolveProviderRawTrimFloorExchanges(), RAW_HISTORY_COMPLETE_EXCHANGES);
  });

  it("TEST 8 — one batch behind: pool expands, trim floor stays RAW4", () => {
    assert.equal(
      resolveSummaryHealthState({ completedTurns: 18, summarizedTurnCount: 10 }),
      "SUMMARY_ONE_BATCH_BEHIND"
    );
    const pool = resolveProviderRawPoolExchangeCount({
      memoryFeatureEnabled: true,
      completedTurns: 18,
      summarizedTurnCount: 10,
    });
    assert.equal(pool, 8);
    const full = rawRecentTurnsToHistory(makeTurns(18), pool, {
      memoryFeatureEnabled: true,
      summarizedTurnCount: 10,
    });
    const trimmed = trimProviderHistoryToBudget(full, HISTORY_TOKEN_BUDGET, {
      minRealPlayableExchanges: resolveProviderRawTrimFloorExchanges(),
      protectOpening: false,
    });
    const playablePairs = trimmed.length / 2;
    assert.ok(playablePairs >= RAW_HISTORY_COMPLETE_EXCHANGES);
    assert.ok(playablePairs < pool);
    const historyTokens = trimmed.reduce((n, m) => n + estimateTokens(m.content), 0);
    assert.ok(historyTokens <= HISTORY_TOKEN_BUDGET * 1.15);
  });

  it("TEST 9 — large backlog: injection bounded by token budget, not turn count", () => {
    assert.equal(
      resolveSummaryHealthState({ completedTurns: 25, summarizedTurnCount: 0 }),
      "SUMMARY_BACKLOGGED"
    );
    const pool = resolveProviderRawPoolExchangeCount({
      memoryFeatureEnabled: true,
      completedTurns: 25,
      summarizedTurnCount: 0,
    });
    assert.equal(pool, 25);
    const full = rawRecentTurnsToHistory(makeTurns(25), pool);
    const trimmed = trimProviderHistoryToBudget(full, HISTORY_TOKEN_BUDGET, {
      minRealPlayableExchanges: resolveProviderRawTrimFloorExchanges(),
      protectOpening: false,
    });
    assert.ok(trimmed.length / 2 < pool);
    assert.ok(trimmed.length / 2 >= RAW_HISTORY_COMPLETE_EXCHANGES);
  });
});
