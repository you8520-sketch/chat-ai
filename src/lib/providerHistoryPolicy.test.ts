import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HISTORY_TOKEN_BUDGET } from "@/lib/contextTrack";
import {
  messagesToTurns,
  rawRecentTurnsToHistory,
  shouldIncludeOpeningInProviderRaw,
} from "@/lib/hybridMemory";
import {
  analyzeProviderHistoryHealth,
  countRealPlayableHistoryTurns,
  trimProviderHistoryToBudget,
} from "./providerHistoryPolicy";

const OPENING = "*훈련장.* 비밀 열쇠 UNIQUE_SETUP_FACT.*";

function buildOpeningPlusPlayable(playableCount: number, charLen: number) {
  const rows: Array<{ role: "user" | "assistant"; content: string; model?: string }> = [
    { role: "assistant", model: "greeting", content: OPENING },
  ];
  for (let t = 1; t <= playableCount; t++) {
    rows.push({ role: "user", content: `유저 ${t}` });
    rows.push({ role: "assistant", content: `AI ${t}`.padEnd(charLen, "x"), model: "test" });
  }
  return messagesToTurns(rows);
}

describe("provider history trim LONG_G1-LONG_G2", () => {
  it("LONG_G1 opening + RAW4 survive 10K soft budget before first summary", () => {
    const turns = buildOpeningPlusPlayable(4, 12_000);
    const history = rawRecentTurnsToHistory(turns, 4, {
      summarizedTurnCount: 0,
      memoryFeatureEnabled: true,
    });
    const trimmed = trimProviderHistoryToBudget(history, HISTORY_TOKEN_BUDGET, {
      minRealPlayableExchanges: 4,
      protectOpening: true,
    });
    const health = analyzeProviderHistoryHealth(trimmed);
    const text = trimmed.map((m) => m.content).join("\n");

    assert.ok(text.includes("UNIQUE_SETUP_FACT"));
    assert.equal(health.realRawCompleteExchanges, 4);
    assert.equal(health.openingPreludePresent, true);
    assert.ok(
      trimmed.reduce((n, m) => n + m.content.length, 0) > HISTORY_TOKEN_BUDGET * 3,
      "opening + RAW4 intentionally exceed soft budget"
    );
  });

  it("LONG_G2 after summarizedThrough=5 opening absent, RAW turns 2-5 present", () => {
    const turns = buildOpeningPlusPlayable(5, 12_000);
    const history = rawRecentTurnsToHistory(turns, 4, {
      summarizedTurnCount: 5,
      memoryFeatureEnabled: true,
    });
    const trimmed = trimProviderHistoryToBudget(history, HISTORY_TOKEN_BUDGET, {
      minRealPlayableExchanges: 4,
      protectOpening: shouldIncludeOpeningInProviderRaw({
        opening: turns[0] ?? null,
        summarizedTurnCount: 5,
        memoryFeatureEnabled: true,
        playableCount: 5,
      }),
    });
    const text = trimmed.map((m) => m.content).join("\n");
    assert.doesNotMatch(text, /UNIQUE_SETUP_FACT/);
    assert.match(text, /유저 2/);
    assert.match(text, /유저 5/);
    assert.equal(countRealPlayableHistoryTurns(trimmed), 4);
  });
});
