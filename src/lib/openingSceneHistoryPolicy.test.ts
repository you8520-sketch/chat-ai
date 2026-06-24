import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OPENING_SCENE_USER_ANCHOR,
  buildOpeningSceneSystemBlock,
} from "@/lib/chatGreetingContext";

const OPENING = "*훈련장 저편.* 첫 인사.";

function buildSixTurnRecentHistory(): { role: "user" | "assistant"; content: string }[] {
  const out: { role: "user" | "assistant"; content: string }[] = [];
  for (let t = 1; t <= 6; t++) {
    out.push({ role: "user", content: `유저 턴 ${t} — 다른 장소로 이동했다.` });
    out.push({
      role: "assistant",
      content: `AI 턴 ${t} — 훈련장을 벗어나 시장으로 걸어간다.`,
    });
  }
  return out;
}

/** route.ts: shortTermHistory = recentHistory (no prependOpeningSceneToHistory) */
function routeShortTermHistory(recentHistory: { role: "user" | "assistant"; content: string }[]) {
  return recentHistory;
}

describe("opening scene — route policy (no history prepend)", () => {
  it("6+ turns: history has no fake opening anchor or greeting replay", () => {
    const recentHistory = buildSixTurnRecentHistory();
    const shortTermHistory = routeShortTermHistory(recentHistory);
    const historyText = shortTermHistory.map((m) => m.content).join("\n");

    assert.equal(shortTermHistory.length, 12);
    assert.ok(!historyText.includes(OPENING_SCENE_USER_ANCHOR));
    assert.ok(!historyText.includes(OPENING));
    assert.ok(historyText.includes("유저 턴 6"));
    assert.ok(historyText.includes("AI 턴 6"));
  });

  it("system opening block still available for contextBuilder (lightweight facts)", () => {
    const block = buildOpeningSceneSystemBlock(OPENING);
    assert.match(block, /\[OPENING SCENE — established facts at chat start\]/);
    assert.ok(block.includes(OPENING));
    assert.match(block, /Do NOT invent a different starting location/);
  });

  it("early turns (t=1-3): history is recent turns only, no opening pair", () => {
    const recentHistory = buildSixTurnRecentHistory().slice(0, 4);
    const historyText = routeShortTermHistory(recentHistory)
      .map((m) => m.content)
      .join("\n");
    assert.ok(!historyText.includes(OPENING_SCENE_USER_ANCHOR));
    assert.ok(historyText.includes("유저 턴 2"));
  });
});
