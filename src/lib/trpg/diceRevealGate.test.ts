import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  nextDiceRevealGateState,
  shouldHoldRoundReveal,
  TRPG_DICE_REVEAL_GATE_CAP_MS,
} from "./diceRevealGate";

describe("dice reveal gate", () => {
  it("holds a new round with new rolls until the overlay is gone", () => {
    let state = nextDiceRevealGateState(
      { gatedRound: null, holding: false },
      { roundNumber: 5, hasNewRolls: true, overlayVisible: true, overlayDismissed: false }
    );
    assert.equal(state.holding, true);
    assert.equal(state.gatedRound, 5);
    assert.equal(shouldHoldRoundReveal(state, 5), true);
    // overlay still visible -> still holding
    state = nextDiceRevealGateState(state, {
      roundNumber: 5,
      hasNewRolls: true,
      overlayVisible: true,
      overlayDismissed: false,
    });
    assert.equal(state.holding, true);
    // overlay dismissed -> release
    state = nextDiceRevealGateState(state, {
      roundNumber: 5,
      hasNewRolls: true,
      overlayVisible: false,
      overlayDismissed: true,
    });
    assert.equal(state.holding, false);
    assert.equal(shouldHoldRoundReveal(state, 5), false);
  });

  it("does not gate a round with no rolls", () => {
    const state = nextDiceRevealGateState(
      { gatedRound: null, holding: false },
      { roundNumber: 3, hasNewRolls: false, overlayVisible: false, overlayDismissed: false }
    );
    assert.equal(state.holding, false);
    assert.equal(shouldHoldRoundReveal(state, 3), false);
  });

  it("does not hold a different round", () => {
    const state = { gatedRound: 5, holding: true };
    assert.equal(shouldHoldRoundReveal(state, 6), false);
  });

  it("caps the hold window at ~1.5s", () => {
    assert.equal(TRPG_DICE_REVEAL_GATE_CAP_MS, 1500);
  });
});
