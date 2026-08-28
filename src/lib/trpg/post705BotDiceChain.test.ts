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

function applyTransition(
  state: RoundPresentationState,
  actors: readonly PresentationActor[],
  opts: {
    outcomeMap: Map<number, TrpgParticipantAdjudicationOutcome>;
    adjudicated: Set<number>;
    consumed: Set<number>;
    rolls: TrpgPublicRoll[];
    awaitingMoreActors: boolean;
    actionRevealComplete?: boolean;
    overlay?: { sim: OverlaySim; report: ReturnType<typeof trpgDiceOverlayPlaybackReport> };
  }
): RoundPresentationState {
  const aggregateKey = trpgDiceRollSessionKey(ROUND, opts.rolls);
  const activeKey = overlaySessionKeyForActor(state, actors, aggregateKey);
  const overlayReport = opts.overlay?.report;
  const decision = resolveLiveActorPresentationTransition({
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
    overlayDismissed: overlayReport?.dismissed,
    overlaySessionKey: overlayReport?.sessionKey,
    activeRollSessionKey: activeKey,
  });
  if (decision.kind !== "transition") return state;
  return { ...state, ...decision.next };
}

function freezeActors(
  previous: PresentationActor[] | null,
  frozenRound: number | null,
  actions: TrpgPublicAction[],
  rolls: TrpgPublicRoll[],
  resolutionOrder: number[],
  phase: string
): { actors: PresentationActor[]; frozenRound: number | null; restartCount: number } {
  const decided = decideLiveRoundPresentation({
    phase,
    roundNumber: ROUND,
    actions,
    rolls,
    resolutionOrder,
    adjudicatedParticipantIds: [],
  });
  const frozen = freezeLivePresentationActors({
    previous,
    next: decided.actors,
    ready: decided.ready,
    roundNumber: ROUND,
    frozenRound,
  });
  return { actors: frozen.actors, frozenRound: frozen.frozenRound, restartCount: 0 };
}

