import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HISTORY_TOKEN_BUDGET, MIN_HISTORY_TURN_FLOOR } from "@/lib/contextTrack";
import {
  rawRecentTurnsToHistory,
  resolveLorebookExcludeFromTrimmedHistory,
  resolveMemoryCoverageGap,
  resolveMemoryCoverageTurnFloor,
  trimHistoryToBudget,
  type DialogueTurn,
} from "@/lib/hybridMemory";
import { estimateTokens } from "@/lib/tokenEstimate";

/** Long enough that 10K budget cannot keep all turns — forces real trim. */
function makeLongPlayableTurns(n: number): DialogueTurn[] {
  const pad = "가".repeat(3200);
  return Array.from({ length: n }, (_, i) => ({
    user: `user turn ${i + 1}\n${pad}`,
    assistant: `assistant turn ${i + 1}\n${pad}`,
  }));
}

/** Deferred 6-turn seal: summarized becomes 6 at N=7, 12 at N=13, … */
function expectedSummarizedForCompleted(n: number): number {
  if (n < 7) return 0;
  return Math.floor((n - 1) / 6) * 6;
}

function analyzeCoverage(opts: {
  completedTurns: number;
  summarizedTurnCount: number;
  historyBudget?: number;
  minTurnFloor?: number;
}) {
  const turns = makeLongPlayableTurns(opts.completedTurns);
  const history = rawRecentTurnsToHistory(turns);
  const coverageFloor = resolveMemoryCoverageTurnFloor({
    completedTurns: opts.completedTurns,
    summarizedTurnCount: opts.summarizedTurnCount,
    minimumTurns: opts.minTurnFloor ?? MIN_HISTORY_TURN_FLOOR,
  });
  const unsummarizedTurns = Math.max(
    0,
    opts.completedTurns - opts.summarizedTurnCount
  );
  const trimmed = trimHistoryToBudget(
    history,
    opts.historyBudget ?? HISTORY_TOKEN_BUDGET,
    coverageFloor
  );
  const firstRawPlayableTurn =
    resolveLorebookExcludeFromTrimmedHistory(turns, trimmed) ?? 1;
  const lastLtmCoveredTurn = opts.summarizedTurnCount;
  const gap = resolveMemoryCoverageGap({
    firstRawPlayableTurn,
    summarizedTurnCount: opts.summarizedTurnCount,
  });
  return {
    completedTurns: opts.completedTurns,
    summarizedTurnCount: opts.summarizedTurnCount,
    unsummarizedTurns,
    coverageFloor,
    firstRawPlayableTurn,
    lastLtmCoveredTurn,
    gap,
    trimmedMessageCount: trimmed.length,
  };
}

/** Legacy floor=4 only — documents pre-fix gap behavior. */
function analyzeLegacyFloor4(opts: {
  completedTurns: number;
  summarizedTurnCount: number;
}) {
  const turns = makeLongPlayableTurns(opts.completedTurns);
  const history = rawRecentTurnsToHistory(turns);
  const trimmed = trimHistoryToBudget(history, HISTORY_TOKEN_BUDGET, MIN_HISTORY_TURN_FLOOR);
  const firstRawPlayableTurn =
    resolveLorebookExcludeFromTrimmedHistory(turns, trimmed) ?? 1;
  const gap = resolveMemoryCoverageGap({
    firstRawPlayableTurn,
    summarizedTurnCount: opts.summarizedTurnCount,
  });
  return { firstRawPlayableTurn, gap };
}

