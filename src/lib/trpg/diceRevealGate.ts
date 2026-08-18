/**
 * Client-side dice presentation + reveal gate.
 *
 * Backend GM/Bot generation never blocks. This only delays frontend reveal of
 * the current round's result/narration until the dice overlay dismisses.
 */

/** Minimum watchdog. Actual timeout is trpgDiceRevealWatchdogMs(rollCount). */
export const TRPG_DICE_REVEAL_GATE_CAP_MS = 4000;

/** Hide current-round results on the same render a new session key arrives, before pending is committed. */
export function shouldHideIncomingRollSession(opts: {
  rollSessionKey: string;
  presentationSessionKey: string;
  isFirstObservation: boolean;
  replayOnMount: boolean;
}): boolean {
  if (!opts.rollSessionKey) return false;
  if (opts.presentationSessionKey === opts.rollSessionKey) return false;
  if (opts.isFirstObservation && opts.replayOnMount !== true) return false;
  return true;
}

/** Incoming session hide is synchronous; do not wait for revealGateReleased to flip. */
export function holdCurrentRoundReveal(opts: {
  incomingSessionHidden: boolean;
  presentationHidesRound: boolean;
  revealGateReleased: boolean;
}): boolean {
  if (opts.incomingSessionHidden) return true;
  return opts.presentationHidesRound && !opts.revealGateReleased;
}

export type TrpgDicePresentationState = "idle" | "pending" | "playing" | "settled" | "dismissed";

export type TrpgDicePresentation = {
  state: TrpgDicePresentationState;
  sessionKey: string;
  roundNumber: number | null;
};

export const IDLE_DICE_PRESENTATION: TrpgDicePresentation = {
  state: "idle",
  sessionKey: "",
  roundNumber: null,
};

export type TrpgDiceRevealGateState = {
  gatedRound: number | null;
  holding: boolean;
};

export type TrpgDiceRevealGateReleaseReason = "dismissed" | "watchdog";

export function nextDicePresentation(
  prev: TrpgDicePresentation,
  opts: {
    rollSessionKey: string;
    roundNumber: number;
    overlayVisible: boolean;
    overlaySettled: boolean;
    overlayDismissed: boolean;
    mountConsume: boolean;
  }
): TrpgDicePresentation {
  const key = opts.rollSessionKey;
  if (!key) return IDLE_DICE_PRESENTATION;

  const isNewSession = key !== prev.sessionKey;
  if (isNewSession) {
    if (opts.mountConsume) {
      return { state: "dismissed", sessionKey: key, roundNumber: opts.roundNumber };
    }
    return { state: "pending", sessionKey: key, roundNumber: opts.roundNumber };
  }

  switch (prev.state) {
    case "idle":
      return prev;
    case "pending":
      if (opts.overlayVisible) return { ...prev, state: "playing" };
      return prev;
    case "playing":
      if (opts.overlayDismissed) return { ...prev, state: "dismissed" };
      if (opts.overlaySettled) return { ...prev, state: "settled" };
      return prev;
    case "settled":
      if (opts.overlayDismissed) return { ...prev, state: "dismissed" };
      return prev;
    case "dismissed":
      return prev;
    default: {
      const _never: never = prev.state;
      return _never;
    }
  }
}

/** Hide every current-round result surface while the presentation session is in flight. */
export function hideCurrentRoundResults(presentation: TrpgDicePresentation, roundNumber: number): boolean {
  if (presentation.roundNumber !== roundNumber) return false;
  return presentation.state === "pending" || presentation.state === "playing" || presentation.state === "settled";
}

export function nextDiceRevealGateState(
  prev: TrpgDiceRevealGateState,
  opts: {
    roundNumber: number;
    presentation: TrpgDicePresentation;
  }
): TrpgDiceRevealGateState {
  const holding = hideCurrentRoundResults(opts.presentation, opts.roundNumber);
  if (!holding && !prev.holding && opts.presentation.roundNumber !== opts.roundNumber) {
    return { gatedRound: opts.roundNumber, holding: false };
  }
  return { gatedRound: opts.roundNumber, holding };
}

export function shouldHoldRoundReveal(state: TrpgDiceRevealGateState, roundNumber: number): boolean {
  return state.holding && state.gatedRound === roundNumber;
}

export function resolveDiceRevealGateReleaseReason(opts: {
  presentation: TrpgDicePresentation;
  watchdogFired: boolean;
}): TrpgDiceRevealGateReleaseReason | null {
  if (opts.presentation.state === "dismissed") return "dismissed";
  if (opts.watchdogFired && hideCurrentRoundResults(opts.presentation, opts.presentation.roundNumber ?? -1)) {
    return "watchdog";
  }
  return null;
}
