/**
 * Client-side reveal gate for the dice overlay.
 *
 * Backend GM/Bot generation never blocks for dice animation. This gate only
 * delays the *frontend presentation* of a new round's narration/action cards
 * until the dice overlay has settled (or a safety watchdog elapses), so a
 * poll that skips ROLLING and lands on GENERATING_NARRATION does not pop the
 * new prose before the dice play.
 */

/** Watchdog only — must exceed full overlay lifecycle (~2200ms). Normal release is overlay dismissed. */
export const TRPG_DICE_REVEAL_GATE_CAP_MS = 3500;

export type TrpgDiceRevealGateState = {
  /** Round number whose narration/actions are currently gated. */
  gatedRound: number | null;
  /** Whether the gate is currently holding back the round's reveal. */
  holding: boolean;
};

export type TrpgDiceRevealGateReleaseReason = "dismissed" | "watchdog";

export function nextDiceRevealGateState(
  prev: TrpgDiceRevealGateState,
  opts: {
    roundNumber: number;
    hasNewRolls: boolean;
    overlayVisible: boolean;
    overlayDismissed: boolean;
    overlayRoundNumber: number;
  }
): TrpgDiceRevealGateState {
  const overlayForRound = opts.overlayRoundNumber === opts.roundNumber;
  const overlayActive = overlayForRound && opts.overlayVisible && !opts.overlayDismissed;
  const overlayFinished = overlayForRound && (opts.overlayDismissed || !opts.overlayVisible);

  const isNewRound = opts.roundNumber !== prev.gatedRound;
  if (isNewRound) {
    return {
      gatedRound: opts.roundNumber,
      holding: opts.hasNewRolls,
    };
  }
  if (!opts.hasNewRolls || overlayFinished) {
    return { gatedRound: opts.roundNumber, holding: false };
  }
  if (overlayActive) {
    return { gatedRound: opts.roundNumber, holding: true };
  }
  return { gatedRound: opts.roundNumber, holding: prev.holding };
}

/** Whether a round's narration/action reveal should be held back by the gate. */
export function shouldHoldRoundReveal(state: TrpgDiceRevealGateState, roundNumber: number): boolean {
  return state.holding && state.gatedRound === roundNumber;
}

export function resolveDiceRevealGateReleaseReason(opts: {
  holding: boolean;
  overlayDismissed: boolean;
  overlayVisible: boolean;
  overlayRoundNumber: number;
  roundNumber: number;
  watchdogFired: boolean;
}): TrpgDiceRevealGateReleaseReason | null {
  if (!opts.holding) return null;
  const overlayForRound = opts.overlayRoundNumber === opts.roundNumber;
  if (overlayForRound && (opts.overlayDismissed || !opts.overlayVisible)) return "dismissed";
  if (opts.watchdogFired) return "watchdog";
  return null;
}
