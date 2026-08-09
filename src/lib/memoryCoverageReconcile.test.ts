import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  reconcileMemoryCoverageFixedPoint,
  type MemoryCoverageReconcileReading,
} from "@/lib/memoryCoverageReconcile";

type FixtureBuild = MemoryCoverageReconcileReading & {
  history: Array<{ role: "user" | "assistant"; content: string }>;
};

type FixtureMemory = {
  cutoff: number;
  sealedThrough: number;
};

function completePairs(firstTurn: number, count: number): FixtureBuild["history"] {
  return Array.from({ length: count }, (_, index) => [
    { role: "user" as const, content: `user-${firstTurn + index}` },
    { role: "assistant" as const, content: `assistant-${firstTurn + index}` },
  ]).flat();
}

describe("memory coverage fixed-point reconciliation", () => {
  it("does zero preview passes for a normal non-degraded turn", async () => {
    let rebuilds = 0;
    const initial: FixtureBuild = {
      degraded: false,
      firstRawPlayableTurn: 7,
      gapTurns: 0,
      estimatedInputTokens: 30_000,
      history: completePairs(7, 4),
    };
    const result = await reconcileMemoryCoverageFixedPoint({
      initialBuild: initial,
      initialMemory: { cutoff: 7, sealedThrough: 6 },
      initialLtmCutoff: 7,
      failSafeLtmCutoff: 21,
      readCoverage: (build) => build,
      rebuildMemory: (cutoff) => {
        rebuilds += 1;
        return { cutoff, sealedThrough: cutoff - 1 };
      },
      rebuildContext: () => {
        throw new Error("normal turn must not rebuild context");
      },
    });

    assert.equal(result.passes, 0);
    assert.equal(rebuilds, 0);
    assert.equal(result.stable, true);
    assert.equal(result.nonconvergent, false);
  });

  it("converges T13 → T19 with no RAW/LTM middle hole", async () => {
    const cutoffs: number[] = [];
    const initial: FixtureBuild = {
      degraded: true,
      firstRawPlayableTurn: 13,
      gapTurns: 6,
      estimatedInputTokens: 149_000,
      history: completePairs(13, 8),
    };
    const result = await reconcileMemoryCoverageFixedPoint({
      initialBuild: initial,
      initialMemory: { cutoff: 7, sealedThrough: 6 },
      initialLtmCutoff: 7,
      failSafeLtmCutoff: 21,
      readCoverage: (build) => build,
      rebuildMemory: (cutoff) => {
        cutoffs.push(cutoff);
        return { cutoff, sealedThrough: cutoff - 1 };
      },
      rebuildContext: (memory) => {
        const firstRawPlayableTurn = memory.cutoff === 13 ? 19 : 19;
        return {
          degraded: true,
          firstRawPlayableTurn,
          gapTurns: 12,
          estimatedInputTokens: 149_500,
          history: completePairs(firstRawPlayableTurn, 2),
        };
      },
    });

    assert.deepEqual(cutoffs, [13, 19]);
    assert.equal(result.passes, 2);
    assert.equal(result.initialFirstRawTurn, 13);
    assert.equal(result.finalFirstRawTurn, 19);
    assert.equal(result.finalLtmCutoff, 19);
    assert.equal(result.memory.sealedThrough, 18);
    assert.equal(result.middleHoleTurns, 0);
    assert.equal(result.overlapTurns, 0);
    assert.equal(result.stable, true);
    assert.equal(result.nonconvergent, false);
    assert.ok(result.build.estimatedInputTokens <= 150_000);
    assert.equal(result.build.history.length % 2, 0);
    assert.match(result.build.history[0]?.content ?? "", /user-19/);
  });

  it("bounds non-convergence and fails safe toward overlap, never a hole", async () => {
    const cutoffs: number[] = [];
    const initial: FixtureBuild = {
      degraded: true,
      firstRawPlayableTurn: 5,
      gapTurns: 4,
      estimatedInputTokens: 149_000,
      history: completePairs(5, 16),
    };
    const result = await reconcileMemoryCoverageFixedPoint({
      initialBuild: initial,
      initialMemory: { cutoff: 1, sealedThrough: 0 },
      initialLtmCutoff: 1,
      failSafeLtmCutoff: 21,
      maxPasses: 3,
      readCoverage: (build) => build,
      rebuildMemory: (cutoff) => {
        cutoffs.push(cutoff);
        return { cutoff, sealedThrough: cutoff - 1 };
      },
      rebuildContext: (memory) => {
        const firstRawPlayableTurn =
          memory.cutoff === 5 ? 10 : memory.cutoff === 10 ? 15 : 20;
        return {
          degraded: true,
          firstRawPlayableTurn,
          gapTurns: Math.max(0, firstRawPlayableTurn - 1),
          estimatedInputTokens: 149_800,
          history: completePairs(firstRawPlayableTurn, 21 - firstRawPlayableTurn),
        };
      },
    });

    assert.deepEqual(cutoffs, [5, 10, 21]);
    assert.equal(result.passes, 3);
    assert.equal(result.nonconvergent, true);
    assert.equal(result.stable, false);
    assert.equal(result.finalFirstRawTurn, 20);
    assert.equal(result.finalLtmCutoff, 21);
    assert.equal(result.middleHoleTurns, 0);
    assert.equal(result.overlapTurns, 1);
    assert.ok(result.build.estimatedInputTokens <= 150_000);
    assert.equal(result.build.history.length % 2, 0);
  });
});
