import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  activePresentationDiceSessionKey,
  applyTrpgDiceOverlaySession,
  overlayPresentationDismissed,
  shouldAdvanceActorDiceAfterOverlayDismiss,
  trpgDiceOverlayPlayOwnerSessionKey,
  trpgDiceOverlayPlaybackReport,
  trpgDiceOverlaySessionAction,
  trpgDiceRollSessionKey,
  type TrpgDiceOverlayPlay,
} from "./diceRollUx";
import type { TrpgParticipantAdjudicationOutcome } from "./roundAdjudication";
import {
  activePresentationRoll,
  advanceAfterActorResult,
  buildRoundPresentationActors,
  decideLiveRoundPresentation,
  freezeLivePresentationActors,
  resolveLiveActorPresentationTransition,
  shouldShowActorResultLane,
  shouldShowGmNarration,
  startCinematicPresentation,
  type PresentationActor,
  type RoundPresentationState,
} from "./roundPresentation";
import type { TrpgPublicAction, TrpgPublicRoll } from "./snapshot";

const H = 10;
const B1 = 20;
const B2 = 30;
const ROUND = 4;

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

function transitionDecision(
  state: RoundPresentationState,
  actors: readonly PresentationActor[],
  opts: {
    outcomeMap: Map<number, TrpgParticipantAdjudicationOutcome>;
    adjudicated: Set<number>;
    consumed: Set<number>;
    rolls: TrpgPublicRoll[];
    awaitingMoreActors: boolean;
    actionRevealComplete?: boolean;
    overlay?: { report: ReturnType<typeof trpgDiceOverlayPlaybackReport> };
  }
): ReturnType<typeof resolveLiveActorPresentationTransition> {
  const aggregateKey = trpgDiceRollSessionKey(ROUND, opts.rolls);
  const activeKey = overlaySessionKeyForActor(state, actors, aggregateKey);
  return resolveLiveActorPresentationTransition({
    mode: state.mode,
    phase: state.phase,
    presentationIndex: state.presentationIndex,
    actors,
    rolls: opts.rolls,
    adjudicatedParticipantIds: opts.adjudicated,
    declarationConsumedIds: opts.consumed,
    participantAdjudicationOutcomes: opts.outcomeMap,
    awaitingMoreActors: opts.awaitingMoreActors,
    actionRevealComplete: opts.actionRevealComplete ?? state.phase !== "actor-action",
    overlayDismissed: opts.overlay?.report.dismissed,
    overlaySessionKey: opts.overlay?.report.sessionKey,
    activeRollSessionKey: activeKey,
  });
}

