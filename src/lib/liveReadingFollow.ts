/** Shared live-reading band + continuous viewport chase for TRPG and general chat. */

export const LIVE_READING_MIN_RATIO = 0.56;
export const LIVE_READING_MAX_RATIO = 0.69;
export const LIVE_READING_TARGET_RATIO = 0.63;
export const LIVE_READING_FOLLOW_EPSILON_PX = 8;

export const LIVE_FOLLOW_BASE_SPEED_PX_PER_SEC = 140;
export const LIVE_FOLLOW_MAX_CATCHUP_SPEED_PX_PER_SEC = 260;
export const LIVE_FOLLOW_ANIMATOR_EPSILON_PX = 2;
/** Bottom breathing room so reading target is reachable before maxScrollY clamp. */
export const LIVE_FOLLOW_TAIL_SPACER_RATIO = 0.38;

export const LIVE_FOLLOW_CONTINUOUS_DEFAULT_SMOOTHING_SEC = 0.65;
export const LIVE_FOLLOW_CONTINUOUS_MIN_CRUISE_PX_PER_SEC = 16;
export const LIVE_FOLLOW_CONTINUOUS_GROWTH_MATCH = 0.9;

export type LiveReadingMotionMode = "stepwise-chase" | "continuous-flow";

export type LiveReadingMotionProfile = {
  mode?: LiveReadingMotionMode;
  /** Low-pass time constant for discrete sentinel jumps (seconds). */
  targetSmoothingTimeSec?: number;
  /** Minimum downward cruise velocity while follow is attached (px/s). */
  minCruiseVelocityPxPerSec?: number;
  /** Match scroll velocity to measured sentinel growth rate. */
  growthMatchFactor?: number;
};

export type MotionSample = {
  t: number;
  scrollY: number;
};

export type ScrollMotionContinuityMetrics = {
  totalActiveDurationMs: number;
  movingDurationMs: number;
  stoppedDurationMs: number;
  motionDutyCycle: number;
  maxVisibleStopGapMs: number;
  medianScrollVelocity: number;
  p95Velocity: number;
  velocityStdDev: number;
  stopStartOscillation: boolean;
};

export function narrationFollowDeltaPx(opts: {
  endTop: number;
  viewportHeight: number;
  targetRatio?: number;
  epsilonPx?: number;
}): number {
  const targetY = opts.viewportHeight * (opts.targetRatio ?? LIVE_READING_TARGET_RATIO);
  const delta = opts.endTop - targetY;
  if (Math.abs(delta) < (opts.epsilonPx ?? LIVE_READING_FOLLOW_EPSILON_PX)) return 0;
  return delta;
}

export function isNearLiveReadingBand(opts: {
  endTop: number;
  viewportHeight: number;
  minRatio?: number;
  maxRatio?: number;
}): boolean {
  const ratio = opts.endTop / Math.max(1, opts.viewportHeight);
  return (
    ratio >= (opts.minRatio ?? LIVE_READING_MIN_RATIO) &&
    ratio <= (opts.maxRatio ?? LIVE_READING_MAX_RATIO)
  );
}

export function prefersReducedLiveReadingMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function computeLiveFollowVelocityPxPerSec(opts: {
  remainingDeltaPx: number;
  viewportHeight: number;
  baseSpeedPxPerSec?: number;
  maxCatchUpSpeedPxPerSec?: number;
  catchUpDistanceRatio?: number;
}): number {
  const base = opts.baseSpeedPxPerSec ?? LIVE_FOLLOW_BASE_SPEED_PX_PER_SEC;
  const maxCatchUp = opts.maxCatchUpSpeedPxPerSec ?? LIVE_FOLLOW_MAX_CATCHUP_SPEED_PX_PER_SEC;
  const threshold = Math.max(1, opts.viewportHeight * (opts.catchUpDistanceRatio ?? 0.15));
  return Math.abs(opts.remainingDeltaPx) > threshold ? maxCatchUp : base;
}

export function computeLiveFollowFrameStep(opts: {
  remainingDeltaPx: number;
  dtSec: number;
  viewportHeight: number;
  baseSpeedPxPerSec?: number;
  maxCatchUpSpeedPxPerSec?: number;
}): number {
  if (opts.remainingDeltaPx === 0 || opts.dtSec <= 0) return 0;
  const speed = computeLiveFollowVelocityPxPerSec({
    remainingDeltaPx: opts.remainingDeltaPx,
    viewportHeight: opts.viewportHeight,
    baseSpeedPxPerSec: opts.baseSpeedPxPerSec,
    maxCatchUpSpeedPxPerSec: opts.maxCatchUpSpeedPxPerSec,
  });
  const maxStep = speed * opts.dtSec;
  return Math.sign(opts.remainingDeltaPx) * Math.min(Math.abs(opts.remainingDeltaPx), maxStep);
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
  return sorted[idx] ?? 0;
}

function stdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/** Measure perceptual scroll continuity from frame samples during active follow. */
export function measureScrollMotionContinuity(
  samples: MotionSample[],
  opts?: {
    velocityThresholdPxPerSec?: number;
    stopGapThresholdMs?: number;
    oscillationVelocityThresholdPxPerSec?: number;
  }
): ScrollMotionContinuityMetrics {
  const velocityThreshold = opts?.velocityThresholdPxPerSec ?? 8;
  const stopGapThresholdMs = opts?.stopGapThresholdMs ?? 300;
  const oscillationThreshold = opts?.oscillationVelocityThresholdPxPerSec ?? 80;

  if (samples.length < 2) {
    return {
      totalActiveDurationMs: 0,
      movingDurationMs: 0,
      stoppedDurationMs: 0,
      motionDutyCycle: 0,
      maxVisibleStopGapMs: 0,
      medianScrollVelocity: 0,
      p95Velocity: 0,
      velocityStdDev: 0,
      stopStartOscillation: false,
    };
  }

  let movingDurationMs = 0;
  let stoppedDurationMs = 0;
  let currentStopGapMs = 0;
  let maxVisibleStopGapMs = 0;
  const velocities: number[] = [];
  let previousZeroCrossings = 0;
  let wasMoving = false;

  for (let i = 1; i < samples.length; i += 1) {
    const prev = samples[i - 1]!;
    const cur = samples[i]!;
    const dtMs = Math.max(1, cur.t - prev.t);
    const dtSec = dtMs / 1000;
    const velocity = (cur.scrollY - prev.scrollY) / dtSec;
    velocities.push(Math.abs(velocity));
    const moving = Math.abs(velocity) >= velocityThreshold;

    if (moving) {
      movingDurationMs += dtMs;
      if (currentStopGapMs > 0) {
        maxVisibleStopGapMs = Math.max(maxVisibleStopGapMs, currentStopGapMs);
        currentStopGapMs = 0;
      }
      if (!wasMoving && i > 1) previousZeroCrossings += 1;
      wasMoving = true;
    } else {
      stoppedDurationMs += dtMs;
      currentStopGapMs += dtMs;
      wasMoving = false;
    }
  }

  maxVisibleStopGapMs = Math.max(maxVisibleStopGapMs, currentStopGapMs);
  const totalActiveDurationMs = movingDurationMs + stoppedDurationMs;
  const motionDutyCycle =
    totalActiveDurationMs > 0 ? movingDurationMs / totalActiveDurationMs : 0;
  const medianScrollVelocity = percentile(velocities, 0.5);
  const p95Velocity = percentile(velocities, 0.95);
  const velocityStdDev = stdDev(velocities);
  const stopStartOscillation =
    previousZeroCrossings >= 3 &&
    p95Velocity >= oscillationThreshold &&
    maxVisibleStopGapMs >= stopGapThresholdMs;

  return {
    totalActiveDurationMs,
    movingDurationMs,
    stoppedDurationMs,
    motionDutyCycle,
    maxVisibleStopGapMs,
    medianScrollVelocity,
    p95Velocity,
    velocityStdDev,
    stopStartOscillation,
  };
}

export type LiveReadingFollowController = {
  notifyTargetUpdate: () => void;
  stop: () => void;
  isRunning: () => boolean;
};

function isContinuousFlowProfile(profile: LiveReadingMotionProfile | undefined): boolean {
  return profile?.mode === "continuous-flow";
}

function smoothSentinelTop(opts: {
  rawTop: number;
  smoothedTop: number | null;
  dtSec: number;
  smoothingTimeSec: number;
}): number {
  if (opts.smoothedTop == null) return opts.rawTop;
  const alpha = 1 - Math.exp(-opts.dtSec / Math.max(0.05, opts.smoothingTimeSec));
  return opts.smoothedTop + (opts.rawTop - opts.smoothedTop) * alpha;
}

function updateEstimatedGrowthPxPerSec(opts: {
  rawTop: number;
  previousRawTop: number | null;
  previousSampleMs: number | null;
  nowMs: number;
  currentEstimate: number;
}): number {
  if (opts.previousRawTop == null || opts.previousSampleMs == null) return opts.currentEstimate;
  if (opts.rawTop <= opts.previousRawTop) return opts.currentEstimate * 0.92;
  const dtSec = Math.max(0.001, (opts.nowMs - opts.previousSampleMs) / 1000);
  const instant = (opts.rawTop - opts.previousRawTop) / dtSec;
  return opts.currentEstimate * 0.7 + instant * 0.3;
}

