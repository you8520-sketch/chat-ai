import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  beginTrpgProgrammaticScroll,
  cancelTrpgProgrammaticScroll,
  countRawSmoothScrollBypass,
  createTrpgProgrammaticScrollHandle,
  decideLiveFollowOnGrowth,
  decidePassiveScrollFollowUpdate,
  isTrpgScrollIntentKey,
  resolveTrpgLiveFollowOwner,
  shouldDetachLiveFollowOnUserIntent,
  TRPG_PROGRAMMATIC_SCROLL_SMOOTH_FALLBACK_MS,
  updateManualDetachFollowZone,
} from "./followLatest";

describe("TRPG declaration scroll ownership", () => {
  it("1: declaration active + cinematic=true → ACTIVE_DECLARATION_END wins", () => {
    assert.equal(
      resolveTrpgLiveFollowOwner({
        cinematicMotion: true,
        activeDeclarationReveal: true,
        freshGmRound: 3,
        gmRevealComplete: false,
        nextActionVisible: false,
      }),
      "ACTIVE_DECLARATION_END"
    );

    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.match(room, /case "ACTIVE_DECLARATION_END"/);
    assert.match(room, /declarationEndRef/);
    assert.match(room, /data-trpg-declaration-end/);
    assert.match(room, /alignReadingBandEnd\(declarationEndRef\.current/);
  });

  it("2: declaration completes → CURRENT_ACTOR wins during cinematic", () => {
    assert.equal(
      resolveTrpgLiveFollowOwner({
        cinematicMotion: true,
        activeDeclarationReveal: false,
        freshGmRound: null,
        gmRevealComplete: false,
        nextActionVisible: false,
      }),
      "CURRENT_ACTOR"
    );
  });

  it("3: tiny manual scroll while still near → stays detached (hysteresis latch)", () => {
    const passive = decidePassiveScrollFollowUpdate({
      manualDetached: true,
      following: false,
      nearFollowOwner: true,
      hasLeftFollowZoneSinceDetach: false,
    });
    assert.equal(passive.rejoin, false);
    assert.equal(passive.following, false);

    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.match(room, /hasLeftFollowZoneSinceDetachRef/);
    assert.match(room, /decidePassiveScrollFollowUpdate/);
  });

  it("4: leave follow zone then return → passive stays detached (no auto-rejoin)", () => {
    assert.deepEqual(
      updateManualDetachFollowZone({
        manualDetached: true,
        nearFollowOwner: false,
        hasLeftFollowZoneSinceDetach: false,
      }),
      { hasLeftFollowZoneSinceDetach: true }
    );
    const passive = decidePassiveScrollFollowUpdate({
      manualDetached: true,
      following: false,
      nearFollowOwner: true,
      hasLeftFollowZoneSinceDetach: true,
    });
    assert.equal(passive.rejoin, false);
    assert.equal(passive.following, false);
  });

  it("5: explicit 최신으로 → immediate rejoin regardless of latch", () => {
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.match(room, /scrollToLatest\("smooth"\)/);
    const block = room.match(/const scrollToLatest = useCallback\([\s\S]*?\n  \);/);
    assert.ok(block);
    const body = block[0]!;
    assert.ok(body.indexOf("manualScrollDetachedRef.current = false") < body.indexOf("scrollToFollowOwner(liveFollowOwner"));
    assert.match(room, /hasLeftFollowZoneSinceDetachRef\.current = false/);
    assert.match(room, /followLatestRef\.current = true/);
    assert.match(room, /최신으로/);
  });

  it("6: smooth programmatic scroll remains classified programmatic beyond two RAFs", () => {
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.match(room, /beginTrpgProgrammaticScroll/);
    assert.match(room, /scrollend/);
    assert.doesNotMatch(
      room,
      /requestAnimationFrame\(\(\) => \{\s*window\.requestAnimationFrame\(\(\) => \{\s*programmaticScrollRef\.current = false/
    );

    const handle = createTrpgProgrammaticScrollHandle();
    const activeLog: boolean[] = [];
    const timers: Array<{ fn: () => void; ms: number }> = [];
    beginTrpgProgrammaticScroll({
      handle,
      behavior: "smooth",
      scrollEndSupported: false,
      smoothFallbackMs: TRPG_PROGRAMMATIC_SCROLL_SMOOTH_FALLBACK_MS,
      onActiveChange: (active) => activeLog.push(active),
      scheduleTimeout: (fn, ms) => {
        timers.push({ fn, ms });
        return timers.length as unknown as ReturnType<typeof setTimeout>;
      },
    });
    assert.equal(handle.active, true);
    assert.equal(activeLog.at(-1), true);
    assert.equal(timers.at(-1)?.ms, TRPG_PROGRAMMATIC_SCROLL_SMOOTH_FALLBACK_MS);
    assert.equal(activeLog.filter((v) => v === true).length, 1);
  });

  it("7: physical wheel during smooth programmatic scroll → user wins immediately", () => {
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.match(room, /cancelProgrammaticScrollOwnership/);
    assert.match(room, /detachLiveFollow[\s\S]{0,200}cancelProgrammaticScrollOwnership/);

    const handle = createTrpgProgrammaticScrollHandle();
    let active = false;
    beginTrpgProgrammaticScroll({
      handle,
      behavior: "smooth",
      scrollEndSupported: false,
      smoothFallbackMs: 500,
      onActiveChange: (next) => {
        active = next;
      },
      scheduleTimeout: () => 1 as unknown as ReturnType<typeof setTimeout>,
    });
    assert.equal(active, true);
    cancelTrpgProgrammaticScroll({
      handle,
      onActiveChange: (next) => {
        active = next;
      },
    });
    assert.equal(active, false);
    assert.equal(handle.active, false);
  });

  it("8: NEXT_ACTION smooth scroll uses same follow owner (no raw bypass)", () => {
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.match(room, /scrollToFollowOwner\("NEXT_ACTION", "smooth"\)/);
    assert.equal(countRawSmoothScrollBypass(room), 0);
  });

  it("manual wheel detaches follow immediately", () => {
    assert.equal(shouldDetachLiveFollowOnUserIntent(), true);

    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.match(room, /detachLiveFollow/);
    assert.match(room, /window\.addEventListener\("wheel"/);
    assert.match(room, /manualScrollDetachedRef\.current = true/);
    assert.match(room, /followLatestRef\.current = false/);
  });

  it("pending RAF must not scroll when manually detached", () => {
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.match(room, /followScrollRafRef/);
    assert.match(
      room,
      /if \(!followLatestRef\.current \|\| manualScrollDetachedRef\.current\) return/
    );
    assert.match(room, /cancelPendingFollowScroll/);
    assert.match(room, /cancelAnimationFrame\(followScrollRafRef\.current\)/);
  });

  it("declaration growth while detached does not force scroll", () => {
    const growth = decideLiveFollowOnGrowth({ following: false });
    assert.equal(growth.autoFollow, false);
    assert.equal(growth.unseenLatest, true);

    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.match(room, /handleTrpgLiveSceneResizeGrowth/);
    assert.match(room, /programmaticScrollRef\.current\) return/);
  });

  it("DECLARATION_SCROLL_TARGET and growth observer use different refs", () => {
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.match(room, /declarationEndRef/);
    assert.match(room, /declarationGrowthRef/);
    assert.match(room, /data-trpg-declaration-end/);
    assert.match(room, /data-trpg-declaration-growth/);
    assert.match(room, /scrollToFollowOwner\("ACTIVE_DECLARATION_END"/);
    assert.match(room, /alignReadingBandEnd\(declarationEndRef\.current/);
    assert.match(room, /declarationGrowthEl/);
    assert.doesNotMatch(
      room,
      /observer\.observe\(declarationEndRef\.current\)/
    );
  });

  it("FOLLOWING + ACTIVE_DECLARATION_GROWTH autoFollows via declaration growth observer", () => {
    const growth = decideLiveFollowOnGrowth({ following: true });
    assert.equal(growth.autoFollow, true);
    assert.equal(growth.unseenLatest, false);

    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.match(room, /if \(declarationGrowthEl\) observer\.observe\(declarationGrowthEl\)/);
    assert.match(room, /scrollToFollowOwner\("ACTIVE_DECLARATION_END"/);
    assert.match(room, /liveDeclaration\.activeDeclarationActorId/);
  });

  it("Human result to Bot declaration keeps ACTIVE_DECLARATION_END owner", () => {
    assert.equal(
      resolveTrpgLiveFollowOwner({
        cinematicMotion: true,
        activeDeclarationReveal: true,
        freshGmRound: null,
        gmRevealComplete: false,
        nextActionVisible: false,
      }),
      "ACTIVE_DECLARATION_END"
    );
    assert.equal(
      resolveTrpgLiveFollowOwner({
        cinematicMotion: true,
        activeDeclarationReveal: false,
        freshGmRound: null,
        gmRevealComplete: false,
        nextActionVisible: false,
      }),
      "CURRENT_ACTOR"
    );
  });

  it("GM follow owner unchanged when no active declaration", () => {
    assert.equal(
      resolveTrpgLiveFollowOwner({
        cinematicMotion: false,
        activeDeclarationReveal: false,
        freshGmRound: 3,
        gmRevealComplete: false,
        nextActionVisible: false,
      }),
      "GM_NARRATION_END"
    );

    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.match(room, /case "GM_NARRATION_END"/);
    assert.match(room, /alignNarrationEnd\(behavior\)/);
  });

  it("mobile touch scroll uses same detach semantics", () => {
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.match(room, /touchstart/);
    assert.match(room, /touchmove/);
    assert.match(room, /detachLiveFollow\(\)/);
  });

  it("text selection does not force-finish reveal or steal scroll", () => {
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.match(room, /shouldSkipRevealFinishClick/);
    assert.doesNotMatch(room, /detachLiveFollow[\s\S]{0,80}getSelection/);

    const follow = readFileSync("src/lib/trpg/followLatest.ts", "utf8");
    assert.match(follow, /hasActiveTextSelection/);
    assert.match(follow, /shouldSkipRevealFinishClick/);
  });

  it("scroll intent keys include keyboard navigation", () => {
    for (const key of ["PageUp", "PageDown", "Home", "End", "ArrowUp", "ArrowDown", " "]) {
      assert.equal(isTrpgScrollIntentKey(key), true, key);
    }
    assert.equal(isTrpgScrollIntentKey("Enter"), false);
  });

  it("resolveTrpgLiveFollowOwner remains the single follow owner", () => {
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.match(room, /resolveTrpgLiveFollowOwner/);
    assert.match(room, /scrollToFollowOwner/);
    assert.doesNotMatch(room, /scrollIntoView[\s\S]{0,40}declaration/);
    assert.equal(countRawSmoothScrollBypass(room), 0);
  });
});