function applyTransition(
  state: RoundPresentationState,
  actors: readonly PresentationActor[],
  opts: Parameters<typeof transitionDecision>[2]
): RoundPresentationState {
  const decision = transitionDecision(state, actors, opts);
  if (decision.kind !== "transition") return state;
  return { ...state, ...decision.next };
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

describe("POST-705 production H/B1/B2 dice chain", () => {
  it("T_H_B1_B2_FULL_CHAIN: Human through incremental Bot2 no_roll with overlay session proof", () => {
    const human = action(H, "human", "Human");
    const bot1 = action(B1, "ai_character", "Bot1");
    const bot2 = action(B2, "ai_character", "Bot2");
    const humanRoll = roll(H, "Human", 14);
    const bot1Roll = roll(B1, "Bot1", 8);
    const consumed = new Set<number>();
    const trace: string[] = ["ROUND START"];

    let frozen: PresentationActor[] | null = null;
    let frozenRound: number | null = null;
    let prevSessionKey = "";
    let state: RoundPresentationState = { mode: "idle", phase: "idle", presentationIndex: 0 };
    const overlay = freshOverlaySim();
    let outcomeMap = outcomes([[H, "roll"]]);

    // Snapshot A — Human only, bots still generating (BOT_ACTION early phase)
    trace.push("H ACTION", "H OUTCOME=roll");
    const snapA = freezeActors(frozen, frozenRound, [human], [humanRoll], [H, B1, B2], "BOT_ACTION", [H]);
    frozen = snapA.actors;
    frozenRound = snapA.frozenRound;
    const sessionA = decideLiveRoundPresentation({
      phase: "BOT_ACTION",
      roundNumber: ROUND,
      actions: [human],
      rolls: [humanRoll],
      resolutionOrder: [H, B1, B2],
      adjudicatedParticipantIds: [H],
    }).sessionKey;
    if (sessionA && sessionA !== prevSessionKey) {
      prevSessionKey = sessionA;
      state = { mode: "cinematic", ...startCinematicPresentation() };
    }
    assert.equal(state.presentationIndex, 0, "CHAIN_STARTS_AT_HUMAN_INDEX_0");

    state = applyTransition(state, frozen, {
      outcomeMap,
      adjudicated: new Set([H]),
      consumed,
      rolls: [humanRoll],
      awaitingMoreActors: true,
      actionRevealComplete: true,
    });
    assert.equal(state.phase, "actor-dice");
    trace.push("H actor-dice");

    const humanKey = overlaySessionKeyForActor(state, frozen, trpgDiceRollSessionKey(ROUND, [humanRoll]));
    tickOverlay(overlay, humanKey);
    assert.equal(overlay.startCount, 1, "HUMAN_OVERLAY_START_COUNT");
    trace.push("H OVERLAY START");

    const humanDismiss = dismissOverlay(overlay, humanKey);
    state = applyTransition(state, frozen, {
      outcomeMap,
      adjudicated: new Set([H]),
      consumed,
      rolls: [humanRoll],
      awaitingMoreActors: true,
      overlay: { report: humanDismiss },
    });
    assert.equal(state.phase, "actor-result");
    trace.push("H RESULT");

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
    assert.equal(shouldShowGmNarration(state), false);
    trace.push("WAIT FOR BOT1");

    // Bot1 action, outcome roll, roll absent
    consumed.add(B1);
    outcomeMap = outcomes([
      [H, "roll"],
      [B1, "roll"],
    ]);
    const snapB = freezeActors(frozen, frozenRound, [human, bot1], [humanRoll], [H, B1, B2], "BOT_ACTION", [H, B1]);
    frozen = snapB.actors;
    trace.push("BOT1 ACTION", "BOT1 OUTCOME=roll", "BOT1 ROLL ABSENT");

    const bot1Hold = transitionDecision(state, frozen, {
      outcomeMap,
      adjudicated: new Set([H, B1]),
      consumed,
      rolls: [humanRoll],
      awaitingMoreActors: true,
      actionRevealComplete: true,
    });
    assert.equal(bot1Hold.kind, "hold", "BOT1_LATE_ROLL_INITIAL_KIND");
    assert.equal(state.phase, "actor-action");
    trace.push("HOLD");

    const snapC = freezeActors(frozen, frozenRound, [human, bot1], [humanRoll, bot1Roll], [H, B1, B2], "BOT_ACTION", [H, B1]);
    frozen = snapC.actors;
    assert.ok(frozen.find((a) => a.actorId === B1)?.roll, "FROZEN_BOT1_ROLL_REFRESHED");
    trace.push("BOT1 ROLL ARRIVES");

    state = applyTransition(state, frozen, {
      outcomeMap,
      adjudicated: new Set([H, B1]),
      consumed,
      rolls: [humanRoll, bot1Roll],
      awaitingMoreActors: true,
      actionRevealComplete: true,
    });
    assert.equal(state.phase, "actor-dice");
    trace.push("BOT1 actor-dice");

    const bot1Key = overlaySessionKeyForActor(state, frozen, trpgDiceRollSessionKey(ROUND, [humanRoll, bot1Roll]));
    assert.notEqual(humanKey, bot1Key);
    tickOverlay(overlay, bot1Key);
    assert.equal(overlay.startCount, 2, "BOT1 overlay start once after Human");
    trace.push("BOT1 OVERLAY START");

    const bot1Dismiss = dismissOverlay(overlay, bot1Key);
    state = applyTransition(state, frozen, {
      outcomeMap,
      adjudicated: new Set([H, B1]),
      consumed,
      rolls: [humanRoll, bot1Roll],
      awaitingMoreActors: false,
      overlay: { report: bot1Dismiss },
    });
    assert.equal(state.phase, "actor-result");
    trace.push("BOT1 RESULT");

    state = {
      ...state,
      ...advanceAfterActorResult({
        actors: frozen,
        presentationIndex: state.presentationIndex,
        adjudicatedParticipantIds: new Set([H, B1]),
        declarationConsumedIds: consumed,
        awaitingMoreActors: true,
      }),
    };
    consumed.add(B2);
    const snapBot2 = freezeActors(
      frozen,
      frozenRound,
      [human, bot1, bot2],
      [humanRoll, bot1Roll],
      [H, B1, B2],
      "BOT_ACTION",
      [H, B1]
    );
    frozen = snapBot2.actors;
    trace.push("BOT2 ACTION", "BOT2 OUTCOME=unknown");

    const bot2Unknown = transitionDecision(state, frozen, {
      outcomeMap,
      adjudicated: new Set([H, B1]),
      consumed,
      rolls: [humanRoll, bot1Roll],
      awaitingMoreActors: false,
      actionRevealComplete: true,
    });
    assert.equal(bot2Unknown.kind, "hold", "BOT2_UNKNOWN_FIRST_KIND");
    assert.equal(shouldShowGmNarration(state), false, "BOT2_UNKNOWN_GM_VISIBLE");
    trace.push("HOLD", "GM=false");

    outcomeMap = outcomes([
      [H, "roll"],
      [B1, "roll"],
      [B2, "no_roll"],
    ]);
    trace.push("BOT2 OUTCOME=no_roll ARRIVES", "RE-EVALUATE SAME ACTOR");

    const bot2Late = transitionDecision(state, frozen, {
      outcomeMap,
      adjudicated: new Set([H, B1, B2]),
      consumed,
      rolls: [humanRoll, bot1Roll],
      awaitingMoreActors: false,
      actionRevealComplete: true,
    });
    assert.equal(bot2Late.kind, "transition", "BOT2_LATE_NO_ROLL_REEVALUATED");
    const bot2OverlayBefore = overlay.startCount;
    state = applyTransition(state, frozen, {
      outcomeMap,
      adjudicated: new Set([H, B1, B2]),
      consumed,
      rolls: [humanRoll, bot1Roll],
      awaitingMoreActors: false,
      actionRevealComplete: true,
    });
    assert.equal(overlay.startCount, bot2OverlayBefore, "BOT2_LATE_NO_ROLL_OVERLAY_COUNT");
    assert.equal(state.phase, "gm-narration", "BOT2_LATE_NO_ROLL_REACHES_GM");
    assert.equal(shouldShowGmNarration(state), true);
    trace.push("BOT2 OVERLAY=0", "ADVANCE", "GM=true");

    assert.deepEqual(trace, [
      "ROUND START",
      "H ACTION",
      "H OUTCOME=roll",
      "H actor-dice",
      "H OVERLAY START",
      "H RESULT",
      "WAIT FOR BOT1",
      "BOT1 ACTION",
      "BOT1 OUTCOME=roll",
      "BOT1 ROLL ABSENT",
      "HOLD",
      "BOT1 ROLL ARRIVES",
      "BOT1 actor-dice",
      "BOT1 OVERLAY START",
      "BOT1 RESULT",
      "BOT2 ACTION",
      "BOT2 OUTCOME=unknown",
      "HOLD",
      "GM=false",
      "BOT2 OUTCOME=no_roll ARRIVES",
      "RE-EVALUATE SAME ACTOR",
      "BOT2 OVERLAY=0",
      "ADVANCE",
      "GM=true",
    ]);
  });

  it("OUTCOME_ROLL_WITHOUT_CLIENT_ROLL_RETURNS_HOLD", () => {
    const bot1 = action(B1, "ai_character", "Bot1");
    const actors = buildRoundPresentationActors({
      resolutionOrder: [B1],
      actions: [bot1],
      rolls: [],
    });
    const decision = resolveLiveActorPresentationTransition({
      mode: "cinematic",
      phase: "actor-action",
      presentationIndex: 0,
      actors,
      rolls: [],
      adjudicatedParticipantIds: new Set([B1]),
      declarationConsumedIds: new Set([B1]),
      participantAdjudicationOutcomes: outcomes([[B1, "roll"]]),
      actionRevealComplete: true,
    });
    assert.equal(decision.kind, "hold", "OUTCOME_ROLL_WITHOUT_ROLL_KIND");
  });

  it("BOT1_LATE_ROLL: hold until authoritative roll then actor-dice once", () => {
    const bot1 = action(B1, "ai_character", "Bot1");
    const actorsBefore = buildRoundPresentationActors({
      resolutionOrder: [B1],
      actions: [bot1],
      rolls: [],
    });
    const state: RoundPresentationState = {
      mode: "cinematic",
      phase: "actor-action",
      presentationIndex: 0,
    };
    const outcomeMap = outcomes([[B1, "roll"]]);
    const gates = {
      adjudicated: new Set([B1]),
      consumed: new Set([B1]),
      awaitingMoreActors: false,
      actionRevealComplete: true,
    };

    const initial = transitionDecision(state, actorsBefore, {
      outcomeMap,
      rolls: [],
      ...gates,
    });
    assert.equal(initial.kind, "hold", "BOT1_LATE_ROLL_INITIAL_KIND");

    const bot1Roll = roll(B1, "Bot1", 8);
    const actorsAfter = buildRoundPresentationActors({
      resolutionOrder: [B1],
      actions: [bot1],
      rolls: [bot1Roll],
    });
    const afterRoll = transitionDecision(state, actorsAfter, {
      outcomeMap,
      rolls: [bot1Roll],
      ...gates,
    });
    assert.equal(afterRoll.kind, "transition", "BOT1_LATE_ROLL_REEVALUATED");
    if (afterRoll.kind === "transition") {
      assert.equal(afterRoll.next.phase, "actor-dice", "BOT1_DICE_PHASE_ENTERED");
    }

    const diceState = applyTransition(state, actorsAfter, {
      outcomeMap,
      rolls: [bot1Roll],
      ...gates,
    });
    const overlay = freshOverlaySim();
    const bot1Key = overlaySessionKeyForActor(diceState, actorsAfter, trpgDiceRollSessionKey(ROUND, [bot1Roll]));
    tickOverlay(overlay, bot1Key);
    assert.equal(overlay.startCount, 1, "BOT1_OVERLAY_START_COUNT");
    tickOverlay(overlay, bot1Key);
    assert.equal(overlay.startCount, 1, "BOT1_OVERLAY_REPLAY");
  });

  it("BOT2_LATE_NO_ROLL: unknown outcome then no_roll re-evaluates without deadlock", () => {
    const bot2 = action(B2, "ai_character", "Bot2");
    const actors = buildRoundPresentationActors({
      resolutionOrder: [H, B1, B2],
      actions: [action(H, "human", "H"), action(B1, "ai_character", "B1"), bot2],
      rolls: [roll(H, "Human", 12), roll(B1, "Bot1", 9)],
    });
    const state: RoundPresentationState = {
      mode: "cinematic",
      phase: "actor-action",
      presentationIndex: 2,
    };
    const consumed = new Set([B2]);
    const unknownMap = outcomes([
      [H, "roll"],
      [B1, "roll"],
    ]);

    const hold = transitionDecision(state, actors, {
      outcomeMap: unknownMap,
      adjudicated: new Set([H, B1]),
      consumed,
      rolls: [roll(H, "Human", 12), roll(B1, "Bot1", 9)],
      awaitingMoreActors: false,
      actionRevealComplete: true,
    });
    assert.equal(hold.kind, "hold", "BOT2_UNKNOWN_FIRST_KIND");
    assert.equal(shouldShowGmNarration(state), false, "BOT2_UNKNOWN_GM_VISIBLE");

    const lateMap = outcomes([
      [H, "roll"],
      [B1, "roll"],
      [B2, "no_roll"],
    ]);
    const advance = transitionDecision(state, actors, {
      outcomeMap: lateMap,
      adjudicated: new Set([H, B1, B2]),
      consumed,
      rolls: [roll(H, "Human", 12), roll(B1, "Bot1", 9)],
      awaitingMoreActors: false,
      actionRevealComplete: true,
    });
    assert.equal(advance.kind, "transition", "BOT2_LATE_NO_ROLL_REEVALUATED");
    if (advance.kind === "transition") {
      assert.equal(advance.next.phase, "gm-narration", "BOT2_LATE_NO_ROLL_REACHES_GM");
    }
  });

  it("BOT2_LATE_SKIPPED: unknown outcome then skipped re-evaluates without deadlock", () => {
    const bot2 = action(B2, "ai_character", "Bot2");
    const actors = buildRoundPresentationActors({
      resolutionOrder: [H, B2],
      actions: [action(H, "human", "H"), bot2],
      rolls: [roll(H, "Human", 12)],
    });
    const state: RoundPresentationState = {
      mode: "cinematic",
      phase: "actor-action",
      presentationIndex: 1,
    };
    const consumed = new Set([B2]);

    const hold = transitionDecision(state, actors, {
      outcomeMap: outcomes([[H, "roll"]]),
      adjudicated: new Set([H]),
      consumed,
      rolls: [roll(H, "Human", 12)],
      awaitingMoreActors: false,
      actionRevealComplete: true,
    });
    assert.equal(hold.kind, "hold");

    const advance = transitionDecision(state, actors, {
      outcomeMap: outcomes([
        [H, "roll"],
        [B2, "skipped"],
      ]),
      adjudicated: new Set([H, B2]),
      consumed,
      rolls: [roll(H, "Human", 12)],
      awaitingMoreActors: false,
      actionRevealComplete: true,
    });
    assert.equal(advance.kind, "transition", "LATE_SKIPPED_REEVALUATED");
    if (advance.kind === "transition") {
      assert.equal(advance.next.phase, "gm-narration");
    }
  });

  it("FUTURE_ROLL_BUFFERED: Bot2 roll during Bot1 overlay does not steal active overlay", () => {
    const human = action(H, "human", "Human");
    const bot1 = action(B1, "ai_character", "Bot1");
    const bot2 = action(B2, "ai_character", "Bot2");
    const humanRoll = roll(H, "Human", 14);
    const bot1Roll = roll(B1, "Bot1", 8);
    const bot2Roll = roll(B2, "Bot2", 12);
    const outcomeMap = outcomes([
      [H, "roll"],
      [B1, "roll"],
      [B2, "roll"],
    ]);

    let frozen: PresentationActor[] | null = null;
    let frozenRound: number | null = null;
    const snapBot1 = freezeActors(
      frozen,
      frozenRound,
      [human, bot1],
      [humanRoll, bot1Roll],
      [H, B1, B2],
      "ROLLING",
      [H, B1, B2]
    );
    frozen = snapBot1.actors;
    let state: RoundPresentationState = {
      mode: "cinematic",
      phase: "actor-dice",
      presentationIndex: 1,
    };
    const overlay = freshOverlaySim();
    const bot1Key = overlaySessionKeyForActor(state, frozen, trpgDiceRollSessionKey(ROUND, [humanRoll, bot1Roll]));
    tickOverlay(overlay, bot1Key);
    assert.equal(overlay.startCount, 1);

    const snapBuffered = freezeActors(
      frozen,
      snapBot1.frozenRound,
      [human, bot1, bot2],
      [humanRoll, bot1Roll, bot2Roll],
      [H, B1, B2],
      "ROLLING",
      [H, B1, B2]
    );
    frozen = snapBuffered.actors;
    assert.ok(frozen.find((a) => a.actorId === B2)?.roll, "FUTURE_ROLL_BUFFERED");
    assert.equal(activePresentationRoll({ actors: frozen, state })?.participantId, B1, "FUTURE_ROLL_STEALS_ACTIVE_OVERLAY");

    const bot1KeyAfterBuffer = overlaySessionKeyForActor(
      state,
      frozen,
      trpgDiceRollSessionKey(ROUND, [humanRoll, bot1Roll, bot2Roll])
    );
    assert.equal(bot1KeyAfterBuffer, bot1Key);
    const bot2Key = trpgDiceRollSessionKey(ROUND, [bot2Roll]);
    const misalignedReport = trpgDiceOverlayPlaybackReport({
      incomingSessionKey: bot2Key,
      playOwnerSessionKey: overlay.playOwnerSessionKey,
      play: overlay.play,
      settled: false,
      rollCount: 1,
    });
    assert.equal(misalignedReport.visible, false);
    assert.equal(overlay.startCount, 1);
    assert.equal(overlay.playOwnerSessionKey, bot1Key, "BOT1_OVERLAY_REPLAY");

    const bot1Dismiss = dismissOverlay(overlay, bot1Key);
    state = applyTransition(state, frozen, {
      outcomeMap,
      adjudicated: new Set([H, B1, B2]),
      consumed: new Set([B1, B2]),
      rolls: [humanRoll, bot1Roll, bot2Roll],
      awaitingMoreActors: false,
      overlay: { report: bot1Dismiss },
    });
    assert.equal(state.phase, "actor-result");

    state = {
      ...state,
      ...advanceAfterActorResult({
        actors: frozen,
        presentationIndex: state.presentationIndex,
        adjudicatedParticipantIds: new Set([H, B1, B2]),
        declarationConsumedIds: new Set([B1, B2]),
        awaitingMoreActors: false,
      }),
    };
    state = applyTransition(state, frozen, {
      outcomeMap,
      adjudicated: new Set([H, B1, B2]),
      consumed: new Set([B1, B2]),
      rolls: [humanRoll, bot1Roll, bot2Roll],
      awaitingMoreActors: false,
      actionRevealComplete: true,
    });
    assert.equal(state.phase, "actor-dice");
    assert.equal(state.presentationIndex, 2);
    const bot2StartKey = overlaySessionKeyForActor(state, frozen, trpgDiceRollSessionKey(ROUND, [humanRoll, bot1Roll, bot2Roll]));
    tickOverlay(overlay, bot2StartKey);
    assert.equal(overlay.startCount, 2);
  });

  it("DICE_ORDER follows resolutionOrder not declaration persistence order", () => {
    const first = action(30, "ai_character", "Third");
    const second = action(20, "ai_character", "Second");
    const third = action(10, "human", "First");
    const rollSecond = roll(20, "Second", 15);
    const rollThird = roll(30, "Third", 9);
    const resolutionOrder = [10, 30, 20];
    const actors = buildRoundPresentationActors({
      resolutionOrder,
      actions: [first, second, third],
      rolls: [rollSecond, rollThird],
    });
    assert.equal(actors[0]?.actorId, 10);
    assert.equal(actors[1]?.actorId, 30);
    assert.equal(actors[2]?.actorId, 20);

    let state: RoundPresentationState = { mode: "cinematic", ...startCinematicPresentation() };
    const outcomeMap = outcomes([
      [10, "no_roll"],
      [30, "roll"],
      [20, "roll"],
    ]);
    state = applyTransition(state, actors, {
      outcomeMap,
      adjudicated: new Set([10, 30, 20]),
      consumed: new Set([30, 20]),
      rolls: [rollSecond, rollThird],
      awaitingMoreActors: false,
      actionRevealComplete: true,
    });
    assert.equal(state.presentationIndex, 1);
    assert.equal(actors[state.presentationIndex]?.actorId, 30);
  });
});

describe("POST-705 overlay dismiss gate", () => {
  it("uses production shouldAdvanceActorDiceAfterOverlayDismiss helper", () => {
    const key = trpgDiceRollSessionKey(ROUND, [roll(H, "Human", 12)]);
    assert.equal(
      shouldAdvanceActorDiceAfterOverlayDismiss({
        mode: "cinematic",
        phase: "actor-dice",
        overlayDismissed: true,
        overlaySessionKey: key,
        activeRollSessionKey: key,
      }),
      true
    );
    assert.equal(
      overlayPresentationDismissed({
        overlayDismissed: true,
        overlaySessionKey: key,
        presentationDiceSessionKey: key,
      }),
      true
    );
  });
});
