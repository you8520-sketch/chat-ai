import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  capLiveFollowFrameStep,
  computeLiveFollowFrameStep,
  computeNaturalCruiseVelocityPxPerSec,
  createLiveReadingFollowController,
  estimateVerticalGrowthPxPerSec,
  LIVE_FOLLOW_MAX_CATCHUP_SPEED_PX_PER_SEC,
  LIVE_READING_TARGET_RATIO,
  measureScrollMotionContinuity,
  resolveTargetDocumentY,
  type MotionSample,
} from "./liveReadingFollow";

function createQueuedRaf() {
  const queue: FrameRequestCallback[] = [];
  let nowMs = 0;
  return {
    requestAnimationFrame: (fn: FrameRequestCallback) => {
      queue.push(fn);
      return queue.length;
    },
    cancelAnimationFrame: () => {
      queue.length = 0;
    },
    flush(count = 1) {
      for (let i = 0; i < count; i += 1) {
        const fn = queue.shift();
        if (!fn) break;
        nowMs += 16;
        fn(nowMs);
      }
    },
    get nowMs() {
      return nowMs;
    },
  };
}

describe("liveReadingFollow continuous motion", () => {
  it("resolveTargetDocumentY is scroll-independent for growth measurement", () => {
    const el = {
      getBoundingClientRect: () => ({ top: 400 }),
    } as Element;
    assert.equal(resolveTargetDocumentY({ element: el, scrollY: 100 }), 500);
    assert.equal(resolveTargetDocumentY({ element: el, scrollY: 200 }), 600);
  });

  it("natural cruise stays near prose growth for 28/40ms presets", () => {
    const fast = estimateVerticalGrowthPxPerSec(28, 4);
    const normal = estimateVerticalGrowthPxPerSec(40, 4);
    assert.ok(fast > normal);
    assert.ok(fast < 200, `fast=${fast}`);
    assert.ok(normal < 150, `normal=${normal}`);
    const cruise = computeNaturalCruiseVelocityPxPerSec({
      measuredGrowthPxPerSec: fast,
      streamIntervalMs: 28,
      charsPerTick: 4,
    });
    assert.ok(cruise <= fast * 0.95);
    assert.ok(cruise < 140, "must not use legacy 140px/s min cruise floor");
  });

  it("capLiveFollowFrameStep enforces canonical max catch-up on every step", () => {
    const dtSec = 1 / 60;
    const capped = capLiveFollowFrameStep({
      step: 500,
      dtSec,
      maxCatchUpSpeedPxPerSec: LIVE_FOLLOW_MAX_CATCHUP_SPEED_PX_PER_SEC,
    });
    assert.ok(Math.abs(capped) <= LIVE_FOLLOW_MAX_CATCHUP_SPEED_PX_PER_SEC * dtSec + 0.001);
  });

  it("continuous-flow keeps RAF alive between discrete sentinel jumps", () => {
    let scrollY = 0;
    let endTop = 500;
    const viewportHeight = 800;
    const samples: MotionSample[] = [{ t: 0, scrollY: 0 }];
    const raf = createQueuedRaf();
    const el = {
      getBoundingClientRect: () => ({ top: endTop }),
    } as Element;

    const controller = createLiveReadingFollowController({
      getViewportHeight: () => viewportHeight,
      getScrollPosition: () => scrollY,
      scrollBy: (delta) => {
        scrollY += delta;
        endTop -= delta;
        samples.push({ t: raf.nowMs, scrollY });
      },
      resolveTargetElement: () => el,
      shouldFollow: () => true,
      isContentGrowing: () => true,
      motionProfile: {
        mode: "continuous-flow",
        targetSmoothingTimeSec: 0.5,
        streamIntervalMs: 28,
        streamCharsPerTick: 4,
      },
      requestAnimationFrame: raf.requestAnimationFrame,
      cancelAnimationFrame: raf.cancelAnimationFrame,
    });

    controller.notifyTargetUpdate();
    raf.flush(30);
    assert.equal(controller.isRunning(), true);

    endTop += 28;
    controller.notifyTargetUpdate();
    raf.flush(40);

    const metrics = measureScrollMotionContinuity(samples);
    assert.ok(metrics.motionDutyCycle > 0.5, `duty=${metrics.motionDutyCycle}`);
    assert.equal(metrics.directionReversalCount, 0);
    assert.equal(metrics.stopStartOscillation, false);
    controller.stop();
    assert.equal(controller.isRunning(), false);
  });

  it("continuous-flow does not scroll upward when ahead of target band", () => {
    let scrollY = 0;
    let endTop = 400;
    const viewportHeight = 800;
    const raf = createQueuedRaf();
    const el = {
      getBoundingClientRect: () => ({ top: endTop }),
    } as Element;

    const controller = createLiveReadingFollowController({
      getViewportHeight: () => viewportHeight,
      getScrollPosition: () => scrollY,
      scrollBy: (delta) => {
        scrollY += delta;
        endTop -= delta;
      },
      resolveTargetElement: () => el,
      shouldFollow: () => true,
      isContentGrowing: () => true,
      motionProfile: { mode: "continuous-flow", streamIntervalMs: 28, streamCharsPerTick: 4 },
      requestAnimationFrame: raf.requestAnimationFrame,
      cancelAnimationFrame: raf.cancelAnimationFrame,
    });

    controller.notifyTargetUpdate();
    raf.flush(20);
    assert.ok(scrollY >= 0);
    controller.stop();
  });

  it("stepwise-chase stops RAF when delta reaches zero", () => {
    let scrollY = 0;
    const viewportHeight = 800;
    const raf = createQueuedRaf();
    const el = {
      getBoundingClientRect: () => ({ top: viewportHeight * LIVE_READING_TARGET_RATIO }),
    } as Element;

    const controller = createLiveReadingFollowController({
      getViewportHeight: () => viewportHeight,
      scrollBy: (delta) => {
        scrollY += delta;
      },
      resolveTargetElement: () => el,
      shouldFollow: () => true,
      requestAnimationFrame: raf.requestAnimationFrame,
      cancelAnimationFrame: raf.cancelAnimationFrame,
    });

    controller.notifyTargetUpdate();
    raf.flush(1);
    assert.equal(controller.isRunning(), false);
    assert.equal(scrollY, 0);
  });

  it("measureScrollMotionContinuity flags stop-start oscillation and direction reversals", () => {
    const samples: MotionSample[] = [];
    let t = 0;
    let scrollY = 0;
    for (let cycle = 0; cycle < 5; cycle += 1) {
      for (let i = 0; i < 4; i += 1) {
        scrollY += 10;
        samples.push({ t, scrollY });
        t += 16;
      }
      samples.push({ t: t + 500, scrollY });
      t += 500;
    }
    const metrics = measureScrollMotionContinuity(samples);
    assert.ok(metrics.maxVisibleStopGapMs >= 300);
    assert.equal(metrics.stopStartOscillation, true);

    const pingPong: MotionSample[] = [{ t: 0, scrollY: 0 }];
    let y = 0;
    for (let i = 1; i <= 30; i += 1) {
      y += i % 2 === 0 ? -12 : 12;
      pingPong.push({ t: i * 16, scrollY: y });
    }
    const reversed = measureScrollMotionContinuity(pingPong);
    assert.ok(reversed.directionReversalCount >= 1);
  });

  it("computeLiveFollowFrameStep caps per-frame catch-up", () => {
    const step = computeLiveFollowFrameStep({
      remainingDeltaPx: 400,
      dtSec: 1 / 60,
      viewportHeight: 800,
    });
    assert.ok(Math.abs(step) <= 260 / 60 + 1);
  });
});
