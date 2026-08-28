import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  activePresentationDiceSessionKey,
  trpgDiceRollSessionKey,
} from "./diceRollUx";
import {
  advanceAfterActorResult,
  buildRoundPresentationActors,
  freezeLivePresentationActors,
  isLiveRoundPresentationReady,
  resolveLiveActorDeclarationPresentation,
  resolveLiveActorPresentationTransition,
  revealedActorIds,
  resultLaneActorIds,
  shouldShowGmNarration,
  startCinematicPresentation,
  trpgRoundPresentationSessionKey,
  type PresentationActor,
  type RoundPresentationState,
} from "./roundPresentation";
import {
  createPresentationSession,
  deriveExpectedPresentationActorIdsFromLogRow,
  derivePresentationSceneTurnLiveProps,
  deriveResolutionOrderFromLogRow,
  filterRevealedActions,
  findPresentationLogRow,
  inferHeldPresentationRoundFromLog,
  isPresentationLiveRow,
  isPresentationSessionReleased,
  presentationSessionMetadata,
  resolvePresentationLiveReady,
  resolvePresentationRoundNumber,
  resolvePresentationSourceRolls,
  shouldShowNextActionInput,
} from "./presentationSession";
import type { TrpgPublicAction, TrpgPublicLog, TrpgPublicRoll } from "./snapshot";

const H = 47;
const B1 = 49;
const B2 = 48;
const ROUND_48 = 48;
const ROUND_49 = 49;
const EXPECTED = [H, B1, B2] as const;

function action(participantId: number, kind: TrpgPublicAction["kind"], name: string): TrpgPublicAction {
  return { participantId, name, body: `${name} acts`, revealed: true, kind, actionType: "investigate" };
}

function roll(participantId: number, name: string, d20: number, tier: "SUCCESS" | "FAILURE"): TrpgPublicRoll {
  return {
    participantId,
    name,
    d20,
    statKey: "nerve",
    finalScore: d20,
    dc: 11,
    tier,
    success: tier === "SUCCESS",
    actionBody: `${name} acts`,
    actionType: "investigate",
    kind: participantId === H ? "human" : "ai_character",
  };
}

function logRow48(): TrpgPublicLog {
  return {
    roundNumber: ROUND_48,
    actions: [action(H, "human", "Human"), action(B1, "ai_character", "Bot1"), action(B2, "ai_character", "Bot2")],
    rolls: [roll(H, "Human", 12, "SUCCESS"), roll(B1, "Bot1", 9, "FAILURE"), roll(B2, "Bot2", 6, "FAILURE")],
    narration: "Round 48 GM narration canonical text for progressive reveal.",
    billedPoints: null,
    viewerSharePoints: null,
  };
}

function visibility(opts: {
  state: RoundPresentationState;
  actors: PresentationActor[];
  sceneLive: ReturnType<typeof derivePresentationSceneTurnLiveProps>;
}) {
  const revealed = opts.sceneLive.revealedActorIds ?? [];
  const b2Index = opts.actors.findIndex((actor) => actor.actorId === B2);
  const b2Revealed = revealed.includes(B2);
  return {
    b2FullProseVisible: b2Revealed && opts.state.phase !== "actor-action",
    b2ResultVisible: (opts.sceneLive.resultLaneActorIds ?? []).includes(B2),
    gmVisible: opts.sceneLive.showGmNarration === true,
    actorCount: opts.actors.length,
    activeActor: opts.actors[opts.state.presentationIndex]?.actorId ?? null,
  };
}

