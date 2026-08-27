import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  advanceAfterActorAction,
  buildRoundPresentationActors,
  decideLiveRoundPresentation,
  isLiveRoundPresentationReady,
  preCinematicVisibleActionIds,
  resolveLiveRevealedActionIds,
  revealedActorIds,
  shouldDecorativeRevealAction,
  isActorActionRevealBeatSatisfied,
  startCinematicPresentation,
  idlePresentation,
  type RoundPresentationState,
} from "./roundPresentation";
import { resolveTrpgMountSeenKeys } from "../../app/trpg/useRevealedText";

/**
 * Production-shape regression (campaign 38):
 * human@t0, bot1@t+10s, bot2+rolls@t+35s, cinematic@rolls-ready.
 * DECLARATION_ORDER (persistence) != RESOLUTION_ORDER (mechanics).
 */
const order = [10, 20, 30];
const human = { participantId: 10, name: "Human", kind: "human" as const, body: "조사한다.", revealed: true };
const bot1 = { participantId: 20, name: "BotAlpha", kind: "ai_character" as const, body: "앞을 본다.", revealed: true };
const bot2 = { participantId: 30, name: "BotBeta", kind: "ai_character" as const, body: "뒤를 본다.", revealed: true };
const humanRoll = { participantId: 10, d20: 14, dc: 12, tier: "SUCCESS" as const, statKey: "dex", finalScore: 16 };
const bot1Roll = { participantId: 20, d20: 8, dc: 12, tier: "FAILURE" as const, statKey: "dex", finalScore: 10 };
const bot2Roll = { participantId: 30, d20: 17, dc: 12, tier: "SUCCESS" as const, statKey: "dex", finalScore: 19 };

function visibleAt(actions: typeof human[], rolls: typeof humanRoll[], phase: string) {
  const decided = decideLiveRoundPresentation({
    phase,
    roundNumber: 1,
    actions,
    rolls,
    resolutionOrder: order,
  });
  const preIds = preCinematicVisibleActionIds(actions);
  const mode = decided.ready ? "cinematic" : "idle";
  const state: RoundPresentationState = decided.ready
    ? { mode: "cinematic", ...startCinematicPresentation() }
    : idlePresentation();
  const cinematicIds = revealedActorIds({ actors: decided.actors, state });
  const visible =
    resolveLiveRevealedActionIds({
      isLiveRow: true,
      mode: state.mode,
      cinematicRevealedIds: cinematicIds,
      preCinematicVisibleIds: preIds,
    }) ?? [];
  return { decided, preIds, visible, state, mode };
}

describe("TRPG two-bot production-shape declaration visibility", () => {
  it("bot1 visible before bot2 completes; cinematic not roll-ready until rolls persist", () => {
    const t0 = visibleAt([human], [], "BOT_ACTION");
    assert.deepEqual(t0.preIds, [10]);
    assert.deepEqual(t0.visible, [10]);
    assert.equal(t0.decided.ready, false);

    const tBot1 = visibleAt([human, bot1], [], "BOT_ACTION");
    assert.deepEqual(tBot1.preIds, [10, 20]);
    assert.deepEqual(tBot1.visible, [10, 20], "BOT1_VISIBLE_BEFORE_BOT2_COMPLETE");
    assert.equal(tBot1.decided.ready, false);
    assert.equal(isLiveRoundPresentationReady({ phase: "BOT_ACTION", hasLockedActorSet: true }), false);

    const tBot2NoRolls = visibleAt([human, bot1, bot2], [], "BOT_ACTION");
    assert.deepEqual(tBot2NoRolls.visible, [10, 20, 30]);
    assert.equal(tBot2NoRolls.decided.ready, false);

    const tReady = visibleAt([human, bot1, bot2], [humanRoll, bot1Roll, bot2Roll], "GENERATING_NARRATION");
    assert.equal(tReady.decided.ready, true);
    assert.equal(tReady.mode, "cinematic");
  });

  it("pre-declared bot prose does not replay during resolution cinematic", () => {
    const actions = [human, bot1, bot2];
    const rolls = [humanRoll, bot1Roll, bot2Roll];
    const preIds = preCinematicVisibleActionIds(actions);
    assert.deepEqual(preIds, [10, 20, 30]);

    const seen = new Set(
      resolveTrpgMountSeenKeys({
        log: [{ roundNumber: 1, narration: null, actions }],
        currentRoundNumber: 1,
        liveReady: false,
      })
    );
    assert.ok(seen.has("a:1:20"));
    assert.ok(seen.has("a:1:30"));

    for (const id of [20, 30]) {
      assert.equal(
        shouldDecorativeRevealAction({
          kind: "ai_character",
          participantId: id,
          activeRevealActorId: id,
          isFresh: !seen.has(`a:1:${id}`),
          skipDecorativeReveal: false,
          cinematicActorAction: true,
          preCinematicallyDeclared: true,
        }),
        false,
        "ALREADY_VISIBLE_ACTION_REPLAY=false"
      );
      assert.equal(
        isActorActionRevealBeatSatisfied({
          actionKind: "ai_character",
          isFreshAiAction: !seen.has(`a:1:${id}`),
          alreadyCompleted: false,
          effectiveActorRevealComplete: false,
          preCinematicallyDeclared: true,
        }),
        true
      );
    }
  });

  it("bot1 no-roll does not block resolution when pre-declared", () => {
    const bot1Talk = { ...bot1, body: "말한다." };
    const actions = [human, bot1Talk, bot2];
    const rolls = [humanRoll, bot2Roll];
    const preIds = preCinematicVisibleActionIds(actions);
    assert.deepEqual(preIds, [10, 20, 30]);
    assert.equal(
      isActorActionRevealBeatSatisfied({
        actionKind: "ai_character",
        isFreshAiAction: true,
        alreadyCompleted: false,
        effectiveActorRevealComplete: false,
        preCinematicallyDeclared: preIds.includes(20),
      }),
      true
    );
    const actors = buildRoundPresentationActors({
      resolutionOrder: order,
      actions,
      rolls,
    });
    let state: RoundPresentationState = { mode: "cinematic", ...startCinematicPresentation() };
    state = { ...state, ...advanceAfterActorAction({ actors, presentationIndex: 0 }) };
    assert.equal(state.phase, "actor-dice");
  });

  it("refresh after bot1 persist keeps bot1 visible and marked seen", () => {
    const log = [
      {
        roundNumber: 1,
        narration: null,
        actions: [human, bot1],
      },
    ];
    const seen = resolveTrpgMountSeenKeys({ log, currentRoundNumber: 1, liveReady: false });
    assert.ok(seen.includes("a:1:10"));
    assert.ok(seen.includes("a:1:20"));
    assert.equal(seen.includes("a:1:30"), false);

    const afterBot2Log = [
      {
        roundNumber: 1,
        narration: null,
        actions: [human, bot1, bot2],
      },
    ];
    const seenAfter = resolveTrpgMountSeenKeys({
      log: afterBot2Log,
      currentRoundNumber: 1,
      liveReady: false,
    });
    assert.ok(seenAfter.includes("a:1:20"));
    assert.ok(seenAfter.includes("a:1:30"));
  });
});