describe("resolveMemoryCoverageTurnFloor", () => {
  it("uses max(minimum, unsummarized) without hardcoding 6/7", () => {
    assert.equal(
      resolveMemoryCoverageTurnFloor({ completedTurns: 4, summarizedTurnCount: 0 }),
      4
    );
    assert.equal(
      resolveMemoryCoverageTurnFloor({ completedTurns: 7, summarizedTurnCount: 0 }),
      7
    );
    assert.equal(
      resolveMemoryCoverageTurnFloor({ completedTurns: 7, summarizedTurnCount: 6 }),
      4
    );
    assert.equal(
      resolveMemoryCoverageTurnFloor({ completedTurns: 12, summarizedTurnCount: 6 }),
      6
    );
    assert.equal(
      resolveMemoryCoverageTurnFloor({ completedTurns: 13, summarizedTurnCount: 12 }),
      4
    );
  });

  it("regen keeps the same floor when completed/summarized unchanged", () => {
    const before = resolveMemoryCoverageTurnFloor({
      completedTurns: 12,
      summarizedTurnCount: 6,
    });
    const afterRegen = resolveMemoryCoverageTurnFloor({
      completedTurns: 12,
      summarizedTurnCount: 6,
    });
    assert.equal(afterRegen, before);
  });

  it("last-turn delete lowers completed and recomputes floor", () => {
    const beforeDelete = resolveMemoryCoverageTurnFloor({
      completedTurns: 12,
      summarizedTurnCount: 6,
    });
    assert.equal(beforeDelete, 6);
    const afterDelete = resolveMemoryCoverageTurnFloor({
      completedTurns: 11,
      summarizedTurnCount: 6,
    });
    assert.equal(afterDelete, 5);
    // Reconcile summarized down when it exceeds completed — no contradiction
    const afterReconcile = resolveMemoryCoverageTurnFloor({
      completedTurns: 11,
      summarizedTurnCount: 6,
    });
    assert.ok(afterReconcile <= 11);
    assert.equal(
      resolveMemoryCoverageTurnFloor({
        completedTurns: 5,
        summarizedTurnCount: 6,
      }),
      4
    );
  });
});

describe("memory coverage invariant — 10K trim matrix", () => {
  const cases: Array<{ n: number; summarized: number; note: string }> = [
    { n: 4, summarized: 0, note: "early" },
    { n: 5, summarized: 0, note: "early" },
    { n: 6, summarized: 0, note: "pre-seal" },
    { n: 7, summarized: 0, note: "async delay before first seal" },
    { n: 10, summarized: 6, note: "post first seal" },
    { n: 11, summarized: 6, note: "post first seal" },
    { n: 12, summarized: 6, note: "post first seal" },
    { n: 13, summarized: 6, note: "async delay before second seal" },
  ];

  for (const { n, summarized, note } of cases) {
    it(`N=${n} summarized=${summarized} (${note}): gap=0 and firstRaw<=summarized+1`, () => {
      const after = analyzeCoverage({
        completedTurns: n,
        summarizedTurnCount: summarized,
      });
      assert.equal(after.unsummarizedTurns, Math.max(0, n - summarized));
      assert.equal(
        after.coverageFloor,
        Math.max(MIN_HISTORY_TURN_FLOOR, after.unsummarizedTurns)
      );
      assert.equal(after.gap, 0, JSON.stringify(after));
      assert.ok(
        after.firstRawPlayableTurn <= summarized + 1,
        `firstRaw=${after.firstRawPlayableTurn} summarized=${summarized}`
      );
      assert.ok(
        after.firstRawPlayableTurn <= n - MIN_HISTORY_TURN_FLOOR + 1 ||
          after.firstRawPlayableTurn === 1 ||
          after.coverageFloor > MIN_HISTORY_TURN_FLOOR,
        "coverage floor should expand protection when unsummarized > 4"
      );
    });
  }

  it("N=20 summarized=6: legacy floor=4 had a gap; coverage floor closes it", () => {
    // Chunk alignment can keep ~5 turns with floor=4 — need enough history for a real gap.
    const legacy = analyzeLegacyFloor4({
      completedTurns: 20,
      summarizedTurnCount: 6,
    });
    assert.ok(
      legacy.gap > 0,
      `expected legacy gap>0, got ${JSON.stringify(legacy)}`
    );
    const after = analyzeCoverage({
      completedTurns: 20,
      summarizedTurnCount: 6,
    });
    assert.equal(after.gap, 0, JSON.stringify(after));
    assert.ok(after.firstRawPlayableTurn <= 7);
    assert.ok(after.firstRawPlayableTurn <= legacy.firstRawPlayableTurn);
  });
});