describe("presentation session server-round rollover", () => {
  it("PRODUCTION_TRACE_STAGE_A: round48 bot2 actor-action progressive", () => {
    const row = logRow48();
    const actions = filterRevealedActions(row.actions);
    const rolls = row.rolls;
    const actors = buildRoundPresentationActors({
      resolutionOrder: [...EXPECTED],
      actions,
      rolls,
    });
    const state: RoundPresentationState = {
      mode: "cinematic",
      phase: "actor-action",
      presentationIndex: 2,
    };
    const sceneLive = derivePresentationSceneTurnLiveProps({
      rowRoundNumber: ROUND_48,
      presentationRoundNumber: ROUND_48,
      gateLiveRound: true,
      roundShow: state,
      cinematicRevealedIds: revealedActorIds({ actors, state }),
      cinematicLaneIds: resultLaneActorIds({ actors, state }),
      cinematicShowGm: shouldShowGmNarration(state),
      preCinematicVisibleIds: [],
      serverGmStreamDraft: "",
      presentationLogNarration: row.narration,
    });
    const vis = visibility({ state, actors, sceneLive });
    assert.equal(vis.actorCount, 3);
    assert.equal(vis.activeActor, B2);
    assert.equal(vis.b2FullProseVisible, false);
    assert.equal(vis.b2ResultVisible, false);
    assert.equal(vis.gmVisible, false);
  });

  it("PRODUCTION_TRACE_STAGE_B: server round49 while presentation still round48", () => {
    const row48 = logRow48();
    const log = [row48];
    const roundShow: RoundPresentationState = {
      mode: "cinematic",
      phase: "actor-action",
      presentationIndex: 2,
    };
    const session = createPresentationSession({
      roundNumber: ROUND_48,
      expectedPresentationActorIds: [...EXPECTED],
      resolutionOrder: [...EXPECTED],
    });
    const inferred = inferHeldPresentationRoundFromLog({
      serverRoundNumber: ROUND_49,
      serverPhase: "ACTION_INPUT",
      log,
      roundShow,
    });
    assert.equal(inferred, ROUND_48);
    const presentationRoundNumber = resolvePresentationRoundNumber({
      serverRoundNumber: ROUND_49,
      session,
      roundShow,
      inferredHeldRound: inferred,
    });
    assert.equal(presentationRoundNumber, ROUND_48, "PRESENTATION_ROUND_STILL_48");
    const presentationLogRow = findPresentationLogRow(log, presentationRoundNumber);
    const sourceActions = filterRevealedActions(presentationLogRow?.actions ?? []);
    const sourceRolls = resolvePresentationSourceRolls({
      presentationRoundNumber,
      serverRoundNumber: ROUND_49,
      presentationLogRow,
      serverCurrentRolls: [],
      dicePreviewRolls: [],
    });
    const meta = presentationSessionMetadata({
      session,
      presentationRoundNumber,
      serverRoundNumber: ROUND_49,
      serverExpectedPresentationActorIds: [],
      serverResolutionOrder: [],
    });
    const liveReady = resolvePresentationLiveReady({
      presentationRoundNumber,
      serverRoundNumber: ROUND_49,
      serverPhase: "ACTION_INPUT",
      sourceActions,
      sourceRolls,
      resolutionOrder: meta.resolutionOrder,
      adjudicatedParticipantIds: sourceActions.map((a) => a.participantId),
    });
    assert.equal(liveReady, true, "ROUND48_STILL_LIVE_WHEN_SERVER_ROUND49");
    const frozen = freezeLivePresentationActors({
      previous: null,
      next: buildRoundPresentationActors({
        resolutionOrder: meta.resolutionOrder,
        actions: sourceActions,
        rolls: sourceRolls,
      }),
      ready: liveReady,
      roundNumber: presentationRoundNumber,
      frozenRound: null,
    });
    assert.equal(frozen.actors.length, 3, "PRESENTATION_ACTOR_COUNT=3");
    assert.equal(frozen.actors.some((actor) => actor.actorId === B2), true, "ROUND48_ACTORS_PRESERVED");
    const isLiveRow = isPresentationLiveRow({
      rowRoundNumber: ROUND_48,
      presentationRoundNumber,
      gateLiveRound: true,
    });
    assert.equal(isLiveRow, true, "ROUND48_IS_STILL_LIVE_PRESENTATION_ROW");
    const sceneLive = derivePresentationSceneTurnLiveProps({
      rowRoundNumber: ROUND_48,
      presentationRoundNumber,
      gateLiveRound: true,
      roundShow,
      cinematicRevealedIds: revealedActorIds({ actors: frozen.actors, state: roundShow }),
      cinematicLaneIds: resultLaneActorIds({ actors: frozen.actors, state: roundShow }),
      cinematicShowGm: shouldShowGmNarration(roundShow),
      preCinematicVisibleIds: [],
      serverGmStreamDraft: "",
      presentationLogNarration: row48.narration,
    });
    assert.notEqual(sceneLive.revealedActorIds, undefined);
    assert.notEqual(sceneLive.resultLaneActorIds, undefined);
    assert.notEqual(sceneLive.showGmNarration, undefined);
    const vis = visibility({ state: roundShow, actors: frozen.actors, sceneLive });
    assert.equal(vis.activeActor, B2, "ACTIVE_ACTOR=48");
    assert.equal(vis.b2FullProseVisible, false, "B2_FULL_PROSE_VISIBLE=false");
    assert.equal(vis.b2ResultVisible, false, "B2_RESULT_VISIBLE=false");
    assert.equal(vis.gmVisible, false, "GM_VISIBLE=false");
    assert.equal(
      shouldShowNextActionInput({
        serverPhase: "ACTION_INPUT",
        hasUnlockedDraft: true,
        session,
        roundShow,
        gmRevealComplete: false,
      }),
      false,
      "ROUND49_ACTION_INPUT_VISIBLE=false"
    );
    const diceKey = activePresentationDiceSessionKey({
      roundNumber: presentationRoundNumber,
      mode: "cinematic",
      phase: "actor-dice",
      activeRoll: sourceRolls.find((r) => r.participantId === B2) ?? null,
      aggregateRollSessionKey: trpgDiceRollSessionKey(presentationRoundNumber, sourceRolls),
    });
    assert.match(diceKey, /^48\|/, "ROUND48_DICE_SESSION_PRESERVED");
  });

  it("POLL_SKIP: infer round48 bridge without intermediate snapshot", () => {
    const roundShow: RoundPresentationState = {
      mode: "cinematic",
      phase: "actor-result",
      presentationIndex: 1,
    };
    const inferred = inferHeldPresentationRoundFromLog({
      serverRoundNumber: ROUND_49,
      serverPhase: "ACTION_INPUT",
      log: [logRow48()],
      roundShow,
    });
    assert.equal(inferred, ROUND_48);
    const presentationRoundNumber = resolvePresentationRoundNumber({
      serverRoundNumber: ROUND_49,
      session: null,
      roundShow,
      inferredHeldRound: inferred,
    });
    assert.equal(presentationRoundNumber, ROUND_48);
    const row = findPresentationLogRow([logRow48()], presentationRoundNumber);
    assert.ok(row?.actions.some((a) => a.participantId === B2));
  });

  it("FRESH_MOUNT: server round49 does not replay round48 cinematic", () => {
    const roundShow: RoundPresentationState = { mode: "historical", phase: "idle", presentationIndex: 0 };
    const inferred = inferHeldPresentationRoundFromLog({
      serverRoundNumber: ROUND_49,
      serverPhase: "ACTION_INPUT",
      log: [logRow48()],
      roundShow,
    });
    assert.equal(inferred, null, "FRESH_MOUNT_REPLAYS_OLD_ROUND=false");
    const presentationRoundNumber = resolvePresentationRoundNumber({
      serverRoundNumber: ROUND_49,
      session: null,
      roundShow,
      inferredHeldRound: inferred,
    });
    assert.equal(presentationRoundNumber, ROUND_49);
    const ready = isLiveRoundPresentationReady({
      phase: "ACTION_INPUT",
      hasLockedActorSet: false,
      resolutionOrder: EXPECTED,
      adjudicatedParticipantIds: [],
    });
    assert.equal(ready, false);
  });

  it("NO_ROLL B2 after server rollover: progressive action then GM", () => {
    const row = logRow48();
    row.rolls = row.rolls.filter((r) => r.participantId !== B2);
    const actions = filterRevealedActions(row.actions);
    const actors = buildRoundPresentationActors({
      resolutionOrder: [...EXPECTED],
      actions,
      rolls: row.rolls,
    });
    let state: RoundPresentationState = {
      mode: "cinematic",
      phase: "actor-action",
      presentationIndex: 2,
    };
    const declaration = resolveLiveActorDeclarationPresentation({
      mode: state.mode,
      phase: state.phase,
      presentationIndex: state.presentationIndex,
      presentationActors: actors,
      actions,
      consumedAiIds: new Set([B1]),
    });
    assert.equal(declaration.activeDeclarationActorId, B2);
    const transition = resolveLiveActorPresentationTransition({
      mode: state.mode,
      phase: state.phase,
      presentationIndex: state.presentationIndex,
      actors,
      rolls: row.rolls,
      adjudicatedParticipantIds: new Set([H, B1, B2]),
      declarationConsumedIds: new Set([H, B1, B2]),
      participantAdjudicationOutcomes: new Map([
        [H, "roll"],
        [B1, "roll"],
        [B2, "no_roll"],
      ]),
      awaitingMoreActors: false,
      expectedPresentationActorIds: EXPECTED,
      actionRevealComplete: true,
    });
    assert.equal(transition.kind, "transition");
    if (transition.kind === "transition") {
      state = { ...state, ...transition.next };
    }
    assert.equal(state.phase, "gm-narration", "NO_ROLL skips dice to GM");
    assert.equal(shouldShowGmNarration(state), true);
  });

  it("STATIC_OWNER_AUDIT: single presentation-round owners in room", () => {
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    const sessionModule = readFileSync("src/lib/trpg/presentationSession.ts", "utf8");
    assert.match(room, /resolvePresentationRoundNumber/);
    assert.match(room, /presentationSession/);
    assert.match(room, /derivePresentationSceneTurnLiveProps/);
    assert.match(sessionModule, /export function resolvePresentationRoundNumber/);
    assert.match(sessionModule, /export function derivePresentationSceneTurnLiveProps/);
    assert.doesNotMatch(room, /presentationRoundRef\.current !== snap\.round\.number/);
    const liveRowServerRound = room.match(/row\.roundNumber === snap\.round\.number && gateLiveRound/g) ?? [];
    assert.equal(liveRowServerRound.length, 0, "SERVER_ROUND_USED_AS_LIVE_PRESENTATION_ID_COUNT=0");
  });
});

