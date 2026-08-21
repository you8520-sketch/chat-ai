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
