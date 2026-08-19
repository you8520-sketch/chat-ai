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
