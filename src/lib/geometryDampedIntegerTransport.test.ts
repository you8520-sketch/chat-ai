import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createIntegerScrollDebtTransport } from "@/lib/integerScrollTransport";
import {
  computeGeometryDampedStep,
  createLiveReadingFollowController,
  LIVE_FOLLOW_GEOMETRY_DAMPED_DEFAULT_RATE,
  type GeometryDampedFrameTrace,
} from "@/lib/liveReadingFollow";

const VIEWPORT_HEIGHT = 800;
const TARGET_BAND_Y = VIEWPORT_HEIGHT * 0.63;

type CombinedTrace = GeometryDampedFrameTrace & {
  integerDebt: number;
  appliedIntegerDelta: number;
  logicalMinusPhysical: number;
};

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
    get nowMs() {
      return nowMs;
    },
  };
}

/** Replicates pre-fix residual contract: logical-vs-physical delta into debt transport. */
function runResidualBugHarness(frameCount: number) {
  let physicalScrollY = 0;
  let logicalFloatY = 0;
  let targetDocumentY = TARGET_BAND_Y + 2;
  const traces: CombinedTrace[] = [];
  const transport = createIntegerScrollDebtTransport((delta) => {
    physicalScrollY += delta;
  });
  const dtSec = 1 / 60;
  const slowDampingRate = 3;

  for (let frame = 0; frame < frameCount; frame += 1) {
    targetDocumentY += 0.05;
    const desiredScrollY = targetDocumentY - TARGET_BAND_Y;
    const nextFloat = computeGeometryDampedStep({
      current: logicalFloatY,
      target: Math.max(logicalFloatY, desiredScrollY),
      dtSec,
      dampingRate: slowDampingRate,
    });
    logicalFloatY = nextFloat;
    const residualDelta = logicalFloatY - physicalScrollY;
    const requested = residualDelta > 0 ? residualDelta : 0;
    const appliedIntegerDelta = transport.apply(requested);
    // Pre-fix motor kept floatScrollY at damped logical position; it did not
    // re-sync to physical + applied increment.
    traces.push({
      targetDocumentY,
      logicalFloatCameraY: logicalFloatY,
      requestedDelta: requested,
      appliedPhysicalDelta: appliedIntegerDelta,
      physicalScrollY,
      integerDebt: transport.getDebt(),
      appliedIntegerDelta,
      logicalMinusPhysical: logicalFloatY - physicalScrollY,
    });
  }

  return { traces, physicalScrollY };
}

function runProductionHarness(frameCount: number, opts?: { contentGrowing?: boolean }) {
  let physicalScrollY = 0;
  let targetDocumentY = TARGET_BAND_Y + 40;
  const traces: CombinedTrace[] = [];
  const transport = createIntegerScrollDebtTransport((delta) => {
    physicalScrollY += delta;
  });
  const clock = createFrameClock();
  let lastAppliedIntegerDelta = 0;

  const controller = createLiveReadingFollowController({
    getViewportHeight: () => VIEWPORT_HEIGHT,
    getScrollPosition: () => physicalScrollY,
    scrollBy: (requestedDelta) => {
      lastAppliedIntegerDelta = transport.apply(requestedDelta);
      if (lastAppliedIntegerDelta !== 0) {
        physicalScrollY += lastAppliedIntegerDelta;
      }
    },
    resolveTargetElement: () =>
      ({
        getBoundingClientRect: () => ({ top: targetDocumentY - physicalScrollY }),
      }) as Element,
    shouldFollow: () => true,
    isContentGrowing: () => opts?.contentGrowing ?? true,
    motionProfile: { mode: "geometry-damped", downwardOnly: true },
    onGeometryDampedFrame: (trace) => {
      traces.push({
        ...trace,
        integerDebt: transport.getDebt(),
        appliedIntegerDelta: lastAppliedIntegerDelta,
        logicalMinusPhysical: trace.logicalFloatCameraY - trace.physicalScrollY,
      });
    },
    requestAnimationFrame: clock.requestAnimationFrame,
    cancelAnimationFrame: clock.cancelAnimationFrame,
  });

  controller.notifyTargetUpdate();
  for (let frame = 0; frame < frameCount; frame += 1) {
    targetDocumentY += 0.35;
    clock.driveFrame(1000 / 60);
  }
  controller.stop();
  return { traces, physicalScrollY };
}

