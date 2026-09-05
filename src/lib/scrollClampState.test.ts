import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  evaluateContinuousMotionProof,
  IMPLICIT_SCROLL_RANGE_PASS_PATH,
  MIN_AVAILABLE_DOWNWARD_SCROLL_PX,
  MIN_MEANINGFUL_SCROLL_RANGE_PX,
  measureIntegerScrollCadence,
  resolveScrollClampState,
  type MotionProofFrame,
} from "./scrollClampState";

function movingFrames(opts?: { startY?: number; step?: number; count?: number }): MotionProofFrame[] {
  const startY = opts?.startY ?? 40;
  const step = opts?.step ?? 1;
  const count = opts?.count ?? 48;
  return Array.from({ length: count }, (_, i) => ({
    t: i * 16,
    scrollY: startY + i * step,
    endTop: 520 * 0.63,
    remainingDelta: 0,
    followLatest: true,
    manualDetached: false,
  }));
}

function frozenFrames(scrollY = 80): MotionProofFrame[] {
  return Array.from({ length: 40 }, (_, i) => ({
    t: i * 16,
    scrollY,
    endTop: 800,
    remainingDelta: 400,
    followLatest: true,
    manualDetached: false,
  }));
}

describe("scrollClampState motion proof", () => {
  it("never treats implicit scrollRange < 4 as a pass path", () => {
    assert.equal(IMPLICIT_SCROLL_RANGE_PASS_PATH, false);
  });

  it("distinguishes SCROLL_RANGE_LOW from PHYSICALLY_CANNOT_SCROLL", () => {
    const scrollable = resolveScrollClampState({
      scrollHeight: 2000,
      innerHeight: 520,
      scrollY: 80,
      endTop: 800,
    });
    assert.ok(scrollable.AVAILABLE_DOWNWARD_SCROLL_PX >= MIN_AVAILABLE_DOWNWARD_SCROLL_PX);
    assert.equal(scrollable.physicallyCannotScroll, false);
    assert.equal(scrollable.TARGET_REQUIRES_DOWNWARD_SCROLL, true);

    const clamped = resolveScrollClampState({
      scrollHeight: 520,
      innerHeight: 520,
      scrollY: 0,
      endTop: 200,
    });
    assert.ok(clamped.AVAILABLE_DOWNWARD_SCROLL_PX <= 2);
    assert.equal(clamped.physicallyCannotScroll, true);
    assert.equal(clamped.MAX_SCROLL_Y, 0);
  });

  it("fails the broken no-scroll fixture on a scrollable page", () => {
    const startGeometry = resolveScrollClampState({
      scrollHeight: 2200,
      innerHeight: 520,
      scrollY: 40,
      endTop: 900,
    });
    const proof = evaluateContinuousMotionProof({
      frames: frozenFrames(40),
      startGeometry,
      requireMotion: true,
    });
    assert.equal(proof.passed, false);
    assert.equal(proof.classification, "SCROLL_RANGE_LOW");
    assert.ok(proof.reasons.includes("SCROLL_RANGE_LOW"));
    assert.ok(proof.TOTAL_SCROLL_RANGE_PX < MIN_MEANINGFUL_SCROLL_RANGE_PX);
    const BROKEN_NO_SCROLL_FIXTURE_PASSES = proof.passed;
    assert.equal(BROKEN_NO_SCROLL_FIXTURE_PASSES, false);
  });

  it("does not pass zero motion just because scrollRange is low", () => {
    const startGeometry = resolveScrollClampState({
      scrollHeight: 1800,
      innerHeight: 520,
      scrollY: 10,
      endTop: 700,
    });
    const threePx = Array.from({ length: 40 }, (_, i) => ({
      t: i * 16,
      scrollY: 10 + (i > 20 ? 3 : 0),
      endTop: 700,
      remainingDelta: 300,
      followLatest: true,
      manualDetached: false,
    }));
    const proof = evaluateContinuousMotionProof({
      frames: threePx,
      startGeometry,
      requireMotion: true,
    });
    assert.equal(proof.passed, false);
    assert.ok(proof.reasons.includes("SCROLL_RANGE_LOW"));
  });

  it("allows no motion only when geometry proves physical clamp", () => {
    const startGeometry = resolveScrollClampState({
      scrollHeight: 520,
      innerHeight: 520,
      scrollY: 0,
      endTop: 180,
    });
    assert.equal(startGeometry.physicallyCannotScroll, true);
    const proof = evaluateContinuousMotionProof({
      frames: frozenFrames(0),
      startGeometry,
      requireMotion: false,
    });
    assert.equal(proof.classification, "PHYSICALLY_CANNOT_SCROLL");
    assert.equal(proof.passed, true);
  });

  it("still fails a physically clamped geometry when motion is required", () => {
    const startGeometry = resolveScrollClampState({
      scrollHeight: 522,
      innerHeight: 520,
      scrollY: 2,
      endTop: 180,
    });
    const proof = evaluateContinuousMotionProof({
      frames: frozenFrames(2),
      startGeometry,
      requireMotion: true,
    });
    assert.equal(proof.passed, false);
    assert.equal(proof.classification, "FIXTURE_NOT_SCROLLABLE");
  });

  it("passes a healthy continuous downward chase", () => {
    const startGeometry = resolveScrollClampState({
      scrollHeight: 2400,
      innerHeight: 520,
      scrollY: 40,
      endTop: 520 * 0.63,
    });
    const proof = evaluateContinuousMotionProof({
      frames: movingFrames({ startY: 40, step: 1, count: 50 }),
      startGeometry,
      requireMotion: true,
    });
    assert.equal(proof.passed, true, proof.reasons.join(","));
    assert.equal(proof.classification, "MUST_MOVE");
    assert.ok(proof.TOTAL_SCROLL_RANGE_PX >= MIN_MEANINGFUL_SCROLL_RANGE_PX);
    assert.equal(proof.cadence.MEDIAN_POSITIVE_STEP_PX, 1);
    assert.ok(proof.cadence.P95_INTER_STEP_GAP_MS <= 120);
    assert.ok(proof.cadence.MAX_INTER_STEP_GAP_MS <= 200);
    assert.equal(proof.DIRECTION_REVERSAL_COUNT, 0);
    assert.equal(proof.LARGE_JUMP_COUNT, 0);
    assert.equal(proof.FOLLOW_LATEST_ALWAYS_TRUE, true);
    assert.equal(proof.PROGRAMMATIC_SELF_DETACH, false);
  });

  it("measures integer cadence independently from frame duty cycle", () => {
    const metrics = measureIntegerScrollCadence([
      { t: 0, scrollY: 0 },
      { t: 16, scrollY: 0 },
      { t: 48, scrollY: 1 },
      { t: 96, scrollY: 1 },
      { t: 112, scrollY: 2 },
      { t: 176, scrollY: 3 },
    ]);
    assert.equal(metrics.POSITIVE_SCROLL_STEP_COUNT, 3);
    assert.equal(metrics.MEDIAN_POSITIVE_STEP_PX, 1);
    assert.equal(metrics.MEDIAN_INTER_STEP_GAP_MS, 64);
    assert.equal(metrics.P95_INTER_STEP_GAP_MS, 64);
    assert.equal(metrics.MAX_INTER_STEP_GAP_MS, 64);
    assert.equal(metrics.DIRECTION_REVERSAL_COUNT, 0);
    assert.equal(metrics.LARGE_JUMP_COUNT, 0);
  });

  it("separates positive catch-up steps from steady cruise cadence", () => {
    const metrics = measureIntegerScrollCadence([
      { t: 0, scrollY: 0, remainingDelta: 4 },
      { t: 16, scrollY: 1, remainingDelta: 3 },
      { t: 149, scrollY: 1, remainingDelta: 0 },
      { t: 199, scrollY: 2, remainingDelta: -1 },
      { t: 282, scrollY: 3, remainingDelta: -2 },
    ]);
    assert.equal(metrics.POSITIVE_SCROLL_STEP_COUNT, 2);
    assert.equal(metrics.MEDIAN_INTER_STEP_GAP_MS, 83);
    assert.equal(metrics.P95_INTER_STEP_GAP_MS, 83);
    assert.equal(metrics.MAX_INTER_STEP_GAP_MS, 83);
  });
});
