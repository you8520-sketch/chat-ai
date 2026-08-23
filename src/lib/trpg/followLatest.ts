export const TRPG_FOLLOW_LATEST_THRESHOLD_PX = 120;

export function distanceFromBottom(opts: {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
}): number {
  return opts.scrollHeight - opts.scrollTop - opts.clientHeight;
}

export function isNearBottom(
  opts: {
    scrollHeight: number;
    scrollTop: number;
    clientHeight: number;
  },
  thresholdPx = TRPG_FOLLOW_LATEST_THRESHOLD_PX
): boolean {
  return distanceFromBottom(opts) <= thresholdPx;
}

export function livePresentationActivityKey(opts: {
  roundNumber: number;
  mode: string;
  phase: string;
  presentationIndex: number;
  revealedActorCount: number;
  resultLaneCount: number;
  gmVisible: boolean;
}): string {
  return [
    opts.roundNumber,
    opts.mode,
    opts.phase,
    opts.presentationIndex,
    opts.revealedActorCount,
    opts.resultLaneCount,
    opts.gmVisible ? 1 : 0,
  ].join("|");
}

export function decideLiveFollowUpdate(opts: {
  following: boolean;
  activityChanged: boolean;
}): { autoFollow: boolean; unseenLatest: boolean } {
  if (!opts.activityChanged) return { autoFollow: false, unseenLatest: false };
  if (opts.following) return { autoFollow: true, unseenLatest: false };
  return { autoFollow: false, unseenLatest: true };
}

export function decideLiveFollowOnGrowth(opts: { following: boolean }): {
  autoFollow: boolean;
  unseenLatest: boolean;
} {
  return opts.following
    ? { autoFollow: true, unseenLatest: false }
    : { autoFollow: false, unseenLatest: true };
}

/** Keep the live GM reveal end in the lower reading band, not the page bottom. */
export const TRPG_NARRATION_FOLLOW_MIN_RATIO = 0.7;
export const TRPG_NARRATION_FOLLOW_MAX_RATIO = 0.85;
export const TRPG_NARRATION_FOLLOW_TARGET_RATIO = 0.78;
export const TRPG_NARRATION_FOLLOW_EPSILON_PX = 8;

export function narrationFollowDeltaPx(opts: {
  endTop: number;
  viewportHeight: number;
  targetRatio?: number;
  epsilonPx?: number;
}): number {
  const targetY = opts.viewportHeight * (opts.targetRatio ?? TRPG_NARRATION_FOLLOW_TARGET_RATIO);
  const delta = opts.endTop - targetY;
  if (Math.abs(delta) < (opts.epsilonPx ?? TRPG_NARRATION_FOLLOW_EPSILON_PX)) return 0;
  return delta;
}

export function isNearNarrationFollow(opts: {
  endTop: number;
  viewportHeight: number;
  minRatio?: number;
  maxRatio?: number;
}): boolean {
  const ratio = opts.endTop / Math.max(1, opts.viewportHeight);
  return (
    ratio >= (opts.minRatio ?? TRPG_NARRATION_FOLLOW_MIN_RATIO) &&
    ratio <= (opts.maxRatio ?? TRPG_NARRATION_FOLLOW_MAX_RATIO)
  );
}

export function narrationFollowDeltaFromElement(el: Element): number {
  return narrationFollowDeltaPx({
    endTop: el.getBoundingClientRect().top,
    viewportHeight: window.innerHeight,
  });
}

export function isNearNarrationFollowElement(el: Element): boolean {
  return isNearNarrationFollow({
    endTop: el.getBoundingClientRect().top,
    viewportHeight: window.innerHeight,
  });
}
