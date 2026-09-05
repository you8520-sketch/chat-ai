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
export const INTEGER_CADENCE_MAX_INTER_STEP_GAP_MS = 200;
export const INTEGER_CADENCE_P95_INTER_STEP_GAP_MS = 120;
export const INTEGER_CADENCE_MAX_STEP_PX = 1;
export const INTEGER_CADENCE_STEADY_MIN_REMAINING_DELTA_PX = -8;

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

export type IntegerScrollCadenceMetrics = {
  POSITIVE_SCROLL_STEP_COUNT: number;
  TOTAL_SCROLL_RANGE: number;
  MEDIAN_POSITIVE_STEP_PX: number;
  P95_POSITIVE_STEP_PX: number;
  MEDIAN_INTER_STEP_GAP_MS: number;
  P95_INTER_STEP_GAP_MS: number;
  MAX_INTER_STEP_GAP_MS: number;
  AVERAGE_SCROLL_VELOCITY: number;
  DIRECTION_REVERSAL_COUNT: number;
  LARGE_JUMP_COUNT: number;
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
  cadence: IntegerScrollCadenceMetrics;
  metrics: ScrollMotionContinuityMetrics | null;
};

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
  return sorted[index] ?? 0;
}

export function measureIntegerScrollCadence(
  samples: MotionProofFrame[],
  opts?: { maxStepPx?: number }
): IntegerScrollCadenceMetrics {
  const positiveSteps: number[] = [];
  const positiveStepTimes: number[] = [];
  const allPositiveStepTimes: number[] = [];
  const maxStepPx = opts?.maxStepPx ?? INTEGER_CADENCE_MAX_STEP_PX;
  let previousScrollY = samples[0]?.scrollY ?? 0;
  let previousSignedStep = 0;
  let directionReversalCount = 0;
  let largeJumpCount = 0;

  for (let index = 1; index < samples.length; index += 1) {
    const sample = samples[index]!;
    const step = sample.scrollY - previousScrollY;
    if (step > 0) {
      allPositiveStepTimes.push(sample.t);
      const inSteadyCruise =
        sample.remainingDelta == null ||
        sample.remainingDelta > INTEGER_CADENCE_STEADY_MIN_REMAINING_DELTA_PX;
      if (inSteadyCruise) {
        positiveSteps.push(step);
        positiveStepTimes.push(sample.t);
      }
      if (step > maxStepPx) largeJumpCount += 1;
    }
    if (
      step !== 0 &&
      previousSignedStep !== 0 &&
      Math.sign(step) !== Math.sign(previousSignedStep)
    ) {
      directionReversalCount += 1;
    }
    if (step !== 0) previousSignedStep = step;
    previousScrollY = sample.scrollY;
  }

  const steadyInterStepGaps = positiveStepTimes
    .slice(1)
    .map((time, index) => Math.max(0, time - positiveStepTimes[index]!));
  const allInterStepGaps = allPositiveStepTimes
    .slice(1)
    .map((time, index) => Math.max(0, time - allPositiveStepTimes[index]!));
  const totalPositiveScroll = positiveSteps.reduce((sum, step) => sum + step, 0);
  const firstPositiveTime = positiveStepTimes[0];
  const lastPositiveTime = positiveStepTimes[positiveStepTimes.length - 1];
  const positiveDurationSec =
    firstPositiveTime != null && lastPositiveTime != null
      ? Math.max(0.001, (lastPositiveTime - firstPositiveTime) / 1000)
      : 0;

  return {
    POSITIVE_SCROLL_STEP_COUNT: positiveSteps.length,
    TOTAL_SCROLL_RANGE: samples.length > 0
      ? Math.max(...samples.map((sample) => sample.scrollY)) -
        Math.min(...samples.map((sample) => sample.scrollY))
      : 0,
    MEDIAN_POSITIVE_STEP_PX: percentile(positiveSteps, 0.5),
    P95_POSITIVE_STEP_PX: percentile(positiveSteps, 0.95),
    MEDIAN_INTER_STEP_GAP_MS: percentile(steadyInterStepGaps, 0.5),
    P95_INTER_STEP_GAP_MS: percentile(steadyInterStepGaps, 0.95),
    MAX_INTER_STEP_GAP_MS: allInterStepGaps.length > 0 ? Math.max(...allInterStepGaps) : 0,
    AVERAGE_SCROLL_VELOCITY:
      positiveDurationSec > 0 ? totalPositiveScroll / positiveDurationSec : 0,
    DIRECTION_REVERSAL_COUNT: directionReversalCount,
    LARGE_JUMP_COUNT: largeJumpCount,
  };
}

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
}): ContinuousMotionProof {
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
  const cadence = measureIntegerScrollCadence(frames);

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
      cadence,
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
  if (cadence.POSITIVE_SCROLL_STEP_COUNT === 0) {
    reasons.push("NO_POSITIVE_SCROLL_STEPS");
  }
  if (cadence.P95_INTER_STEP_GAP_MS > INTEGER_CADENCE_P95_INTER_STEP_GAP_MS) {
    reasons.push("P95_INTER_STEP_GAP_MS");
  }
  if (cadence.MAX_INTER_STEP_GAP_MS > INTEGER_CADENCE_MAX_INTER_STEP_GAP_MS) {
    reasons.push("MAX_INTER_STEP_GAP_MS");
  }
  const reversals = Math.max(
    directionReversalCount,
    metrics?.directionReversalCount ?? 0,
    cadence.DIRECTION_REVERSAL_COUNT
  );
  if (reversals !== 0) {
    reasons.push("DIRECTION_REVERSAL_COUNT");
  }
  const largeJumps = largeJumpCount + cadence.LARGE_JUMP_COUNT;
  if (largeJumps !== 0) {
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
    LARGE_JUMP_COUNT: largeJumps,
    MAX_FRAME_VELOCITY: maxFrameVelocity,
    FOLLOW_LATEST_ALWAYS_TRUE: followLatestAlwaysTrue,
    PROGRAMMATIC_SELF_DETACH: programmaticSelfDetach,
    cadence,
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
    `POSITIVE_SCROLL_STEP_COUNT=${proof.cadence.POSITIVE_SCROLL_STEP_COUNT}`,
    `TOTAL_SCROLL_RANGE=${proof.cadence.TOTAL_SCROLL_RANGE}`,
    `MEDIAN_POSITIVE_STEP_PX=${proof.cadence.MEDIAN_POSITIVE_STEP_PX}`,
    `P95_POSITIVE_STEP_PX=${proof.cadence.P95_POSITIVE_STEP_PX}`,
    `MEDIAN_INTER_STEP_GAP_MS=${proof.cadence.MEDIAN_INTER_STEP_GAP_MS}`,
    `P95_INTER_STEP_GAP_MS=${proof.cadence.P95_INTER_STEP_GAP_MS}`,
    `MAX_INTER_STEP_GAP_MS=${proof.cadence.MAX_INTER_STEP_GAP_MS}`,
    `AVERAGE_SCROLL_VELOCITY=${proof.cadence.AVERAGE_SCROLL_VELOCITY}`,
    `MAX_FRAME_VELOCITY=${proof.MAX_FRAME_VELOCITY}`,
    `FOLLOW_LATEST_ALWAYS_TRUE=${proof.FOLLOW_LATEST_ALWAYS_TRUE}`,
    `PROGRAMMATIC_SELF_DETACH=${proof.PROGRAMMATIC_SELF_DETACH}`,
    `reasons=${proof.reasons.join(",") || "none"}`,
  ].join("\n");
}
