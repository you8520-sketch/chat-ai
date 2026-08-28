import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  activePresentationDiceSessionKey,
  applyTrpgDiceOverlaySession,
  trpgDiceOverlayPlaybackReport,
  trpgDiceOverlayPlayOwnerSessionKey,
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
  isPresentationActorRosterMaterialized,
  isRoundPresentationAwaitingMoreActors,
  resolveLiveActorDeclarationPresentation,
  resolveLiveActorPresentationTransition,
  resultLaneActorIds,
  revealedActorIds,
  shouldShowGmNarration,
  type PresentationActor,
  type RoundPresentationState,
} from "./roundPresentation";
import type { TrpgPublicAction, TrpgPublicRoll } from "./snapshot";

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
  const actionKind = trpgDiceOverlaySessionAction({
    rollSessionKey: incomingKey,
    prevRollSessionKey: sim.prevRollSessionKey,
    consumed: false,
    started: sim.play.started,
    dismissed: sim.play.dismissed,
  });
  if (actionKind === "start") sim.startCount += 1;
  sim.play = applyTrpgDiceOverlaySession(sim.play, actionKind);
  sim.playOwnerSessionKey = trpgDiceOverlayPlayOwnerSessionKey(actionKind, incomingKey);
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

function visibilitySnapshot(opts: {
  state: RoundPresentationState;
  actors: readonly PresentationActor[];
  actions: TrpgPublicAction[];
  consumed: Set<number>;
}) {
  const declaration = resolveLiveActorDeclarationPresentation({
    mode: opts.state.mode,
    phase: opts.state.phase,
    presentationIndex: opts.state.presentationIndex,
    presentationActors: opts.actors,
    actions: opts.actions,
    consumedAiIds: opts.consumed,
  });
  const revealed = revealedActorIds({ actors: opts.actors, state: opts.state });
  const resultLane = resultLaneActorIds({ actors: opts.actors, state: opts.state });
  const b2Actor = opts.actors.find((a) => a.actorId === B2);
  const b2Revealed = revealed.includes(B2);
  const b2Progressive = declaration.activeDeclarationActorId === B2;
  const b2DeclarationComplete =
    b2Actor?.action?.kind === "ai_character" ? opts.consumed.has(B2) : true;
  const b2FullProseVisible = b2Revealed && b2DeclarationComplete && !b2Progressive;
  return {
    b2FullProseVisible,
    b2ResultLaneVisible: resultLane.includes(B2),
    gmVisible: shouldShowGmNarration(opts.state),
    b2ProgressiveReveal: b2Progressive,
    b2ResultBeforeDice:
      resultLane.includes(B2) &&
      opts.state.phase !== "actor-result" &&
      opts.state.phase !== "gm-narration" &&
      opts.state.phase !== "complete",
  };
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
  if (state.phase === "actor-dice" && opts.overlay) {
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
      overlayDismissed: opts.overlay.report.dismissed,
      overlaySessionKey: opts.overlay.report.sessionKey,
      activeRollSessionKey: activeKey,
    });
  }
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
    actionRevealComplete: opts.actionRevealComplete ?? true,
  });
}

