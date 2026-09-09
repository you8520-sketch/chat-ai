import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createIntegerScrollDebtTransport } from "./integerScrollTransport";
import {
  computeNaturalCruiseVelocityPxPerSec,
  createLiveReadingFollowController,
  estimateLineWrapIntervalMs,
  estimateVerticalGrowthPxPerSec,
  LIVE_FOLLOW_MAX_CATCHUP_SPEED_PX_PER_SEC,
  type LiveReadingFollowController,
} from "./liveReadingFollow";
import {
  type ChatLiveFollowMotionPrefs,
  resolveChatLiveFollowMotionProfile,
} from "./chatLiveFollow";

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

function createRenderedTargetChaseHarness(
  prefs: ChatLiveFollowMotionPrefs,
  opts?: { shouldFollow?: () => boolean }
) {
  let scrollY = 0;
  let targetDocumentY = TARGET_Y;
  const appliedScrolls: number[] = [];
  const transport = createIntegerScrollDebtTransport((delta) => {
    appliedScrolls.push(delta);
    scrollY += delta;
  });
  const clock = createFrameClock();
  const controller: LiveReadingFollowController = createLiveReadingFollowController({
    getViewportHeight: () => VIEWPORT_HEIGHT,
    getScrollPosition: () => scrollY,
    scrollBy: (requestedDelta) => {
      transport.apply(requestedDelta);
    },
    resolveTargetElement: () =>
      ({
        getBoundingClientRect: () => ({ top: targetDocumentY - scrollY }),
      }) as Element,
    shouldFollow: opts?.shouldFollow ?? (() => true),
    isContentGrowing: () => true,
    motionProfile: resolveChatLiveFollowMotionProfile(prefs),
    getMotionProfile: () =>
      resolveChatLiveFollowMotionProfile(prefs),
    requestAnimationFrame: clock.requestAnimationFrame,
    cancelAnimationFrame: clock.cancelAnimationFrame,
  });

  return {
    controller,
    appliedScrolls,
    get scrollY() {
      return scrollY;
    },
    get targetDocumentY() {
      return targetDocumentY;
    },
    setTargetDocumentY(value: number) {
      targetDocumentY = value;
    },
    driveUntilIdle(maxFrames = 120) {
      let framesRun = 0;
      for (let frame = 0; frame < maxFrames; frame += 1) {
        if (clock.pending.length === 0) break;
        clock.drive(1);
        framesRun += 1;
      }
      return {
        framesRun,
        queueLength: clock.pending.length,
      };
    },
    queuedFrameCount() {
      return clock.pending.length;
    },
  };
}

