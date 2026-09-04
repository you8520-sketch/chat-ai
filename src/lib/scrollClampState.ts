/** Test-only scroll clamp + continuous-motion proof. Not used by production follow. */

import {
  LIVE_FOLLOW_MAX_CATCHUP_SPEED_PX_PER_SEC,
  LIVE_READING_TARGET_RATIO,
  measureScrollMotionContinuity,
  type ScrollMotionContinuityMetrics,
} from "./liveReadingFollow";

export const MIN_AVAILABLE_DOWNWARD_SCROLL_PX = 100;
export const MIN_MEANINGFUL_SCROLL_RANGE_PX = 24;
export const PHYSICAL_CLAMP_EPSILON_PX = 2;
export const MOTION_DUTY_CYCLE_MIN = 0.75;
export const MAX_VISIBLE_STOP_GAP_MS_LIMIT = 300;
export const MAX_FRAME_VELOCITY_PX_PER_SEC = LIVE_FOLLOW_MAX_CATCHUP_SPEED_PX_PER_SEC;
export const MAX_FRAME_VELOCITY_EPSILON_PX_PER_SEC = 12;

/** Documented: scrollRange < 4 is never a PASS reason. */
export const IMPLICIT_SCROLL_RANGE_PASS_PATH = false;

export type ScrollClampGeometry = {
  scrollHeight: number;
  innerHeight: number;
  scrollY: number;
  endTop?: number | null;
  targetRatio?: number;
};

export type ScrollClampState = {
  MAX_SCROLL_Y: number;
  CURRENT_SCROLL_Y: number;
  AVAILABLE_DOWNWARD_SCROLL_PX: number;
  TARGET_REQUIRES_DOWNWARD_SCROLL: boolean;
  physicallyCannotScroll: boolean;
};

export type MotionProofFrame = {
  t: number;
  scrollY: number;
  endTop?: number | null;
  remainingDelta?: number | null;
  followLatest?: boolean;
  manualDetached?: boolean;
};

export type ScrollMotionClassification =
  | "PHYSICALLY_CANNOT_SCROLL"
  | "MUST_MOVE"
  | "SCROLL_RANGE_LOW"
  | "FIXTURE_NOT_SCROLLABLE"
  | "MOTION_GATE_FAILED";

export type ContinuousMotionProof = {
  passed: boolean;
  classification: ScrollMotionClassification;
  reasons: string[];
  MAX_SCROLL_Y: number;
  CURRENT_SCROLL_Y: number;
  AVAILABLE_DOWNWARD_SCROLL_PX: number;
  TARGET_REQUIRES_DOWNWARD_SCROLL: boolean;
  TOTAL_SCROLL_RANGE_PX: number;
  MOTION_DUTY_CYCLE: number;
  MAX_VISIBLE_STOP_GAP_MS: number;
  DIRECTION_REVERSAL_COUNT: number;
  LARGE_JUMP_COUNT: number;
  MAX_FRAME_VELOCITY: number;
  FOLLOW_LATEST_ALWAYS_TRUE: boolean;
  PROGRAMMATIC_SELF_DETACH: boolean;
  metrics: ScrollMotionContinuityMetrics | null;
};

export function resolveScrollClampState(geometry: ScrollClampGeometry): ScrollClampState {
  const maxScrollY = Math.max(0, geometry.scrollHeight - geometry.innerHeight);
  const currentScrollY = geometry.scrollY;
  const availableDownwardScrollPx = maxScrollY - currentScrollY;
  const targetY = geometry.innerHeight * (geometry.targetRatio ?? LIVE_READING_TARGET_RATIO);
  const remainingDelta = geometry.endTop == null ? null : geometry.endTop - targetY;
  const targetRequiresDownwardScroll =
    remainingDelta != null && remainingDelta > PHYSICAL_CLAMP_EPSILON_PX;
  const physicallyCannotScroll = availableDownwardScrollPx <= PHYSICAL_CLAMP_EPSILON_PX;
  return {
    MAX_SCROLL_Y: maxScrollY,
    CURRENT_SCROLL_Y: currentScrollY,
    AVAILABLE_DOWNWARD_SCROLL_PX: availableDownwardScrollPx,
    TARGET_REQUIRES_DOWNWARD_SCROLL: targetRequiresDownwardScroll,
    physicallyCannotScroll,
  };
}

