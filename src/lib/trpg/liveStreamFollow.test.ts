import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  TRPG_LIVE_READING_MAX_RATIO,
  TRPG_LIVE_READING_MIN_RATIO,
  TRPG_LIVE_READING_TARGET_RATIO,
  narrationFollowDeltaPx,
} from "./followLatest";
import {
  computeLiveFollowFrameStep,
  computeLiveFollowVelocityPxPerSec,
} from "../liveReadingFollow";
import {
  createEmptyActiveDeclarationEndRef,
  createLiveStreamFollowController,
  resolveActorScopedDeclarationEnd,
  TRPG_LIVE_FOLLOW_BASE_SPEED_PX_PER_SEC,
  TRPG_LIVE_FOLLOW_MAX_CATCHUP_SPEED_PX_PER_SEC,
} from "./liveStreamFollow";

describe("live stream follow reading band", () => {
  it("targets approximately 63% viewport height on desktop", () => {
    const viewportHeight = 1000;
    const endTop = 780;
    const delta = narrationFollowDeltaPx({ endTop, viewportHeight });
    assert.equal(delta, 780 - viewportHeight * TRPG_LIVE_READING_TARGET_RATIO);
    assert.equal(TRPG_LIVE_READING_TARGET_RATIO, 0.63);
    assert.ok(TRPG_LIVE_READING_MIN_RATIO <= TRPG_LIVE_READING_TARGET_RATIO);
    assert.ok(TRPG_LIVE_READING_TARGET_RATIO <= TRPG_LIVE_READING_MAX_RATIO);
    const targetTop = endTop - delta;
    assert.ok(Math.abs(targetTop / viewportHeight - 0.63) < 0.001);
  });
});

describe("actor-scoped declaration end owner", () => {
  it("never resolves Bot1 sentinel when Bot2 is active", () => {
    const bot1 = { id: 1 } as HTMLSpanElement;
    const bot2 = { id: 2 } as HTMLSpanElement;
    const staleRef = { actorId: 1, element: bot1 };
    const resolved = resolveActorScopedDeclarationEnd({
      activeActorId: 2,
      ref: staleRef,
      queryScopedElement: (id) => (id === 2 ? bot2 : null),
    });
    assert.equal(resolved, bot2);
  });

  it("clears stale ref when actor id mismatches", () => {
    const ref = createEmptyActiveDeclarationEndRef();
    ref.actorId = 1;
    ref.element = { id: 1 } as HTMLSpanElement;
    const resolved = resolveActorScopedDeclarationEnd({
      activeActorId: 2,
      ref,
      queryScopedElement: () => null,
    });
    assert.equal(resolved, null);
  });
});

describe("continuous live follow animator", () => {
  it("moves with velocity-limited steps and converges without per-tick full delta jumps", () => {
    let scrollY = 0;
    let endTop = 900;
    const viewportHeight = 1000;
    let nowMs = 0;
    const el = {
      getBoundingClientRect: () => ({ top: endTop }),
    } as Element;

    const controller = createLiveStreamFollowController({
      getViewportHeight: () => viewportHeight,
      scrollBy: (delta) => {
        scrollY += delta;
        endTop -= delta;
      },
      resolveTargetElement: () => el,
      shouldFollow: () => true,
      baseSpeedPxPerSec: TRPG_LIVE_FOLLOW_BASE_SPEED_PX_PER_SEC,
      maxCatchUpSpeedPxPerSec: TRPG_LIVE_FOLLOW_MAX_CATCHUP_SPEED_PX_PER_SEC,
      requestAnimationFrame: (fn) => {
        nowMs += 16;
        fn(nowMs);
        return nowMs;
      },
      cancelAnimationFrame: () => {},
      now: () => nowMs,
    });

    controller.notifyTargetUpdate();
    const maxStep = TRPG_LIVE_FOLLOW_MAX_CATCHUP_SPEED_PX_PER_SEC * (16 / 1000) + 1;
    for (let i = 0; i < 120; i += 1) {
      const before = scrollY;
      controller.notifyTargetUpdate();
      const step = scrollY - before;
      if (step !== 0) assert.ok(Math.abs(step) <= maxStep);
    }
    assert.ok(Math.abs(endTop - viewportHeight * TRPG_LIVE_READING_TARGET_RATIO) < 12);
    controller.stop();
    assert.equal(controller.isRunning(), false);
  });

  it("manual detach cancels immediately", () => {
    let following = true;
    let scrollY = 0;
    let pending: FrameRequestCallback | null = null;
    const controller = createLiveStreamFollowController({
      getViewportHeight: () => 1000,
      scrollBy: (delta) => {
        scrollY += delta;
      },
      resolveTargetElement: () =>
        ({
          getBoundingClientRect: () => ({ top: 900 }),
        }) as Element,
      shouldFollow: () => following,
      requestAnimationFrame: (fn) => {
        pending = fn;
        return 1;
      },
      cancelAnimationFrame: () => {
        pending = null;
      },
      now: () => 16,
    });
    controller.notifyTargetUpdate();
    assert.equal(pending != null, true);
    pending?.(16);
    assert.equal(controller.isRunning(), true);
    following = false;
    controller.stop();
    const before = scrollY;
    controller.notifyTargetUpdate();
    pending?.(16);
    assert.equal(scrollY, before);
    assert.equal(controller.isRunning(), false);
  });

  it("frame step respects velocity cap", () => {
    const step = computeLiveFollowFrameStep({
      remainingDeltaPx: 500,
      dtSec: 1 / 60,
      viewportHeight: 1000,
    });
    const speed = computeLiveFollowVelocityPxPerSec({
      remainingDeltaPx: 500,
      viewportHeight: 1000,
    });
    assert.ok(Math.abs(step) <= speed * (1 / 60) + 0.001);
  });
});
