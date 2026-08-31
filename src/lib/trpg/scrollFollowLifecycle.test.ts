import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  decideLiveFollowOnGrowth,
  decideLiveFollowUpdate,
  decidePassiveScrollFollowUpdate,
} from "./followLatest";
import { trpgRoundPresentationSessionKey } from "./roundPresentation";

const ROUND_KEY = trpgRoundPresentationSessionKey({
  roundNumber: 3,
  rolls: [{ participantId: 1, d20: 12, dc: 11, tier: "SUCCESS" }],
  actions: [{ participantId: 1 }],
  ready: true,
});

type ScrollFollowModel = {
  manualDetached: boolean;
  followLatest: boolean;
  unseenLatest: boolean;
  hasLeftFollowZoneSinceDetach: boolean;
  programmaticScrollCount: number;
  queueSessionKey: string;
};

function createModel(overrides?: Partial<ScrollFollowModel>): ScrollFollowModel {
  return {
    manualDetached: false,
    followLatest: true,
    unseenLatest: false,
    hasLeftFollowZoneSinceDetach: false,
    programmaticScrollCount: 0,
    queueSessionKey: "",
    ...overrides,
  };
}

/** Test-local model of detachLiveFollow(). */
function detach(state: ScrollFollowModel): ScrollFollowModel {
  return {
    ...state,
    manualDetached: true,
    hasLeftFollowZoneSinceDetach: false,
    followLatest: false,
  };
}

/** Test-local model of removed #708 [queueSessionKey] follow-reset (repro only). */
function legacyQueueSessionKeyFollowReset(
  state: ScrollFollowModel,
  nextQueueSessionKey: string
): ScrollFollowModel {
  if (!nextQueueSessionKey) {
    return { ...state, queueSessionKey: nextQueueSessionKey };
  }
  return {
    ...state,
    queueSessionKey: nextQueueSessionKey,
    manualDetached: false,
    hasLeftFollowZoneSinceDetach: false,
    followLatest: true,
    unseenLatest: false,
  };
}

/** Test-local model of current production: key change only. */
function queueSessionKeyTransition(
  state: ScrollFollowModel,
  nextQueueSessionKey: string
): ScrollFollowModel {
  return { ...state, queueSessionKey: nextQueueSessionKey };
}

/** Test-local model of scrollToFollowOwner guard in TrpgCampaignRoom. */
function passiveFollowScrollAttempt(state: ScrollFollowModel): ScrollFollowModel {
  if (!state.followLatest || state.manualDetached) return state;
  return { ...state, programmaticScrollCount: state.programmaticScrollCount + 1 };
}

/** Test-local model of [snap.id] campaign entry reset. */
function campaignEntryReset(state: ScrollFollowModel): ScrollFollowModel {
  return {
    ...state,
    manualDetached: false,
    hasLeftFollowZoneSinceDetach: false,
    followLatest: true,
    unseenLatest: false,
  };
}

/** Test-local model of scrollToLatest() explicit rejoin — production order. */
function explicitRejoin(state: ScrollFollowModel): ScrollFollowModel {
  const restored = {
    ...state,
    manualDetached: false,
    hasLeftFollowZoneSinceDetach: false,
    followLatest: true,
    unseenLatest: false,
  };
  return passiveFollowScrollAttempt(restored);
}

/** Test-local model of hysteresis rejoin via decidePassiveScrollFollowUpdate. */
function hysteresisRejoin(state: ScrollFollowModel): ScrollFollowModel {
  const update = decidePassiveScrollFollowUpdate({
    manualDetached: state.manualDetached,
    following: state.followLatest,
    nearFollowOwner: true,
    hasLeftFollowZoneSinceDetach: true,
  });
  if (!update.rejoin) return state;
  return {
    ...state,
    manualDetached: false,
    followLatest: true,
    unseenLatest: false,
    hasLeftFollowZoneSinceDetach: false,
    programmaticScrollCount: state.programmaticScrollCount + 1,
  };
}

