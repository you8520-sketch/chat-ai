import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OPENING_TURN_USER } from "@/lib/chatGreetingContext";
import { HISTORY_TOKEN_BUDGET } from "@/lib/contextTrack";
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

const OPENING = "*첫 장면.* 비밀 문장 EARLY_OPENING.*";

function buildRouteHistory(playableCount: number): CanonicalRouteHistoryMessage[] {
  const history: CanonicalRouteHistoryMessage[] = [
    { role: "assistant", content: OPENING, sceneMode: "normal", activeRoute: "general" },
  ];
  for (let i = 1; i <= playableCount; i++) {
    history.push({ role: "user", content: `safe-u-${i}` });
    history.push({
      role: "assistant",
      content: `safe-a-${i}`,
      sceneMode: i <= 2 ? "explicit" : "normal",
      activeRoute: i <= 2 ? "adult" : "general",
    });
  }
  return history;
}

describe("general return opening policy GR_G1-GR_G4", () => {
  it("GR_G1 adult->general at turn3 keeps opening with bounded real RAW", () => {
    const history = buildRouteHistory(3);
    const bounded = boundCanonicalRouteHistoryForProvider(history, 4, {
      includeOpening: true,
    });
    const bridged = buildGeneralProviderContext(bounded, {
      relationshipChange: "calmer tone",
      currentLocation: "hallway",
    });
    const trimmed = trimProviderHistoryToBudget(bridged, HISTORY_TOKEN_BUDGET, {
      minRealPlayableExchanges: 4,
      protectOpening: true,
    });
    const text = trimmed.map((m) => m.content).join("\n");
    assert.ok(text.includes("EARLY_OPENING"));
    assert.ok(text.includes("safe-u-3"));
    assert.ok(countRealPlayableHistoryTurns(trimmed) <= 4);
    assert.ok(analyzeProviderHistoryHealth(trimmed).generalRouteBridgePresent);
  });

  it("GR_G2 opening is not counted as real RAW", () => {
    const history = buildRouteHistory(3);
    const bounded = boundCanonicalRouteHistoryForProvider(history, 4, {
      includeOpening: true,
    });
    const health = analyzeProviderHistoryHealth(bounded);
    assert.equal(health.openingPreludePresent, true);
    assert.equal(health.realRawCompleteExchanges, 3);
    assert.ok(health.openingPreludeChars > 0);
  });

  it("GR_G3 adult->general after summary5 removes opening", () => {
    const history = buildRouteHistory(6);
    const bounded = boundCanonicalRouteHistoryForProvider(history, 4, {
      includeOpening: false,
    });
    const text = bounded.map((m) => m.content).join("\n");
    assert.doesNotMatch(text, /EARLY_OPENING/);
    assert.doesNotMatch(text, new RegExp(OPENING_TURN_USER));
    assert.match(text, /safe-u-3/);
  });

  it("GR_G4 real playable RAW never exceeds 4", () => {
    const history = buildRouteHistory(20);
    const bounded = boundCanonicalRouteHistoryForProvider(history, 4, {
      includeOpening: true,
    });
    const bridged = buildGeneralProviderContext(bounded, {
      relationshipChange: "trust",
    });
    const trimmed = trimProviderHistoryToBudget(bridged, HISTORY_TOKEN_BUDGET, {
      minRealPlayableExchanges: 4,
      protectOpening: true,
    });
    assert.ok(countRealPlayableHistoryTurns(trimmed) <= 4);
  });
});