function classifyProof(opts: {
  requireMotion: boolean;
  physicallyCannotScroll: boolean;
  scrollRangePx: number;
  fixtureScrollable: boolean;
  gateFailed: boolean;
}): ScrollMotionClassification {
  if (!opts.requireMotion && opts.physicallyCannotScroll) {
    return "PHYSICALLY_CANNOT_SCROLL";
  }
  if (!opts.fixtureScrollable) return "FIXTURE_NOT_SCROLLABLE";
  if (opts.scrollRangePx < MIN_MEANINGFUL_SCROLL_RANGE_PX) return "SCROLL_RANGE_LOW";
  if (opts.gateFailed) return "MOTION_GATE_FAILED";
  return "MUST_MOVE";
}

export function evaluateContinuousMotionProof(opts: {
  frames: MotionProofFrame[];
  startGeometry: ScrollClampState;
  requireMotion: boolean;
  minDutyCycle?: number;
}): ContinuousMotionProof {
  const minDuty = opts.minDutyCycle ?? MOTION_DUTY_CYCLE_MIN;
  const frames = opts.frames;
  const start = opts.startGeometry;
  const reasons: string[] = [];

  const scrollRangePx =
    frames.length > 0
      ? Math.max(...frames.map((frame) => frame.scrollY)) -
        Math.min(...frames.map((frame) => frame.scrollY))
      : 0;

  const followLatestAlwaysTrue =
    frames.length > 0 && frames.every((frame) => frame.followLatest !== false);
  const programmaticSelfDetach = frames.some(
    (frame) => frame.followLatest === false || frame.manualDetached === true
  );

  const fixtureScrollable = start.AVAILABLE_DOWNWARD_SCROLL_PX >= MIN_AVAILABLE_DOWNWARD_SCROLL_PX;
  const clampProven = start.physicallyCannotScroll;
  const clampAllowed = !opts.requireMotion && clampProven;

  let largeJumpCount = 0;
  let directionReversalCount = 0;
  let maxFrameVelocity = 0;
  let previousScrollY = frames[0]?.scrollY ?? 0;
  let previousT = frames[0]?.t ?? 0;
  let previousSignedVelocity = 0;

  for (let i = 1; i < frames.length; i += 1) {
    const frame = frames[i]!;
    const dtSec = Math.max(1 / 120, (frame.t - previousT) / 1000);
    const step = frame.scrollY - previousScrollY;
    const signedVelocity = step / dtSec;
    const absVelocity = Math.abs(signedVelocity);
    maxFrameVelocity = Math.max(maxFrameVelocity, absVelocity);

    if (
      Math.abs(step) > 0.5 &&
      Math.abs(previousSignedVelocity) > 4 &&
      Math.sign(previousSignedVelocity) !== Math.sign(signedVelocity) &&
      Math.sign(signedVelocity) !== 0
    ) {
      directionReversalCount += 1;
    }
    previousSignedVelocity = signedVelocity;

    if (step > 0) {
      const maxStep = MAX_FRAME_VELOCITY_PX_PER_SEC * dtSec + 6;
      if (step > maxStep) largeJumpCount += 1;
    }
    previousScrollY = frame.scrollY;
    previousT = frame.t;
  }

  const metrics =
    frames.length >= 2
      ? measureScrollMotionContinuity(
          frames.map((frame) => ({ t: frame.t, scrollY: frame.scrollY })),
          { velocityThresholdPxPerSec: 4 }
        )
      : null;

  if (clampAllowed) {
    return {
      passed: true,
      classification: "PHYSICALLY_CANNOT_SCROLL",
      reasons: [],
      MAX_SCROLL_Y: start.MAX_SCROLL_Y,
      CURRENT_SCROLL_Y: start.CURRENT_SCROLL_Y,
      AVAILABLE_DOWNWARD_SCROLL_PX: start.AVAILABLE_DOWNWARD_SCROLL_PX,
      TARGET_REQUIRES_DOWNWARD_SCROLL: start.TARGET_REQUIRES_DOWNWARD_SCROLL,
      TOTAL_SCROLL_RANGE_PX: scrollRangePx,
      MOTION_DUTY_CYCLE: metrics?.motionDutyCycle ?? 0,
      MAX_VISIBLE_STOP_GAP_MS: metrics?.maxVisibleStopGapMs ?? 0,
      DIRECTION_REVERSAL_COUNT: metrics?.directionReversalCount ?? directionReversalCount,
      LARGE_JUMP_COUNT: largeJumpCount,
      MAX_FRAME_VELOCITY: maxFrameVelocity,
      FOLLOW_LATEST_ALWAYS_TRUE: followLatestAlwaysTrue,
      PROGRAMMATIC_SELF_DETACH: programmaticSelfDetach,
      metrics,
    };
  }

  if (opts.requireMotion && !fixtureScrollable) {
    reasons.push("FIXTURE_NOT_SCROLLABLE");
  }
  if (scrollRangePx < MIN_MEANINGFUL_SCROLL_RANGE_PX) {
    reasons.push("SCROLL_RANGE_LOW");
  }
  if (frames.length <= 30) {
    reasons.push("INSUFFICIENT_FRAMES");
  }
  if ((metrics?.motionDutyCycle ?? 0) < minDuty) {
    reasons.push("MOTION_DUTY_CYCLE");
  }
  if ((metrics?.maxVisibleStopGapMs ?? 0) > MAX_VISIBLE_STOP_GAP_MS_LIMIT) {
    reasons.push("MAX_VISIBLE_STOP_GAP_MS");
  }
  const reversals = Math.max(directionReversalCount, metrics?.directionReversalCount ?? 0);
  if (reversals !== 0) {
    reasons.push("DIRECTION_REVERSAL_COUNT");
  }
  if (largeJumpCount !== 0) {
    reasons.push("LARGE_JUMP_COUNT");
  }
  if (maxFrameVelocity > MAX_FRAME_VELOCITY_PX_PER_SEC + MAX_FRAME_VELOCITY_EPSILON_PX_PER_SEC) {
    reasons.push("MAX_FRAME_VELOCITY");
  }
  if (!followLatestAlwaysTrue) {
    reasons.push("FOLLOW_LATEST_ALWAYS_TRUE");
  }
  if (programmaticSelfDetach) {
    reasons.push("PROGRAMMATIC_SELF_DETACH");
  }
  if (metrics?.stopStartOscillation) {
    reasons.push("STOP_START_OSCILLATION");
  }

  const classification = classifyProof({
    requireMotion: opts.requireMotion,
    physicallyCannotScroll: clampProven,
    scrollRangePx,
    fixtureScrollable,
    gateFailed: reasons.length > 0,
  });

  return {
    passed: reasons.length === 0,
    classification,
    reasons,
    MAX_SCROLL_Y: start.MAX_SCROLL_Y,
    CURRENT_SCROLL_Y: start.CURRENT_SCROLL_Y,
    AVAILABLE_DOWNWARD_SCROLL_PX: start.AVAILABLE_DOWNWARD_SCROLL_PX,
    TARGET_REQUIRES_DOWNWARD_SCROLL: start.TARGET_REQUIRES_DOWNWARD_SCROLL,
    TOTAL_SCROLL_RANGE_PX: scrollRangePx,
    MOTION_DUTY_CYCLE: metrics?.motionDutyCycle ?? 0,
    MAX_VISIBLE_STOP_GAP_MS: metrics?.maxVisibleStopGapMs ?? 0,
    DIRECTION_REVERSAL_COUNT: reversals,
    LARGE_JUMP_COUNT: largeJumpCount,
    MAX_FRAME_VELOCITY: maxFrameVelocity,
    FOLLOW_LATEST_ALWAYS_TRUE: followLatestAlwaysTrue,
    PROGRAMMATIC_SELF_DETACH: programmaticSelfDetach,
    metrics,
  };
}

