import {
  createLiveReadingFollowController,
  LIVE_FOLLOW_ANIMATOR_EPSILON_PX,
  LIVE_FOLLOW_BASE_SPEED_PX_PER_SEC,
  LIVE_FOLLOW_MAX_CATCHUP_SPEED_PX_PER_SEC,
  LIVE_FOLLOW_TAIL_SPACER_RATIO,
  LIVE_READING_TARGET_RATIO,
  type LiveReadingFollowController,
} from "../liveReadingFollow";

export {
  LIVE_FOLLOW_ANIMATOR_EPSILON_PX,
  LIVE_FOLLOW_BASE_SPEED_PX_PER_SEC,
  LIVE_FOLLOW_MAX_CATCHUP_SPEED_PX_PER_SEC,
  LIVE_FOLLOW_TAIL_SPACER_RATIO,
  LIVE_READING_TARGET_RATIO,
};

/** @deprecated Use LIVE_FOLLOW_* from liveReadingFollow */
export const TRPG_LIVE_FOLLOW_BASE_SPEED_PX_PER_SEC = LIVE_FOLLOW_BASE_SPEED_PX_PER_SEC;
/** @deprecated */
export const TRPG_LIVE_FOLLOW_MAX_CATCHUP_SPEED_PX_PER_SEC = LIVE_FOLLOW_MAX_CATCHUP_SPEED_PX_PER_SEC;
/** @deprecated */
export const TRPG_LIVE_FOLLOW_ANIMATOR_EPSILON_PX = LIVE_FOLLOW_ANIMATOR_EPSILON_PX;
/** @deprecated */
export const TRPG_LIVE_FOLLOW_TAIL_SPACER_RATIO = LIVE_FOLLOW_TAIL_SPACER_RATIO;

export type TrpgActiveDeclarationEndRef = {
  actorId: number;
  element: HTMLSpanElement | null;
};

export function createEmptyActiveDeclarationEndRef(): TrpgActiveDeclarationEndRef {
  return { actorId: -1, element: null };
}

/** Resolve declaration end sentinel for the active actor only — never a stale Bot1 ref. */
export function resolveActorScopedDeclarationEnd(opts: {
  activeActorId: number | null;
  ref: TrpgActiveDeclarationEndRef;
  queryScopedElement: (actorId: number) => Element | null;
}): Element | null {
  if (opts.activeActorId == null) return null;
  if (opts.ref.element && opts.ref.actorId === opts.activeActorId) {
    return opts.ref.element;
  }
  return opts.queryScopedElement(opts.activeActorId);
}

export type LiveStreamFollowController = LiveReadingFollowController;

/** TRPG wrapper around the shared live reading follow motion engine. */
export function createLiveStreamFollowController(
  opts: Parameters<typeof createLiveReadingFollowController>[0]
): LiveStreamFollowController {
  return createLiveReadingFollowController(opts);
}
