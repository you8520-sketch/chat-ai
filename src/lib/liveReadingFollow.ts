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
export const LIVE_FOLLOW_CONTINUOUS_GROWTH_MATCH = 0.9;

/** Typical assistant prose line height in general chat (px). */
export const MEDIAN_LINE_HEIGHT_PX = 26;
/** Typical wrapped line length for Korean chat prose (chars). */
export const MEDIAN_CHARS_PER_LINE = 42;

export type LiveReadingMotionMode = "stepwise-chase" | "continuous-flow";

export type LiveReadingMotionProfile = {
  mode?: LiveReadingMotionMode;
  /** Low-pass time constant for discrete sentinel jumps (seconds). */
  targetSmoothingTimeSec?: number;
  /** Match scroll velocity to measured sentinel growth rate. */
  growthMatchFactor?: number;
  /** Stream reveal interval for natural cruise calibration (ms). */
  streamIntervalMs?: number;
  /** Chars revealed per stream tick for natural cruise calibration. */
  streamCharsPerTick?: number;
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
  medianSignedVelocity: number;
  directionReversalCount: number;
  stopStartOscillation: boolean;
};

export function getScrollPosition(): number {
  if (typeof window === "undefined") return 0;
  return window.scrollY;
}

/** Scroll-independent document Y for a target element sentinel. */
export function resolveTargetDocumentY(opts: { element: Element; scrollY?: number }): number {
  const scrollY = opts.scrollY ?? getScrollPosition();
  return scrollY + opts.element.getBoundingClientRect().top;
}

export function estimateLineWrapIntervalMs(
  streamIntervalMs: number,
  charsPerTick = 1
): number {
  if (streamIntervalMs <= 0) return 0;
  const ticksPerLine = Math.max(1, Math.ceil(MEDIAN_CHARS_PER_LINE / Math.max(1, charsPerTick)));
  return ticksPerLine * streamIntervalMs;
}

export function estimateVerticalGrowthPxPerSec(
  streamIntervalMs: number,
  charsPerTick = 1,
  lineHeightPx = MEDIAN_LINE_HEIGHT_PX
): number {
  const wrapMs = estimateLineWrapIntervalMs(streamIntervalMs, charsPerTick);
  if (wrapMs <= 0) return 0;
  return (lineHeightPx / wrapMs) * 1000;
}

/** Natural cruise speed aligned to prose growth — never multiples above measured/expected growth. */
export function computeNaturalCruiseVelocityPxPerSec(opts: {
  measuredGrowthPxPerSec: number;
  streamIntervalMs?: number;
  charsPerTick?: number;
  growthMatchFactor?: number;
}): number {
  const match = opts.growthMatchFactor ?? LIVE_FOLLOW_CONTINUOUS_GROWTH_MATCH;
  const charsPerTick = opts.charsPerTick ?? 1;
  const expected =
    opts.streamIntervalMs != null && opts.streamIntervalMs > 0
      ? estimateVerticalGrowthPxPerSec(opts.streamIntervalMs, charsPerTick)
      : 0;
  const naturalBase = Math.max(opts.measuredGrowthPxPerSec, expected);
  if (naturalBase <= 0) return 0;
  return naturalBase * match;
}

