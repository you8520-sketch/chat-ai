import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  activePresentationDiceSessionKey,
  applyTrpgDiceOverlaySession,
  shouldAdvanceActorDiceAfterOverlayDismiss,
  trpgDiceOverlayPlaybackReport,
  trpgDiceOverlayPlayOwnerSessionKey,
  trpgDiceOverlaySessionAction,
  trpgDiceRollSessionKey,
  TRPG_RESULT_HOLD_MS,
  type TrpgDiceOverlayPlay,
} from "./diceRollUx";
import type { TrpgParticipantAdjudicationOutcome } from "./roundAdjudication";
import {
  activePresentationRoll,
  advanceAfterActorResult,
  buildRoundPresentationActors,
  decideLiveRoundPresentation,
  freezeLivePresentationActors,
  isActorActionRevealBeatSatisfied,
  resolveLiveActorDeclarationPresentation,
  resolveLiveActorPresentationTransition,
  shouldShowGmNarration,
  startCinematicPresentation,
  type LiveActorDeclarationPresentation,
  type PresentationActor,
  type RoundPresentationState,
} from "./roundPresentation";
import type { TrpgPublicAction, TrpgPublicRoll } from "./snapshot";
import {
  shouldDetachLiveFollowOnKey,
  shouldDetachLiveFollowOnTouchDelta,
  shouldDetachLiveFollowOnWheel,
} from "./followLatest";

const H = 47;
const B1 = 49;
const B2 = 48;
const ROUND = 45;

function action(participantId: number, kind: TrpgPublicAction["kind"], name: string): TrpgPublicAction {
  return { participantId, name, body: `${name} acts`, revealed: true, kind, actionType: "investigate" };
}

