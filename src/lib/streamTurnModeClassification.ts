/**
 * Stream turn mode classification — separates post-stream lock (Responsibility A)
 * from HTML instant visual mode (Responsibility B).
 *
 * Invariant: STATUS_WIDGET_POSTPROCESS != HTML_FLASH_TURN
 * Status localized text must never flip whole-turn instant reveal mode.
 */

/** Canonical producers — keep in sync with /api/chat/route.ts send({ type: "status" }). */
export const NORMAL_STATUS_WIDGET_GENERATION_MESSAGE = "상태창 생성 중…" as const;
export const HTML_FLASH_GENERATION_MESSAGE = "HTML 생성 중…" as const;
export const POSTPROCESS_FINISH_MESSAGE = "마무리 중…" as const;
export const POSTPROCESS_LENGTH_SUPPLEMENT_MESSAGE = "분량 보강 중…" as const;

export const HTML_FLASH_EXPLICIT_OWNER = "done.htmlFlashTurn === true";

/** Responsibility A — main RP ended; block non-instant prose append/replace. */
const POST_STREAM_LOCK_STATUS_RE =
  /마무리|분량 보강|HTML 생성|상태창 생성/i;

export type StreamTurnModeState = {
  htmlFlashStreamTurn: boolean;
  postStreamLocked: boolean;
};

export function createInitialStreamTurnModeState(): StreamTurnModeState {
  return { htmlFlashStreamTurn: false, postStreamLocked: false };
}

export function shouldLockPostStreamFromStatusMessage(
  message: string | null | undefined
): boolean {
  return Boolean(message && POST_STREAM_LOCK_STATUS_RE.test(message));
}

/**
 * Responsibility B — localized status text must NOT enable HTML flash mode.
 * Explicit evidence only: done.htmlFlashTurn or instant replace during post-stream lock.
 */
export function shouldSetHtmlFlashFromStatusMessage(
  _message: string | null | undefined
): boolean {
  return false;
}

export function applyStatusSseToStreamTurnMode(
  state: StreamTurnModeState,
  message: string | null | undefined
): StreamTurnModeState {
  const next = { ...state };
  if (shouldLockPostStreamFromStatusMessage(message)) {
    next.postStreamLocked = true;
  }
  if (shouldSetHtmlFlashFromStatusMessage(message)) {
    next.htmlFlashStreamTurn = true;
  }
  return next;
}

/** HTML visual card instant replace during post-stream lock — explicit instant prose snap owner. */
export function applyInstantReplaceDuringPostStreamLock(
  state: StreamTurnModeState,
  instant: boolean
): StreamTurnModeState {
  if (state.postStreamLocked && instant) {
    return { ...state, htmlFlashStreamTurn: true };
  }
  return state;
}

export function applyExplicitHtmlFlashTurnFlag(
  state: StreamTurnModeState,
  htmlFlashTurn: boolean | undefined
): StreamTurnModeState {
  if (htmlFlashTurn === true) {
    return { ...state, htmlFlashStreamTurn: true };
  }
  return state;
}

export function resolveInstantRevealAtStreamDone(input: {
  streamIntervalMs: number;
  htmlFlashStreamTurn: boolean;
  htmlFlashTurn?: boolean;
}): boolean {
  return (
    input.streamIntervalMs <= 0 ||
    input.htmlFlashStreamTurn ||
    input.htmlFlashTurn === true
  );
}

export type StreamDoneRevealDecision = {
  instantReveal: boolean;
  pr826DeferPathEntered: boolean;
  forcedFlushAtDone: boolean;
};

export function planStreamDoneRevealDecision(input: {
  streamIntervalMs: number;
  htmlFlashStreamTurn: boolean;
  htmlFlashTurn?: boolean;
  revealIdle: boolean;
  hasFinalContent: boolean;
}): StreamDoneRevealDecision {
  const instantReveal = resolveInstantRevealAtStreamDone(input);
  const forcedFlushAtDone = instantReveal && input.hasFinalContent;
  const pr826DeferPathEntered =
    input.hasFinalContent &&
    !instantReveal &&
    input.streamIntervalMs > 0 &&
    !input.revealIdle;
  return { instantReveal, pr826DeferPathEntered, forcedFlushAtDone };
}
