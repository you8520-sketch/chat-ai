import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  decideLiveFollowOnGrowth,
  decideManualScrollRejoin,
  isTrpgScrollIntentKey,
  resolveTrpgLiveFollowOwner,
  shouldDetachLiveFollowOnUserIntent,
} from "./followLatest";

describe("TRPG declaration scroll ownership", () => {
  it("1: active declaration reveal owns ACTIVE_DECLARATION_END before GM", () => {
    assert.equal(
      resolveTrpgLiveFollowOwner({
        cinematicMotion: false,
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

  it("2: manual wheel detaches follow immediately", () => {
    assert.equal(shouldDetachLiveFollowOnUserIntent(), true);

    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.match(room, /detachLiveFollow/);
    assert.match(room, /window\.addEventListener\("wheel"/);
    assert.match(room, /manualScrollDetachedRef\.current = true/);
    assert.match(room, /followLatestRef\.current = false/);
  });

  it("3: pending RAF must not scroll when manually detached", () => {
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.match(room, /followScrollRafRef/);
    assert.match(
      room,
      /if \(!followLatestRef\.current \|\| manualScrollDetachedRef\.current\) return/
    );
    assert.match(room, /cancelPendingFollowScroll/);
    assert.match(room, /cancelAnimationFrame\(followScrollRafRef\.current\)/);
  });

  it("4: declaration growth while detached does not force scroll", () => {
    const growth = decideLiveFollowOnGrowth({ following: false });
    assert.equal(growth.autoFollow, false);
    assert.equal(growth.unseenLatest, true);

    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.match(room, /decideLiveFollowOnGrowth/);
    assert.match(room, /programmaticScrollRef\.current\) return/);
  });

  it("5: detached growth sets unseenLatest", () => {
    assert.deepEqual(decideLiveFollowOnGrowth({ following: false }), {
      autoFollow: false,
      unseenLatest: true,
    });

    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.match(room, /data-trpg-unseen-latest/);
  });

  it("6: 최신으로 click restores follow and clears manual detach", () => {
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.match(room, /scrollToLatest\("smooth"\)/);
    assert.match(room, /manualScrollDetachedRef\.current = false/);
    assert.match(room, /followLatestRef\.current = true/);
    assert.match(room, /최신으로/);
  });

  it("7: GM follow owner unchanged when no active declaration", () => {
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

  it("8: cinematic CURRENT_ACTOR still wins over declaration", () => {
    assert.equal(
      resolveTrpgLiveFollowOwner({
        cinematicMotion: true,
        activeDeclarationReveal: true,
        freshGmRound: 3,
        gmRevealComplete: false,
        nextActionVisible: false,
      }),
      "CURRENT_ACTOR"
    );
  });

  it("9: mobile touch scroll uses same detach semantics", () => {
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.match(room, /touchstart/);
    assert.match(room, /touchmove/);
    assert.match(room, /detachLiveFollow\(\)/);
  });

  it("10: text selection does not force-finish reveal or steal scroll", () => {
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.match(room, /shouldSkipRevealFinishClick/);
    assert.doesNotMatch(room, /detachLiveFollow[\s\S]{0,80}getSelection/);

    const follow = readFileSync("src/lib/trpg/followLatest.ts", "utf8");
    assert.match(follow, /hasActiveTextSelection/);
    assert.match(follow, /shouldSkipRevealFinishClick/);
  });

  it("manual rejoin when user returns inside follow threshold", () => {
    assert.deepEqual(
      decideManualScrollRejoin({ manualDetached: true, nearFollowOwner: true }),
      { rejoin: true }
    );
    assert.deepEqual(
      decideManualScrollRejoin({ manualDetached: true, nearFollowOwner: false }),
      { rejoin: false }
    );
    assert.deepEqual(
      decideManualScrollRejoin({ manualDetached: false, nearFollowOwner: true }),
      { rejoin: false }
    );
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
  });
});