export function capLiveFollowFrameStep(opts: {
  step: number;
  dtSec: number;
  maxCatchUpSpeedPxPerSec?: number;
}): number {
  if (opts.step === 0 || opts.dtSec <= 0) return 0;
  const maxCatchUp = opts.maxCatchUpSpeedPxPerSec ?? LIVE_FOLLOW_MAX_CATCHUP_SPEED_PX_PER_SEC;
  const maxFrameStep = maxCatchUp * opts.dtSec;
  return Math.sign(opts.step) * Math.min(Math.abs(opts.step), maxFrameStep);
}

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
  const rawStep =
    Math.sign(opts.remainingDeltaPx) * Math.min(Math.abs(opts.remainingDeltaPx), maxStep);
  return capLiveFollowFrameStep({
    step: rawStep,
    dtSec: opts.dtSec,
    maxCatchUpSpeedPxPerSec: opts.maxCatchUpSpeedPxPerSec,
  });
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
      medianSignedVelocity: 0,
      directionReversalCount: 0,
      stopStartOscillation: false,
    };
  }

  let movingDurationMs = 0;
  let stoppedDurationMs = 0;
  let currentStopGapMs = 0;
  let maxVisibleStopGapMs = 0;
  const velocities: number[] = [];
  const signedVelocities: number[] = [];
  let previousZeroCrossings = 0;
  let directionReversalCount = 0;
  let wasMoving = false;
  let previousSignedVelocity = 0;

  for (let i = 1; i < samples.length; i += 1) {
    const prev = samples[i - 1]!;
    const cur = samples[i]!;
    const dtMs = Math.max(1, cur.t - prev.t);
    const dtSec = dtMs / 1000;
    const signedVelocity = (cur.scrollY - prev.scrollY) / dtSec;
    const velocity = Math.abs(signedVelocity);
    velocities.push(velocity);
    signedVelocities.push(signedVelocity);
    const moving = velocity >= velocityThreshold;

    if (
      moving &&
      Math.abs(previousSignedVelocity) >= velocityThreshold &&
      Math.sign(previousSignedVelocity) !== Math.sign(signedVelocity) &&
      Math.sign(signedVelocity) !== 0
    ) {
      directionReversalCount += 1;
    }
    previousSignedVelocity = signedVelocity;

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
  const medianSignedVelocity = percentile(
    signedVelocities.map((v) => Math.abs(v)),
    0.5
  );
  const stopStartOscillation =
    (previousZeroCrossings >= 3 &&
      p95Velocity >= oscillationThreshold &&
      maxVisibleStopGapMs >= stopGapThresholdMs) ||
    directionReversalCount >= 2;

  return {
    totalActiveDurationMs,
    movingDurationMs,
    stoppedDurationMs,
    motionDutyCycle,
    maxVisibleStopGapMs,
    medianScrollVelocity,
    p95Velocity,
    velocityStdDev,
    medianSignedVelocity,
    directionReversalCount,
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

function smoothDocumentY(opts: {
  rawDocumentY: number;
  smoothedDocumentY: number | null;
  dtSec: number;
  smoothingTimeSec: number;
}): number {
  if (opts.smoothedDocumentY == null) return opts.rawDocumentY;
  const alpha = 1 - Math.exp(-opts.dtSec / Math.max(0.05, opts.smoothingTimeSec));
  return opts.smoothedDocumentY + (opts.rawDocumentY - opts.smoothedDocumentY) * alpha;
}

function updateEstimatedGrowthPxPerSec(opts: {
  documentY: number;
  previousDocumentY: number | null;
  previousSampleMs: number | null;
  nowMs: number;
  currentEstimate: number;
  contentGrowing?: boolean;
  streamIntervalMs?: number;
  streamCharsPerTick?: number;
}): number {
  if (opts.previousDocumentY == null || opts.previousSampleMs == null) {
    return opts.currentEstimate;
  }
  if (opts.documentY <= opts.previousDocumentY) {
    const decayed = opts.currentEstimate * (opts.contentGrowing ? 0.96 : 0.92);
    return decayed;
  }
  const dtSec = Math.max(0.001, (opts.nowMs - opts.previousSampleMs) / 1000);
  const instant = (opts.documentY - opts.previousDocumentY) / dtSec;
  const expectedMax =
    opts.streamIntervalMs != null && opts.streamIntervalMs > 0
      ? estimateVerticalGrowthPxPerSec(opts.streamIntervalMs, opts.streamCharsPerTick) * 2.5
      : LIVE_FOLLOW_MAX_CATCHUP_SPEED_PX_PER_SEC;
  const clampedInstant = Math.min(instant, expectedMax);
  const blended = opts.currentEstimate * 0.7 + clampedInstant * 0.3;
  return blended;
}

/** Single shared motion engine — TRPG and chat supply their own target resolver. */
export function createLiveReadingFollowController(opts: {
  getViewportHeight: () => number;
  getScrollPosition?: () => number;
  scrollBy: (delta: number) => void;
  resolveTargetElement: () => Element | null;
  shouldFollow: () => boolean;
  targetRatio?: number;
  baseSpeedPxPerSec?: number;
  maxCatchUpSpeedPxPerSec?: number;
  motionProfile?: LiveReadingMotionProfile;
  /** Resolve pacing-aware motion profile each frame (overrides motionProfile when set). */
  getMotionProfile?: () => LiveReadingMotionProfile | undefined;
  /** When true, continuous-flow keeps cruising while content is still revealing. */
  isContentGrowing?: () => boolean;
  prefersReducedMotion?: () => boolean;
  requestAnimationFrame?: (fn: FrameRequestCallback) => number;
  cancelAnimationFrame?: (id: number) => void;
}): LiveReadingFollowController {
  let rafId: number | null = null;
  let lastFrameTimeMs: number | null = null;
  let smoothedDocumentY: number | null = null;
  let previousDocumentY: number | null = null;
  let previousGrowthSampleMs: number | null = null;
  let estimatedGrowthPxPerSec = 0;
  const readScrollY = opts.getScrollPosition ?? getScrollPosition;
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
  const resolveProfile = () => opts.getMotionProfile?.() ?? opts.motionProfile;
  const maxCatchUp = opts.maxCatchUpSpeedPxPerSec ?? LIVE_FOLLOW_MAX_CATCHUP_SPEED_PX_PER_SEC;

  const resetMotionState = () => {
    lastFrameTimeMs = null;
    smoothedDocumentY = null;
    previousDocumentY = null;
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
    const profile = resolveProfile();
    const continuous = isContinuousFlowProfile(profile);
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

    const scrollY = readScrollY();
    const rawDocumentY = resolveTargetDocumentY({ element: el, scrollY });
    estimatedGrowthPxPerSec = updateEstimatedGrowthPxPerSec({
      documentY: rawDocumentY,
      previousDocumentY,
      previousSampleMs: previousGrowthSampleMs,
      nowMs: timestamp,
      currentEstimate: estimatedGrowthPxPerSec,
      contentGrowing: opts.isContentGrowing?.() ?? false,
      streamIntervalMs: profile?.streamIntervalMs,
      streamCharsPerTick: profile?.streamCharsPerTick,
    });
    previousDocumentY = rawDocumentY;
    previousGrowthSampleMs = timestamp;

    const contentGrowing = opts.isContentGrowing?.() ?? false;
    const smoothedRawDocumentY = continuous
      ? smoothDocumentY({
          rawDocumentY,
          smoothedDocumentY,
          dtSec,
          smoothingTimeSec:
            profile?.targetSmoothingTimeSec ?? LIVE_FOLLOW_CONTINUOUS_DEFAULT_SMOOTHING_SEC,
        })
      : rawDocumentY;
    const expectedGrowthPxPerSec =
      continuous &&
      contentGrowing &&
      profile?.streamIntervalMs != null &&
      profile.streamIntervalMs > 0
        ? estimateVerticalGrowthPxPerSec(profile.streamIntervalMs, profile.streamCharsPerTick)
        : 0;
    const paceProjectedDocumentY =
      smoothedDocumentY == null
        ? smoothedRawDocumentY
        : smoothedDocumentY + expectedGrowthPxPerSec * dtSec;
    const effectiveDocumentY = continuous
      ? Math.max(smoothedRawDocumentY, paceProjectedDocumentY)
      : rawDocumentY;
    if (continuous) smoothedDocumentY = effectiveDocumentY;

    const viewportHeight = opts.getViewportHeight();
    const effectiveEndTop = effectiveDocumentY - scrollY;
    const minBandY = viewportHeight * LIVE_READING_MIN_RATIO;
    const delta = narrationFollowDeltaPx({
      endTop: effectiveEndTop,
      viewportHeight,
      targetRatio: opts.targetRatio ?? LIVE_READING_TARGET_RATIO,
      epsilonPx: LIVE_FOLLOW_ANIMATOR_EPSILON_PX,
    });

    let step = 0;

    if (delta > 0) {
      step = reducedMotion()
        ? delta
        : computeLiveFollowFrameStep({
            remainingDeltaPx: delta,
            dtSec,
            viewportHeight,
            baseSpeedPxPerSec: opts.baseSpeedPxPerSec,
            maxCatchUpSpeedPxPerSec: maxCatchUp,
          });
    } else if (
      continuous &&
      !reducedMotion() &&
      contentGrowing &&
      effectiveEndTop > minBandY + LIVE_FOLLOW_ANIMATOR_EPSILON_PX
    ) {
      const cruiseVelocity = computeNaturalCruiseVelocityPxPerSec({
        measuredGrowthPxPerSec: estimatedGrowthPxPerSec,
        streamIntervalMs: profile?.streamIntervalMs,
        charsPerTick: profile?.streamCharsPerTick,
        growthMatchFactor: profile?.growthMatchFactor,
      });
      if (cruiseVelocity > 0) {
        step = cruiseVelocity * dtSec;
      }
    }

    if (continuous && step < 0) step = 0;

    step = capLiveFollowFrameStep({ step, dtSec, maxCatchUpSpeedPxPerSec: maxCatchUp });

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
