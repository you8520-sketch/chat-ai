import {
  advanceAfterActorAction,
  advanceAfterActorResult,
  advanceAfterDiceDismiss,
  type PresentationActor,
  type RoundPresentationState,
} from "./roundPresentation";

export type HiddenPresentationSession = {
  sessionKey: string;
  roundNumber: number;
};

export function beginHiddenPresentationSession(opts: {
  sessionKey: string;
  roundNumber: number;
}): HiddenPresentationSession {
  return { sessionKey: opts.sessionKey, roundNumber: opts.roundNumber };
}

/** Hidden catch-up applies only while hidden within the same presentation session. */
export function isHiddenPresentationCatchUpActive(opts: {
  documentHidden: boolean;
  session: HiddenPresentationSession | null;
  sessionKey: string;
  cinematic: boolean;
}): boolean {
  if (!opts.documentHidden || !opts.cinematic || !opts.sessionKey) return false;
  return opts.session?.sessionKey === opts.sessionKey;
}

/** Decorative reveal stays consumed for the rest of the round after hidden fast-forward. */
export function shouldSkipDecorativeReveal(opts: {
  consumedSessionKey: string | null;
  sessionKey: string;
  hiddenCatchUpActive: boolean;
}): boolean {
  if (opts.hiddenCatchUpActive) return true;
  return opts.consumedSessionKey != null && opts.consumedSessionKey === opts.sessionKey;
}

export function hiddenPresentationSessionStillActive(opts: {
  session: HiddenPresentationSession | null;
  sessionKey: string;
}): boolean {
  return opts.session != null && opts.session.sessionKey === opts.sessionKey;
}

/**
 * Fast-forward already-available cosmetic presentation while the tab is hidden.
 * Stops at gm-narration when GM text is not yet available — never fabricates content.
 */
export function catchUpHiddenPresentationState(opts: {
  state: RoundPresentationState;
  actors: readonly PresentationActor[];
  gmTextAvailable: boolean;
}): RoundPresentationState {
  if (opts.state.mode !== "cinematic") return opts.state;
  let state = opts.state;
  let guard = 0;
  while (guard < 64) {
    if (state.phase === "complete") return state;
    if (state.phase === "gm-narration") {
      return opts.gmTextAvailable ? { ...state, phase: "complete" } : state;
    }
    if (state.phase === "idle") return state;
    if (state.phase === "actor-action") {
      state = {
        ...state,
        ...advanceAfterActorAction({
          actors: opts.actors,
          presentationIndex: state.presentationIndex,
        }),
      };
    } else if (state.phase === "actor-dice") {
      state = {
        ...state,
        ...advanceAfterDiceDismiss({
          actors: opts.actors,
          presentationIndex: state.presentationIndex,
        }),
      };
    } else if (state.phase === "actor-result") {
      state = {
        ...state,
        ...advanceAfterActorResult({
          actors: opts.actors,
          presentationIndex: state.presentationIndex,
        }),
      };
    } else {
      return state;
    }
    guard += 1;
  }
  return state;
}

export function presentationStateEquals(a: RoundPresentationState, b: RoundPresentationState): boolean {
  return a.mode === b.mode && a.phase === b.phase && a.presentationIndex === b.presentationIndex;
}
