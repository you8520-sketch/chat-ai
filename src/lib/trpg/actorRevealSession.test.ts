import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  advanceAfterActorAction,
  buildRoundPresentationActors,
  shouldShowGmNarration,
  startCinematicPresentation,
} from "./roundPresentation";
import {
  resolveEffectiveActorRevealComplete,
  type ActorRevealReport,
} from "./followLatest";

const ROUND = 5;
const AI1 = 10;
const AI2 = 20;
const AI_LAST = 30;

function effective(
  activeParticipantId: number | null,
  report: ActorRevealReport | null
): boolean {
  return resolveEffectiveActorRevealComplete({
    roundNumber: ROUND,
    activeParticipantId,
    report,
  });
}

function actorsFor(ids: number[]) {
  return buildRoundPresentationActors({
    resolutionOrder: ids,
    actions: ids.map((id) => ({
      participantId: id,
      name: `AI${id}`,
      kind: "ai_character" as const,
      actionType: "talk",
      body: `action ${id}`,
      revealed: true,
    })),
    rolls: [],
  });
}

describe("TRPG actor reveal session ownership", () => {
  const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");

  it("stores session-tagged actor reveal reports in the room owner", () => {
    assert.match(room, /ActorRevealReport/);
    assert.match(room, /actorRevealReport/);
    assert.match(room, /resolveEffectiveActorRevealComplete/);
    assert.match(room, /effectiveActorRevealComplete/);
    assert.match(room, /participantId: action\.participantId/);
    assert.doesNotMatch(room, /activeActorRevealComplete/);
  });

  it("1: AI1 complete=true while active actor is AI1 → effective=true", () => {
    assert.equal(
      effective(AI1, { roundNumber: ROUND, participantId: AI1, complete: true, progressive: false }),
      true
    );
  });

  it("2: presentation advances to AI2 before AI2 reports → effective=false", () => {
    const staleAi1Report: ActorRevealReport = {
      roundNumber: ROUND,
      participantId: AI1,
      complete: true,
      progressive: false,
    };
    assert.equal(effective(AI2, staleAi1Report), false);
    assert.equal(effective(AI2, null), false);
  });

  it("3: late stale AI1 complete report while active actor is AI2 → effective=false", () => {
    assert.equal(
      effective(AI2, { roundNumber: ROUND, participantId: AI1, complete: true, progressive: false }),
      false
    );
  });

  it("4: AI2 reports complete=false → effective=false", () => {
    assert.equal(
      effective(AI2, { roundNumber: ROUND, participantId: AI2, complete: false, progressive: true }),
      false
    );
  });

  it("5: AI2 reports complete=true → effective=true", () => {
    assert.equal(
      effective(AI2, { roundNumber: ROUND, participantId: AI2, complete: true, progressive: false }),
      true
    );
  });

  it("6: last AI stale prior-actor report must not open GM; only last AI complete may", () => {
    const actors = actorsFor([AI1, AI2, AI_LAST]);
    let state = { mode: "cinematic" as const, ...startCinematicPresentation() };
    state = { ...state, ...advanceAfterActorAction({ actors, presentationIndex: 0 }) };
    state = { ...state, ...advanceAfterActorAction({ actors, presentationIndex: 1 }) };
    assert.equal(state.presentationIndex, 2);
    assert.equal(shouldShowGmNarration(state), false);

    assert.equal(
      effective(AI_LAST, { roundNumber: ROUND, participantId: AI2, complete: true, progressive: false }),
      false
    );
    assert.equal(
      effective(AI_LAST, { roundNumber: ROUND, participantId: AI_LAST, complete: true, progressive: false }),
      true
    );

    const afterLast = advanceAfterActorAction({ actors, presentationIndex: 2 });
    assert.equal(afterLast.phase, "gm-narration");
  });

  it("rejects reports from a different round number", () => {
    assert.equal(
      resolveEffectiveActorRevealComplete({
        roundNumber: ROUND,
        activeParticipantId: AI1,
        report: { roundNumber: ROUND - 1, participantId: AI1, complete: true },
      }),
      false
    );
  });
});
