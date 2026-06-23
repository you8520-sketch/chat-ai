import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { estimateTokens } from "@/lib/ai";
import {
  rawRecentTurnsToHistory,
  resolveLorebookExcludeTurnStart,
  resolveRawRecentTurnPool,
  messagesToTurns,
  type DialogueTurn,
} from "@/lib/hybridMemory";

function makeTurns(n: number): DialogueTurn[] {
  return Array.from({ length: n }, (_, i) => ({
    user: `user turn ${i + 1} `.repeat(40),
    assistant: `assistant turn ${i + 1} `.repeat(80),
  }));
}

describe("rawRecentTurnsToHistory", () => {
  it("does not backfill summarized turns when unsummarized is shorter than window", () => {
    const turns = makeTurns(30);
    const { pool, firstTurn1Indexed } = resolveRawRecentTurnPool(turns, 29, 6);
    assert.equal(pool.length, 1);
    assert.equal(firstTurn1Indexed, 30);
    const history = rawRecentTurnsToHistory(turns, 29, 6);
    assert.equal(history.length, 2);
    assert.match(history[0]!.content, /user turn 30/);
  });

  it("uses unsummarized pool when it exceeds maxRawTurns window", () => {
    const turns = makeTurns(12);
    const history = rawRecentTurnsToHistory(turns, 0, 6);
    assert.equal(history.length, 6 * 2);
    assert.match(history[0]!.content, /user turn 7/);
  });

  it("messagesToTurns pairs user and assistant", () => {
    const turns = messagesToTurns([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello", model: "test" },
    ]);
    assert.equal(turns.length, 1);
  });

  it("keeps only unsummarized tail without crossing summarized boundary", () => {
    const turns = makeTurns(8);
    const { pool, firstTurn1Indexed } = resolveRawRecentTurnPool(turns, 6, 6);
    assert.equal(pool.length, 2);
    assert.equal(firstTurn1Indexed, 7);
    assert.match(pool[0]!.user, /user turn 7/);
  });

  it("DeepSeek-scale window does not backfill summarized turns into raw pool", () => {
    const turns = makeTurns(60);
    const { pool, firstTurn1Indexed } = resolveRawRecentTurnPool(turns, 30, 60);
    assert.equal(pool.length, 30);
    assert.equal(firstTurn1Indexed, 31);
    assert.match(pool[0]!.user, /user turn 31/);
    const history = rawRecentTurnsToHistory(turns, 30, 60);
    assert.equal(history.length, 60);
    assert.match(history[0]!.content, /user turn 31/);
  });
});

describe("resolveLorebookExcludeTurnStart", () => {
  it("returns cutoff when summarized and raw starts after turn 1", () => {
    assert.equal(
      resolveLorebookExcludeTurnStart(6, { firstTurn1Indexed: 7 }),
      7
    );
  });

  it("returns undefined when nothing summarized yet", () => {
    assert.equal(
      resolveLorebookExcludeTurnStart(0, { firstTurn1Indexed: 1 }),
      undefined
    );
  });

  it("returns undefined when raw still includes turn 1", () => {
    assert.equal(
      resolveLorebookExcludeTurnStart(0, { firstTurn1Indexed: 1 }),
      undefined
    );
  });
});