describe("presentation session release", () => {
  it("ROUND49_INPUT_VISIBLE_AFTER_ROUND48_PRESENTATION_COMPLETE", () => {
    const session = createPresentationSession({
      roundNumber: ROUND_48,
      expectedPresentationActorIds: [...EXPECTED],
      resolutionOrder: [...EXPECTED],
    });
    const roundShow: RoundPresentationState = {
      mode: "cinematic",
      phase: "gm-narration",
      presentationIndex: 2,
    };
    assert.equal(
      isPresentationSessionReleased({ roundShow, gmRevealComplete: true }),
      true
    );
    assert.equal(
      shouldShowNextActionInput({
        serverPhase: "ACTION_INPUT",
        hasUnlockedDraft: true,
        session,
        roundShow,
        gmRevealComplete: true,
      }),
      true,
      "ROUND49_INPUT_VISIBLE_AFTER_ROUND48_PRESENTATION_COMPLETE"
    );
  });

  it("derive expected ids from log row when session latched after rollover", () => {
    const row = logRow48();
    const resolution = deriveResolutionOrderFromLogRow(row);
    const expected = deriveExpectedPresentationActorIdsFromLogRow(row, EXPECTED);
    assert.deepEqual(expected, [H, B1, B2]);
    assert.ok(resolution.length >= 3);
    const sessionKey = trpgRoundPresentationSessionKey({
      roundNumber: ROUND_48,
      rolls: row.rolls,
      actions: filterRevealedActions(row.actions),
      ready: true,
    });
    assert.equal(sessionKey, `${ROUND_48}|live-cinematic`);
  });
});
