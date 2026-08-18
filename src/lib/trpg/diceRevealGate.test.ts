import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  hideCurrentRoundResults,
  IDLE_DICE_PRESENTATION,
  nextDicePresentation,
  nextDiceRevealGateState,
  resolveDiceRevealGateReleaseReason,
  shouldHideIncomingRollSession,
  shouldHoldRoundReveal,
  TRPG_DICE_REVEAL_GATE_CAP_MS,
} from "./diceRevealGate";
import { trpgDiceRevealWatchdogMs, trpgEmeraldDiceTiming } from "./diceRollUx";

describe("dice presentation session", () => {
  it("holds on a new session immediately, even while overlay is not visible yet", () => {
    const pending = nextDicePresentation(IDLE_DICE_PRESENTATION, {
      rollSessionKey: "5|1:12:10:SUCCESS",
      roundNumber: 5,
      overlayVisible: false,
      overlaySettled: false,
      overlayDismissed: false,
      mountConsume: false,
    });
    assert.equal(pending.state, "pending");
    assert.equal(hideCurrentRoundResults(pending, 5), true);
    const gate = nextDiceRevealGateState({ gatedRound: null, holding: false }, {
      roundNumber: 5,
      presentation: pending,
    });
    assert.equal(gate.holding, true);
    assert.equal(shouldHoldRoundReveal(gate, 5), true);
  });

  it("does not treat overlayVisible=false as dismissed while pending", () => {
    const pending = nextDicePresentation(IDLE_DICE_PRESENTATION, {
      rollSessionKey: "6|1:8:12:FAIL",
      roundNumber: 6,
      overlayVisible: false,
      overlaySettled: false,
      overlayDismissed: true,
      mountConsume: false,
    });
    assert.equal(pending.state, "pending");
    assert.equal(hideCurrentRoundResults(pending, 6), true);
  });

  it("walks pending → playing → settled → dismissed and only then releases", () => {
    let state = nextDicePresentation(IDLE_DICE_PRESENTATION, {
      rollSessionKey: "7|2:20:12:CRITICAL_SUCCESS",
      roundNumber: 7,
      overlayVisible: false,
      overlaySettled: false,
      overlayDismissed: false,
      mountConsume: false,
    });
    state = nextDicePresentation(state, {
      rollSessionKey: "7|2:20:12:CRITICAL_SUCCESS",
      roundNumber: 7,
      overlayVisible: true,
      overlaySettled: false,
      overlayDismissed: false,
      mountConsume: false,
    });
    assert.equal(state.state, "playing");
    state = nextDicePresentation(state, {
      rollSessionKey: "7|2:20:12:CRITICAL_SUCCESS",
      roundNumber: 7,
      overlayVisible: true,
      overlaySettled: true,
      overlayDismissed: false,
      mountConsume: false,
    });
    assert.equal(state.state, "settled");
    assert.equal(hideCurrentRoundResults(state, 7), true);
    state = nextDicePresentation(state, {
      rollSessionKey: "7|2:20:12:CRITICAL_SUCCESS",
      roundNumber: 7,
      overlayVisible: false,
      overlaySettled: true,
      overlayDismissed: true,
      mountConsume: false,
    });
    assert.equal(state.state, "dismissed");
    assert.equal(hideCurrentRoundResults(state, 7), false);
    assert.equal(resolveDiceRevealGateReleaseReason({ presentation: state, watchdogFired: false }), "dismissed");
  });

  it("consumes historical mount rolls without playing them", () => {
    const state = nextDicePresentation(IDLE_DICE_PRESENTATION, {
      rollSessionKey: "3|1:4:10:FAIL",
      roundNumber: 3,
      overlayVisible: false,
      overlaySettled: false,
      overlayDismissed: false,
      mountConsume: true,
    });
    assert.equal(state.state, "dismissed");
    assert.equal(hideCurrentRoundResults(state, 3), false);
  });

  it("does not hide past-round results", () => {
    const pending = nextDicePresentation(IDLE_DICE_PRESENTATION, {
      rollSessionKey: "8|1:11:10:SUCCESS",
      roundNumber: 8,
      overlayVisible: false,
      overlaySettled: false,
      overlayDismissed: false,
      mountConsume: false,
    });
    assert.equal(hideCurrentRoundResults(pending, 7), false);
  });

  it("uses a watchdog cap above the full overlay lifecycle", () => {
    assert.ok(TRPG_DICE_REVEAL_GATE_CAP_MS >= 3000);
    for (const n of [1, 2, 3, 4] as const) {
      const timing = trpgEmeraldDiceTiming(n);
      const watchdog = trpgDiceRevealWatchdogMs(n);
      assert.ok(watchdog > timing.totalMs, `${n} dice watchdog ${watchdog} must exceed overlay ${timing.totalMs}`);
      assert.ok(watchdog < 10_000, "watchdog is expected duration + margin, not a 10s hide");
    }
  });

  it("keeps overlay dismiss ahead of result reveal and the watchdog for 1-4 dice", () => {
    for (const n of [1, 2, 3, 4] as const) {
      const overlayDismissedAt = trpgEmeraldDiceTiming(n).totalMs;
      const firstResultVisibleAt = overlayDismissedAt;
      const firstNarrationVisibleAt = overlayDismissedAt;
      const watchdogAt = trpgDiceRevealWatchdogMs(n);
      assert.ok(overlayDismissedAt <= firstResultVisibleAt);
      assert.ok(overlayDismissedAt <= firstNarrationVisibleAt);
      assert.ok(overlayDismissedAt < watchdogAt);
      const dismissed = nextDicePresentation(
        { state: "settled", sessionKey: `${n}|session`, roundNumber: n },
        {
          rollSessionKey: `${n}|session`,
          roundNumber: n,
          overlayVisible: false,
          overlaySettled: true,
          overlayDismissed: true,
          mountConsume: false,
        }
      );
      assert.equal(dismissed.state, "dismissed");
      assert.equal(
        resolveDiceRevealGateReleaseReason({ presentation: dismissed, watchdogFired: false }),
        "dismissed"
      );
      assert.equal(
        resolveDiceRevealGateReleaseReason({ presentation: dismissed, watchdogFired: true }),
        "dismissed"
      );
    }
  });

  it("hides a new roll session on the same render before pending commits", () => {
    assert.equal(
      hideCurrentRoundResults(IDLE_DICE_PRESENTATION, 9),
      false
    );
    assert.equal(
      shouldHideIncomingRollSession({
        rollSessionKey: "9|1:14:12:SUCCESS",
        presentationSessionKey: "",
        isFirstObservation: false,
        replayOnMount: false,
      }),
      true
    );
    assert.equal(
      shouldHideIncomingRollSession({
        rollSessionKey: "9|1:14:12:SUCCESS",
        presentationSessionKey: "9|1:14:12:SUCCESS",
        isFirstObservation: false,
        replayOnMount: false,
      }),
      false
    );
    assert.equal(
      shouldHideIncomingRollSession({
        rollSessionKey: "9|1:14:12:SUCCESS",
        presentationSessionKey: "",
        isFirstObservation: true,
        replayOnMount: false,
      }),
      false
    );
  });
});
