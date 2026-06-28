import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OPENING_TURN_USER } from "@/lib/chatGreetingContext";
import {
  messagesToTurns,
  rawRecentTurnsToHistory,
  resolveRawRecentTurnPool,
} from "@/lib/hybridMemory";

const OPENING = "*훈련장 저편.* 첫 인사.";

function buildDialogueWithOpening(playableCount: number) {
  const rows: Array<{ role: "user" | "assistant"; content: string; model?: string }> = [
    { role: "assistant", model: "greeting", content: OPENING },
  ];
  for (let t = 1; t <= playableCount; t++) {
    rows.push({ role: "user", content: `유저 턴 ${t}` });
    rows.push({ role: "assistant", content: `AI 턴 ${t}`, model: "test" });
  }
  return messagesToTurns(rows);
}

describe("opening scene — raw history turn 0", () => {
  it("includes opening in raw pool for full conversation", () => {
    const turns = buildDialogueWithOpening(5);
    const history = rawRecentTurnsToHistory(turns, 0);
    const historyText = history.map((m) => m.content).join("\n");

    assert.equal(history[0]?.content, OPENING_TURN_USER);
    assert.ok(historyText.includes(OPENING));
    assert.ok(historyText.includes("유저 턴 5"));
  });

  it("puts full conversation in pool (trim is token-based in contextBuilder)", () => {
    const turns = buildDialogueWithOpening(20);
    const { pool } = resolveRawRecentTurnPool(turns, 0);

    assert.equal(pool.length, 21);
    assert.equal(pool[0]!.user, OPENING_TURN_USER);
    assert.ok(pool[0]!.assistant.includes(OPENING));
    assert.match(pool[20]!.user, /유저 턴 20/);
  });

  it("summarizedTurnCount does not remove playable turns from pool", () => {
    const turns = buildDialogueWithOpening(12);
    const { pool } = resolveRawRecentTurnPool(turns, 6);
    assert.equal(pool.length, 13);
    assert.equal(pool[0]!.user, OPENING_TURN_USER);
    assert.match(pool[1]!.user, /유저 턴 1/);
    assert.match(pool[12]!.user, /유저 턴 12/);
  });

  it("early playable turns still include opening in history", () => {
    const turns = buildDialogueWithOpening(2);
    const historyText = rawRecentTurnsToHistory(turns, 0)
      .map((m) => m.content)
      .join("\n");
    assert.ok(historyText.includes(OPENING));
    assert.ok(historyText.includes("유저 턴 2"));
  });
});
