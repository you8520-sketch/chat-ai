import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OPENING_TURN_USER } from "@/lib/chatGreetingContext";
import {
  countPlayableHistoryTurns,
  messagesToTurns,
  rawRecentTurnsToHistory,
  resolveRawRecentTurnPool,
  shouldIncludeOpeningInProviderRaw,
} from "@/lib/hybridMemory";

const OPENING = "*훈련장 저편.* 첫 인사. 비밀 열쇠를 들고 있다.*";

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

describe("opening greeting provider RAW contract G1-G6", () => {
  it("G1 first user request sees greeting", () => {
    const turns = buildDialogueWithOpening(0);
    const history = rawRecentTurnsToHistory(turns, 4, {
      summarizedTurnCount: 0,
      memoryFeatureEnabled: true,
    });
    assert.equal(history[0]?.content, OPENING_TURN_USER);
    assert.ok(history.some((m) => m.content.includes(OPENING)));
  });

  it("G2 turn2 sees greeting + turn1", () => {
    const turns = buildDialogueWithOpening(1);
    const history = rawRecentTurnsToHistory(turns, 4, {
      summarizedTurnCount: 0,
      memoryFeatureEnabled: true,
    });
    const text = history.map((m) => m.content).join("\n");
    assert.ok(text.includes(OPENING));
    assert.ok(text.includes("유저 턴 1"));
    assert.equal(countPlayableHistoryTurns(history), 1);
  });

  it("G3 turn5 sees greeting + turns1-4", () => {
    const turns = buildDialogueWithOpening(4);
    const history = rawRecentTurnsToHistory(turns, 4, {
      summarizedTurnCount: 0,
      memoryFeatureEnabled: true,
    });
    const text = history.map((m) => m.content).join("\n");
    assert.ok(text.includes(OPENING));
    assert.ok(text.includes("유저 턴 1"));
    assert.ok(text.includes("유저 턴 4"));
    assert.equal(countPlayableHistoryTurns(history), 4);
  });

  it("G4 after 1-5 sealed, turn6 does not require raw greeting", () => {
    const turns = buildDialogueWithOpening(5);
    const history = rawRecentTurnsToHistory(turns, 4, {
      summarizedTurnCount: 5,
      memoryFeatureEnabled: true,
    });
    const text = history.map((m) => m.content).join("\n");
    assert.doesNotMatch(text, new RegExp(OPENING.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(text, /유저 턴 2/);
    assert.match(text, /유저 턴 5/);
    assert.equal(countPlayableHistoryTurns(history), 4);
  });

  it("G6 greeting never counts against RAW=4", () => {
    const turns = buildDialogueWithOpening(10);
    const history = rawRecentTurnsToHistory(turns, 4, {
      summarizedTurnCount: 0,
      memoryFeatureEnabled: true,
    });
    assert.equal(countPlayableHistoryTurns(history), 4);
    const { includesOpening } = resolveRawRecentTurnPool(turns, 4, {
      summarizedTurnCount: 0,
      memoryFeatureEnabled: true,
    });
    assert.equal(includesOpening, true);
  });

  it("memory OFF keeps opening only during early bootstrap", () => {
    assert.equal(
      shouldIncludeOpeningInProviderRaw({
        opening: { user: OPENING_TURN_USER, assistant: OPENING },
        summarizedTurnCount: 0,
        memoryFeatureEnabled: false,
        playableCount: 3,
      }),
      true
    );
    assert.equal(
      shouldIncludeOpeningInProviderRaw({
        opening: { user: OPENING_TURN_USER, assistant: OPENING },
        summarizedTurnCount: 0,
        memoryFeatureEnabled: false,
        playableCount: 8,
      }),
      false
    );
  });

  it("G5 opening prelude is passed into first-batch summary user payload", async () => {
    const {
      __setSummarizeTurnBatchCallerForTests,
      summarizeTurnBatch,
    } = await import("@/lib/memory/memory-rolling-summary");
    const OPENING_FACT = "비밀 열쇠를 들고 있다";
    let captured = "";
    __setSummarizeTurnBatchCallerForTests(async (_system, history) => {
      captured = history[0]!.content;
      return {
        text:
          "짧지만 중요한 사건 하나만 기록함. 비밀 열쇠를 들고 있었다. " +
          "추가 장식 없이 사실만 압축. 반복 묘사는 생략. 핵심만 유지.",
      };
    });
    try {
      await summarizeTurnBatch({
        dialogue: "[1턴]\n유저: hi\nChar: hello",
        charName: "Char",
        startTurn: 1,
        endTurn: 5,
        openingPrelude: `[OPENING/PRELUDE CONTEXT — not source turn 1]\n${OPENING_TURN_USER}\n${OPENING_FACT}`,
      });
      assert.match(captured, /OPENING\/PRELUDE CONTEXT/);
      assert.match(captured, new RegExp(OPENING_FACT));
    } finally {
      __setSummarizeTurnBatchCallerForTests(null);
    }
  });
});
