import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  attachPromptPackingSnapshotToLedger,
  attachPromptPackingTrendToCycleJson,
  comparePromptPackingTrend,
  type PromptPackingTrendSnapshot,
} from "@/lib/memoryResearch/promptPackingTrend";
import { emptyLedger } from "@/lib/memoryResearch/ledger";

function snapshot(overrides: Partial<PromptPackingTrendSnapshot> = {}): PromptPackingTrendSnapshot {
  return {
    generatedAt: "2026-09-30T00:00:00.000Z",
    currentTurnFixture: 300,
    policyId: "summary5_raw4",
    rawRecentExchanges: 4,
    rollingSummaryInterval: 5,
    mediumTermBlockCount: 15,
    models: [
      {
        modelId: "deepseek-v4.1-flash",
        n15DeltaInputTokens: 3000,
        n15MediumTokens: 2400,
      },
      {
        modelId: "gemini-3.7-flash",
        n15DeltaInputTokens: 2800,
        n15MediumTokens: 2200,
      },
    ],
    ...overrides,
  };
}

describe("Memory prompt-packing trend radar", () => {
  it("returns NO_HISTORY until a durable prior snapshot exists", () => {
    const trend = comparePromptPackingTrend(snapshot(), []);
    assert.equal(trend.status, "NO_HISTORY");
    assert.equal(trend.comparable, false);
    assert.equal(trend.previousCycleKey, null);
  });

  it("stays STABLE when memory-specific overhead is unchanged", () => {
    const current = snapshot({ generatedAt: "2026-10-07T00:00:00.000Z" });
    const trend = comparePromptPackingTrend(current, [
      { cycleKey: "weekly-2026-W40", promptPackingSnapshot: snapshot() },
    ]);
    assert.equal(trend.status, "STABLE");
    assert.equal(trend.comparable, true);
    assert.equal(trend.modelDeltas.length, 2);
    assert.ok(trend.modelDeltas.every((row) => row.verdict === "UNCHANGED"));
  });

  it("flags memory overhead growth without reacting to unrelated baseline prompt size", () => {
    const current = snapshot({
      generatedAt: "2026-10-07T00:00:00.000Z",
      models: [
        {
          modelId: "deepseek-v4.1-flash",
          n15DeltaInputTokens: 3300,
          n15MediumTokens: 2500,
        },
        {
          modelId: "gemini-3.7-flash",
          n15DeltaInputTokens: 2800,
          n15MediumTokens: 2200,
        },
      ],
    });
    const trend = comparePromptPackingTrend(current, [
      { cycleKey: "weekly-2026-W40", promptPackingSnapshot: snapshot() },
    ]);
    assert.equal(trend.status, "MEMORY_OVERHEAD_INCREASE");
    const deepseek = trend.modelDeltas.find(
      (row) => row.modelId === "deepseek-v4.1-flash"
    );
    assert.equal(deepseek?.n15DeltaInputTokensDelta, 300);
    assert.equal(deepseek?.mediumTokensDelta, 100);
    assert.equal(deepseek?.verdict, "INCREASED");
  });

  it("does not compare token overhead across a changed memory architecture", () => {
    const current = snapshot({ mediumTermBlockCount: 20 });
    const trend = comparePromptPackingTrend(current, [
      { cycleKey: "weekly-2026-W40", promptPackingSnapshot: snapshot() },
    ]);
    assert.equal(trend.status, "ARCHITECTURE_CHANGED");
    assert.equal(trend.comparable, false);
    assert.deepEqual(trend.modelDeltas, []);
  });

  it("reports model-set drift separately while comparing common models", () => {
    const current = snapshot({
      models: [
        {
          modelId: "deepseek-v4.1-flash",
          n15DeltaInputTokens: 3000,
          n15MediumTokens: 2400,
        },
        {
          modelId: "new-model",
          n15DeltaInputTokens: 2700,
          n15MediumTokens: 2100,
        },
      ],
    });
    const trend = comparePromptPackingTrend(current, [
      { cycleKey: "weekly-2026-W40", promptPackingSnapshot: snapshot() },
    ]);
    assert.equal(trend.status, "STABLE");
    assert.equal(trend.modelSetChanged, true);
    assert.deepEqual(trend.addedModels, ["new-model"]);
    assert.deepEqual(trend.removedModels, ["gemini-3.7-flash"]);
    assert.deepEqual(trend.modelDeltas.map((row) => row.modelId), [
      "deepseek-v4.1-flash",
    ]);
  });

  it("does not call a fully replaced model set stable", () => {
    const current = snapshot({
      models: [
        {
          modelId: "replacement-a",
          n15DeltaInputTokens: 2600,
          n15MediumTokens: 2000,
        },
        {
          modelId: "replacement-b",
          n15DeltaInputTokens: 2500,
          n15MediumTokens: 1900,
        },
      ],
    });
    const trend = comparePromptPackingTrend(current, [
      { cycleKey: "weekly-2026-W40", promptPackingSnapshot: snapshot() },
    ]);
    assert.equal(trend.status, "MODEL_SET_CHANGED");
    assert.equal(trend.comparable, false);
    assert.equal(trend.modelSetChanged, true);
    assert.deepEqual(trend.modelDeltas, []);
  });

  it("persists the current snapshot on the newest matching ledger cycle and trend in the cycle JSON", () => {
    const ledger = {
      ...emptyLedger(),
      cycles: [
        {
          cycleKey: "weekly-2026-W39",
          mode: "weekly",
          finishedAt: "2026-09-23T00:00:00Z",
          mainSha: "old",
          counts: {},
        },
        {
          cycleKey: "weekly-2026-W40",
          mode: "weekly",
          finishedAt: "2026-09-30T00:00:00Z",
          mainSha: "new",
          counts: {},
        },
      ],
    };
    const current = snapshot();
    const updated = attachPromptPackingSnapshotToLedger(
      ledger,
      "weekly-2026-W40",
      current
    );
    assert.equal(updated.cycles[0]?.promptPackingSnapshot, undefined);
    assert.deepEqual(updated.cycles[1]?.promptPackingSnapshot, current);

    const trend = comparePromptPackingTrend(current, []);
    const cycle = JSON.parse(
      attachPromptPackingTrendToCycleJson(
        JSON.stringify({ cycleKey: "weekly-2026-W40", status: "COMPLETED" }),
        trend
      )
    ) as Record<string, unknown>;
    assert.equal(cycle.cycleKey, "weekly-2026-W40");
    assert.deepEqual(cycle.promptPackingTrend, trend);
  });
});
