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

export type LiveReadingFollowController = {
  notifyTargetUpdate: () => void;
  stop: () => void;
  isRunning: () => boolean;
};

/** Single shared motion engine — TRPG and chat supply their own target resolver. */
export function createLiveReadingFollowController(opts: {
  getViewportHeight: () => number;
  scrollBy: (delta: number) => void;
  resolveTargetElement: () => Element | null;
  shouldFollow: () => boolean;
  targetRatio?: number;
  baseSpeedPxPerSec?: number;
  maxCatchUpSpeedPxPerSec?: number;
  prefersReducedMotion?: () => boolean;
  requestAnimationFrame?: (fn: FrameRequestCallback) => number;
  cancelAnimationFrame?: (id: number) => void;
  now?: () => number;
}): LiveReadingFollowController {
  let rafId: number | null = null;
  let lastFrameTimeMs: number | null = null;
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
  const now = opts.now ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
  const reducedMotion = opts.prefersReducedMotion ?? prefersReducedLiveReadingMotion;

  const tick = (timestamp: number) => {
    rafId = null;
    if (!opts.shouldFollow()) {
      lastFrameTimeMs = null;
      return;
    }
    const el = opts.resolveTargetElement();
    if (!el) {
      lastFrameTimeMs = null;
      return;
    }
    const dtSec =
      lastFrameTimeMs == null ? 1 / 60 : Math.min(0.05, Math.max(0, (timestamp - lastFrameTimeMs) / 1000));
    lastFrameTimeMs = timestamp;

    const delta = narrationFollowDeltaPx({
      endTop: el.getBoundingClientRect().top,
      viewportHeight: opts.getViewportHeight(),
      targetRatio: opts.targetRatio ?? LIVE_READING_TARGET_RATIO,
      epsilonPx: LIVE_FOLLOW_ANIMATOR_EPSILON_PX,
    });

    if (delta === 0) {
      lastFrameTimeMs = null;
      return;
    }

    const step = reducedMotion()
      ? delta
      : computeLiveFollowFrameStep({
          remainingDeltaPx: delta,
          dtSec,
          viewportHeight: opts.getViewportHeight(),
          baseSpeedPxPerSec: opts.baseSpeedPxPerSec,
          maxCatchUpSpeedPxPerSec: opts.maxCatchUpSpeedPxPerSec,
        });
    if (step !== 0) opts.scrollBy(step);

    if (reducedMotion()) {
      lastFrameTimeMs = null;
      return;
    }

    rafId = raf(tick);
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
      lastFrameTimeMs = null;
    },
    isRunning: () => rafId != null,
  };
}
