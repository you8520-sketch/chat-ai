import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  applyLegacyQueueSessionKeyFollowReset,
  applyQueueSessionKeyTransition,
  applyTrpgCampaignEntryFollowReset,
  applyTrpgExplicitRejoinScroll,
  applyTrpgHysteresisRejoin,
  applyTrpgManualScrollDetach,
  applyTrpgPassiveFollowScrollAttempt,
  createTrpgScrollFollowLifecycleState,
  decideLiveFollowOnGrowth,
  decideLiveFollowUpdate,
  shouldDetachLiveFollowOnKey,
  shouldDetachLiveFollowOnTouchDelta,
  shouldDetachLiveFollowOnWheel,
} from "./followLatest";
import { trpgRoundPresentationSessionKey } from "./roundPresentation";

const ROUND_KEY = trpgRoundPresentationSessionKey({
  roundNumber: 3,
  rolls: [{ participantId: 1, d20: 12, dc: 11, tier: "SUCCESS" }],
  actions: [{ participantId: 1 }],
  ready: true,
});

describe("TRPG scroll-follow lifecycle regression", () => {
  it("REPRO_S3: legacy queueSessionKey effect clears manual detach and triggers scroll", () => {
    let state = createTrpgScrollFollowLifecycleState({ queueSessionKey: "" });
    state = applyTrpgManualScrollDetach(state);
    assert.equal(state.manualDetached, true);
    assert.equal(state.followLatest, false);

    state = applyLegacyQueueSessionKeyFollowReset(state, ROUND_KEY);
    assert.equal(state.manualDetached, false, "legacy effect clears manual detach");
    assert.equal(state.followLatest, true, "legacy effect re-enables follow");

    state = applyTrpgPassiveFollowScrollAttempt(state);
    assert.equal(state.programmaticScrollCount, 1, "re-attached follow yanks viewport");
  });

  it("FIX_S3: queueSessionKey ready transition preserves manual detach", () => {
    let state = createTrpgScrollFollowLifecycleState({ queueSessionKey: "" });
    state = applyTrpgManualScrollDetach(state);
    state = applyQueueSessionKeyTransition(state, ROUND_KEY);

    assert.equal(state.manualDetached, true);
    assert.equal(state.followLatest, false);
    assert.equal(state.queueSessionKey, ROUND_KEY);

    state = applyTrpgPassiveFollowScrollAttempt(state);
    assert.equal(state.programmaticScrollCount, 0, "no programmatic scroll while detached");
  });

  it("S1: campaign entry resets follow and scrolls to latest", () => {
    let state = createTrpgScrollFollowLifecycleState({
      manualDetached: true,
      followLatest: false,
    });
    state = applyTrpgCampaignEntryFollowReset(state);
    state = applyTrpgPassiveFollowScrollAttempt(state);
    assert.equal(state.followLatest, true);
    assert.equal(state.manualDetached, false);
    assert.equal(state.programmaticScrollCount, 1);
  });

  it("S2: following user survives ready transition and keeps auto-follow", () => {
    let state = createTrpgScrollFollowLifecycleState({ queueSessionKey: "" });
    state = applyQueueSessionKeyTransition(state, ROUND_KEY);
    assert.equal(state.followLatest, true);
    state = applyTrpgPassiveFollowScrollAttempt(state);
    assert.equal(state.programmaticScrollCount, 1);
  });

  it("S4: detached user keeps position on followActivityKey change", () => {
    let state = applyTrpgManualScrollDetach(createTrpgScrollFollowLifecycleState());
    for (let i = 0; i < 5; i += 1) {
      state = applyTrpgPassiveFollowScrollAttempt(state);
    }
    assert.equal(state.programmaticScrollCount, 0);
  });

  it("S5: detached user keeps position on ResizeObserver growth", () => {
    let state = applyTrpgManualScrollDetach(createTrpgScrollFollowLifecycleState());
    const growth = decideLiveFollowOnGrowth({ following: state.followLatest });
    assert.equal(growth.autoFollow, false);
    state = applyTrpgPassiveFollowScrollAttempt(state);
    assert.equal(state.programmaticScrollCount, 0);
  });

  it("S6: detached user keeps position when declaration starts", () => {
    let state = applyTrpgManualScrollDetach(createTrpgScrollFollowLifecycleState());
    state = applyTrpgPassiveFollowScrollAttempt(state);
    assert.equal(state.programmaticScrollCount, 0);
  });

  it("S7: detached user keeps position during GM narration streaming growth", () => {
    let state = applyTrpgManualScrollDetach(createTrpgScrollFollowLifecycleState());
    for (let i = 0; i < 8; i += 1) {
      state = applyTrpgPassiveFollowScrollAttempt(state);
    }
    assert.equal(state.programmaticScrollCount, 0);
  });

  it("S8: detached user keeps position when next round session key arrives", () => {
    let state = applyTrpgManualScrollDetach(
      createTrpgScrollFollowLifecycleState({ queueSessionKey: "2|live-cinematic" })
    );
    state = applyQueueSessionKeyTransition(state, "3|live-cinematic");
    assert.equal(state.manualDetached, true);
    assert.equal(state.followLatest, false);
    state = applyTrpgPassiveFollowScrollAttempt(state);
    assert.equal(state.programmaticScrollCount, 0);
  });

  it("S9: explicit 최신으로 rejoin scrolls to latest", () => {
    let state = applyTrpgManualScrollDetach(createTrpgScrollFollowLifecycleState());
    state = applyTrpgExplicitRejoinScroll(state);
    assert.equal(state.manualDetached, false);
    assert.equal(state.followLatest, true);
    assert.equal(state.programmaticScrollCount, 1);
  });

  it("S10: hysteresis rejoin after leaving and returning to follow zone", () => {
    let state = applyTrpgManualScrollDetach(createTrpgScrollFollowLifecycleState());
    state = { ...state, hasLeftFollowZoneSinceDetach: true };
    state = applyTrpgHysteresisRejoin(state);
    assert.equal(state.manualDetached, false);
    assert.equal(state.followLatest, true);
    assert.equal(state.programmaticScrollCount, 1);
  });

  it("S11: upward wheel detaches; downward wheel preserves follow", () => {
    assert.equal(shouldDetachLiveFollowOnWheel(-1), true);
    assert.equal(shouldDetachLiveFollowOnWheel(120), false);
  });

  it("S12: keyboard and touch intent matches room convention", () => {
    assert.equal(shouldDetachLiveFollowOnKey("PageUp"), true);
    assert.equal(shouldDetachLiveFollowOnKey("Home"), true);
    assert.equal(shouldDetachLiveFollowOnKey("ArrowUp"), true);
    assert.equal(shouldDetachLiveFollowOnKey("PageDown"), false);
    assert.equal(shouldDetachLiveFollowOnTouchDelta(500 - 600), true);
    assert.equal(shouldDetachLiveFollowOnTouchDelta(500 - 400), false);
  });

  it("S13: mobile and desktop share the same detach helpers", () => {
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.match(room, /shouldDetachLiveFollowOnWheel/);
    assert.match(room, /shouldDetachLiveFollowOnTouchDelta/);
    assert.match(room, /shouldDetachLiveFollowOnKey/);
    assert.match(room, /pointerdown/);
  });

  it("S14: scrollToFollowOwner remains the single programmatic scroll owner", () => {
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.match(room, /scrollToFollowOwner/);
    assert.doesNotMatch(room, /scrollIntoView[\s\S]{0,40}declarationEndRef/);
  });

  it("INVARIANT: USER_MANUAL_SCROLL_DETACH beats passive presentation state", () => {
    let state = createTrpgScrollFollowLifecycleState();
    state = applyTrpgManualScrollDetach(state);
    state = applyQueueSessionKeyTransition(state, ROUND_KEY);
    const activity = decideLiveFollowUpdate({
      following: state.followLatest,
      activityChanged: true,
    });
    assert.equal(activity.autoFollow, false);
    assert.equal(activity.unseenLatest, true);
    state = applyTrpgPassiveFollowScrollAttempt(state);
    assert.equal(state.programmaticScrollCount, 0);
  });

  it("FIX: removed queueSessionKey follow-reset owner from TrpgCampaignRoom", () => {
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.doesNotMatch(
      room,
      /useLayoutEffect\(\(\) => \{[\s\S]*queueSessionKey[\s\S]*manualScrollDetachedRef\.current = false[\s\S]*\}, \[queueSessionKey\]\)/
    );
  });
});