/** Single shared motion engine — TRPG and chat supply their own target resolver. */
export function createLiveReadingFollowController(opts: {
  getViewportHeight: () => number;
  scrollBy: (delta: number) => void;
  resolveTargetElement: () => Element | null;
  shouldFollow: () => boolean;
  targetRatio?: number;
  baseSpeedPxPerSec?: number;
  maxCatchUpSpeedPxPerSec?: number;
  motionProfile?: LiveReadingMotionProfile;
  prefersReducedMotion?: () => boolean;
  requestAnimationFrame?: (fn: FrameRequestCallback) => number;
  cancelAnimationFrame?: (id: number) => void;
}): LiveReadingFollowController {
  let rafId: number | null = null;
  let lastFrameTimeMs: number | null = null;
  let smoothedEndTop: number | null = null;
  let previousRawEndTop: number | null = null;
  let previousGrowthSampleMs: number | null = null;
  let estimatedGrowthPxPerSec = 0;
  const raf =
    opts.requestAnimationFrame ??
    ((fn: FrameRequestCallback) =>
      (typeof requestAnimationFrame !== "undefined"
        ? requestAnimationFrame(fn)
        : setTimeout(() => fn(0), 16)) as unknown as number);
  const cancelRaf = opts.cancelAnimationFrame ?? ((id: number) => {
    if (typeof cancelAnimationFrame !== "undefined") cancelAnimationFrame(id);
    else clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
  });
  const reducedMotion = opts.prefersReducedMotion ?? prefersReducedLiveReadingMotion;
  const profile = opts.motionProfile;
  const continuous = isContinuousFlowProfile(profile);

  const resetMotionState = () => {
    lastFrameTimeMs = null;
    smoothedEndTop = null;
    previousRawEndTop = null;
    previousGrowthSampleMs = null;
    estimatedGrowthPxPerSec = 0;
  };

  const scheduleNextFrame = () => {
    if (rafId != null) return;
    rafId = raf(tick);
  };

  const tick = (timestamp: number) => {
    rafId = null;
    if (!opts.shouldFollow()) {
      resetMotionState();
      return;
    }
    const el = opts.resolveTargetElement();
    if (!el) {
      if (continuous) {
        scheduleNextFrame();
        return;
      }
      resetMotionState();
      return;
    }
    const dtSec =
      lastFrameTimeMs == null ? 1 / 60 : Math.min(0.05, Math.max(0, (timestamp - lastFrameTimeMs) / 1000));
    lastFrameTimeMs = timestamp;

    const rawEndTop = el.getBoundingClientRect().top;
    estimatedGrowthPxPerSec = updateEstimatedGrowthPxPerSec({
      rawTop: rawEndTop,
      previousRawTop: previousRawEndTop,
      previousSampleMs: previousGrowthSampleMs,
      nowMs: timestamp,
      currentEstimate: estimatedGrowthPxPerSec,
    });
    previousRawEndTop = rawEndTop;
    previousGrowthSampleMs = timestamp;

    const effectiveEndTop = continuous
      ? smoothSentinelTop({
          rawTop: rawEndTop,
          smoothedTop: smoothedEndTop,
          dtSec,
          smoothingTimeSec:
            profile?.targetSmoothingTimeSec ?? LIVE_FOLLOW_CONTINUOUS_DEFAULT_SMOOTHING_SEC,
        })
      : rawEndTop;
    if (continuous) smoothedEndTop = effectiveEndTop;

    const delta = narrationFollowDeltaPx({
      endTop: effectiveEndTop,
      viewportHeight: opts.getViewportHeight(),
      targetRatio: opts.targetRatio ?? LIVE_READING_TARGET_RATIO,
      epsilonPx: LIVE_FOLLOW_ANIMATOR_EPSILON_PX,
    });

    let step = 0;
    if (delta !== 0) {
      step = reducedMotion()
        ? delta
        : computeLiveFollowFrameStep({
            remainingDeltaPx: delta,
            dtSec,
            viewportHeight: opts.getViewportHeight(),
            baseSpeedPxPerSec: opts.baseSpeedPxPerSec,
            maxCatchUpSpeedPxPerSec: opts.maxCatchUpSpeedPxPerSec,
          });
    } else if (continuous && !reducedMotion()) {
      const growthMatch = profile?.growthMatchFactor ?? LIVE_FOLLOW_CONTINUOUS_GROWTH_MATCH;
      const minCruise = profile?.minCruiseVelocityPxPerSec ?? LIVE_FOLLOW_CONTINUOUS_MIN_CRUISE_PX_PER_SEC;
      const cruiseVelocity = Math.max(minCruise, estimatedGrowthPxPerSec * growthMatch);
      if (cruiseVelocity > 0) step = cruiseVelocity * dtSec;
    }

    if (step !== 0) opts.scrollBy(step);

    if (continuous) {
      if (opts.shouldFollow()) scheduleNextFrame();
      return;
    }

    if (delta === 0) {
      resetMotionState();
      return;
    }

    if (reducedMotion()) {
      resetMotionState();
      return;
    }

    scheduleNextFrame();
  };

  const start = () => {
    if (rafId != null) return;
    lastFrameTimeMs = null;
    rafId = raf(tick);
  };

  return {
    notifyTargetUpdate: () => {
      if (!opts.shouldFollow()) return;
      start();
    },
    stop: () => {
      if (rafId != null) cancelRaf(rafId);
      rafId = null;
      resetMotionState();
    },
    isRunning: () => rafId != null,
  };
}