function roll(participantId: number, name: string, d20: number, tier: "SUCCESS" | "FAILURE" | "CRITICAL_FAILURE"): TrpgPublicRoll {
  return {
    participantId,
    name,
    d20,
    statKey: "nerve",
    finalScore: d20,
    dc: 11,
    tier,
    success: tier === "SUCCESS",
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

type OverlaySim = {
  play: TrpgDiceOverlayPlay;
  playOwnerSessionKey: string;
  prevRollSessionKey: string;
  startCount: number;
};

function freshOverlaySim(): OverlaySim {
  return { play: { started: false, dismissed: false, index: 0 }, playOwnerSessionKey: "", prevRollSessionKey: "", startCount: 0 };
}

function overlaySessionKeyForActor(
  state: RoundPresentationState,
  actors: readonly PresentationActor[],
  aggregateKey: string
): string {
  const activeRoll = activePresentationRoll({ actors, state });
  return activePresentationDiceSessionKey({
    roundNumber: ROUND,
    mode: state.mode,
    phase: state.phase,
    activeRoll,
    aggregateRollSessionKey: aggregateKey,
  });
}

function tickOverlay(sim: OverlaySim, incomingKey: string): ReturnType<typeof trpgDiceOverlayPlaybackReport> {
  const action = trpgDiceOverlaySessionAction({
    rollSessionKey: incomingKey,
    prevRollSessionKey: sim.prevRollSessionKey,
    consumed: false,
    started: sim.play.started,
    dismissed: sim.play.dismissed,
  });
  if (action === "start") sim.startCount += 1;
  sim.play = applyTrpgDiceOverlaySession(sim.play, action);
  sim.playOwnerSessionKey = trpgDiceOverlayPlayOwnerSessionKey(action, incomingKey);
  sim.prevRollSessionKey = incomingKey;
  return trpgDiceOverlayPlaybackReport({
    incomingSessionKey: incomingKey,
    playOwnerSessionKey: sim.playOwnerSessionKey,
    play: sim.play,
    settled: false,
    rollCount: incomingKey ? 1 : 0,
  });
}

function dismissOverlay(sim: OverlaySim, incomingKey: string): ReturnType<typeof trpgDiceOverlayPlaybackReport> {
  sim.play = { ...sim.play, dismissed: true };
  return trpgDiceOverlayPlaybackReport({
    incomingSessionKey: incomingKey,
    playOwnerSessionKey: sim.playOwnerSessionKey,
    play: sim.play,
    settled: true,
    rollCount: 1,
  });
}

function freezeActors(
  previous: PresentationActor[] | null,
  frozenRound: number | null,
  actions: TrpgPublicAction[],
  rolls: TrpgPublicRoll[],
  resolutionOrder: number[],
  phase: string,
  adjudicatedParticipantIds: number[] = []
): { actors: PresentationActor[]; frozenRound: number | null } {
  const decided = decideLiveRoundPresentation({
    phase,
    roundNumber: ROUND,
    actions,
    rolls,
    resolutionOrder,
    adjudicatedParticipantIds,
  });
  const frozen = freezeLivePresentationActors({
    previous,
    next: decided.actors,
    ready: decided.ready,
    roundNumber: ROUND,
    frozenRound,
  });
  return { actors: frozen.actors, frozenRound: frozen.frozenRound };
}

function liveDeclaration(
  state: RoundPresentationState,
  actors: readonly PresentationActor[],
  actions: TrpgPublicAction[],
  consumed: Set<number>
): LiveActorDeclarationPresentation {
  return resolveLiveActorDeclarationPresentation({
    mode: state.mode,
    phase: state.phase,
    presentationIndex: state.presentationIndex,
    presentationActors: actors,
    actions,
    consumedAiIds: consumed,
  });
}

function productionRevealBeatSatisfied(opts: {
  state: RoundPresentationState;
  actors: readonly PresentationActor[];
  actions: TrpgPublicAction[];
  consumed: Set<number>;
  actorRevealComplete: boolean;
}): { satisfied: boolean; declaration: LiveActorDeclarationPresentation } {
  const declaration = liveDeclaration(opts.state, opts.actors, opts.actions, opts.consumed);
  const current = opts.actors[opts.state.presentationIndex];
  const activeActorId = current?.actorId ?? null;
  const resolutionActionAlreadyConsumed =
    activeActorId != null && opts.consumed.has(activeActorId);
  const satisfied =
    declaration.currentActorDeclarationComplete &&
    isActorActionRevealBeatSatisfied({
      actionKind: current?.action?.kind,
      isFreshAiAction: current?.action?.kind === "ai_character",
      alreadyCompleted: false,
      resolutionActionAlreadyConsumed,
      effectiveActorRevealComplete: opts.actorRevealComplete,
    });
  return { satisfied, declaration };
}

function tryActorActionTransition(opts: {
  state: RoundPresentationState;
  actors: readonly PresentationActor[];
  actions: TrpgPublicAction[];
  consumed: Set<number>;
  outcomeMap: Map<number, TrpgParticipantAdjudicationOutcome>;
  adjudicated: Set<number>;
  rolls: TrpgPublicRoll[];
  awaitingMoreActors: boolean;
  actorRevealComplete: boolean;
}): { state: RoundPresentationState; declaration: LiveActorDeclarationPresentation; blocked: boolean } {
  const gate = productionRevealBeatSatisfied({
    state: opts.state,
    actors: opts.actors,
    actions: opts.actions,
    consumed: opts.consumed,
    actorRevealComplete: opts.actorRevealComplete,
  });
  if (opts.state.phase !== "actor-action" || !gate.satisfied) {
    return { state: opts.state, declaration: gate.declaration, blocked: true };
  }
  const decision = resolveLiveActorPresentationTransition({
    mode: opts.state.mode,
    phase: opts.state.phase,
    presentationIndex: opts.state.presentationIndex,
    actors: opts.actors,
    rolls: opts.rolls,
    adjudicatedParticipantIds: opts.adjudicated,
    declarationConsumedIds: opts.consumed,
    participantAdjudicationOutcomes: opts.outcomeMap,
    awaitingMoreActors: opts.awaitingMoreActors,
    actionRevealComplete: true,
  });
  if (decision.kind !== "transition") {
    return { state: opts.state, declaration: gate.declaration, blocked: true };
  }
  return {
    state: { ...opts.state, ...decision.next },
    declaration: gate.declaration,
    blocked: false,
  };
}

function tryActorDiceTransition(opts: {
  state: RoundPresentationState;
  actors: readonly PresentationActor[];
  consumed: Set<number>;
  outcomeMap: Map<number, TrpgParticipantAdjudicationOutcome>;
  adjudicated: Set<number>;
  rolls: TrpgPublicRoll[];
  awaitingMoreActors: boolean;
  overlayReport: ReturnType<typeof trpgDiceOverlayPlaybackReport>;
}): RoundPresentationState {
  const aggregateKey = trpgDiceRollSessionKey(ROUND, opts.rolls);
  const activeKey = overlaySessionKeyForActor(opts.state, opts.actors, aggregateKey);
  const decision = resolveLiveActorPresentationTransition({
    mode: opts.state.mode,
    phase: opts.state.phase,
    presentationIndex: opts.state.presentationIndex,
    actors: opts.actors,
    rolls: opts.rolls,
    adjudicatedParticipantIds: opts.adjudicated,
    declarationConsumedIds: opts.consumed,
    participantAdjudicationOutcomes: opts.outcomeMap,
    awaitingMoreActors: opts.awaitingMoreActors,
    overlayDismissed: opts.overlayReport.dismissed,
    overlaySessionKey: opts.overlayReport.sessionKey,
    activeRollSessionKey: activeKey,
  });
  if (decision.kind !== "transition") return opts.state;
  return { ...opts.state, ...decision.next };
}

describe("POST-706 production presentation timeline", () => {
  it("PRODUCTION_TRACE_ROUND_45: H dice → B1 declaration → B1 dice with B2 buffered", () => {
    const human = action(H, "human", "Human");
    const bot1 = action(B1, "ai_character", "Bot1");
    const bot2 = action(B2, "ai_character", "Bot2");
    const humanRoll = roll(H, "Human", 4, "FAILURE");
    const bot1Roll = roll(B1, "Bot1", 4, "FAILURE");
    const bot2Roll = roll(B2, "Bot2", 1, "CRITICAL_FAILURE");
    const consumed = new Set<number>();
    const overlay = freshOverlaySim();
    let frozen: PresentationActor[] | null = null;
    let frozenRound: number | null = null;
    let outcomeMap = outcomes([[H, "roll"]]);
    let state: RoundPresentationState = { mode: "idle", phase: "idle", presentationIndex: 0 };
    const order = [H, B1, B2];

    const snapH = freezeActors(frozen, frozenRound, [human], [humanRoll], order, "ROLLING", [H]);
    frozen = snapH.actors;
    frozenRound = snapH.frozenRound;
    state = { mode: "cinematic", ...startCinematicPresentation() };

    let step = tryActorActionTransition({
      state,
      actors: frozen,
      actions: [human],
      consumed,
      outcomeMap,
      adjudicated: new Set([H]),
      rolls: [humanRoll],
      awaitingMoreActors: true,
      actorRevealComplete: true,
    });
    state = step.state;
    assert.equal(state.phase, "actor-dice", "H actor-dice");

    const humanKey = overlaySessionKeyForActor(state, frozen, trpgDiceRollSessionKey(ROUND, [humanRoll]));
    tickOverlay(overlay, humanKey);
    assert.equal(overlay.startCount, 1, "H_OVERLAY_COUNT");

    const snapB1DuringHDice = freezeActors(frozen, frozenRound, [human, bot1], [humanRoll, bot1Roll], order, "BOT_ACTION", [H, B1]);
    frozen = snapB1DuringHDice.actors;
    outcomeMap = outcomes([
      [H, "roll"],
      [B1, "roll"],
    ]);
    const declDuringHDice = liveDeclaration(state, frozen, [human, bot1], consumed);
    assert.equal(declDuringHDice.activeDeclarationActorId, null, "B1 must not steal declaration during H dice");
    assert.ok(!declDuringHDice.visibleActionIds.includes(B1), "B1 buffered during H dice");
    assert.equal(state.phase, "actor-dice", "H overlay remains owned by H");

    const humanDismiss = dismissOverlay(overlay, humanKey);
    state = tryActorDiceTransition({
      state,
      actors: frozen,
      consumed,
      outcomeMap,
      adjudicated: new Set([H]),
      rolls: [humanRoll],
      awaitingMoreActors: true,
      overlayReport: humanDismiss,
    });
    assert.equal(state.phase, "actor-result");

    state = {
      ...state,
      ...advanceAfterActorResult({
        actors: frozen,
        presentationIndex: state.presentationIndex,
        adjudicatedParticipantIds: new Set([H]),
        declarationConsumedIds: consumed,
        awaitingMoreActors: true,
      }),
    };
    assert.equal(state.presentationIndex, 1);
    assert.equal(state.phase, "actor-action");

    const snapB2BeforeB1Reveal = freezeActors(
      frozen,
      frozenRound,
      [human, bot1, bot2],
      [humanRoll, bot1Roll, bot2Roll],
      order,
      "GENERATING_NARRATION",
      [H, B1, B2]
    );
    frozen = snapB2BeforeB1Reveal.actors;
    outcomeMap = outcomes([
      [H, "roll"],
      [B1, "roll"],
      [B2, "roll"],
    ]);

    const declBeforeB1Complete = liveDeclaration(state, frozen, [human, bot1, bot2], consumed);
    assert.equal(declBeforeB1Complete.activeDeclarationActorId, B1, "B1 remains current declaration owner");
    assert.ok(!declBeforeB1Complete.visibleActionIds.includes(B2), "B2 remains buffered before B1 reveal completes");

    step = tryActorActionTransition({
      state,
      actors: frozen,
      actions: [human, bot1, bot2],
      consumed,
      outcomeMap,
      adjudicated: new Set([H, B1, B2]),
      rolls: [humanRoll, bot1Roll, bot2Roll],
      awaitingMoreActors: false,
      actorRevealComplete: false,
    });
    assert.equal(step.blocked, true, "B1 actor-action blocked until declaration completes");
    assert.equal(state.phase, "actor-action");

    consumed.add(B1);
    step = tryActorActionTransition({
      state,
      actors: frozen,
      actions: [human, bot1, bot2],
      consumed,
      outcomeMap,
      adjudicated: new Set([H, B1, B2]),
      rolls: [humanRoll, bot1Roll, bot2Roll],
      awaitingMoreActors: false,
      actorRevealComplete: true,
    });
    state = step.state;
    assert.equal(step.blocked, false, "B1 declaration completion path");
    assert.equal(state.phase, "actor-dice", "B1 actor-action → actor-dice");
    assert.ok(consumed.has(B1), "B1 consumed");
    assert.equal(liveDeclaration(state, frozen, [human, bot1, bot2], consumed).activeDeclarationActorId, null);

    const b1Key = overlaySessionKeyForActor(state, frozen, trpgDiceRollSessionKey(ROUND, [humanRoll, bot1Roll, bot2Roll]));
    tickOverlay(overlay, b1Key);
    assert.equal(overlay.startCount, 2, "B1_OVERLAY_COUNT");

    const b1Dismiss = dismissOverlay(overlay, b1Key);
    state = tryActorDiceTransition({
      state,
      actors: frozen,
      consumed,
      outcomeMap,
      adjudicated: new Set([H, B1, B2]),
      rolls: [humanRoll, bot1Roll, bot2Roll],
      awaitingMoreActors: false,
      overlayReport: b1Dismiss,
    });
    assert.equal(state.phase, "actor-result");

    state = {
      ...state,
      ...advanceAfterActorResult({
        actors: frozen,
        presentationIndex: state.presentationIndex,
        adjudicatedParticipantIds: new Set([H, B1, B2]),
        declarationConsumedIds: consumed,
        awaitingMoreActors: false,
      }),
    };
    assert.equal(state.presentationIndex, 2);
    assert.equal(state.phase, "actor-action");

    const declB2 = liveDeclaration(state, frozen, [human, bot1, bot2], consumed);
    assert.equal(declB2.activeDeclarationActorId, B2, "B2 progressive reveal begins only after B1 result");

    consumed.add(B2);
    step = tryActorActionTransition({
      state,
      actors: frozen,
      actions: [human, bot1, bot2],
      consumed,
      outcomeMap,
      adjudicated: new Set([H, B1, B2]),
      rolls: [humanRoll, bot1Roll, bot2Roll],
      awaitingMoreActors: false,
      actorRevealComplete: true,
    });
    state = step.state;
    assert.equal(state.phase, "actor-dice");

    const b2Key = overlaySessionKeyForActor(state, frozen, trpgDiceRollSessionKey(ROUND, [humanRoll, bot1Roll, bot2Roll]));
    tickOverlay(overlay, b2Key);
    assert.equal(overlay.startCount, 3, "B2_OVERLAY_COUNT");

    const b2Dismiss = dismissOverlay(overlay, b2Key);
    state = tryActorDiceTransition({
      state,
      actors: frozen,
      consumed,
      outcomeMap,
      adjudicated: new Set([H, B1, B2]),
      rolls: [humanRoll, bot1Roll, bot2Roll],
      awaitingMoreActors: false,
      overlayReport: b2Dismiss,
    });
    state = {
      ...state,
      ...advanceAfterActorResult({
        actors: frozen,
        presentationIndex: state.presentationIndex,
        adjudicatedParticipantIds: new Set([H, B1, B2]),
        declarationConsumedIds: consumed,
        awaitingMoreActors: false,
      }),
    };
    assert.equal(shouldShowGmNarration(state), true, "B2_DICE_BEFORE_GM");
    assert.equal(overlay.startCount, 3, "ALL_ROLLING_BOTS_OVERLAY_ONCE");
  });

  it("CURRENT_ACTOR_DECLARATION_COMPLETION_IS_NOT_BLOCKED_BY_FUTURE_AI", () => {
    const bot1 = action(B1, "ai_character", "Bot1");
    const bot2 = action(B2, "ai_character", "Bot2");
    const bot1Roll = roll(B1, "Bot1", 4, "FAILURE");
    const consumed = new Set<number>([B1]);
    const state: RoundPresentationState = {
      mode: "cinematic",
      phase: "actor-action",
      presentationIndex: 1,
    };
    const actors = buildRoundPresentationActors({
      resolutionOrder: [H, B1, B2],
      actions: [action(H, "human", "Human"), bot1, bot2],
      rolls: [roll(H, "Human", 4, "FAILURE"), bot1Roll, roll(B2, "Bot2", 1, "CRITICAL_FAILURE")],
    });
    const outcomeMap = outcomes([
      [H, "roll"],
      [B1, "roll"],
      [B2, "roll"],
    ]);
    const declaration = liveDeclaration(state, actors, [action(H, "human", "Human"), bot1, bot2], consumed);
    assert.equal(declaration.currentActorDeclarationComplete, true);
    assert.equal(declaration.activeDeclarationActorId, null);

    const step = tryActorActionTransition({
      state,
      actors,
      actions: [action(H, "human", "Human"), bot1, bot2],
      consumed,
      outcomeMap,
      adjudicated: new Set([H, B1, B2]),
      rolls: [roll(H, "Human", 4, "FAILURE"), bot1Roll, roll(B2, "Bot2", 1, "CRITICAL_FAILURE")],
      awaitingMoreActors: false,
      actorRevealComplete: true,
    });
    assert.equal(step.blocked, false);
    assert.equal(step.state.phase, "actor-dice", "B1 → actor-dice despite B2 waiting");
  });

  it("variants: mixed no_roll and late rolls follow resolutionOrder", () => {
    const human = action(H, "human", "Human");
    const bot1 = action(B1, "ai_character", "Bot1");
    const bot2 = action(B2, "ai_character", "Bot2");
    const humanRoll = roll(H, "Human", 14, "SUCCESS");
    const bot2Roll = roll(B2, "Bot2", 3, "FAILURE");
    const consumed = new Set<number>([B1]);
    const order = [H, B1, B2];
    const outcomeMap = outcomes([
      [H, "roll"],
      [B1, "no_roll"],
      [B2, "roll"],
    ]);

    let actors = buildRoundPresentationActors({
      resolutionOrder: order,
      actions: [human, bot1, bot2],
      rolls: [humanRoll],
    });
    let state: RoundPresentationState = {
      mode: "cinematic",
      phase: "actor-action",
      presentationIndex: 1,
    };

    state = tryActorActionTransition({
      state,
      actors,
      actions: [human, bot1, bot2],
      consumed,
      outcomeMap,
      adjudicated: new Set([H, B1, B2]),
      rolls: [humanRoll],
      awaitingMoreActors: false,
      actorRevealComplete: true,
    }).state;
    assert.equal(state.presentationIndex, 2, "B1 no_roll advances past dice");
    assert.equal(state.phase, "actor-action");

    const lateHold = tryActorActionTransition({
      state,
      actors,
      actions: [human, bot1, bot2],
      consumed,
      outcomeMap,
      adjudicated: new Set([H, B1, B2]),
      rolls: [humanRoll],
      awaitingMoreActors: false,
      actorRevealComplete: false,
    });
    assert.equal(lateHold.blocked, true, "late B2 roll holds actor-action");

    actors = buildRoundPresentationActors({
      resolutionOrder: order,
      actions: [human, bot1, bot2],
      rolls: [humanRoll, bot2Roll],
    });
    consumed.add(B2);
    state = tryActorActionTransition({
      state,
      actors,
      actions: [human, bot1, bot2],
      consumed,
      outcomeMap,
      adjudicated: new Set([H, B1, B2]),
      rolls: [humanRoll, bot2Roll],
      awaitingMoreActors: false,
      actorRevealComplete: true,
    }).state;
    assert.equal(state.phase, "actor-dice", "late B2 roll still reaches dice");
  });

  it("resolutionOrder differs from persistence order for dice sequence", () => {
    const persistenceOrder = [H, B2, B1];
    const resolutionOrder = [H, B1, B2];
    const actions = persistenceOrder.map((id) =>
      action(id, id === H ? "human" : "ai_character", `Actor${id}`)
    );
    const rolls = [
      roll(H, "Human", 10, "FAILURE"),
      roll(B1, "Bot1", 8, "FAILURE"),
      roll(B2, "Bot2", 5, "FAILURE"),
    ];
    const actors = buildRoundPresentationActors({ resolutionOrder, actions, rolls });
    const diceOrder: number[] = [];
    let state: RoundPresentationState = { mode: "cinematic", ...startCinematicPresentation() };
    const consumed = new Set<number>([B1, B2]);
    const outcomeMap = outcomes([
      [H, "roll"],
      [B1, "roll"],
      [B2, "roll"],
    ]);

    for (let i = 0; i < 3; i += 1) {
      if (state.phase === "actor-action") {
        state = tryActorActionTransition({
          state,
          actors,
          actions,
          consumed,
          outcomeMap,
          adjudicated: new Set([H, B1, B2]),
          rolls,
          awaitingMoreActors: false,
          actorRevealComplete: true,
        }).state;
      }
      if (state.phase === "actor-dice") {
        diceOrder.push(actors[state.presentationIndex]!.actorId);
        state = {
          ...state,
          phase: "actor-result",
        };
        state = {
          ...state,
          ...advanceAfterActorResult({
            actors,
            presentationIndex: state.presentationIndex,
            adjudicatedParticipantIds: new Set([H, B1, B2]),
            declarationConsumedIds: consumed,
            awaitingMoreActors: false,
          }),
        };
      }
    }
    assert.deepEqual(diceOrder, [H, B1, B2], "dice order follows resolutionOrder");
  });

  it("round-scoped follow reset on queueSessionKey change", () => {
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.match(room, /useLayoutEffect\(\(\) => \{[\s\S]*queueSessionKey[\s\S]*manualScrollDetachedRef\.current = false/);
    assert.match(room, /hasLeftFollowZoneSinceDetachRef\.current = false/);
    assert.match(room, /setFollowLatest\(true\)/);
    assert.match(room, /setUnseenLatest\(false\)/);
    assert.match(room, /\}, \[queueSessionKey\]\)/);
  });

  it("directional wheel detach: downward preserves, upward detaches", () => {
    assert.equal(shouldDetachLiveFollowOnWheel(120), false, "downward wheel preserves follow");
    assert.equal(shouldDetachLiveFollowOnWheel(-1), true, "upward wheel detaches");
    assert.equal(shouldDetachLiveFollowOnKey("ArrowDown"), false);
    assert.equal(shouldDetachLiveFollowOnKey("PageDown"), false);
    assert.equal(shouldDetachLiveFollowOnKey("End"), false);
    assert.equal(shouldDetachLiveFollowOnKey("ArrowUp"), true);
    assert.equal(shouldDetachLiveFollowOnKey("PageUp"), true);
    assert.equal(shouldDetachLiveFollowOnTouchDelta(-40), false, "touch toward newest preserves follow");
    assert.equal(shouldDetachLiveFollowOnTouchDelta(40), true, "touch toward older detaches");
  });

  it("single-die result hold is 3500ms", () => {
    assert.equal(TRPG_RESULT_HOLD_MS[1], 3500);
  });

  it("STALE_GLOBAL_DECLARATION_OWNER_REMOVED: no deprecated pre-cinematic queue API", () => {
    const sources = [
      readFileSync("src/lib/trpg/roundPresentation.ts", "utf8"),
      readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8"),
      readFileSync("src/app/trpg/useRevealedText.ts", "utf8"),
    ];
    const deprecated = [
      "resolvePreCinematicDeclarationReveal",
      "preCinematicVisibleActionIds",
      "PreCinematicDeclarationReveal",
    ];
    for (const source of sources) {
      for (const symbol of deprecated) {
        assert.doesNotMatch(source, new RegExp(symbol));
      }
    }
    assert.match(sources[0]!, /resolveLiveActorDeclarationPresentation/);
    assert.match(sources[1]!, /resolveLiveActorDeclarationPresentation/);
    assert.doesNotMatch(sources[1]!, /declarationReveal\.complete/);
    assert.doesNotMatch(sources[1]!, /declarationReveal\.activeAiId/);
  });
});