describe("geometry-damped + integer transport contract", () => {
  it("BEFORE: residual logical-vs-physical delta accumulates debt and overshoots", () => {
    const { traces } = runResidualBugHarness(120);
    const unappliedDeposits = traces.filter(
      (trace) => trace.requestedDelta > 0 && trace.appliedIntegerDelta === 0
    );
    assert.ok(unappliedDeposits.length >= 15, `unapplied=${unappliedDeposits.length}`);
    const maxDebt = Math.max(...traces.map((trace) => trace.integerDebt));
    assert.ok(maxDebt >= 0.9, `maxDebt=${maxDebt}`);
    const physicalAheadOfLogical = traces.some((trace) => trace.logicalMinusPhysical < -0.5);
    assert.ok(physicalAheadOfLogical, "physical root must leap ahead of logical camera on debt flush");
  });

  it("AFTER: incremental intent keeps logical-physical separation bounded", () => {
    const { traces } = runProductionHarness(120);
    assert.ok(traces.length >= 40);
    assert.ok(
      traces.every((trace) => Math.abs(trace.logicalMinusPhysical) <= 1.001),
      `bound violated: ${traces.map((t) => t.logicalMinusPhysical.toFixed(3)).join(",")}`
    );
    const debtSpikes = traces.filter(
      (trace, index) =>
        index > 0 &&
        trace.integerDebt > traces[index - 1]!.integerDebt + 0.001 &&
        trace.requestedDelta > 0 &&
        traces[index - 1]!.requestedDelta > 0 &&
        Math.abs(trace.requestedDelta - traces[index - 1]!.requestedDelta) < 0.05
    );
    assert.equal(debtSpikes.length, 0, "same incremental intent must not stack debt repeatedly");
  });

  it("AFTER: stationary target emits zero movement intent and no micro-crawl", () => {
    let physicalScrollY = 0;
    const targetDocumentY = TARGET_BAND_Y;
    const transport = createIntegerScrollDebtTransport((delta) => {
      physicalScrollY += delta;
    });
    const clock = createFrameClock();
    const traces: CombinedTrace[] = [];

    const controller = createLiveReadingFollowController({
      getViewportHeight: () => VIEWPORT_HEIGHT,
      getScrollPosition: () => physicalScrollY,
      scrollBy: (requestedDelta) => {
        transport.apply(requestedDelta);
      },
      resolveTargetElement: () =>
        ({
          getBoundingClientRect: () => ({ top: targetDocumentY - physicalScrollY }),
        }) as Element,
      shouldFollow: () => true,
      isContentGrowing: () => false,
      motionProfile: { mode: "geometry-damped", downwardOnly: true },
      onGeometryDampedFrame: (trace) => {
        traces.push({
          ...trace,
          integerDebt: transport.getDebt(),
          appliedIntegerDelta: trace.appliedPhysicalDelta,
          logicalMinusPhysical: trace.logicalFloatCameraY - trace.physicalScrollY,
        });
      },
      requestAnimationFrame: clock.requestAnimationFrame,
      cancelAnimationFrame: clock.cancelAnimationFrame,
    });

    controller.notifyTargetUpdate();
    clock.driveFrame(1000 / 60);
    clock.driveFrame(1000 / 60);
    controller.stop();

    assert.ok(traces.every((trace) => trace.requestedDelta === 0));
    assert.equal(transport.getDebt(), 0);
    assert.equal(physicalScrollY, 0);
  });
});
