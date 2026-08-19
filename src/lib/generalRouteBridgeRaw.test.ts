import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  boundCanonicalRouteHistoryForProvider,
  buildGeneralProviderContext,
  type CanonicalRouteHistoryMessage,
} from "@/lib/adultSceneRouting";
import {
  analyzeProviderHistoryHealth,
  countRealPlayableHistoryTurns,
  trimProviderHistoryToBudget,
} from "@/lib/providerHistoryPolicy";
import { HISTORY_TOKEN_BUDGET } from "@/lib/contextTrack";

function makeSafeHistory(count: number): CanonicalRouteHistoryMessage[] {
  const history: CanonicalRouteHistoryMessage[] = [];
  for (let i = 1; i <= count; i++) {
    history.push({ role: "user", content: `safe-u-${i}` });
    history.push({
      role: "assistant",
      content: `safe-a-${i}`,
      sceneMode: i <= 18 ? "explicit" : "normal",
      activeRoute: i <= 18 ? "adult" : "general",
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
    const trimmed = trimProviderHistoryToBudget(bridged, HISTORY_TOKEN_BUDGET, {
      minRealPlayableExchanges: 4,
      protectOpening: false,
    });
    const health = analyzeProviderHistoryHealth(trimmed);
    assert.ok(health.realRawCompleteExchanges <= 4);
    assert.ok(health.generalRouteBridgePresent);
    assert.equal(countRealPlayableHistoryTurns(trimmed), health.realRawCompleteExchanges);
  });
});
