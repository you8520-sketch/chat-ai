import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  advanceAfterActorAction,
  buildRoundPresentationActors,
  startCinematicPresentation,
  type RoundPresentationState,
} from "./roundPresentation";
import {
  beginHiddenPresentationSession,
  catchUpHiddenPresentationState,
  isHiddenPresentationCatchUpActive,
  hiddenPresentationSessionStillActive,
  shouldSkipDecorativeReveal,
} from "./presentationHiddenCatchUp";

function action(participantId: number, name: string) {
  return {
    participantId,
    name,
    kind: "ai_character" as const,
    actionType: "talk",
    body: `${name} 행동`,
    revealed: true,
  };
}

function roll(participantId: number, name: string, d20: number) {
  return {
    participantId,
    name,
    statKey: "str",
    d20,
    dc: 12,
    tier: "SUCCESS",
    finalScore: d20,
  };
}

function actorsFor(ids: number[], rolls: Array<[number, string, number]> = []) {
  return buildRoundPresentationActors({
    resolutionOrder: ids,
    actions: ids.map((id, i) => action(id, `AI${id}`)),
    rolls: rolls.map(([id, name, d20]) => roll(id, name, d20)),
  });
}

describe("TRPG hidden presentation catch-up", () => {
  const sessionKey = "5|actions:1,2";

  it("B: hidden queue consumes AI1 → AI2 → GM without replay on return", () => {
    const actors = actorsFor([1, 2]);
    const start: RoundPresentationState = { mode: "cinematic", ...startCinematicPresentation() };
    const caught = catchUpHiddenPresentationState({
      state: start,
      actors,
      gmTextAvailable: true,
    });
    assert.equal(caught.phase, "complete");
    assert.equal(
      isHiddenPresentationCatchUpActive({
        documentHidden: true,
        session: beginHiddenPresentationSession({ sessionKey, roundNumber: 5 }),
        sessionKey,
        cinematic: true,
      }),
      true
    );
    assert.equal(
      shouldSkipDecorativeReveal({
        consumedSessionKey: sessionKey,
        sessionKey,
        hiddenCatchUpActive: false,
      }),
      true
    );
  });

  it("C: hidden before GM data does not fabricate GM; GM catch-up when available", () => {
    const actors = actorsFor([1, 2]);
    const start: RoundPresentationState = { mode: "cinematic", ...startCinematicPresentation() };
    const waiting = catchUpHiddenPresentationState({
      state: start,
      actors,
      gmTextAvailable: false,
    });
    assert.equal(waiting.phase, "gm-narration");
    const complete = catchUpHiddenPresentationState({
      state: waiting,
      actors,
      gmTextAvailable: true,
    });
    assert.equal(complete.phase, "complete");
  });

  it("D: hidden session persists after visible return for late GM catch-up", () => {
    const session = beginHiddenPresentationSession({ sessionKey, roundNumber: 5 });
    assert.equal(
      hiddenPresentationSessionStillActive({ session, sessionKey }),
      true
    );
    assert.equal(
      isHiddenPresentationCatchUpActive({
        documentHidden: false,
        session,
        sessionKey,
        cinematic: true,
      }),
      false
    );
    const actors = actorsFor([1, 2]);
    const waiting: RoundPresentationState = {
      mode: "cinematic",
      phase: "gm-narration",
      presentationIndex: 1,
    };
    const complete = catchUpHiddenPresentationState({
      state: waiting,
      actors,
      gmTextAvailable: true,
    });
    assert.equal(complete.phase, "complete");
  });

  it("new session key clears hidden round ownership", () => {
    const session = beginHiddenPresentationSession({ sessionKey, roundNumber: 5 });
    assert.equal(
      hiddenPresentationSessionStillActive({ session, sessionKey: "6|actions:1" }),
      false
    );
  });

  it("visible cinematic keeps strict actor-action before AI2", () => {
    const actors = actorsFor([1, 2]);
    const ai1Only = advanceAfterActorAction({ actors, presentationIndex: 0 });
    assert.equal(ai1Only.presentationIndex, 1);
    assert.equal(ai1Only.phase, "actor-action");
  });
});
