import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  CHAT_STREAM_SPEED_PRESETS,
  streamCharsPerTickForInterval,
} from "@/lib/chatDisplayPrefs";
import {
  decideLiveFollowOnGrowth,
  decideLiveFollowUpdate,
  distanceFromBottom,
  isNearBottom,
  isNearNarrationFollow,
  liveFreshGmNarrationRow,
  livePresentationActivityKey,
  narrationFollowDeltaPx,
  resolveTrpgLiveFollowOwner,
  TRPG_FOLLOW_LATEST_THRESHOLD_PX,
  TRPG_NARRATION_FOLLOW_TARGET_RATIO,
} from "./followLatest";
import {
  trpgGmRevealTick,
  trpgRevealContinueCount,
  trpgRevealImmediate,
  trpgRevealSessionChanged,
} from "./revealTiming";

describe("TRPG follow-latest scroll", () => {
  it("follows the unseen GM log row after beginNextActionRound advances the snapshot", () => {
    const seenAtMount = new Set(["n:0"]);
    const afterNewGm = [
      { roundNumber: 0, narration: "문이 열린다. 시작 장면이다." },
      { roundNumber: 1, narration: "AUDIT_GM_MARKER_28B0 낡은 등불이 흔들린다." },
      { roundNumber: 2, narration: null },
    ];
    const stay = liveFreshGmNarrationRow({ log: afterNewGm, seenKeys: seenAtMount });
    assert.equal(stay?.roundNumber, 1);
    assert.match(stay?.narration ?? "", /AUDIT_GM_MARKER_28B0/);
    const liveFresh = stay != null;
    const liveFollowRound = stay?.roundNumber ?? 2;
    assert.equal(liveFresh, true);
    assert.equal(liveFollowRound, 1);
    assert.notEqual(liveFollowRound, 2);
    const fast = CHAT_STREAM_SPEED_PRESETS.find((p) => p.label === "빠름")!;
    const normal = CHAT_STREAM_SPEED_PRESETS.find((p) => p.label === "보통")!;
    const slow = CHAT_STREAM_SPEED_PRESETS.find((p) => p.label === "느림")!;
    const instant = CHAT_STREAM_SPEED_PRESETS.find((p) => p.label === "즉시")!;
    assert.deepEqual(trpgGmRevealTick(fast.intervalMs), { intervalMs: fast.intervalMs, charsPerTick: 1 });
    assert.deepEqual(trpgGmRevealTick(normal.intervalMs), { intervalMs: normal.intervalMs, charsPerTick: 1 });
    assert.deepEqual(trpgGmRevealTick(slow.intervalMs), { intervalMs: slow.intervalMs, charsPerTick: 1 });
    assert.equal(streamCharsPerTickForInterval(instant.intervalMs), 64);
    assert.equal(
      trpgRevealImmediate({ active: true, reducedMotion: false, charCount: 40, streamIntervalMs: 0 }),
      true
    );
    const session = { text: stay!.narration, active: true, kind: "gm" as const };
    assert.equal(trpgRevealSessionChanged(session, session), false);
    assert.equal(trpgRevealContinueCount({ sessionChanged: false, shownCount: 12, total: 40 }), 12);
    assert.equal(
      liveFreshGmNarrationRow({
        log: afterNewGm,
        seenKeys: new Set(["n:0", "a:1:1", "n:1"]),
      }),
      null
    );
    assert.equal(
      liveFreshGmNarrationRow({
        log: [
          { roundNumber: 1, narration: null },
          { roundNumber: 2, narration: null },
        ],
        seenKeys: seenAtMount,
      }),
      null
    );
  });

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

  it("keeps #598 speed presets while following persisted GM row N after snap.round advances", () => {
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    const reveal = readFileSync("src/app/trpg/useRevealedText.ts", "utf8");
    assert.match(room, /const narrationReveal = useRevealedText\(row\.narration \?\? "", revealNarration, "gm", streamIntervalMs\)/);
    assert.match(reveal, /resolveTrpgRevealVisibleCount/);
    assert.match(reveal, /trpgRevealSessionChanged/);
    assert.match(reveal, /\[text, active, kind, streamIntervalMs\]/);
    assert.match(room, /data-trpg-stream-interval-ms=\{streamIntervalMs\}/);
    const fast = CHAT_STREAM_SPEED_PRESETS.find((p) => p.label === "빠름")!;
    const normal = CHAT_STREAM_SPEED_PRESETS.find((p) => p.label === "보통")!;
    const slow = CHAT_STREAM_SPEED_PRESETS.find((p) => p.label === "느림")!;
    const instant = CHAT_STREAM_SPEED_PRESETS.find((p) => p.label === "즉시")!;
    assert.deepEqual(trpgGmRevealTick(fast.intervalMs), { intervalMs: fast.intervalMs, charsPerTick: 1 });
    assert.deepEqual(trpgGmRevealTick(normal.intervalMs), { intervalMs: normal.intervalMs, charsPerTick: 1 });
    assert.deepEqual(trpgGmRevealTick(slow.intervalMs), { intervalMs: slow.intervalMs, charsPerTick: 1 });
    assert.equal(streamCharsPerTickForInterval(instant.intervalMs), 64);
    assert.equal(
      trpgRevealImmediate({ active: true, reducedMotion: false, charCount: 80, streamIntervalMs: 0 }),
      true
    );
    assert.equal(
      trpgRevealContinueCount({ sessionChanged: false, shownCount: 18, total: 80 }),
      18,
      "mid-reveal speed change does not restart"
    );

    const persistedGmRound = 3;
    const snapRoundAfterAdvance = persistedGmRound + 1;
    const live = liveFreshGmNarrationRow({
      log: [
        { roundNumber: persistedGmRound, narration: "GM turn N body" },
        { roundNumber: snapRoundAfterAdvance, narration: "" },
      ],
      seenKeys: new Set<string>(),
    });
    assert.equal(live?.roundNumber, persistedGmRound);
    assert.notEqual(live?.roundNumber, snapRoundAfterAdvance);
    assert.equal(Boolean(live && live.narration.trim()), true, "LIVE_FRESH_GM");

    const liveFollowRound = live?.roundNumber ?? snapRoundAfterAdvance;
    assert.equal(liveFollowRound, persistedGmRound);
    assert.match(room, /liveScene=\{row\.roundNumber === liveFollowRound\}/);
    assert.match(room, /narrationStartRef=\{row\.roundNumber === liveFollowRound \? narrationStartRef : undefined\}/);
    assert.match(room, /narrationEndRef=\{row\.roundNumber === liveFollowRound \? narrationEndRef : undefined\}/);
    assert.match(room, /resolveTrpgLiveFollowOwner/);
    assert.match(room, /case "GM_NARRATION_END"/);
    assert.match(room, /alignNarrationEnd\(behavior\)/);
    assert.match(room, /scrollToFollowOwner\(liveFollowOwner, "instant"\)/);
    assert.match(room, /data-trpg-live-follow-owner=\{liveFollowOwner\}/);
    assert.equal(
      resolveTrpgLiveFollowOwner({
        cinematicMotion: true,
        freshGmRound: persistedGmRound,
        gmRevealComplete: true,
        nextActionVisible: false,
      }),
      "CURRENT_ACTOR"
    );
  });

  it("settles on the latest scene while preserving manual history browsing", () => {
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.match(room, /isNearBottom/);
    assert.match(room, /isNearNarrationFollowElement/);
    assert.match(room, /followLatest/);
    assert.match(room, /최신으로/);
    assert.match(room, /bottomRef\.current\.scrollIntoView/);
    assert.match(room, /data-trpg-narration-end/);
    assert.match(room, /liveFreshGmNarrationRow/);
    assert.match(room, /liveFollowRound/);
    assert.match(room, /resolveTrpgLiveFollowOwner/);
    assert.match(room, /alignNarrationEnd/);
    assert.match(room, /const narrationReveal = useRevealedText\(row\.narration \?\? "", revealNarration, "gm", streamIntervalMs\)/);
    assert.match(room, /data-trpg-stream-interval-ms=\{streamIntervalMs\}/);
    assert.match(room, /data-trpg-live-follow-round=\{liveFollowRound\}/);
    assert.match(room, /liveScene=\{row\.roundNumber === liveFollowRound\}/);
    assert.match(room, /seenLogKeysRef\.current = new Set\(trpgLogRevealKeys/);
    assert.match(room, /const revealNarration = allowGm && isFreshLogKey\(`n:\$\{row\.roundNumber\}`\)/);
    assert.match(room, /data-trpg-live-follow-owner=\{liveFollowOwner\}/);
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