describe("TRPG scroll-follow lifecycle regression", () => {
  it("REPRO_S3: legacy queueSessionKey effect cleared detach and yanked viewport", () => {
    let state = createModel({ queueSessionKey: "" });
    state = detach(state);
    state = legacyQueueSessionKeyFollowReset(state, ROUND_KEY);
    assert.equal(state.manualDetached, false);
    assert.equal(state.followLatest, true);
    state = passiveFollowScrollAttempt(state);
    assert.equal(state.programmaticScrollCount, 1);
  });

  it("FIX_S3: ready transition preserves manual detach and blocks programmatic scroll", () => {
    let state = createModel({ queueSessionKey: "" });
    state = detach(state);
    state = queueSessionKeyTransition(state, ROUND_KEY);
    assert.equal(state.manualDetached, true);
    assert.equal(state.followLatest, false);
    state = passiveFollowScrollAttempt(state);
    assert.equal(state.programmaticScrollCount, 0);
  });

  it("first entry auto-follow preserved", () => {
    let state = createModel({ manualDetached: true, followLatest: false });
    state = campaignEntryReset(state);
    state = passiveFollowScrollAttempt(state);
    assert.equal(state.followLatest, true);
    assert.equal(state.manualDetached, false);
    assert.equal(state.programmaticScrollCount, 1);
  });

  it("following user keeps auto-follow across ready transition", () => {
    let state = createModel({ queueSessionKey: "" });
    state = queueSessionKeyTransition(state, ROUND_KEY);
    state = passiveFollowScrollAttempt(state);
    assert.equal(state.followLatest, true);
    assert.equal(state.programmaticScrollCount, 1);
  });

  it("detached user survives passive activity, growth, and round key changes", () => {
    let state = detach(createModel({ queueSessionKey: "2|live-cinematic" }));
    state = queueSessionKeyTransition(state, "3|live-cinematic");
    assert.equal(state.manualDetached, true);
    assert.equal(state.followLatest, false);
    const growth = decideLiveFollowOnGrowth({ following: state.followLatest });
    assert.equal(growth.autoFollow, false);
    for (let i = 0; i < 5; i += 1) {
      state = passiveFollowScrollAttempt(state);
    }
    assert.equal(state.programmaticScrollCount, 0);
  });

  it("passive hysteresis no longer auto-rejoins — explicit scrollToLatest only", () => {
    let hysteresis = hysteresisRejoin({
      ...detach(createModel()),
      hasLeftFollowZoneSinceDetach: true,
    });
    assert.equal(hysteresis.manualDetached, true);
    assert.equal(hysteresis.followLatest, false);
    assert.equal(hysteresis.programmaticScrollCount, 0);

    let explicit = explicitRejoin(detach(createModel()));
    assert.equal(explicit.manualDetached, false);
    assert.equal(explicit.followLatest, true);
    assert.equal(explicit.programmaticScrollCount, 1);
  });

  it("USER_MANUAL_SCROLL_DETACH beats passive presentation state", () => {
    let state = queueSessionKeyTransition(detach(createModel()), ROUND_KEY);
    const activity = decideLiveFollowUpdate({
      following: state.followLatest,
      activityChanged: true,
    });
    assert.equal(activity.autoFollow, false);
    assert.equal(activity.unseenLatest, true);
    state = passiveFollowScrollAttempt(state);
    assert.equal(state.programmaticScrollCount, 0);
  });

  it("QUEUE_SESSION_FOLLOW_RESET_OWNER removed from TrpgCampaignRoom", () => {
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.doesNotMatch(
      room,
      /useLayoutEffect\(\(\) => \{[\s\S]*queueSessionKey[\s\S]*manualScrollDetachedRef\.current = false[\s\S]*\}, \[queueSessionKey\]\)/
    );
    assert.doesNotMatch(
      readFileSync("src/lib/trpg/followLatest.ts", "utf8"),
      /TrpgScrollFollowLifecycleState|applyLegacyQueueSessionKeyFollowReset|applyQueueSessionKeyTransition/
    );
  });
});
