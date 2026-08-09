import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OPENING_TURN_USER } from "@/lib/chatGreetingContext";
import { HISTORY_TOKEN_BUDGET, MIN_HISTORY_TURN_FLOOR } from "@/lib/contextTrack";
import {
  countPlayableHistoryTurns,
  rawRecentTurnsToHistory,
  resolveLorebookExcludeFromTrimmedHistory,
  resolveMemoryCoverageGap,
  resolveMemoryCoverageTurnFloor,
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

function analyzeCoverage(opts: {
  completedTurns: number;
  summarizedTurnCount: number;
  opening?: boolean;
  coverageAware: boolean;
}) {
  const playable = makePlayableTurns(opts.completedTurns);
  const turns = opts.opening
    ? [{ user: OPENING_TURN_USER, assistant: "오프닝 장면" }, ...playable]
    : playable;
  const full = rawRecentTurnsToHistory(turns);
  const floor = opts.coverageAware
    ? resolveMemoryCoverageTurnFloor({
        completedTurns: opts.completedTurns,
        summarizedTurnCount: opts.summarizedTurnCount,
      })
    : MIN_HISTORY_TURN_FLOOR;
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
    estimatedTokens: trimmed.reduce(
      (sum, message) => sum + estimateTokens(message.content),
      0
    ),
  };
}

describe("resolveMemoryCoverageTurnFloor", () => {
  it("uses max(base floor, unsummarized playable turns)", () => {
    assert.equal(resolveMemoryCoverageTurnFloor({ completedTurns: 5, summarizedTurnCount: 0 }), 5);
    assert.equal(resolveMemoryCoverageTurnFloor({ completedTurns: 12, summarizedTurnCount: 6 }), 6);
    assert.equal(resolveMemoryCoverageTurnFloor({ completedTurns: 20, summarizedTurnCount: 18 }), 4);
    assert.equal(resolveMemoryCoverageTurnFloor({ completedTurns: 5, summarizedTurnCount: 8 }), 4);
  });

  it("defends against negative, fractional, NaN, and infinite inputs", () => {
    assert.equal(resolveMemoryCoverageTurnFloor({ completedTurns: -3, summarizedTurnCount: -4 }), 4);
    assert.equal(resolveMemoryCoverageTurnFloor({ completedTurns: 7.9, summarizedTurnCount: 1.2 }), 6);
    assert.equal(resolveMemoryCoverageTurnFloor({ completedTurns: Number.NaN, summarizedTurnCount: 0 }), 4);
    assert.equal(resolveMemoryCoverageTurnFloor({ completedTurns: Number.POSITIVE_INFINITY, summarizedTurnCount: 0 }), 4);
    assert.equal(resolveMemoryCoverageTurnFloor({ completedTurns: 7, summarizedTurnCount: Number.NaN, baseFloor: 0 }), 7);
  });
});

describe("RAW ↔ sealed summary coverage matrix", () => {
  const fixtures = [
    { completed: 5, summarized: 0, state: "summary async delay" },
    { completed: 6, summarized: 0, state: "pre-seal" },
    { completed: 7, summarized: 0, state: "first batch generation failure" },
    { completed: 12, summarized: 6, state: "second batch async delay" },
    { completed: 13, summarized: 6, state: "second batch generation failure" },
    { completed: 20, summarized: 6, state: "multiple-batch summary lag" },
  ] as const;

  for (const fixture of fixtures) {
    it(`${fixture.state}: completed=${fixture.completed} summarized=${fixture.summarized}`, () => {
      const after = analyzeCoverage({
        completedTurns: fixture.completed,
        summarizedTurnCount: fixture.summarized,
        coverageAware: true,
      });
      assert.ok(after.firstRawPlayableTurn <= fixture.summarized + 1);
      assert.equal(after.gap, 0);
      assert.ok(countPlayableHistoryTurns(after.trimmed) >= fixture.completed - fixture.summarized);
    });
  }

  it("documents the fixed-floor gaps reproduced before the fix", () => {
    const expected = [
      { completed: 5, summarized: 0, gap: 1 },
      { completed: 6, summarized: 0, gap: 2 },
      { completed: 7, summarized: 0, gap: 3 },
      { completed: 12, summarized: 6, gap: 0 },
      { completed: 13, summarized: 6, gap: 0 },
      { completed: 20, summarized: 6, gap: 9 },
    ];
    for (const fixture of expected) {
      const before = analyzeCoverage({
        completedTurns: fixture.completed,
        summarizedTurnCount: fixture.summarized,
        coverageAware: false,
      });
      assert.equal(before.gap, fixture.gap, JSON.stringify({ fixture, before }));
    }
  });

  it("shrinks back to the four-turn baseline after summary catch-up", () => {
    const before = analyzeCoverage({
      completedTurns: 20,
      summarizedTurnCount: 18,
      coverageAware: false,
    });
    const after = analyzeCoverage({
      completedTurns: 20,
      summarizedTurnCount: 18,
      coverageAware: true,
    });
    assert.equal(after.floor, MIN_HISTORY_TURN_FLOOR);
    assert.deepEqual(after.trimmed, before.trimmed);
    assert.equal(after.estimatedTokens, before.estimatedTokens);
    assert.equal(after.gap, 0);
  });
});

describe("lifecycle and opening fixtures", () => {
  it("regeneration preserves the same coverage state", () => {
    const original = analyzeCoverage({ completedTurns: 13, summarizedTurnCount: 6, coverageAware: true });
    const regenerated = analyzeCoverage({ completedTurns: 13, summarizedTurnCount: 6, coverageAware: true });
    assert.deepEqual(regenerated, original);
  });

  it("last-turn deletion recomputes from the reduced playable count", () => {
    const deleted = analyzeCoverage({ completedTurns: 12, summarizedTurnCount: 6, coverageAware: true });
    assert.equal(deleted.floor, 6);
    assert.equal(deleted.gap, 0);
  });

  it("canonical variant invalidation expands coverage when sealed count rolls back", () => {
    const beforeInvalidation = resolveMemoryCoverageTurnFloor({ completedTurns: 20, summarizedTurnCount: 18 });
    const afterInvalidation = analyzeCoverage({ completedTurns: 20, summarizedTurnCount: 6, coverageAware: true });
    assert.equal(beforeInvalidation, 4);
    assert.equal(afterInvalidation.floor, 14);
    assert.equal(afterInvalidation.gap, 0);
  });

  for (const opening of [false, true]) {
    it(`opening greeting ${opening ? "present" : "absent"} is not counted as playable`, () => {
      const result = analyzeCoverage({
        completedTurns: 7,
        summarizedTurnCount: 0,
        opening,
        coverageAware: true,
      });
      assert.equal(result.floor, 7);
      assert.equal(countPlayableHistoryTurns(result.trimmed), 7);
      assert.equal(result.firstRawPlayableTurn, 1);
      assert.equal(result.gap, 0);
    });
  }
});
