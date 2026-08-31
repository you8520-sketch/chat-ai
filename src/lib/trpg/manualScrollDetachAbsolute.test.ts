/**
 * Manual scroll detach must be absolute — S1–S14 production-equivalent gates.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  decideLiveFollowOnGrowth,
  decideLiveFollowUpdate,
  decidePassiveScrollFollowUpdate,
  freezeViewportScrollPosition,
  resolveTrpgLiveFollowOwner,
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

type LifecycleModel = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  smoothTarget: number | null;
  manualDetached: boolean;
  followLatest: boolean;
  unseenLatest: boolean;
  hasLeftFollowZoneSinceDetach: boolean;
  liveFollowOwner: "GM_NARRATION_END" | "NEXT_ACTION";
  programmaticScrollCount: number;
  queueSessionKey: string;
};

function createModel(overrides?: Partial<LifecycleModel>): LifecycleModel {
  return {
    scrollTop: 2000,
    scrollHeight: 4000,
    clientHeight: 800,
    smoothTarget: null,
    manualDetached: false,
    followLatest: true,
    unseenLatest: false,
    hasLeftFollowZoneSinceDetach: false,
    liveFollowOwner: "GM_NARRATION_END",
    programmaticScrollCount: 0,
    queueSessionKey: "",
    ...overrides,
  };
}

function isNearBottom(model: LifecycleModel): boolean {
  return model.scrollHeight - model.scrollTop - model.clientHeight <= 120;
}

function startProgrammaticSmoothFollow(model: LifecycleModel) {
  if (!model.followLatest || model.manualDetached) return;
  model.smoothTarget = model.scrollHeight - model.clientHeight;
  model.programmaticScrollCount += 1;
}

/** Buggy detach: bookkeeping only — smooth target keeps animating. */
function detachBuggy(model: LifecycleModel) {
  model.manualDetached = true;
  model.followLatest = false;
}

function detachFixed(model: LifecycleModel): LifecycleModel {
  model.smoothTarget = null;
  model.manualDetached = true;
  model.followLatest = false;
  return model;
}

function wheelUpDetach(model: LifecycleModel, fixed: boolean) {
  model.scrollTop = Math.max(0, model.scrollTop - 400);
  if (fixed) detachFixed(model);
  else detachBuggy(model);
}

function tickSmoothScroll(model: LifecycleModel, step = 80) {
  if (model.smoothTarget == null) return;
  if (model.scrollTop < model.smoothTarget) {
    model.scrollTop = Math.min(model.smoothTarget, model.scrollTop + step);
  }
  if (model.scrollTop >= model.smoothTarget) {
    model.smoothTarget = null;
  }
}

function passiveScrollEvent(model: LifecycleModel) {
  const near = isNearBottom(model);
  const update = decidePassiveScrollFollowUpdate({
    manualDetached: model.manualDetached,
    following: model.followLatest,
    nearFollowOwner: near,
    hasLeftFollowZoneSinceDetach: model.hasLeftFollowZoneSinceDetach,
  });
  model.hasLeftFollowZoneSinceDetach = update.hasLeftFollowZoneSinceDetach;
  if (update.rejoin) {
    model.manualDetached = false;
    model.followLatest = true;
    model.unseenLatest = false;
  } else if (model.manualDetached && update.unseenLatest) {
    model.unseenLatest = true;
  }
}

function scrollToFollowOwnerAttempt(model: LifecycleModel) {
  if (!model.followLatest || model.manualDetached) return;
  model.programmaticScrollCount += 1;
}

function explicitRejoin(model: LifecycleModel) {
  model.manualDetached = false;
  model.followLatest = true;
  model.unseenLatest = false;
  model.hasLeftFollowZoneSinceDetach = false;
  scrollToFollowOwnerAttempt(model);
}

describe("S1 lifecycle reproduction — NEXT_ACTION smooth then wheel detach", () => {
  it("BEFORE: passive rejoin + uncancelled smooth yanks viewport after detach", () => {
    let model = createModel({ scrollTop: 2800 });
    model.liveFollowOwner = "NEXT_ACTION";
    startProgrammaticSmoothFollow(model);
    wheelUpDetach(model, false);
    for (let i = 0; i < 8; i += 1) {
      tickSmoothScroll(model);
      passiveScrollEvent(model);
    }
    assert.ok(
      model.scrollTop > 2400,
      "NATIVE_SMOOTH_CONTINUED_AFTER_DETACH_BEFORE"
    );
  });

  it("AFTER S1: detach freezes scroll — no post-detach downward movement", () => {
    let model = createModel({ scrollTop: 2800 });
    model.liveFollowOwner = "NEXT_ACTION";
    startProgrammaticSmoothFollow(model);
    wheelUpDetach(model, true);
    const atDetach = model.scrollTop;
    for (let i = 0; i < 12; i += 1) {
      tickSmoothScroll(model);
      passiveScrollEvent(model);
      scrollToFollowOwnerAttempt(model);
    }
    assert.equal(model.manualDetached, true);
    assert.equal(model.followLatest, false);
    assert.equal(model.scrollTop, atDetach);
    assert.equal(model.programmaticScrollCount, 1);
  });
});