describe("final actor roster materialization race", () => {
  it("PRODUCTION_RACE: short actor array with full adjudication must not enter gm-narration", () => {
    const human = action(H, "human", "Human");
    const bot1 = action(B1, "ai_character", "Bot1");
    const humanRoll = roll(H, "Human", 4, "FAILURE");
    const bot1Roll = roll(B1, "Bot1", 4, "FAILURE");
    const bot2Roll = roll(B2, "Bot2", 1, "CRITICAL_FAILURE");
    const outcomeMap = outcomes([
      [H, "roll"],
      [B1, "roll"],
      [B2, "roll"],
    ]);
    const adjudicated = new Set([H, B1, B2]);
    const consumed = new Set([H, B1]);

    const snap = freezeActors(null, null, [human, bot1], [humanRoll, bot1Roll], [H, B1, B2], "GENERATING_NARRATION", [
      H,
      B1,
      B2,
    ]);
    let actors = snap.actors;
    assert.equal(actors.length, 2, "PRODUCTION_FAILURE_SHAPE_REPRODUCED");
    assert.equal(
      isPresentationActorRosterMaterialized({ actors, adjudicatedParticipantIds: adjudicated }),
      false,
      "ADJUDICATED_ROSTER_MATERIALIZATION_GUARD"
    );

    const state: RoundPresentationState = {
      mode: "cinematic",
      phase: "actor-result",
      presentationIndex: 1,
    };

    const afterB1Result = advanceAfterActorResult({
      actors,
      presentationIndex: state.presentationIndex,
      adjudicatedParticipantIds: adjudicated,
      declarationConsumedIds: consumed,
      awaitingMoreActors: false,
    });

    assert.notEqual(afterB1Result.phase, "gm-narration", "PREMATURE_GM_FROM_SHORT_ACTOR_ARRAY_FIXED");
    assert.deepEqual(afterB1Result, { phase: "actor-action", presentationIndex: 2 });

    const before = visibilitySnapshot({
      state: { ...state, ...afterB1Result },
      actors,
      actions: [human, bot1],
      consumed,
    });
    assert.equal(before.b2FullProseVisible, false, "B2_FULL_TEXT_BEFORE_SLOT");
    assert.equal(before.b2ResultLaneVisible, false, "B2_RESULT_BEFORE_DICE");
    assert.equal(before.gmVisible, false, "GM_BEFORE_B2_RESULT_COMPLETE");

    const bot2 = action(B2, "ai_character", "Bot2");
    const snapB2 = freezeActors(actors, snap.frozenRound, [human, bot1, bot2], [humanRoll, bot1Roll, bot2Roll], [H, B1, B2], "GENERATING_NARRATION", [H, B1, B2]);
    actors = snapB2.actors;
    assert.ok(actors.some((a) => a.actorId === B2));

    let nextState: RoundPresentationState = { mode: "cinematic", ...afterB1Result };
    const waiting = visibilitySnapshot({
      state: nextState,
      actors,
      actions: [human, bot1, bot2],
      consumed,
    });
    assert.equal(waiting.b2FullProseVisible, false);
    assert.equal(waiting.b2ResultLaneVisible, false);
    assert.equal(waiting.gmVisible, false);

    consumed.add(B2);
    const actionDecision = transitionDecision(nextState, actors, {
      outcomeMap,
      adjudicated,
      consumed,
      rolls: [humanRoll, bot1Roll, bot2Roll],
      awaitingMoreActors: false,
      actionRevealComplete: true,
    });
    assert.equal(actionDecision.kind, "transition");
    if (actionDecision.kind === "transition") {
      nextState = { ...nextState, ...actionDecision.next };
    }
    assert.equal(nextState.phase, "actor-dice");

    const duringAction = visibilitySnapshot({
      state: nextState,
      actors,
      actions: [human, bot1, bot2],
      consumed: new Set([B1, B2]),
    });
    assert.equal(duringAction.b2ResultLaneVisible, false);
    assert.equal(duringAction.gmVisible, false);

    const overlay = freshOverlaySim();
    const b2Key = overlaySessionKeyForActor(nextState, actors, trpgDiceRollSessionKey(ROUND, [humanRoll, bot1Roll, bot2Roll]));
    tickOverlay(overlay, b2Key);
    assert.equal(overlay.startCount, 1, "B2_DICE_OVERLAY_COUNT");

    const b2Dismiss = dismissOverlay(overlay, b2Key);
    const diceDecision = transitionDecision(nextState, actors, {
      outcomeMap,
      adjudicated,
      consumed,
      rolls: [humanRoll, bot1Roll, bot2Roll],
      awaitingMoreActors: false,
      overlay: { report: b2Dismiss },
    });
    assert.equal(diceDecision.kind, "transition");
    if (diceDecision.kind === "transition") {
      nextState = { ...nextState, ...diceDecision.next };
    }
    assert.equal(nextState.phase, "actor-result");

    const duringResult = visibilitySnapshot({
      state: nextState,
      actors,
      actions: [human, bot1, bot2],
      consumed: new Set([B1, B2]),
    });
    assert.equal(duringResult.b2ResultLaneVisible, true);
    assert.equal(duringResult.gmVisible, false);

    const afterB2Result = advanceAfterActorResult({
      actors,
      presentationIndex: nextState.presentationIndex,
      adjudicatedParticipantIds: adjudicated,
      declarationConsumedIds: consumed,
      awaitingMoreActors: false,
    });
    assert.equal(afterB2Result.phase, "gm-narration");
    assert.equal(shouldShowGmNarration({ mode: "cinematic", ...afterB2Result }), true);
  });

  it("B2_NO_ROLL: progressive action reveal before GM without dice", () => {
    const human = action(H, "human", "Human");
    const bot1 = action(B1, "ai_character", "Bot1");
    const humanRoll = roll(H, "Human", 12, "SUCCESS");
    const bot1Roll = roll(B1, "Bot1", 9, "FAILURE");
    const bot2 = action(B2, "ai_character", "Bot2");
    const outcomeMap = outcomes([
      [H, "roll"],
      [B1, "roll"],
      [B2, "no_roll"],
    ]);
    const adjudicated = new Set([H, B1, B2]);
    const consumed = new Set([H, B1]);

    const snap = freezeActors(null, null, [human, bot1], [humanRoll, bot1Roll], [H, B1, B2], "GENERATING_NARRATION", [H, B1, B2]);
    let actors = snap.actors;
    let state: RoundPresentationState = { mode: "cinematic", phase: "actor-result", presentationIndex: 1 };

    const held = advanceAfterActorResult({
      actors,
      presentationIndex: state.presentationIndex,
      adjudicatedParticipantIds: adjudicated,
      declarationConsumedIds: consumed,
      awaitingMoreActors: false,
    });
    assert.deepEqual(held, { phase: "actor-action", presentationIndex: 2 });

    const snapB2 = freezeActors(actors, snap.frozenRound, [human, bot1, bot2], [humanRoll, bot1Roll], [H, B1, B2], "GENERATING_NARRATION", [H, B1, B2]);
    actors = snapB2.actors;
    state = { mode: "cinematic", ...held };
    consumed.add(B2);

    const beforeReveal = visibilitySnapshot({
      state,
      actors,
      actions: [human, bot1, bot2],
      consumed: new Set([H, B1]),
    });
    assert.equal(beforeReveal.b2FullProseVisible, false, "B2_NO_ROLL_PASS");

    const advance = transitionDecision(state, actors, {
      outcomeMap,
      adjudicated,
      consumed,
      rolls: [humanRoll, bot1Roll],
      awaitingMoreActors: false,
      actionRevealComplete: true,
    });
    assert.equal(advance.kind, "transition");
    if (advance.kind === "transition") {
      assert.equal(advance.next.phase, "gm-narration");
    }
  });

  it("B2_SKIPPED: skipped outcome re-evaluates without deadlock", () => {
    const human = action(H, "human", "Human");
    const bot1 = action(B1, "ai_character", "Bot1");
    const bot2 = action(B2, "ai_character", "Bot2");
    const humanRoll = roll(H, "Human", 12, "SUCCESS");
    const bot1Roll = roll(B1, "Bot1", 9, "FAILURE");
    const outcomeMap = outcomes([
      [H, "roll"],
      [B1, "roll"],
      [B2, "skipped"],
    ]);
    const adjudicated = new Set([H, B1, B2]);
    const consumed = new Set([H, B1]);

    const snap = freezeActors(null, null, [human, bot1], [humanRoll, bot1Roll], [H, B1, B2], "GENERATING_NARRATION", [H, B1, B2]);
    const held = advanceAfterActorResult({
      actors: snap.actors,
      presentationIndex: 1,
      adjudicatedParticipantIds: adjudicated,
      declarationConsumedIds: consumed,
      awaitingMoreActors: false,
    });
    assert.deepEqual(held, { phase: "actor-action", presentationIndex: 2 });

    const snapB2 = freezeActors(snap.actors, snap.frozenRound, [human, bot1, bot2], [humanRoll, bot1Roll], [H, B1, B2], "GENERATING_NARRATION", [H, B1, B2]);
    consumed.add(B2);
    const advance = transitionDecision(
      { mode: "cinematic", ...held },
      snapB2.actors,
      {
        outcomeMap,
        adjudicated,
        consumed,
        rolls: [humanRoll, bot1Roll],
        awaitingMoreActors: false,
        actionRevealComplete: true,
      }
    );
    assert.equal(advance.kind, "transition", "B2_SKIPPED_PASS");
    if (advance.kind === "transition") {
      assert.equal(advance.next.phase, "gm-narration");
    }
  });

  it("B2_LATE_ACTION: action materializes after B1 result hold", () => {
    const human = action(H, "human", "Human");
    const bot1 = action(B1, "ai_character", "Bot1");
    const humanRoll = roll(H, "Human", 12, "SUCCESS");
    const bot1Roll = roll(B1, "Bot1", 9, "FAILURE");
    const bot2Roll = roll(B2, "Bot2", 6, "FAILURE");
    const outcomeMap = outcomes([
      [H, "roll"],
      [B1, "roll"],
      [B2, "roll"],
    ]);
    const adjudicated = new Set([H, B1, B2]);

    const snap = freezeActors(null, null, [human, bot1], [humanRoll, bot1Roll], [H, B1, B2], "GENERATING_NARRATION", [H, B1, B2]);
    const held = advanceAfterActorResult({
      actors: snap.actors,
      presentationIndex: 1,
      adjudicatedParticipantIds: adjudicated,
      declarationConsumedIds: new Set([H, B1]),
      awaitingMoreActors: false,
    });
    assert.equal(held.presentationIndex, 2);
    assert.notEqual(held.phase, "gm-narration", "B2_LATE_ACTION_PASS");

    const bot2 = action(B2, "ai_character", "Bot2");
    const snapLate = freezeActors(snap.actors, snap.frozenRound, [human, bot1, bot2], [humanRoll, bot1Roll, bot2Roll], [H, B1, B2], "GENERATING_NARRATION", [H, B1, B2]);
    assert.ok(snapLate.actors.some((a) => a.actorId === B2));
    assert.equal(
      isPresentationActorRosterMaterialized({
        actors: snapLate.actors,
        adjudicatedParticipantIds: adjudicated,
      }),
      true
    );
  });

  it("B2_LATE_ROLL: roll arrives after B2 action materializes", () => {
    const human = action(H, "human", "Human");
    const bot1 = action(B1, "ai_character", "Bot1");
    const bot2 = action(B2, "ai_character", "Bot2");
    const humanRoll = roll(H, "Human", 12, "SUCCESS");
    const bot1Roll = roll(B1, "Bot1", 9, "FAILURE");
    const outcomeMap = outcomes([
      [H, "roll"],
      [B1, "roll"],
      [B2, "roll"],
    ]);
    const adjudicated = new Set([H, B1, B2]);
    const consumed = new Set([H, B1, B2]);

    const snapActionOnly = freezeActors(null, null, [human, bot1, bot2], [humanRoll, bot1Roll], [H, B1, B2], "GENERATING_NARRATION", [H, B1, B2]);
    let state: RoundPresentationState = { mode: "cinematic", phase: "actor-action", presentationIndex: 2 };

    let decision = transitionDecision(state, snapActionOnly.actors, {
      outcomeMap,
      adjudicated,
      consumed,
      rolls: [humanRoll, bot1Roll],
      awaitingMoreActors: false,
      actionRevealComplete: true,
    });
    assert.equal(decision.kind, "hold", "B2_LATE_ROLL_PASS");

    const bot2Roll = roll(B2, "Bot2", 6, "FAILURE");
    const snapWithRoll = freezeActors(
      snapActionOnly.actors,
      snapActionOnly.frozenRound,
      [human, bot1, bot2],
      [humanRoll, bot1Roll, bot2Roll],
      [H, B1, B2],
      "GENERATING_NARRATION",
      [H, B1, B2]
    );
    decision = transitionDecision(state, snapWithRoll.actors, {
      outcomeMap,
      adjudicated,
      consumed,
      rolls: [humanRoll, bot1Roll, bot2Roll],
      awaitingMoreActors: false,
      actionRevealComplete: true,
    });
    assert.equal(decision.kind, "transition");
    if (decision.kind === "transition") {
      assert.equal(decision.next.phase, "actor-dice");
    }
  });

  it("NON_ADJUDICATED_RESOLUTION_ORDER_MEMBER_DOES_NOT_BLOCK_GM", () => {
    const spectatorOrder = [H, 15, B1];
    const human = action(H, "human", "Human");
    const bot1 = action(B1, "ai_character", "Bot1");
    const humanRoll = roll(H, "Human", 12, "SUCCESS");
    const bot1Roll = roll(B1, "Bot1", 9, "FAILURE");
    const actors = buildRoundPresentationActors({
      resolutionOrder: spectatorOrder,
      actions: [human, bot1],
      rolls: [humanRoll, bot1Roll],
    });
    assert.equal(actors.some((a) => a.actorId === 15), false);
    const adjudicated = new Set([H, B1]);
    assert.equal(
      isPresentationActorRosterMaterialized({ actors, adjudicatedParticipantIds: adjudicated }),
      true
    );
    const afterBot1 = advanceAfterActorResult({
      actors,
      presentationIndex: 1,
      adjudicatedParticipantIds: adjudicated,
      declarationConsumedIds: new Set([H, B1]),
      awaitingMoreActors: false,
    });
    assert.equal(afterBot1.phase, "gm-narration");
  });

  it("STATIC_OWNER_AUDIT: single presentation transition owners", () => {
    const roundPresentation = readFileSync("src/lib/trpg/roundPresentation.ts", "utf8");
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");

    const lastActorToGmMatches = roundPresentation.match(/phase:\s*"gm-narration"/g) ?? [];
    assert.equal(lastActorToGmMatches.length, 1, "LAST_ACTOR_TO_GM_OWNER_COUNT");

    assert.match(roundPresentation, /export function isPresentationActorRosterMaterialized/);
    assert.equal(
      (roundPresentation.match(/export function isPresentationActorRosterMaterialized/g) ?? []).length,
      1,
      "PRESENTATION_ROSTER_COMPLETENESS_OWNER_COUNT"
    );

    assert.equal(
      (roundPresentation.match(/export function isRoundPresentationAwaitingMoreActors/g) ?? []).length,
      1,
      "SERVER_AWAITING_MORE_ACTORS_OWNER_COUNT"
    );

    const gmDraftAdvancePatterns = [
      /gmNarrationDraft[\s\S]{0,120}phase:\s*"gm-narration"/,
      /gmTextReady[\s\S]{0,120}phase:\s*"gm-narration"/,
      /currentNarration[\s\S]{0,120}phase:\s*"gm-narration"/,
      /GENERATING_NARRATION[\s\S]{0,120}phase:\s*"gm-narration"/,
      /gmGenerationInFlight[\s\S]{0,120}phase:\s*"gm-narration"/,
    ];
    const gmDraftAdvanceCount = gmDraftAdvancePatterns.filter((pattern) => pattern.test(room)).length;
    assert.equal(gmDraftAdvanceCount, 0, "GM_DRAFT_PRESENTATION_ADVANCE_OWNER_COUNT");

    assert.equal(
      isRoundPresentationAwaitingMoreActors({
        phase: "BOT_ACTION",
        workType: "generate_bots",
      }),
      true
    );
    assert.equal(
      isRoundPresentationAwaitingMoreActors({
        phase: "GENERATING_NARRATION",
        workType: "idle",
      }),
      false
    );
  });
});