describe("memory coverage — summary async delay and shrink-back", () => {
  it("N=7 summarized=0 keeps unsummarized 1..7 in RAW", () => {
    const delayed = analyzeCoverage({
      completedTurns: 7,
      summarizedTurnCount: 0,
    });
    assert.equal(delayed.coverageFloor, 7);
    assert.equal(delayed.gap, 0);
    assert.equal(delayed.firstRawPlayableTurn, 1);
  });

  it("after seal N=7 summarized=6 floor shrinks to max(4,1)=4", () => {
    const sealed = analyzeCoverage({
      completedTurns: 7,
      summarizedTurnCount: 6,
    });
    assert.equal(sealed.coverageFloor, 4);
    assert.equal(sealed.gap, 0);
    assert.ok(sealed.firstRawPlayableTurn <= 7);
    // Soft shrink: may drop older summarized turns from RAW (already in LTM)
    assert.ok(sealed.firstRawPlayableTurn >= 1);
  });

  it("expectedSummarized helper matches deferred 6-turn cadence fixture points", () => {
    assert.equal(expectedSummarizedForCompleted(6), 0);
    assert.equal(expectedSummarizedForCompleted(7), 6);
    assert.equal(expectedSummarizedForCompleted(12), 6);
    assert.equal(expectedSummarizedForCompleted(13), 12);
  });
});

describe("memory coverage — summary failure lag", () => {
  it("does not collapse to last-4 when summarized lags far behind", () => {
    const failed = analyzeCoverage({
      completedTurns: 13,
      summarizedTurnCount: 0,
    });
    assert.equal(failed.coverageFloor, 13);
    assert.equal(failed.gap, 0);
    assert.equal(failed.firstRawPlayableTurn, 1);
    const legacy = analyzeLegacyFloor4({
      completedTurns: 13,
      summarizedTurnCount: 0,
    });
    assert.ok(legacy.gap > 0, "legacy would drop unsummarized prefix");
  });
});

describe("memory coverage — soft-over-budget vs absolute degrade signal", () => {
  it("normal unsummarized window may soft-exceed HISTORY_TOKEN_BUDGET", () => {
    const turns = makeLongPlayableTurns(7);
    const history = rawRecentTurnsToHistory(turns);
    const floor = resolveMemoryCoverageTurnFloor({
      completedTurns: 7,
      summarizedTurnCount: 0,
    });
    const trimmed = trimHistoryToBudget(history, HISTORY_TOKEN_BUDGET, floor);
    assert.equal(trimmed.length, history.length);
    // Estimate tokens of kept history — may exceed 10K when floor protects all 7
    const histTokens = estimateTokens(trimmed.map((m) => m.content).join("\n"));
    assert.ok(
      histTokens > HISTORY_TOKEN_BUDGET,
      `expected soft-over-budget, got ${histTokens}`
    );
  });

  it("absolute safety can lower floor below coverage (graceful degrade)", () => {
    const turns = makeLongPlayableTurns(8);
    const history = rawRecentTurnsToHistory(turns);
    const coverageFloor = resolveMemoryCoverageTurnFloor({
      completedTurns: 8,
      summarizedTurnCount: 0,
    });
    assert.equal(coverageFloor, 8);
    // Simulate absolute payload force-trim: degrade floor until history shrinks
    let floor = coverageFloor;
    let trimmed = trimHistoryToBudget(history, 500, floor);
    while (trimmed.length >= history.length && floor > 1) {
      floor -= 1;
      trimmed = trimHistoryToBudget(history, 500, floor);
    }
    assert.ok(floor < coverageFloor);
    const firstRaw =
      resolveLorebookExcludeFromTrimmedHistory(turns, trimmed) ?? 1;
    const gap = resolveMemoryCoverageGap({
      firstRawPlayableTurn: firstRaw,
      summarizedTurnCount: 0,
    });
    // Degrade may open a gap — allowed only under absolute safety pressure
    assert.ok(gap >= 0);
    assert.ok(trimmed.length < history.length);
  });
});