describe("general chat target-chase regression", () => {
  it("uses shared target-chase motion and preserves both production reveal speeds", () => {
    const fastPrefs = { streamIntervalMs: 28, streamCharsPerTick: 1 };
    const normalPrefs = { streamIntervalMs: 40, streamCharsPerTick: 1 };
    assert.deepEqual(resolveChatLiveFollowMotionProfile(fastPrefs), {
      mode: "stepwise-chase",
      streamIntervalMs: 28,
      streamCharsPerTick: 1,
      downwardOnly: true,
    });
    assert.deepEqual(resolveChatLiveFollowMotionProfile(normalPrefs), {
      mode: "stepwise-chase",
      streamIntervalMs: 40,
      streamCharsPerTick: 1,
      downwardOnly: true,
    });

    const fastGrowth = estimateVerticalGrowthPxPerSec(28, 1);
    const normalGrowth = estimateVerticalGrowthPxPerSec(40, 1);
    assert.equal(fastGrowth.toFixed(3), "22.109");
    assert.equal(normalGrowth.toFixed(3), "15.476");
    assert.equal(
      computeNaturalCruiseVelocityPxPerSec({
        measuredGrowthPxPerSec: fastGrowth,
        streamIntervalMs: 28,
        charsPerTick: 1,
      }).toFixed(3),
      "19.898"
    );
    assert.equal(
      computeNaturalCruiseVelocityPxPerSec({
        measuredGrowthPxPerSec: normalGrowth,
        streamIntervalMs: 40,
        charsPerTick: 1,
      }).toFixed(3),
      "13.929"
    );
    assert.equal(estimateLineWrapIntervalMs(28, 1), 1176);
    assert.equal(estimateLineWrapIntervalMs(40, 1), 1680);
  });

  it("stays still while the rendered target does not grow", () => {
    const harness = createRenderedTargetChaseHarness({
      streamIntervalMs: 28,
      streamCharsPerTick: 1,
    });

    harness.controller.notifyTargetUpdate();
    harness.driveUntilIdle(180);

    assert.deepEqual(harness.appliedScrolls, []);
    assert.equal(harness.controller.isRunning(), false);
    harness.controller.stop();
  });

  it("leaves a manually detached viewport parked even when the target grows", () => {
    let attached = true;
    const harness = createRenderedTargetChaseHarness(
      {
        streamIntervalMs: 28,
        streamCharsPerTick: 1,
      },
      { shouldFollow: () => attached }
    );
    harness.setTargetDocumentY(TARGET_Y + RENDERED_LINE_PX);

    harness.controller.notifyTargetUpdate();
    attached = false;
    harness.driveUntilIdle();

    assert.deepEqual(harness.appliedScrolls, []);
    assert.equal(harness.controller.isRunning(), false);
    harness.controller.stop();
  });

  it("chases one rendered line in a bounded episode and then settles", () => {
    const harness = createRenderedTargetChaseHarness({
      streamIntervalMs: 28,
      streamCharsPerTick: 1,
    });
    harness.setTargetDocumentY(TARGET_Y + RENDERED_LINE_PX);

    harness.controller.notifyTargetUpdate();
    const episode = harness.driveUntilIdle();

    assert.ok(harness.appliedScrolls.length > 1);
    assert.ok(harness.appliedScrolls.every((step) => step > 0));
    assert.ok(
      harness.appliedScrolls.every(
        (step) => step <= LIVE_FOLLOW_MAX_CATCHUP_SPEED_PX_PER_SEC / 60 + 1
      )
    );
    assert.ok(episode.framesRun <= 30, `framesRun=${episode.framesRun}`);
    assert.ok(
      harness.scrollY >= RENDERED_LINE_PX - 6 && harness.scrollY <= RENDERED_LINE_PX + 2,
      `scrollY=${harness.scrollY}`
    );
    assert.equal(harness.controller.isRunning(), false);
    harness.controller.stop();
  });

  it("coalesces rapid layout growth in the same canonical chase owner", () => {
    const harness = createRenderedTargetChaseHarness({
      streamIntervalMs: 28,
      streamCharsPerTick: 1,
    });
    const initialTarget = harness.targetDocumentY;
    harness.setTargetDocumentY(initialTarget + RENDERED_LINE_PX);

    harness.controller.notifyTargetUpdate();
    harness.driveUntilIdle(1);
    assert.equal(harness.queuedFrameCount(), 1);

    harness.setTargetDocumentY(initialTarget + RENDERED_LINE_PX * 2);
    harness.controller.notifyTargetUpdate();
    assert.equal(
      harness.queuedFrameCount(),
      1,
      "rapid growth must reuse the running chase rather than spawn another animator"
    );
    harness.driveUntilIdle();

    assert.ok(harness.appliedScrolls.every((step) => step > 0));
    assert.ok(
      harness.scrollY >= RENDERED_LINE_PX * 2 - 6 &&
        harness.scrollY <= RENDERED_LINE_PX * 2 + 2,
      `scrollY=${harness.scrollY}`
    );
    assert.equal(harness.controller.isRunning(), false);
    harness.controller.stop();
  });

  it("never issues an upward programmatic correction", () => {
    const harness = createRenderedTargetChaseHarness({
      streamIntervalMs: 28,
      streamCharsPerTick: 1,
    });
    harness.setTargetDocumentY(TARGET_Y - 10);

    harness.controller.notifyTargetUpdate();
    harness.driveUntilIdle();

    assert.deepEqual(harness.appliedScrolls, []);
    assert.equal(harness.controller.isRunning(), false);
    harness.controller.stop();
  });
});
