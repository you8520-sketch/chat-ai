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
  preCinematicVisibleIds?: readonly number[];
}): string {
  return [
    opts.roundNumber,
    opts.mode,
    opts.phase,
    opts.presentationIndex,
    opts.revealedActorCount,
    opts.resultLaneCount,
    opts.gmVisible ? 1 : 0,
    opts.preCinematicVisibleIds?.join(",") ?? "",
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

/** Newest log row whose GM text arrived after this room mount. */
export function liveFreshGmNarrationRow(opts: {
  log: ReadonlyArray<{ roundNumber: number; narration: string | null }>;
  seenKeys: Iterable<string>;
}): { roundNumber: number; narration: string } | null {
  const seen = opts.seenKeys instanceof Set ? opts.seenKeys : new Set(opts.seenKeys);
  let found: { roundNumber: number; narration: string } | null = null;
  for (const row of opts.log) {
    const narration = row.narration?.trim() ?? "";
    if (!narration) continue;
    if (seen.has(`n:${row.roundNumber}`)) continue;
    found = { roundNumber: row.roundNumber, narration };
  }
  return found;
}

export type TrpgLiveFollowOwner =
  | "CURRENT_ACTOR"
  | "ACTIVE_DECLARATION_END"
  | "GM_NARRATION_END"
  | "NEXT_ACTION"
  | "NONE";

/** Single resolver for which live element owns auto-follow during a TRPG round. */
export function resolveTrpgLiveFollowOwner(opts: {
  cinematicMotion: boolean;
  activeDeclarationReveal?: boolean;
  freshGmRound: number | null;
  gmRevealComplete: boolean;
  nextActionVisible: boolean;
}): TrpgLiveFollowOwner {
  if (opts.activeDeclarationReveal === true) return "ACTIVE_DECLARATION_END";
  if (opts.cinematicMotion) return "CURRENT_ACTOR";
  if (opts.freshGmRound != null) {
    if (!opts.gmRevealComplete) return "GM_NARRATION_END";
    return "NEXT_ACTION";
  }
  if (opts.nextActionVisible) return "NEXT_ACTION";
  return "NONE";
}

/** Lower-reading-band follow delta for any live stream end sentinel (GM or declaration). */
export function readingBandFollowDeltaFromElement(el: Element): number {
  return narrationFollowDeltaFromElement(el);
}

export function isNearReadingBandFollowElement(el: Element): boolean {
  return isNearNarrationFollowElement(el);
}

/** ResizeObserver growth callback owner — matches TrpgCampaignRoom live scene observer. */
export function handleTrpgLiveSceneResizeGrowth(opts: {
  following: boolean;
  manualDetached: boolean;
  liveFollowOwner: TrpgLiveFollowOwner;
  followScrollRafRef: { current: number | null };
  requestAnimationFrame: (fn: FrameRequestCallback) => number;
  cancelAnimationFrame: (handle: number) => void;
  scrollToFollowOwner: (owner: TrpgLiveFollowOwner, behavior?: ScrollBehavior) => void;
  onUnseenLatest: () => void;
}): void {
  const growth = decideLiveFollowOnGrowth({ following: opts.following });
  if (growth.autoFollow) {
    if (opts.followScrollRafRef.current != null) {
      opts.cancelAnimationFrame(opts.followScrollRafRef.current);
    }
    opts.followScrollRafRef.current = opts.requestAnimationFrame(() => {
      opts.followScrollRafRef.current = null;
      if (!opts.following || opts.manualDetached) return;
      opts.scrollToFollowOwner(opts.liveFollowOwner, "instant");
    });
  } else if (growth.unseenLatest) {
    opts.onUnseenLatest();
  }
}

/** Measurement + scrollBy owner for declaration/GM reading-band follow. */
export function applyTrpgReadingBandEndFollow(opts: {
  element: Element;
  scrollBy: (delta: number, behavior?: ScrollBehavior) => void;
  behavior?: ScrollBehavior;
}): number {
  const delta = readingBandFollowDeltaFromElement(opts.element);
  if (delta !== 0) opts.scrollBy(delta, opts.behavior ?? "instant");
  return delta;
}

/** alignReadingBandEnd scheduling owner — instant path applies synchronously inside programmatic scroll. */
export function scheduleTrpgReadingBandEndFollow(opts: {
  element: Element;
  behavior: ScrollBehavior;
  narrationFollowRafRef: { current: number | null };
  requestAnimationFrame: (fn: FrameRequestCallback) => number;
  cancelAnimationFrame: (handle: number) => void;
  scrollBy: (delta: number, behavior?: ScrollBehavior) => void;
  runProgrammaticScroll: (fn: () => void, behavior: ScrollBehavior) => void;
  cancelPendingFollowScroll: () => void;
}): void {
  const apply = () => {
    applyTrpgReadingBandEndFollow({
      element: opts.element,
      scrollBy: opts.scrollBy,
      behavior: opts.behavior,
    });
  };
  if (opts.behavior === "smooth") {
    opts.runProgrammaticScroll(apply, opts.behavior);
    return;
  }
  opts.cancelPendingFollowScroll();
  opts.runProgrammaticScroll(apply, opts.behavior);
}

export const TRPG_SCROLL_INTENT_KEYS = new Set([
  "PageUp",
  "PageDown",
  "Home",
  "End",
  "ArrowUp",
  "ArrowDown",
  " ",
  "Spacebar",
]);

export function isTrpgScrollIntentKey(key: string): boolean {
  return TRPG_SCROLL_INTENT_KEYS.has(key);
}

export function shouldDetachLiveFollowOnWheel(deltaY: number): boolean {
  return deltaY < 0;
}

export function shouldDetachLiveFollowOnKey(key: string): boolean {
  return key === "PageUp" || key === "Home" || key === "ArrowUp";
}

export function shouldDetachLiveFollowOnTouchDelta(deltaY: number): boolean {
  return deltaY < 0;
}

export function shouldDetachLiveFollowOnUserIntent(): boolean {
  return true;
}

export function freezeViewportScrollPosition(): number {
  if (typeof window === "undefined") return 0;
  const top = window.scrollY;
  window.scrollTo({ top, left: 0, behavior: "instant" });
  return top;
}

export function updateManualDetachFollowZone(opts: {
  manualDetached: boolean;
  nearFollowOwner: boolean;
  hasLeftFollowZoneSinceDetach: boolean;
}): { hasLeftFollowZoneSinceDetach: boolean } {
  if (!opts.manualDetached) {
    return { hasLeftFollowZoneSinceDetach: opts.hasLeftFollowZoneSinceDetach };
  }
  if (!opts.nearFollowOwner) {
    return { hasLeftFollowZoneSinceDetach: true };
  }
  return { hasLeftFollowZoneSinceDetach: opts.hasLeftFollowZoneSinceDetach };
}

/** Passive layout scroll must not detach follow — only explicit user intent may rejoin. */
export function decidePassiveScrollFollowUpdate(opts: {
  manualDetached: boolean;
  following: boolean;
  nearFollowOwner: boolean;
  hasLeftFollowZoneSinceDetach: boolean;
}): {
  following: boolean;
  unseenLatest: boolean;
  hasLeftFollowZoneSinceDetach: boolean;
  rejoin: boolean;
} {
  if (!opts.manualDetached) {
    return {
      following: opts.following,
      unseenLatest: false,
      hasLeftFollowZoneSinceDetach: false,
      rejoin: false,
    };
  }
  const zone = updateManualDetachFollowZone({
    manualDetached: true,
    nearFollowOwner: opts.nearFollowOwner,
    hasLeftFollowZoneSinceDetach: opts.hasLeftFollowZoneSinceDetach,
  });
  return {
    following: false,
    unseenLatest: !opts.nearFollowOwner,
    hasLeftFollowZoneSinceDetach: zone.hasLeftFollowZoneSinceDetach,
    rejoin: false,
  };
}

export const TRPG_PROGRAMMATIC_SCROLL_SMOOTH_FALLBACK_MS = 800;
export const TRPG_PROGRAMMATIC_SCROLL_INSTANT_SETTLE_MS = 48;

export type TrpgProgrammaticScrollHandle = {
  active: boolean;
  settleTimer: ReturnType<typeof setTimeout> | null;
  scrollEndHandler: (() => void) | null;
};

export function createTrpgProgrammaticScrollHandle(): TrpgProgrammaticScrollHandle {
  return { active: false, settleTimer: null, scrollEndHandler: null };
}

export function trpgProgrammaticScrollScrollEndSupported(): boolean {
  return typeof window !== "undefined" && "onscrollend" in window;
}

export function beginTrpgProgrammaticScroll(opts: {
  handle: TrpgProgrammaticScrollHandle;
  behavior: ScrollBehavior;
  scrollEndSupported?: boolean;
  smoothFallbackMs?: number;
  instantSettleMs?: number;
  onActiveChange: (active: boolean) => void;
  scheduleTimeout?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  addScrollEndListener?: (handler: () => void) => void;
  removeScrollEndListener?: (handler: () => void) => void;
}): void {
  cancelTrpgProgrammaticScroll({
    handle: opts.handle,
    onActiveChange: opts.onActiveChange,
    removeScrollEndListener: opts.removeScrollEndListener,
    clearTimeoutFn: opts.scheduleTimeout ? clearTimeout : undefined,
  });

  opts.handle.active = true;
  opts.onActiveChange(true);

  const finish = () => {
    cancelTrpgProgrammaticScroll({
      handle: opts.handle,
      onActiveChange: opts.onActiveChange,
      removeScrollEndListener: opts.removeScrollEndListener,
      clearTimeoutFn: opts.scheduleTimeout ? clearTimeout : undefined,
    });
  };

  const useScrollEnd =
    opts.behavior === "smooth" &&
    (opts.scrollEndSupported ?? trpgProgrammaticScrollScrollEndSupported()) &&
    opts.addScrollEndListener != null;

  if (useScrollEnd && opts.addScrollEndListener) {
    const addScrollEndListener = opts.addScrollEndListener;
    const handler = () => finish();
    opts.handle.scrollEndHandler = handler;
    addScrollEndListener(handler);
  }

  const delay =
    opts.behavior === "smooth"
      ? opts.smoothFallbackMs ?? TRPG_PROGRAMMATIC_SCROLL_SMOOTH_FALLBACK_MS
      : opts.instantSettleMs ?? TRPG_PROGRAMMATIC_SCROLL_INSTANT_SETTLE_MS;

  const schedule = opts.scheduleTimeout ?? setTimeout;
  opts.handle.settleTimer = schedule(finish, delay);
}

export function cancelTrpgProgrammaticScroll(opts: {
  handle: TrpgProgrammaticScrollHandle;
  onActiveChange: (active: boolean) => void;
  removeScrollEndListener?: (handler: () => void) => void;
  clearTimeoutFn?: (id: ReturnType<typeof setTimeout>) => void;
}): void {
  const clearTimeoutFn = opts.clearTimeoutFn ?? clearTimeout;
  if (opts.handle.settleTimer != null) {
    clearTimeoutFn(opts.handle.settleTimer);
    opts.handle.settleTimer = null;
  }
  if (opts.handle.scrollEndHandler != null) {
    opts.removeScrollEndListener?.(opts.handle.scrollEndHandler);
    opts.handle.scrollEndHandler = null;
  }
  if (opts.handle.active) {
    opts.handle.active = false;
    opts.onActiveChange(false);
  }
}

/** Count scrollIntoView({ behavior: "smooth" }) calls outside scrollToFollowOwner. */
export function countRawSmoothScrollBypass(source: string): number {
  const ownerFn = source.match(/const scrollToFollowOwner = useCallback\([\s\S]*?\n  \);/);
  const outside = ownerFn ? source.replace(ownerFn[0]!, "") : source;
  const matches = outside.match(/scrollIntoView\(\{[^}]*behavior:\s*"smooth"/g);
  return matches?.length ?? 0;
}

export function shouldShowTrpgReplySuggestions(opts: {
  suggestionsEnabled: boolean;
  freshGmRound: number | null;
  gmRevealComplete: boolean;
  hasSuggestions: boolean;
  hasSuggestionsError: boolean;
}): boolean {
  if (!opts.suggestionsEnabled) return false;
  if (opts.freshGmRound != null && !opts.gmRevealComplete) return false;
  return opts.hasSuggestions || opts.hasSuggestionsError;
}

export type GmRevealReport = {
  roundNumber: number | null;
  complete: boolean;
  progressive?: boolean;
};

export type ActorRevealReport = {
  roundNumber: number | null;
  participantId: number | null;
  complete: boolean;
  progressive?: boolean;
};

export function actorRevealReportsEqual(
  a: ActorRevealReport | null | undefined,
  b: ActorRevealReport | null | undefined
): boolean {
  if (a == null || b == null) return a === b;
  return (
    a.roundNumber === b.roundNumber &&
    a.participantId === b.participantId &&
    a.complete === b.complete &&
    a.progressive === b.progressive
  );
}

/** Preserve report reference when semantic fields are unchanged. */
export function mergeActorRevealReport(
  prev: ActorRevealReport,
  next: ActorRevealReport
): ActorRevealReport {
  return actorRevealReportsEqual(prev, next) ? prev : next;
}

/** Session-scoped GM reveal completion keyed to the reporting row. */
export function resolveEffectiveGmRevealComplete(opts: {
  freshGmRound: number | null;
  report: GmRevealReport | null;
}): boolean {
  if (opts.freshGmRound == null) return false;
  if (opts.report?.roundNumber !== opts.freshGmRound) return false;
  return opts.report.complete;
}

/** Session-scoped actor reveal completion keyed to the active presentation actor. */
export function resolveEffectiveActorRevealComplete(opts: {
  roundNumber: number;
  activeParticipantId: number | null;
  report: ActorRevealReport | null;
}): boolean {
  if (opts.activeParticipantId == null) return false;
  if (opts.report?.roundNumber !== opts.roundNumber) return false;
  if (opts.report.participantId !== opts.activeParticipantId) return false;
  return opts.report.complete;
}

export function hasActiveTextSelection(
  selection: Pick<Selection, "isCollapsed" | "toString"> | null | undefined
): boolean {
  return Boolean(selection && !selection.isCollapsed && selection.toString().trim().length > 0);
}

export function isInteractiveRevealFinishTarget(target: Element): boolean {
  return Boolean(
    target.closest(
      "a, button, input, textarea, select, option, label, summary, [role='button'], [role='link'], [contenteditable='true']"
    )
  );
}

export function isNearPresentationCard(
  el: Element,
  thresholdPx = TRPG_FOLLOW_LATEST_THRESHOLD_PX,
  viewportHeight = typeof window !== "undefined" ? window.innerHeight : 0
): boolean {
  const rect = el.getBoundingClientRect();
  const height = viewportHeight > 0 ? viewportHeight : 800;
  return rect.top >= -thresholdPx && rect.bottom <= height + thresholdPx;
}

export function shouldSkipRevealFinishClick(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true;
  if (hasActiveTextSelection(typeof window !== "undefined" ? window.getSelection() : null)) {
    return true;
  }
  return isInteractiveRevealFinishTarget(target);
}
