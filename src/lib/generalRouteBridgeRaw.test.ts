import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  boundCanonicalRouteHistoryForProvider,
  buildGeneralProviderContext,
  type CanonicalRouteHistoryMessage,
} from "@/lib/adultSceneRouting";
import { countPlayableHistoryTurns, trimHistoryToBudget } from "@/lib/hybridMemory";
import { HISTORY_TOKEN_BUDGET } from "@/lib/contextTrack";

function makeSafeHistory(count: number): CanonicalRouteHistoryMessage[] {
  const history: CanonicalRouteHistoryMessage[] = [];
  for (let i = 1; i <= count; i++) {
    history.push({ role: "user", content: `safe-u-${i}` });
    history.push({
      role: "assistant",
      content: `safe-a-${i}`,
      sceneMode: "normal",
      activeRoute: "general",
    });
  }
  return history;
}

describe("general route bridge RAW<=4", () => {
  it("20 short safe exchanges + bridge => real RAW exchanges <= 4", () => {
    const history = makeSafeHistory(20);
    const bounded = boundCanonicalRouteHistoryForProvider(history);
    assert.equal(bounded.length, 8);
    assert.match(bounded[0]!.content, /safe-u-17/);

    const bridged = buildGeneralProviderContext(bounded, {
      relationshipChange: "trust grew",
      currentLocation: "office",
    });
    const trimmed = trimHistoryToBudget(bridged, HISTORY_TOKEN_BUDGET, 4);
    const realRaw = countPlayableHistoryTurns(trimmed);
    assert.ok(realRaw <= 4, `expected <=4 real RAW, got ${realRaw}`);
  });
});
