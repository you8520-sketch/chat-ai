import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  applyTrpgDiceOverlaySession,
  shouldAdvanceActorDiceAfterOverlayDismiss,
  trpgDiceOverlayPlaybackReport,
  trpgDiceOverlayPlayOwnerSessionKey,
  trpgDiceOverlaySessionAction,
  trpgDiceRollSessionKey,
} from "./diceRollUx";
import {
  advanceAfterDiceDismiss,
  buildRoundPresentationActors,
  shouldShowActorResultLane,
  startCinematicPresentation,
  type PresentationActor,
} from "./roundPresentation";

const rollA = {
  participantId: 10,
  name: "유저",
  d20: 14,
  dc: 12,
  tier: "SUCCESS" as const,
  statKey: "dex",
  finalScore: 16,
  success: true,
  actionBody: "",
  actionType: "free" as const,
  kind: "human" as const,
};
const rollB = {
  participantId: 20,
  name: "동료",
  d20: 8,
  dc: 12,
  tier: "FAILURE" as const,
  statKey: "dex",
  finalScore: 10,
  success: false,
  actionBody: "",
  actionType: "talk" as const,
  kind: "ai_character" as const,
};

function sessionKey(round: number, roll: typeof rollA): string {
  return trpgDiceRollSessionKey(round, [roll]);
}

