import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergeMemoryMeta, EMPTY_MEMORY_META } from "@/lib/chatMemory";
import { resolveBatchStartTurnForTurnNumber } from "@/lib/memory/memory-rolling-summary";

describe("mergeMemoryMeta regen removals", () => {
  it("removes items and thoughts before merging additions", () => {
    const prev = {
      ...EMPTY_MEMORY_META,
      items: ["에쉬: 반지, 목걸이", "렌: 지갑"],
      thoughts: ["에쉬: 조용히 기다린다", "에쉬: 불안해한다"],
    };
    const merged = mergeMemoryMeta(prev, {
      itemsRemove: ["에쉬: 반지, 목걸이"],
      thoughtsRemove: ["에쉬: 불안해한다"],
      items: ["렌→에쉬: 반지"],
      thoughts: ["에쉬: 안도한다"],
    });
    assert.deepEqual(merged.items, ["렌: 지갑", "렌→에쉬: 반지"]);
    assert.ok(merged.thoughts.includes("에쉬: 안도한다"));
    assert.ok(!merged.thoughts.includes("에쉬: 불안해한다"));
  });
});

describe("resolveBatchStartTurnForTurnNumber", () => {
  it("maps turns to 6-turn batch starts", () => {
    assert.equal(resolveBatchStartTurnForTurnNumber(1), 1);
    assert.equal(resolveBatchStartTurnForTurnNumber(6), 1);
    assert.equal(resolveBatchStartTurnForTurnNumber(7), 7);
    assert.equal(resolveBatchStartTurnForTurnNumber(12), 7);
    assert.equal(resolveBatchStartTurnForTurnNumber(13), 13);
  });
});
