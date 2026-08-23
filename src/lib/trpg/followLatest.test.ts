import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  decideLiveFollowOnGrowth,
  decideLiveFollowUpdate,
  distanceFromBottom,
  isNearBottom,
  isNearNarrationFollow,
  livePresentationActivityKey,
  narrationFollowDeltaPx,
  TRPG_FOLLOW_LATEST_THRESHOLD_PX,
  TRPG_NARRATION_FOLLOW_TARGET_RATIO,
} from "./followLatest";

describe("TRPG follow-latest scroll", () => {
  it("treats distance <= 120px as near bottom", () => {
    assert.equal(TRPG_FOLLOW_LATEST_THRESHOLD_PX, 120);
    assert.equal(
      distanceFromBottom({ scrollHeight: 2000, scrollTop: 1880, clientHeight: 100 }),
      20
    );
    assert.equal(isNearBottom({ scrollHeight: 2000, scrollTop: 1880, clientHeight: 100 }), true);
    assert.equal(isNearBottom({ scrollHeight: 2000, scrollTop: 1700, clientHeight: 100 }), false);
    assert.equal(isNearBottom({ scrollHeight: 2000, scrollTop: 1780, clientHeight: 100 }), true);
  });

  it("keeps the live GM reveal end in the lower reading band", () => {
    const vh = 800;
    assert.equal(
      narrationFollowDeltaPx({ endTop: vh * TRPG_NARRATION_FOLLOW_TARGET_RATIO, viewportHeight: vh }),
      0
    );
    assert.equal(narrationFollowDeltaPx({ endTop: 624, viewportHeight: vh }), 0);
    assert.ok(narrationFollowDeltaPx({ endTop: 780, viewportHeight: vh }) > 0);
    assert.ok(narrationFollowDeltaPx({ endTop: 400, viewportHeight: vh }) < 0);
    assert.equal(isNearNarrationFollow({ endTop: 624, viewportHeight: vh }), true);
    assert.equal(isNearNarrationFollow({ endTop: 200, viewportHeight: vh }), false);
    assert.equal(isNearNarrationFollow({ endTop: 760, viewportHeight: vh }), false);
    for (const viewportHeight of [640, 800, 720]) {
      const endTop = viewportHeight * TRPG_NARRATION_FOLLOW_TARGET_RATIO;
      assert.equal(narrationFollowDeltaPx({ endTop, viewportHeight }), 0);
      assert.equal(isNearNarrationFollow({ endTop, viewportHeight }), true);
    }
  });

  it("settles on the latest scene while preserving manual history browsing", () => {
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.match(room, /isNearBottom/);
    assert.match(room, /isNearNarrationFollowElement/);
    assert.match(room, /followLatest/);
    assert.match(room, /최신으로/);
    assert.match(room, /bottomRef\.current\.scrollIntoView/);
    assert.match(room, /data-trpg-narration-end/);
    assert.match(room, /isLiveFreshGmNarration/);
    assert.match(room, /alignNarrationEnd/);
    assert.match(room, /useRevealedText\(row\.narration \?\? "", revealNarration, "gm", streamIntervalMs\)/);
    assert.match(room, /seenLogKeysRef\.current = new Set\(trpgLogRevealKeys/);
    assert.match(room, /const revealNarration = allowGm && isFreshLogKey\(`n:\$\{row\.roundNumber\}`\)/);
    assert.match(room, /requestAnimationFrame/);
    assert.match(room, /if \(!followLatestRef\.current\) return/);
    assert.doesNotMatch(room, /100, 250, 500, 1000, 1500, 2500/);
    assert.doesNotMatch(room, /setInterval\([^)]*3000/);
  });

  it("keeps mobile campaign tabs fixed, visible, and touch friendly", () => {
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    const rail = readFileSync("src/app/trpg/TrpgCampaignRail.tsx", "utf8");
    assert.match(room, /fixed left-3 right-3 top-\[4\.5rem\]/);
    assert.match(room, /aria-label="캠페인 도구"/);
    assert.match(room, /pt-\[5\.25rem\] min-\[576px\]:pt-0/);
    assert.doesNotMatch(room, /mobileMenuOpen/);
    assert.match(rail, /grid grid-cols-3 gap-2/);
    assert.match(rail, /min-h-14/);
    assert.match(rail, /h-5 w-5/);
  });

  it("follows cinematic activity with a live-scene-only ResizeObserver", () => {
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.match(room, /livePresentationActivityKey/);
    assert.match(room, /data-trpg-live-scene/);
    assert.match(room, /liveSceneRef\.current/);
    assert.match(room, /ResizeObserver/);
    assert.doesNotMatch(room, /observer\.observe\(content\)/);
    assert.doesNotMatch(room, /observer\.observe\(quoteSelectContainerRef/);
    const actor1 = livePresentationActivityKey({
      roundNumber: 3,
      mode: "cinematic",
      phase: "actor-action",
      presentationIndex: 0,
      revealedActorCount: 1,
      resultLaneCount: 0,
      gmVisible: false,
    });
    const actor2 = livePresentationActivityKey({
      roundNumber: 3,
      mode: "cinematic",
      phase: "actor-action",
      presentationIndex: 1,
      revealedActorCount: 2,
      resultLaneCount: 1,
      gmVisible: false,
    });
    assert.notEqual(actor1, actor2);
    assert.deepEqual(decideLiveFollowUpdate({ following: true, activityChanged: true }), {
      autoFollow: true,
      unseenLatest: false,
    });
    assert.deepEqual(decideLiveFollowUpdate({ following: false, activityChanged: true }), {
      autoFollow: false,
      unseenLatest: true,
    });
    assert.deepEqual(decideLiveFollowUpdate({ following: true, activityChanged: false }), {
      autoFollow: false,
      unseenLatest: false,
    });
    assert.deepEqual(decideLiveFollowOnGrowth({ following: true }), {
      autoFollow: true,
      unseenLatest: false,
    });
    assert.deepEqual(decideLiveFollowOnGrowth({ following: false }), {
      autoFollow: false,
      unseenLatest: true,
    });
  });
});