export function formatContinuousMotionProof(proof: ContinuousMotionProof): string {
  return [
    `classification=${proof.classification}`,
    `passed=${proof.passed}`,
    `MAX_SCROLL_Y=${proof.MAX_SCROLL_Y}`,
    `CURRENT_SCROLL_Y=${proof.CURRENT_SCROLL_Y}`,
    `AVAILABLE_DOWNWARD_SCROLL_PX=${proof.AVAILABLE_DOWNWARD_SCROLL_PX}`,
    `TARGET_REQUIRES_DOWNWARD_SCROLL=${proof.TARGET_REQUIRES_DOWNWARD_SCROLL}`,
    `TOTAL_SCROLL_RANGE_PX=${proof.TOTAL_SCROLL_RANGE_PX}`,
    `MOTION_DUTY_CYCLE=${proof.MOTION_DUTY_CYCLE}`,
    `MAX_VISIBLE_STOP_GAP_MS=${proof.MAX_VISIBLE_STOP_GAP_MS}`,
    `DIRECTION_REVERSAL_COUNT=${proof.DIRECTION_REVERSAL_COUNT}`,
    `LARGE_JUMP_COUNT=${proof.LARGE_JUMP_COUNT}`,
    `MAX_FRAME_VELOCITY=${proof.MAX_FRAME_VELOCITY}`,
    `FOLLOW_LATEST_ALWAYS_TRUE=${proof.FOLLOW_LATEST_ALWAYS_TRUE}`,
    `PROGRAMMATIC_SELF_DETACH=${proof.PROGRAMMATIC_SELF_DETACH}`,
    `reasons=${proof.reasons.join(",") || "none"}`,
  ].join("\n");
}
