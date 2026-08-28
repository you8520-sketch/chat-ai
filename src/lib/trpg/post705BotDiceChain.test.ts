import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  activePresentationRoll,
  advanceAfterActorAction,
  advanceAfterActorResult,
  advanceAfterDiceDismiss,
  buildRoundPresentationActors,
  shouldShowActorResultLane,
  startCinematicPresentation,
} from "./roundPresentation";
import type { TrpgParticipantAdjudicationOutcome } from "./roundAdjudication";
import type { TrpgPublicAction, TrpgPublicRoll } from "./snapshot";

const H = 10;
const B1 = 20;
const B2 = 30;

function action(participantId: number, kind: TrpgPublicAction["kind"], name: string): TrpgPublicAction {
  return { participantId, name, body: `${name} acts`, revealed: true, kind, actionType: "investigate" };
}

function roll(participantId: number, name: string, d20: number): TrpgPublicRoll {
  return {
    participantId,
    name,
    d20,
    statKey: "nerve",
    finalScore: d20,
    dc: 11,
    tier: d20 >= 11 ? "SUCCESS" : "FAILURE",
    success: d20 >= 11,
    actionBody: "",
    actionType: "investigate",
    kind: participantId === H ? "human" : "ai_character",
  };
}

function outcomes(
  entries: Array<[number, TrpgParticipantAdjudicationOutcome]>
): Map<number, TrpgParticipantAdjudicationOutcome> {
  return new Map(entries);
}

describe("POST-705 H/B1/B2 dice presentation chain", () => {
  it("T_H_B1_B2_CHAIN: outcome roll waits for client roll before actor-dice", () => {
    const human = action(H, "human", "Human");
    const bot1 = action(B1, "ai_character", "Bot1");
    const bot2 = action(B2, "ai_character", "Bot2");
    const humanRoll = roll(H, "Human", 14);
    const bot1Roll = roll(B1, "Bot1", 8);
    const adjudicated = new Set([H, B1, B2]);
    const consumed = new Set([B1, B2]);
    const outcomeMap = outcomes([
      [H, "roll"],
      [B1, "roll"],
      [B2, "no_roll"],
    ]);

    let state = { mode: "cinematic" as const, ...startCinematicPresentation(), presentationIndex: 1 };

    const actorsBeforeBot1Roll = buildRoundPresentationActors({
      resolutionOrder: [H, B1, B2],
      actions: [human, bot1, bot2],
      rolls: [humanRoll],
    });

    const stepB = advanceAfterActorAction({
      actors: actorsBeforeBot1Roll,
      presentationIndex: state.presentationIndex,
      rolls: [humanRoll],
      adjudicatedParticipantIds: new Set([H, B1]),
      declarationConsumedIds: consumed,
      participantAdjudicationOutcomes: outcomeMap,
      awaitingMoreActors: false,
    });
    assert.equal(stepB.phase, "actor-action", "PRESENTATION_PHASE");
    assert.equal(stepB.presentationIndex, 1, "PRESENTATION_INDEX Bot1");
    assert.equal(
      shouldShowActorResultLane({
        actorId: B1,
        actors: actorsBeforeBot1Roll,
        state: { ...state, ...stepB },
      }),
      false,
      "BOT1_RESULT_VISIBLE"
    );
    assert.notEqual(stepB.phase, "actor-dice", "BOT1_OVERLAY_VISIBLE");

    const actorsWithBot1Roll = buildRoundPresentationActors({
      resolutionOrder: [H, B1, B2],
      actions: [human, bot1, bot2],
      rolls: [humanRoll, bot1Roll],
    });
    const stepC = advanceAfterActorAction({
      actors: actorsWithBot1Roll,
      presentationIndex: 1,
      rolls: [humanRoll, bot1Roll],
      adjudicatedParticipantIds: new Set([H, B1]),
      declarationConsumedIds: consumed,
      participantAdjudicationOutcomes: outcomeMap,
      awaitingMoreActors: false,
    });
    assert.deepEqual(stepC, { phase: "actor-dice", presentationIndex: 1 }, "BOT1_DICE_PHASE_ENTERED");
    const diceState = { ...state, ...stepC };
    assert.equal(
      activePresentationRoll({ actors: actorsWithBot1Roll, state: diceState })?.participantId,
      B1,
      "ACTIVE_PRESENTATION_ROLL"
    );

    const afterDismiss = {
      ...diceState,
      ...advanceAfterDiceDismiss({
        actors: actorsWithBot1Roll,
        presentationIndex: 1,
        rolls: [humanRoll, bot1Roll],
        adjudicatedParticipantIds: new Set([H, B1]),
        declarationConsumedIds: consumed,
        participantAdjudicationOutcomes: outcomeMap,
      }),
    };
    assert.equal(afterDismiss.phase, "actor-result", "BOT1_RESULT_BEFORE_DICE_DISMISS guard after dismiss");
    assert.equal(
      shouldShowActorResultLane({ actorId: B1, actors: actorsWithBot1Roll, state: afterDismiss }),
      true
    );

    const afterHold = {
      ...afterDismiss,
      ...advanceAfterActorResult({
        actors: actorsWithBot1Roll,
        presentationIndex: 1,
        adjudicatedParticipantIds: new Set([H, B1, B2]),
        declarationConsumedIds: consumed,
        participantAdjudicationOutcomes: outcomeMap,
        awaitingMoreActors: false,
      }),
    };
    assert.equal(afterHold.phase, "actor-action");
    assert.equal(afterHold.presentationIndex, 2, "Bot2 actor-action");

    const bot2Advance = advanceAfterActorAction({
      actors: actorsWithBot1Roll,
      presentationIndex: 2,
      rolls: [humanRoll, bot1Roll],
      adjudicatedParticipantIds: adjudicated,
      declarationConsumedIds: consumed,
      participantAdjudicationOutcomes: outcomeMap,
      awaitingMoreActors: false,
    });
    assert.notEqual(bot2Advance.phase, "actor-dice", "BOT2_OVERLAY_STARTED false");
    assert.equal(bot2Advance.phase, "gm-narration", "Bot2 no_roll advances to GM");
  });

  it("OUTCOME_ROLL_WITHOUT_CLIENT_ROLL_NEVER_SKIPS", () => {
    const bot1 = action(B1, "ai_character", "Bot1");
    const actors = buildRoundPresentationActors({
      resolutionOrder: [B1],
      actions: [bot1],
      rolls: [],
    });
    const next = advanceAfterActorAction({
      actors,
      presentationIndex: 0,
      rolls: [],
      adjudicatedParticipantIds: new Set([B1]),
      declarationConsumedIds: new Set([B1]),
      participantAdjudicationOutcomes: outcomes([[B1, "roll"]]),
    });
    assert.deepEqual(next, { phase: "actor-action", presentationIndex: 0 });
  });
});