describe("TRPG dice overlay playback session handshake", () => {
  const overlay = readFileSync("src/app/trpg/TrpgDiceOverlay.tsx", "utf8");

  it("overlay uses aligned playback report — one lifecycle owner", () => {
    assert.match(overlay, /trpgDiceOverlayPlaybackReport/);
    assert.match(overlay, /playOwnerSessionKeyRef/);
    assert.match(overlay, /trpgDiceOverlayPlayOwnerSessionKey/);
  });

  it("production room uses single actor-dice dismiss gate helper", () => {
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.match(room, /shouldAdvanceActorDiceAfterOverlayDismiss/);
    assert.doesNotMatch(
      room,
      /overlayPlayback\.dismissed \|\| overlayPlayback\.sessionKey !== activeKey/
    );
  });

  it("T_DICE_NEW_SESSION_STALE_DISMISSED: stale dismissed cannot skip a new session", () => {
    const keyA = sessionKey(4, rollA);
    let playOwner = "";
    let play = { started: false, dismissed: true, index: 0 };

    const staleFirstFrame = trpgDiceOverlayPlaybackReport({
      incomingSessionKey: keyA,
      playOwnerSessionKey: playOwner,
      play,
      settled: false,
      rollCount: 1,
    });
    assert.equal(staleFirstFrame.dismissed, false, "A cannot emit authoritative dismissed=true before A starts");
    assert.equal(staleFirstFrame.visible, false);
    assert.equal(
      shouldAdvanceActorDiceAfterOverlayDismiss({
        phase: "actor-dice",
        mode: "cinematic",
        overlayDismissed: staleFirstFrame.dismissed,
        overlaySessionKey: staleFirstFrame.sessionKey,
        activeRollSessionKey: keyA,
      }),
      false,
      "PARENT_DOES_NOT_ADVANCE"
    );

    const action = trpgDiceOverlaySessionAction({
      rollSessionKey: keyA,
      prevRollSessionKey: "",
      consumed: false,
      started: play.started,
      dismissed: play.dismissed,
    });
    assert.equal(action, "start");
    play = applyTrpgDiceOverlaySession(play, action);
    playOwner = trpgDiceOverlayPlayOwnerSessionKey(action, keyA);

    const started = trpgDiceOverlayPlaybackReport({
      incomingSessionKey: keyA,
      playOwnerSessionKey: playOwner,
      play,
      settled: false,
      rollCount: 1,
    });
    assert.equal(started.visible, true, "overlay visible after A starts");
    assert.equal(started.dismissed, false);

    play = { ...play, dismissed: true };
    const settled = trpgDiceOverlayPlaybackReport({
      incomingSessionKey: keyA,
      playOwnerSessionKey: playOwner,
      play,
      settled: true,
      rollCount: 1,
    });
    assert.equal(settled.dismissed, true, "A authoritative dismissed=true after lifecycle");
    assert.equal(
      shouldAdvanceActorDiceAfterOverlayDismiss({
        phase: "actor-dice",
        mode: "cinematic",
        overlayDismissed: settled.dismissed,
        overlaySessionKey: settled.sessionKey,
        activeRollSessionKey: keyA,
      }),
      true,
      "parent advances exactly once to actor-result"
    );

    const actors: PresentationActor[] = buildRoundPresentationActors({
      resolutionOrder: [10],
      actions: [{ participantId: 10, name: "유저", kind: "human", body: "x", revealed: true }],
      rolls: [rollA],
    });
    const diceState = { mode: "cinematic" as const, phase: "actor-dice" as const, presentationIndex: 0 };
    assert.equal(
      shouldShowActorResultLane({ actorId: 10, actors, state: diceState }),
      false,
      "RESULT_LANE_HIDDEN while actor-dice"
    );
    const advanced = {
      ...diceState,
      ...advanceAfterDiceDismiss({ actors, presentationIndex: 0 }),
    };
    assert.equal(advanced.phase, "actor-result");
    assert.equal(
      shouldShowActorResultLane({ actorId: 10, actors, state: advanced }),
      true,
      "RESULT_LANE_VISIBLE after active die dismiss"
    );
  });

  it("T_DICE_SECOND_ACTOR_STALE_PREVIOUS_DISMISS: A dismissed must not label B dismissed", () => {
    const keyA = sessionKey(4, rollA);
    const keyB = sessionKey(4, rollB);
    const playAfterA = { started: true, dismissed: true, index: 0 };

    const beforeBStart = trpgDiceOverlayPlaybackReport({
      incomingSessionKey: keyB,
      playOwnerSessionKey: keyA,
      play: playAfterA,
      settled: true,
      rollCount: 1,
    });
    assert.equal(beforeBStart.dismissed, false, "old A dismissed state MUST NOT be labeled as B dismissed");
    assert.equal(beforeBStart.visible, false);
    assert.equal(
      shouldAdvanceActorDiceAfterOverlayDismiss({
        phase: "actor-dice",
        mode: "cinematic",
        overlayDismissed: beforeBStart.dismissed,
        overlaySessionKey: beforeBStart.sessionKey,
        activeRollSessionKey: keyB,
      }),
      false,
      "parent remains actor-dice for B"
    );

    const action = trpgDiceOverlaySessionAction({
      rollSessionKey: keyB,
      prevRollSessionKey: keyA,
      consumed: false,
      started: playAfterA.started,
      dismissed: playAfterA.dismissed,
    });
    assert.equal(action, "start");
    const playB = applyTrpgDiceOverlaySession(playAfterA, action);
    const ownerB = trpgDiceOverlayPlayOwnerSessionKey(action, keyB);
    const afterBStart = trpgDiceOverlayPlaybackReport({
      incomingSessionKey: keyB,
      playOwnerSessionKey: ownerB,
      play: playB,
      settled: false,
      rollCount: 1,
    });
    assert.equal(afterBStart.visible, true, "B overlay visibly starts");
    assert.equal(afterBStart.dismissed, false, "B is not skipped");
  });

  it("T_DICE_RESULT_GATE: result lane follows actor-dice dismissal", () => {
    const actors = buildRoundPresentationActors({
      resolutionOrder: [10, 20],
      actions: [
        { participantId: 10, name: "유저", kind: "human", body: "a", revealed: true },
        { participantId: 20, name: "동료", kind: "ai_character", body: "b", revealed: true },
      ],
      rolls: [rollA, rollB],
    });
    const cinematic = { mode: "cinematic" as const, ...startCinematicPresentation() };

    const diceHuman = { ...cinematic, phase: "actor-dice" as const, presentationIndex: 0 };
    assert.equal(
      shouldShowActorResultLane({ actorId: 10, actors, state: diceHuman }),
      false,
      "RESULT_LANE_VISIBLE=false while active die not dismissed"
    );

    const resultHuman = { ...diceHuman, phase: "actor-result" as const };
    assert.equal(
      shouldShowActorResultLane({ actorId: 10, actors, state: resultHuman }),
      true,
      "RESULT_LANE_VISIBLE=true after active die dismiss"
    );
  });

  it("T_DICE_NO_ROLL_ACTOR: actors without rolls still advance without fake dice", () => {
    const actors = buildRoundPresentationActors({
      resolutionOrder: [10, 20],
      actions: [
        { participantId: 10, name: "유저", kind: "human", body: "a", revealed: true },
        { participantId: 20, name: "동료", kind: "ai_character", body: "b", revealed: true },
      ],
      rolls: [rollB],
    });
    const noRollActor = actors[0]!;
    assert.equal(noRollActor.roll, null);

    const advanced = advanceAfterDiceDismiss({ actors, presentationIndex: 0 });
    assert.equal(advanced.phase, "actor-action");
    assert.equal(advanced.presentationIndex, 1);
  });

  it("proves forbidden transient report that previously skipped dice cinematic", () => {
    const keyB = sessionKey(4, rollB);
    const naiveReport = {
      sessionKey: keyB,
      visible: false,
      dismissed: true,
    };
    assert.equal(
      shouldAdvanceActorDiceAfterOverlayDismiss({
        phase: "actor-dice",
        mode: "cinematic",
        overlayDismissed: naiveReport.dismissed,
        overlaySessionKey: naiveReport.sessionKey,
        activeRollSessionKey: keyB,
      }),
      true,
      "document naive stale handshake that bypassed dice"
    );

    const aligned = trpgDiceOverlayPlaybackReport({
      incomingSessionKey: keyB,
      playOwnerSessionKey: sessionKey(4, rollA),
      play: { started: true, dismissed: true, index: 0 },
      settled: true,
      rollCount: 1,
    });
    assert.equal(
      shouldAdvanceActorDiceAfterOverlayDismiss({
        phase: "actor-dice",
        mode: "cinematic",
        overlayDismissed: aligned.dismissed,
        overlaySessionKey: aligned.sessionKey,
        activeRollSessionKey: keyB,
      }),
      false,
      "aligned report blocks premature advance"
    );
  });
});
