import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OPENING_TURN_USER } from "@/lib/chatGreetingContext";
import { HISTORY_TOKEN_BUDGET, MIN_HISTORY_TURN_FLOOR } from "@/lib/contextTrack";
import {
  RAW_HISTORY_COMPLETE_EXCHANGES,
  areCompatibleHistorySuffixes,
  countPlayableHistoryTurns,
  rawRecentTurnsToHistory,
  resolveHistoryMinTurnFloor,
  resolveLorebookExcludeFromTrimmedHistory,
  resolveMemoryCoverageGap,
  resolveMemoryCoverageTurnFloor,
  resolveProviderRawExchangeCountForChat,
  selectLongerHistorySuffix,
  trimHistoryToBudget,
  type DialogueTurn,
} from "@/lib/hybridMemory";
import { estimateTokens } from "@/lib/tokenEstimate";

function makePlayableTurns(count: number): DialogueTurn[] {
  return Array.from({ length: count }, (_, index) => ({
    user: `user-${index + 1}:${"가".repeat(200)}`,
    assistant: `assistant-${index + 1}:${"나".repeat(2500)}`,
  }));
}

function analyzeRawPolicy(opts: {
  completedTurns: number;
  summarizedTurnCount: number;
  opening?: boolean;
}) {
  const playable = makePlayableTurns(opts.completedTurns);
  const turns = opts.opening
    ? [{ user: OPENING_TURN_USER, assistant: "오프닝 장면" }, ...playable]
    : playable;
  const full = rawRecentTurnsToHistory(turns);
  const floor = resolveHistoryMinTurnFloor({
    memoryFeatureEnabled: true,
    completedTurns: opts.completedTurns,
    summarizedTurnCount: opts.summarizedTurnCount,
  });
  const trimmed = trimHistoryToBudget(full, HISTORY_TOKEN_BUDGET, floor);
  const firstRawPlayableTurn =
    resolveLorebookExcludeFromTrimmedHistory(turns, trimmed) ?? 1;
  const gap = resolveMemoryCoverageGap({
    firstRawPlayableTurn,
    summarizedTurnCount: opts.summarizedTurnCount,
  });
  return {
    floor,
    trimmed,
    firstRawPlayableTurn,
    gap,
    playableTurns: countPlayableHistoryTurns(trimmed),
    estimatedTokens: trimmed.reduce(
      (sum, message) => sum + estimateTokens(message.content),
      0
    ),
  };
}

describe("resolveMemoryCoverageTurnFloor (diagnostics only)", () => {
  it("still reports unsummarized span for diagnostics", () => {
    assert.equal(resolveMemoryCoverageTurnFloor({ completedTurns: 5, summarizedTurnCount: 0 }), 5);
    assert.equal(resolveMemoryCoverageTurnFloor({ completedTurns: 12, summarizedTurnCount: 6 }), 6);
  });
});

describe("provider RAW policy (non-blocking summary)", () => {
  it("memory OFF keeps four-exchange floor", () => {
    assert.equal(
      resolveHistoryMinTurnFloor({
        memoryFeatureEnabled: false,
        completedTurns: 20,
        summarizedTurnCount: 0,
      }),
      RAW_HISTORY_COMPLETE_EXCHANGES
    );
  });

  it("memory ON expands RAW pool to cover unsummarized turns while summary pending", () => {
    assert.equal(
      resolveProviderRawExchangeCountForChat({
        memoryFeatureEnabled: true,
        completedTurns: 20,
        summarizedTurnCount: 6,
      }),
      14
    );
    assert.equal(
      resolveProviderRawExchangeCountForChat({
        memoryFeatureEnabled: true,
        completedTurns: 18,
        summarizedTurnCount: 15,
      }),
      RAW_HISTORY_COMPLETE_EXCHANGES
    );
  });

  it("expanded RAW covers unsummarized span without coverage gap", () => {
    const rawCount = resolveProviderRawExchangeCountForChat({
      memoryFeatureEnabled: true,
      completedTurns: 20,
      summarizedTurnCount: 6,
    });
    const playable = makePlayableTurns(20);
    const full = rawRecentTurnsToHistory(playable, rawCount, {
      memoryFeatureEnabled: true,
      summarizedTurnCount: 6,
    });
    const firstRawPlayableTurn =
      resolveLorebookExcludeFromTrimmedHistory(playable, full) ?? 1;
    const gap = resolveMemoryCoverageGap({
      firstRawPlayableTurn,
      summarizedTurnCount: 6,
    });
    assert.equal(rawCount, 14);
    assert.equal(countPlayableHistoryTurns(full), 14);
    assert.equal(gap, 0);
  });

  it("opening greeting is excluded from playable RAW count", () => {
    const rawCount = resolveProviderRawExchangeCountForChat({
      memoryFeatureEnabled: true,
      completedTurns: 7,
      summarizedTurnCount: 0,
    });
    const playable = makePlayableTurns(7);
    const turns = [{ user: OPENING_TURN_USER, assistant: "오프닝 장면" }, ...playable];
    const full = rawRecentTurnsToHistory(turns, rawCount, {
      memoryFeatureEnabled: true,
      summarizedTurnCount: 0,
    });
    assert.equal(countPlayableHistoryTurns(full), 7);
  });
});

describe("adult suffix compatibility", () => {
  it("selects only compatible complete-pair suffixes from one canonical history", () => {
    const full = rawRecentTurnsToHistory(makePlayableTurns(20));
    const handoff = full.slice(-8);
    const coverage = full.slice(-8);
    assert.equal(areCompatibleHistorySuffixes(handoff, coverage), true);
    assert.deepEqual(selectLongerHistorySuffix(handoff, coverage), coverage);
  });

  it("rejects same-length candidates from different worldlines in dev/test", () => {
    const left = rawRecentTurnsToHistory(makePlayableTurns(2));
    const right = left.map((message, index) =>
      index === 0 ? { ...message, content: "different worldline" } : message
    );
    assert.equal(areCompatibleHistorySuffixes(left, right), false);
    assert.throws(
      () => selectLongerHistorySuffix(left, right),
      /canonical latest suffix/
    );
  });

  it("trimmed history keeps complete user/assistant pairs", () => {
    const full = rawRecentTurnsToHistory(makePlayableTurns(5));
    const trimmed = trimHistoryToBudget(full, 7_500, MIN_HISTORY_TURN_FLOOR);
    assert.equal(trimmed.length % 2, 0);
    for (let index = 0; index < trimmed.length; index += 2) {
      assert.equal(trimmed[index]?.role, "user");
      assert.equal(trimmed[index + 1]?.role, "assistant");
    }
  });
});
