import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OPENING_TURN_USER } from "@/lib/chatGreetingContext";
import {
  rawRecentTurnsToHistory,
  resolveLorebookExcludeFromTrimmedHistory,
  resolveLorebookExcludeTurnStart,
  resolveRawRecentTurnPool,
  messagesToTurns,
  trimHistoryToBudget,
  type DialogueTurn,
} from "@/lib/hybridMemory";

function makeTurns(n: number): DialogueTurn[] {
  return Array.from({ length: n }, (_, i) => ({
    user: `user turn ${i + 1} `.repeat(40),
    assistant: `assistant turn ${i + 1} `.repeat(80),
  }));
}

describe("rawRecentTurnsToHistory", () => {
  it("includes all turns in raw pool regardless of summarizedTurnCount", () => {
    const turns = makeTurns(30);
    const { pool, firstTurn1Indexed } = resolveRawRecentTurnPool(turns, 29);
    assert.equal(pool.length, 30);
    assert.equal(firstTurn1Indexed, 1);
    const history = rawRecentTurnsToHistory(turns, 29);
    assert.equal(history.length, 60);
    assert.match(history[0]!.content, /user turn 1/);
    assert.match(history.at(-1)!.content, /assistant turn 30/);
  });

  it("includes full conversation without turn window cap", () => {
    const turns = makeTurns(12);
    const history = rawRecentTurnsToHistory(turns, 0);
    assert.equal(history.length, 12 * 2);
    assert.match(history[0]!.content, /user turn 1/);
  });

  it("messagesToTurns pairs greeting as turn 0 and user+assistant as turn 1+", () => {
    const turns = messagesToTurns([
      { role: "assistant", content: "*scene*", model: "greeting" },
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello", model: "test" },
    ]);
    assert.equal(turns.length, 2);
    assert.equal(turns[0]!.user, OPENING_TURN_USER);
    assert.equal(turns[1]!.user, "hi");
  });

  it("summarizedTurnCount does not shrink the pool", () => {
    const turns = makeTurns(8);
    const { pool } = resolveRawRecentTurnPool(turns, 6);
    assert.equal(pool.length, 8);
    assert.match(pool[0]!.user, /user turn 1/);
    assert.match(pool[7]!.user, /user turn 8/);
  });
});

describe("trimHistoryToBudget", () => {
  it("keeps newest messages within token budget", () => {
    const turns = Array.from({ length: 40 }, (_, i) => ({
      user: `user turn ${i + 1} `.repeat(20),
      assistant: `assistant turn ${i + 1} `.repeat(40),
    }));
    const full = rawRecentTurnsToHistory(turns);
    const trimmed = trimHistoryToBudget(full, 2_000);
    assert.ok(trimmed.length > 0);
    assert.ok(trimmed.length < full.length);
    assert.match(trimmed.at(-1)!.content, /assistant turn 40/);
  });
});

describe("resolveLorebookExcludeFromTrimmedHistory", () => {
  it("returns 1 when trimmed history still starts at opening", () => {
    const turns = messagesToTurns([
      { role: "assistant", content: "*scene*", model: "greeting" },
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello", model: "test" },
    ]);
    const history = rawRecentTurnsToHistory(turns);
    assert.equal(resolveLorebookExcludeFromTrimmedHistory(turns, history), 1);
  });

  it("returns first playable turn index when prefix was trimmed", () => {
    const turns = Array.from({ length: 40 }, (_, i) => ({
      user: `user turn ${i + 1} `.repeat(20),
      assistant: `assistant turn ${i + 1} `.repeat(40),
    }));
    const full = rawRecentTurnsToHistory(turns);
    const trimmed = trimHistoryToBudget(full, 2_000);
    assert.ok(trimmed.length < full.length);
    const cutoff = resolveLorebookExcludeFromTrimmedHistory(turns, trimmed);
    assert.ok(cutoff != null && cutoff > 1);
    assert.ok(trimmed[0]!.content.startsWith(`user turn ${cutoff}`));
  });
});

describe("resolveLorebookExcludeTurnStart (deprecated)", () => {
  it("returns undefined when raw starts at turn 1", () => {
    assert.equal(
      resolveLorebookExcludeTurnStart(6, { firstTurn1Indexed: 1 }),
      undefined
    );
  });
});
