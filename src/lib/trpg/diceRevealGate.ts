/**
 * Client-side reveal gate for the dice overlay.
 *
 * Backend GM/Bot generation never blocks for dice animation. This gate only
 * delays the *frontend presentation* of a new round's narration/action cards
 * until the dice overlay has settled (or a ~1.5s safety cap elapses), so a
 * poll that skips ROLLING and lands on GENERATING_NARRATION does not pop the
 * new prose before the dice play.
 */

export const TRPG_DICE_REVEAL_GATE_CAP_MS = 1500;

export type TrpgDiceRevealGateState = {
  /** Round number whose narration/actions are currently gated. */
  gatedRound: number | null;
  /** Whether the gate is currently holding back the round's reveal. */
  holding: boolean;
};

export function nextDiceRevealGateState(
  prev: TrpgDiceRevealGateState,
  opts: {
    roundNumber: number;
    hasNewRolls: boolean;
    overlayVisible: boolean;
    overlayDismissed: boolean;
  }
): TrpgDiceRevealGateState {
  const isNewRound = opts.roundNumber !== prev.gatedRound;
  if (!isNewRound) {
    // Same round: release once the overlay is gone (or was never needed).
    if (!opts.overlayVisible || opts.overlayDismissed || !opts.hasNewRolls) {
      return { gatedRound: opts.roundNumber, holding: false };
    }
    return { gatedRound: opts.roundNumber, holding: prev.holding };
  }
  // A new round with new rolls should gate until the dice overlay plays.
  if (opts.hasNewRolls && opts.overlayVisible && !opts.overlayDismissed) {
    return { gatedRound: opts.roundNumber, holding: true };
  }
  return { gatedRound: opts.roundNumber, holding: false };
}

/** Whether a round's narration/action reveal should be held back by the gate. */
export function shouldHoldRoundReveal(state: TrpgDiceRevealGateState, roundNumber: number): boolean {
  return state.holding && state.gatedRound === roundNumber;
}