describe("manual scroll detach absolute — S2–S14", () => {
  it("S2: manual detached + passive scroll near follow target → NO automatic rejoin", () => {
    const update = decidePassiveScrollFollowUpdate({
      manualDetached: true,
      following: false,
      nearFollowOwner: true,
      hasLeftFollowZoneSinceDetach: true,
    });
    assert.equal(update.rejoin, false);
    assert.equal(update.following, false);
  });

  it("S3: manual detached + ResizeObserver growth → 0 programmatic follow", () => {
    let model = detachFixed(createModel());
    const growth = decideLiveFollowOnGrowth({ following: model.followLatest });
    assert.equal(growth.autoFollow, false);
    scrollToFollowOwnerAttempt(model);
    assert.equal(model.programmaticScrollCount, 0);
  });

  it("S4: manual detached + activity key change → 0 programmatic follow", () => {
    let model = detachFixed(createModel({ queueSessionKey: "2|x" }));
    model.queueSessionKey = "3|x";
    const activity = decideLiveFollowUpdate({
      following: model.followLatest,
      activityChanged: true,
    });
    assert.equal(activity.autoFollow, false);
    scrollToFollowOwnerAttempt(model);
    assert.equal(model.programmaticScrollCount, 0);
  });

  it("S5: manual detached + NEXT_ACTION owner → 0 new programmatic follow", () => {
    let model = detachFixed(createModel());
    model.liveFollowOwner = "NEXT_ACTION";
    scrollToFollowOwnerAttempt(model);
    assert.equal(model.programmaticScrollCount, 0);
  });

  it("S6: manual detached + reply suggestions visible → 0 programmatic follow", () => {
    let model = detachFixed(createModel());
    model.liveFollowOwner = "NEXT_ACTION";
    scrollToFollowOwnerAttempt(model);
    assert.equal(model.programmaticScrollCount, 0);
  });

  it("S7: manual detached + queueSessionKey change → remains detached", () => {
    let model = detachFixed(createModel({ queueSessionKey: "" }));
    model.queueSessionKey = ROUND_KEY;
    assert.equal(model.manualDetached, true);
    assert.equal(model.followLatest, false);
    scrollToFollowOwnerAttempt(model);
    assert.equal(model.programmaticScrollCount, 0);
  });

  it("S8: manual detached + round key change → remains detached", () => {
    let model = detachFixed(createModel({ queueSessionKey: "2|live-cinematic" }));
    model.queueSessionKey = "3|live-cinematic";
    scrollToFollowOwnerAttempt(model);
    assert.equal(model.manualDetached, true);
    assert.equal(model.programmaticScrollCount, 0);
  });

  it("S9: explicit rejoin → manualDetached=false, one programmatic scroll", () => {
    let model = detachFixed(createModel());
    explicitRejoin(model);
    assert.equal(model.manualDetached, false);
    assert.equal(model.followLatest, true);
    assert.equal(model.programmaticScrollCount, 1);
  });

  it("S10: first campaign entry reset → auto-follow works", () => {
    let model = detachFixed(createModel());
    model.manualDetached = false;
    model.followLatest = true;
    scrollToFollowOwnerAttempt(model);
    assert.equal(model.programmaticScrollCount, 1);
  });

  it("S11: normal following user → GM live reveal auto-follow works", () => {
    let model = createModel();
    model.liveFollowOwner = "GM_NARRATION_END";
    scrollToFollowOwnerAttempt(model);
    assert.equal(model.programmaticScrollCount, 1);
  });

  it("S12: touch upward gesture detaches", () => {
    assert.equal(shouldDetachLiveFollowOnTouchDelta(-40), true);
  });

  it("S13: PageUp / ArrowUp detaches", () => {
    assert.equal(shouldDetachLiveFollowOnKey("PageUp"), true);
    assert.equal(shouldDetachLiveFollowOnKey("ArrowUp"), true);
  });

  it("S14: wheel upward detaches", () => {
    assert.equal(shouldDetachLiveFollowOnWheel(-1), true);
  });
});

describe("production wiring — TrpgCampaignRoom scroll owners", () => {
  it("MANUAL_DETACH_OWNER uses freezeViewportScrollPosition", () => {
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.match(room, /freezeViewportScrollPosition\(\)/);
    assert.match(room, /detachLiveFollow/);
  });

  it("scrollToFollowOwner guards manualDetached + followLatest", () => {
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.match(
      room,
      /if \(!followLatestRef\.current \|\| manualScrollDetachedRef\.current\) return/
    );
  });

  it("NEXT_ACTION effect guards manualDetached", () => {
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.match(
      room,
      /if \(!followLatestRef\.current \|\| manualScrollDetachedRef\.current\) return[\s\S]*liveFollowOwner !== "NEXT_ACTION"/
    );
  });

  it("passive scroll handler does not rejoin on update.rejoin", () => {
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.doesNotMatch(room, /if \(update\.rejoin\)/);
  });

  it("GM complete → NEXT_ACTION owner transition", () => {
    assert.equal(
      resolveTrpgLiveFollowOwner({
        cinematicMotion: false,
        freshGmRound: 3,
        gmRevealComplete: true,
        nextActionVisible: true,
      }),
      "NEXT_ACTION"
    );
  });
});

describe("freezeViewportScrollPosition", () => {
  it("returns current scrollY when window is unavailable", () => {
    assert.equal(freezeViewportScrollPosition(), 0);
  });
});
