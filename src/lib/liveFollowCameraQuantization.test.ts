import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createIntegerScrollDebtTransport } from "@/lib/integerScrollTransport";
import {
  computeNaturalCruiseVelocityPxPerSec,
  createLiveReadingFollowController,
  measureScrollMotionContinuity,
  type MotionSample,
} from "@/lib/liveReadingFollow";
import { measureIntegerScrollCadence } from "@/lib/scrollClampState";

const VIEWPORT_HEIGHT = 800;
const TARGET_Y = VIEWPORT_HEIGHT * 0.63;

function createFrameClock() {
  const pending: FrameRequestCallback[] = [];
  let nowMs = 0;
  return {
    requestAnimationFrame: (fn: FrameRequestCallback) => {
      pending.push(fn);
      return pending.length;
    },
    cancelAnimationFrame: () => {
      pending.length = 0;
    },
    driveFrame(frameDurationMs: number) {
      const fn = pending.shift();
      if (!fn) return;
      nowMs += frameDurationMs;
      fn(nowMs);
    },
    drive(count: number, frameDurationMs = 1000 / 60) {
      for (let i = 0; i < count; i += 1) {
        this.driveFrame(frameDurationMs);
      }
    },
    get nowMs() {
      return nowMs;
    },
    pendingCount() {
      return pending.length;
    },
  };
}

describe("CAMERA stair-step — integer transport quantization proof", () => {
  it("C4 proof: fractional cruise intent becomes 0,0,1,0,0,1 integer pulses", () => {
    const applied: number[] = [];
    const transport = createIntegerScrollDebtTransport((delta) => applied.push(delta));
    const cruisePxPerSec = computeNaturalCruiseVelocityPxPerSec({
      measuredGrowthPxPerSec: 0,
      streamIntervalMs: 16,
      charsPerTick: 1,
    });
    const dtSec = 1 / 60;
    const frameDelta = cruisePxPerSec * dtSec;

    for (let frame = 0; frame < 120; frame += 1) {
      transport.apply(frameDelta);
    }

    assert.ok(applied.length >= 20);
    assert.ok(applied.every((step) => step === 1), `steps=${applied.slice(0, 12).join(",")}`);
    assert.equal(
      applied.filter((step, index) => index > 0 && step > 0 && applied[index - 1] === 0).length,
      0
    );
    const cadence = measureIntegerScrollCadence(
      applied.map((step, index) => ({ t: index * (1000 / 60), scrollY: applied.slice(0, index + 1).reduce((a, b) => a + b, 0) }))
    );
    assert.equal(cadence.MEDIAN_POSITIVE_STEP_PX, 1);
    assert.equal(cadence.P95_POSITIVE_STEP_PX, 1);
  });
});

describe("CAMERA geometry-damped — decoupled smooth follow", () => {
  it("C4/C6: moving target produces continuous motion without 1px-only cadence", () => {
    let scrollY = 0;
    let targetDocumentY = TARGET_Y;
    const samples: MotionSample[] = [{ t: 0, scrollY: 0 }];
    const appliedSteps: number[] = [];
    const clock = createFrameClock();

    const controller = createLiveReadingFollowController({
      getViewportHeight: () => VIEWPORT_HEIGHT,
      getScrollPosition: () => scrollY,
      scrollBy: (delta) => {
        appliedSteps.push(delta);
        scrollY += delta;
        samples.push({ t: clock.nowMs, scrollY });
      },
      resolveTargetElement: () =>
        ({
          getBoundingClientRect: () => ({ top: targetDocumentY - scrollY }),
        }) as Element,
      shouldFollow: () => true,
      isContentGrowing: () => true,
      motionProfile: { mode: "geometry-damped", downwardOnly: true },
      requestAnimationFrame: clock.requestAnimationFrame,
      cancelAnimationFrame: clock.cancelAnimationFrame,
    });

    controller.notifyTargetUpdate();
    for (let frame = 0; frame < 30; frame += 1) {
      clock.drive(1);
    }
    targetDocumentY += 26;
    controller.notifyTargetUpdate();
    for (let frame = 0; frame < 90; frame += 1) {
      clock.drive(1);
    }

    const cadence = measureIntegerScrollCadence(samples.map((s) => ({ t: s.t, scrollY: s.scrollY })));
    const metrics = measureScrollMotionContinuity(samples);

    assert.ok(appliedSteps.some((step) => step > 1 && step < 8), "expected sub-catch-up fractional steps");
    assert.ok(cadence.P95_POSITIVE_STEP_PX > 1 || metrics.motionDutyCycle > 0.85);
    assert.equal(metrics.directionReversalCount, 0);
    controller.stop();
  });

  it("C5: stationary target generates no scroll", () => {
    let scrollY = 0;
    const applied: number[] = [];
    const clock = createFrameClock();
    const controller = createLiveReadingFollowController({
      getViewportHeight: () => VIEWPORT_HEIGHT,
      getScrollPosition: () => scrollY,
      scrollBy: (delta) => {
        applied.push(delta);
        scrollY += delta;
      },
      resolveTargetElement: () =>
        ({
          getBoundingClientRect: () => ({ top: TARGET_Y - scrollY }),
        }) as Element,
      shouldFollow: () => true,
      isContentGrowing: () => false,
      motionProfile: { mode: "geometry-damped", downwardOnly: true },
      requestAnimationFrame: clock.requestAnimationFrame,
      cancelAnimationFrame: clock.cancelAnimationFrame,
    });

    controller.notifyTargetUpdate();
    clock.drive(120);
    assert.deepEqual(applied, []);
    controller.stop();
  });

  it("C7: 60Hz vs 120Hz share the same elapsed-time trajectory", () => {
    const durationMs = 900;

    function runSampled(frameDurationMs: number) {
      let scrollY = 0;
      let targetDocumentY = TARGET_Y + 120;
      const clock = createFrameClock();
      const controller = createLiveReadingFollowController({
        getViewportHeight: () => VIEWPORT_HEIGHT,
        getScrollPosition: () => scrollY,
        scrollBy: (delta) => {
          scrollY += delta;
        },
        resolveTargetElement: () =>
          ({
            getBoundingClientRect: () => ({ top: targetDocumentY - scrollY }),
          }) as Element,
        shouldFollow: () => true,
        isContentGrowing: () => true,
        motionProfile: { mode: "geometry-damped", downwardOnly: true },
        requestAnimationFrame: clock.requestAnimationFrame,
        cancelAnimationFrame: clock.cancelAnimationFrame,
      });
      controller.notifyTargetUpdate();
      let elapsedMs = 0;
      while (elapsedMs < durationMs) {
        clock.driveFrame(frameDurationMs);
        elapsedMs += frameDurationMs;
      }
      controller.stop();
      return scrollY;
    }

    const at60 = runSampled(1000 / 60);
    const at120 = runSampled(1000 / 120);
    assert.ok(Math.abs(at60 - at120) <= 8, `60=${at60} 120=${at120}`);
  });
});
