import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  nextDiceRevealGateState,
  resolveDiceRevealGateReleaseReason,
  shouldHoldRoundReveal,
  TRPG_DICE_REVEAL_GATE_CAP_MS,
} from "./diceRevealGate";

describe("dice reveal gate", () => {
  it("holds a new round with new rolls until the overlay for that round is dismissed", () => {
    let state = nextDiceRevealGateState(
      { gatedRound: null, holding: false },
      {
        roundNumber: 5,
        hasNewRolls: true,
        overlayVisible: false,
        overlayDismissed: true,
        overlayRoundNumber: 4,
      }
    );
    assert.equal(state.holding, true);
    assert.equal(state.gatedRound, 5);
    assert.equal(shouldHoldRoundReveal(state, 5), true);

    state = nextDiceRevealGateState(state, {
      roundNumber: 5,
      hasNewRolls: true,
      overlayVisible: true,
      overlayDismissed: false,
      overlayRoundNumber: 5,
    });
    assert.equal(state.holding, true);

    state = nextDiceRevealGateState(state, {
      roundNumber: 5,
      hasNewRolls: true,
      overlayVisible: false,
      overlayDismissed: true,
      overlayRoundNumber: 5,
    });
    assert.equal(state.holding, false);
    assert.equal(shouldHoldRoundReveal(state, 5), false);
  });

  it("does not release early from stale overlay state on a previous round", () => {
    let state = nextDiceRevealGateState(
      { gatedRound: null, holding: false },
      {
        roundNumber: 6,
        hasNewRolls: true,
        overlayVisible: false,
        overlayDismissed: true,
        overlayRoundNumber: 5,
      }
    );
    assert.equal(state.holding, true);
    state = nextDiceRevealGateState(state, {
      roundNumber: 6,
      hasNewRolls: true,
      overlayVisible: false,
      overlayDismissed: true,
      overlayRoundNumber: 5,
    });
    assert.equal(state.holding, true);
  });

  it("does not gate a round with no rolls", () => {
    const state = nextDiceRevealGateState(
      { gatedRound: null, holding: false },
      {
        roundNumber: 3,
        hasNewRolls: false,
        overlayVisible: false,
        overlayDismissed: false,
        overlayRoundNumber: 3,
      }
    );
    assert.equal(state.holding, false);
    assert.equal(shouldHoldRoundReveal(state, 3), false);
  });

  it("does not hold a different round", () => {
    const state = { gatedRound: 5, holding: true };
    assert.equal(shouldHoldRoundReveal(state, 6), false);
  });

  it("uses a watchdog cap above the full overlay lifecycle", () => {
    assert.ok(TRPG_DICE_REVEAL_GATE_CAP_MS >= 3000);
  });

  it("resolves release reason from overlay dismissal for the active round", () => {
    assert.equal(
      resolveDiceRevealGateReleaseReason({
        holding: true,
        overlayDismissed: true,
        overlayVisible: false,
        overlayRoundNumber: 7,
        roundNumber: 7,
        watchdogFired: false,
      }),
      "dismissed"
    );
    assert.equal(
      resolveDiceRevealGateReleaseReason({
        holding: true,
        overlayDismissed: false,
        overlayVisible: true,
        overlayRoundNumber: 7,
        roundNumber: 7,
        watchdogFired: true,
      }),
      "watchdog"
    );
  });
});
