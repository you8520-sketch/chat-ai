import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createLiveReadingFollowController,
  LIVE_FOLLOW_MAX_CATCHUP_SPEED_PX_PER_SEC,
} from "./liveReadingFollow";
import { resolveChatLiveFollowMotionProfile } from "./chatLiveFollow";

const VIEWPORT_HEIGHT = 800;
const TARGET_Y = VIEWPORT_HEIGHT * 0.63;
const RENDERED_LINE_PX = 26;

type TestFrameQueue = {
  pending: FrameRequestCallback[];
  nowMs: number;
};

function createFrameClock(): TestFrameQueue & {
  requestAnimationFrame: (fn: FrameRequestCallback) => number;
  cancelAnimationFrame: () => void;
  drive: (count: number) => void;
} {
  const pending: FrameRequestCallback[] = [];
  let nowMs = 0;
  return {
    pending,
    get nowMs() {
      return nowMs;
    },
    requestAnimationFrame: (fn) => {
      pending.push(fn);
      return pending.length;
    },
    cancelAnimationFrame: () => {
      pending.length = 0;
    },
    drive: (count) => {
      for (let frame = 0; frame < count; frame += 1) {
        const tick = pending.shift();
        if (!tick) break;
        nowMs += 1000 / 60;
        tick(nowMs);
      }
    },
  };
}

function createGeometryFollowHarness(opts?: { shouldFollow?: () => boolean }) {
  let scrollY = 0;
  let targetDocumentY = TARGET_Y;
  const appliedScrolls: number[] = [];
  const clock = createFrameClock();
  const controller = createLiveReadingFollowController({
    getViewportHeight: () => VIEWPORT_HEIGHT,
    getScrollPosition: () => scrollY,
    scrollBy: (requestedDelta) => {
      appliedScrolls.push(requestedDelta);
      scrollY += requestedDelta;
    },
    resolveTargetElement: () =>
      ({
        getBoundingClientRect: () => ({ top: targetDocumentY - scrollY }),
      }) as Element,
    shouldFollow: opts?.shouldFollow ?? (() => true),
    isContentGrowing: () => true,
    motionProfile: resolveChatLiveFollowMotionProfile({
      streamIntervalMs: 16,
      streamCharsPerTick: 1,
    }),
    getMotionProfile: () =>
      resolveChatLiveFollowMotionProfile({
        streamIntervalMs: 16,
        streamCharsPerTick: 1,
      }),
    requestAnimationFrame: clock.requestAnimationFrame,
    cancelAnimationFrame: clock.cancelAnimationFrame,
  });

  return {
    controller,
    appliedScrolls,
    get scrollY() {
      return scrollY;
    },
    setTargetDocumentY(value: number) {
      targetDocumentY = value;
    },
    driveUntilIdle(maxFrames = 180) {
      let framesRun = 0;
      for (let frame = 0; frame < maxFrames; frame += 1) {
        if (clock.pending.length === 0) break;
        clock.drive(1);
        framesRun += 1;
      }
      return { framesRun, queueLength: clock.pending.length };
    },
  };
}

describe("general chat geometry-damped follow regression", () => {
  it("uses geometry-damped profile independent of reveal cadence", () => {
    const fast = resolveChatLiveFollowMotionProfile({
      streamIntervalMs: 16,
      streamCharsPerTick: 1,
    });
    const normal = resolveChatLiveFollowMotionProfile({
      streamIntervalMs: 40,
      streamCharsPerTick: 1,
    });
    assert.deepEqual(fast, { mode: "geometry-damped", downwardOnly: true });
    assert.deepEqual(normal, fast);
  });

  it("stays still while the rendered target does not grow", () => {
    const harness = createGeometryFollowHarness();
    harness.controller.notifyTargetUpdate();
    harness.driveUntilIdle();
    assert.deepEqual(harness.appliedScrolls, []);
    harness.controller.stop();
  });

  it("leaves a manually detached viewport parked even when the target grows", () => {
    let attached = true;
    const harness = createGeometryFollowHarness({ shouldFollow: () => attached });
    harness.setTargetDocumentY(TARGET_Y + RENDERED_LINE_PX);
    harness.controller.notifyTargetUpdate();
    attached = false;
    harness.driveUntilIdle();
    assert.deepEqual(harness.appliedScrolls, []);
    harness.controller.stop();
  });

  it("follows one rendered line without micro-crawl while target is stationary", () => {
    const harness = createGeometryFollowHarness();
    harness.setTargetDocumentY(TARGET_Y + RENDERED_LINE_PX);
    harness.controller.notifyTargetUpdate();
    harness.driveUntilIdle(90);
    const afterLine = [...harness.appliedScrolls];
    harness.driveUntilIdle(120);
    assert.ok(afterLine.length > 0);
    assert.ok(afterLine.every((step) => step > 0));
    assert.ok(
      afterLine.every(
        (step) => step <= LIVE_FOLLOW_MAX_CATCHUP_SPEED_PX_PER_SEC / 60 + 1
      )
    );
    assert.ok(
      harness.scrollY >= RENDERED_LINE_PX - 8 && harness.scrollY <= RENDERED_LINE_PX + 4,
      `scrollY=${harness.scrollY}`
    );
    assert.equal(harness.appliedScrolls.length, afterLine.length, "no extra crawl after settle");
    harness.controller.stop();
  });

  it("never issues an upward programmatic correction", () => {
    const harness = createGeometryFollowHarness();
    harness.setTargetDocumentY(TARGET_Y - 10);
    harness.controller.notifyTargetUpdate();
    harness.driveUntilIdle();
    assert.deepEqual(harness.appliedScrolls, []);
    harness.controller.stop();
  });
});