describe("POST-705 production H/B1/B2 dice chain", () => {
  it("T_H_B1_B2_FULL_CHAIN: Human through Bot2 no_roll with overlay session proof", () => {
    const human = action(H, "human", "Human");
    const bot1 = action(B1, "ai_character", "Bot1");
    const bot2 = action(B2, "ai_character", "Bot2");
    const humanRoll = roll(H, "Human", 14);
    const bot1Roll = roll(B1, "Bot1", 8);
    const outcomeMap = outcomes([
      [H, "roll"],
      [B1, "roll"],
      [B2, "no_roll"],
    ]);
    const consumed = new Set<number>();
    const trace: string[] = ["ROUND START"];

    let frozen: PresentationActor[] | null = null;
    let frozenRound: number | null = null;
    let presentationRestartCount = 0;
    let prevSessionKey = "";
    let state: RoundPresentationState = { mode: "idle", phase: "idle", presentationIndex: 0 };
    const overlay = freshOverlaySim();

    // Snapshot A — Human only, bots still generating
    trace.push("H ACTION");
    const snapA = freezeActors(frozen, frozenRound, [human], [humanRoll], [H, B1, B2], "ROLLING");
    frozen = snapA.actors;
    frozenRound = snapA.frozenRound;
    const sessionA = decideLiveRoundPresentation({
      phase: "ROLLING",
      roundNumber: ROUND,
      actions: [human],
      rolls: [humanRoll],
      resolutionOrder: [H, B1, B2],
    }).sessionKey;
    if (sessionA && sessionA !== prevSessionKey) {
      if (prevSessionKey && state.mode === "cinematic") presentationRestartCount += 1;
      prevSessionKey = sessionA;
      state = { mode: "cinematic", ...startCinematicPresentation() };
    }
    assert.equal(state.presentationIndex, 0, "CHAIN_STARTS_AT_HUMAN_INDEX_0");
    trace.push("H OUTCOME=roll", "H ROLL PRESENT", "H actor-action");

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
    const humanStart = tickOverlay(overlay, humanKey);
    assert.equal(overlay.startCount, 1, "HUMAN_OVERLAY_START_COUNT");
    assert.equal(humanStart.visible, true);
    trace.push("H OVERLAY START #1");
    assert.equal(
      shouldShowActorResultLane({ actorId: H, actors: frozen, state }),
      false,
      "BOT1_RESULT_BEFORE_DISMISS guard for Human"
    );

    const humanDismiss = dismissOverlay(overlay, humanKey);
    state = applyTransition(state, frozen, {
      outcomeMap,
      adjudicated: new Set([H]),
      consumed,
      rolls: [humanRoll],
      awaitingMoreActors: true,
      overlay: { sim: overlay, report: humanDismiss },
    });
    assert.equal(state.phase, "actor-result");
    trace.push("H OVERLAY DISMISS", "H actor-result");

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
    assert.equal(shouldShowGmNarration(state), false, "GM_PREMATURE_REVEAL");
    trace.push("BOT1 NOT YET AVAILABLE", "WAIT", "GM=false");

    // Snapshot B — Bot1 action, outcome roll, roll absent
    consumed.add(B1);
    const snapB = freezeActors(frozen, frozenRound, [human, bot1], [humanRoll], [H, B1, B2], "ROLLING");
    frozen = snapB.actors;
    assert.ok(frozen.some((a) => a.actorId === B1 && a.action && !a.roll), "FREEZE_LIVE_PRESENTATION_ACTORS_EXERCISED");
    trace.push("BOT1 ACTION ARRIVES", "BOT1 OUTCOME=roll", "BOT1 ROLL ABSENT", "BOT1 actor-action");

    state = applyTransition(state, frozen, {
      outcomeMap,
      adjudicated: new Set([H, B1]),
      consumed,
      rolls: [humanRoll],
      awaitingMoreActors: true,
      actionRevealComplete: true,
    });
    assert.equal(state.phase, "actor-action");
    assert.equal(state.presentationIndex, 1, "BOT1_WAITED_FOR_AUTHORITATIVE_ROLL");
    assert.notEqual(state.phase, "actor-dice", "BOT1_SKIPPED_BEFORE_ROLL");
    const bot1OverlayBeforeRoll = tickOverlay(overlay, overlaySessionKeyForActor(state, frozen, trpgDiceRollSessionKey(ROUND, [humanRoll])));
    assert.equal(overlay.startCount, 1, "BOT1 overlay must not start before roll");

    // Snapshot C — Bot1 authoritative roll arrives on frozen actor
    const snapC = freezeActors(frozen, frozenRound, [human, bot1], [humanRoll, bot1Roll], [H, B1, B2], "ROLLING");
    frozen = snapC.actors;
    const frozenBot1 = frozen.find((a) => a.actorId === B1);
    assert.ok(frozenBot1?.roll, "FROZEN_BOT1_ROLL_REFRESHED");
    assert.equal(presentationRestartCount, 0, "PRESENTATION_RESTART_COUNT");
    trace.push("BOT1 ROLL ARRIVES", "FROZEN ACTOR UPDATED");

    state = applyTransition(state, frozen, {
      outcomeMap,
      adjudicated: new Set([H, B1]),
      consumed,
      rolls: [humanRoll, bot1Roll],
      awaitingMoreActors: true,
      actionRevealComplete: true,
    });
    assert.equal(state.phase, "actor-dice", "BOT1_DICE_PHASE_ENTERED");
    assert.equal(state.presentationIndex, 1);
    assert.equal(activePresentationRoll({ actors: frozen, state })?.participantId, B1, "ACTIVE_PRESENTATION_ROLL");

    const bot1Key = overlaySessionKeyForActor(state, frozen, trpgDiceRollSessionKey(ROUND, [humanRoll, bot1Roll]));
    assert.notEqual(humanKey, bot1Key, "HUMAN_SESSION_KEY != BOT1_SESSION_KEY");
    const bot1Start = tickOverlay(overlay, bot1Key);
    assert.equal(overlay.startCount, 2, "BOT1_OVERLAY_START_COUNT includes one Bot1 start");
    assert.equal(bot1Start.visible, true, "BOT1_OVERLAY_VISIBLE_BEFORE_DISMISS");
    assert.equal(
      shouldShowActorResultLane({ actorId: B1, actors: frozen, state }),
      false,
      "BOT1_RESULT_BEFORE_DISMISS"
    );
    assert.equal(humanDismiss.dismissed, true);
    assert.notEqual(bot1Start.sessionKey, humanKey, "HUMAN_DISMISS_DOES_NOT_DISMISS_BOT1");
    trace.push("BOT1 actor-dice", "BOT1 OVERLAY START #1");

    const bot1Dismiss = dismissOverlay(overlay, bot1Key);
    state = applyTransition(state, frozen, {
      outcomeMap,
      adjudicated: new Set([H, B1]),
      consumed,
      rolls: [humanRoll, bot1Roll],
      awaitingMoreActors: false,
      overlay: { sim: overlay, report: bot1Dismiss },
    });
    assert.equal(state.phase, "actor-result");
    assert.equal(shouldShowActorResultLane({ actorId: B1, actors: frozen, state }), true);
    trace.push("BOT1 OVERLAY DISMISS", "BOT1 actor-result");

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
    consumed.add(B2);
    const snapBot2 = freezeActors(frozen, frozenRound, [human, bot1, bot2], [humanRoll, bot1Roll], [H, B1, B2], "ROLLING");
    frozen = snapBot2.actors;
    trace.push("BOT2 actor-action", "BOT2 OUTCOME=no_roll");

    const bot2StartCountBefore = overlay.startCount;
    state = applyTransition(state, frozen, {
      outcomeMap,
      adjudicated: new Set([H, B1, B2]),
      consumed,
      rolls: [humanRoll, bot1Roll],
      awaitingMoreActors: false,
      actionRevealComplete: true,
    });
    assert.notEqual(state.phase, "actor-dice", "BOT2_NO_ROLL_OVERLAY_START_COUNT");
    assert.equal(overlay.startCount, bot2StartCountBefore, "BOT2 overlay start count unchanged");
    assert.equal(state.phase, "gm-narration", "GM_AFTER_LAST_ACTOR");
    assert.equal(shouldShowGmNarration(state), true);
    trace.push("BOT2 OVERLAY START #0", "GM narration");

    assert.deepEqual(trace, [
      "ROUND START",
      "H ACTION",
      "H OUTCOME=roll",
      "H ROLL PRESENT",
      "H actor-action",
      "H actor-dice",
      "H OVERLAY START #1",
      "H OVERLAY DISMISS",
      "H actor-result",
      "BOT1 NOT YET AVAILABLE",
      "WAIT",
      "GM=false",
      "BOT1 ACTION ARRIVES",
      "BOT1 OUTCOME=roll",
      "BOT1 ROLL ABSENT",
      "BOT1 actor-action",
      "BOT1 ROLL ARRIVES",
      "FROZEN ACTOR UPDATED",
      "BOT1 actor-dice",
      "BOT1 OVERLAY START #1",
      "BOT1 OVERLAY DISMISS",
      "BOT1 actor-result",
      "BOT2 actor-action",
      "BOT2 OUTCOME=no_roll",
      "BOT2 OVERLAY START #0",
      "GM narration",
    ]);
  });

  it("OUTCOME_ROLL_WITHOUT_CLIENT_ROLL_NEVER_SKIPS", () => {
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
    assert.equal(decision.kind, "transition");
    if (decision.kind === "transition") {
      assert.deepEqual(decision.next, { phase: "actor-action", presentationIndex: 0 });
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
      "ROLLING"
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
      "ROLLING"
    );
    frozen = snapBuffered.actors;
    assert.ok(frozen.find((a) => a.actorId === B2)?.roll, "FUTURE_ROLL_BUFFERED");
    assert.equal(activePresentationRoll({ actors: frozen, state })?.participantId, B1, "FUTURE_ROLL_STEALS_ACTIVE_OVERLAY");

    const bot1KeyAfterBuffer = overlaySessionKeyForActor(
      state,
      frozen,
      trpgDiceRollSessionKey(ROUND, [humanRoll, bot1Roll, bot2Roll])
    );
    assert.equal(bot1KeyAfterBuffer, bot1Key, "active dice session stays on Bot1 while buffered");
    const bot2Key = trpgDiceRollSessionKey(ROUND, [bot2Roll]);
    assert.notEqual(bot1Key, bot2Key);
    const misalignedReport = trpgDiceOverlayPlaybackReport({
      incomingSessionKey: bot2Key,
      playOwnerSessionKey: overlay.playOwnerSessionKey,
      play: overlay.play,
      settled: false,
      rollCount: 1,
    });
    assert.equal(misalignedReport.visible, false, "BOT2 overlay must not start during Bot1");
    assert.equal(overlay.startCount, 1, "BOT1 overlay not replayed by buffered Bot2 roll");
    assert.equal(state.phase, "actor-dice");
    assert.equal(overlay.playOwnerSessionKey, bot1Key, "BOT1_OVERLAY_REPLAY");

    const bot1Dismiss = dismissOverlay(overlay, bot1Key);
    state = applyTransition(state, frozen, {
      outcomeMap,
      adjudicated: new Set([H, B1, B2]),
      consumed: new Set([B1, B2]),
      rolls: [humanRoll, bot1Roll, bot2Roll],
      awaitingMoreActors: false,
      overlay: { sim: overlay, report: bot1Dismiss },
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
    assert.equal(overlay.startCount, 2, "BOT2_OVERLAY_START_COUNT");
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
    assert.equal(state.presentationIndex, 1, "second actor in resolutionOrder after human no_roll");
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
