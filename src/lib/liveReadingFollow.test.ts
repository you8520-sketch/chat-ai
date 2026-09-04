import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeLiveFollowFrameStep,
  createLiveReadingFollowController,
  LIVE_READING_TARGET_RATIO,
  measureScrollMotionContinuity,
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
      scrollBy: (delta) => {
        scrollY += delta;
        endTop -= delta;
        samples.push({ t: raf.nowMs, scrollY });
      },
      resolveTargetElement: () => el,
      shouldFollow: () => true,
      isContentGrowing: () => true,
      motionProfile: { mode: "continuous-flow", targetSmoothingTimeSec: 0.5 },
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
    assert.equal(metrics.stopStartOscillation, false);
    controller.stop();
    assert.equal(controller.isRunning(), false);
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

  it("measureScrollMotionContinuity flags stop-start oscillation", () => {
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
