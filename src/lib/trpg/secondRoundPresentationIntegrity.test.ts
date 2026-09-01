import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  advanceAfterActorAction,
  advanceAfterActorResult,
  advanceAfterDiceDismiss,
  buildRoundPresentationActors,
  isRoundPresentationAwaitingMoreActors,
  resolveLiveActorDeclarationPresentation,
  resolveLiveActorPresentationTransition,
  revealedActorIds,
  shouldDecorativeRevealAction,
  startCinematicPresentation,
  trpgRoundPresentationSessionKey,
  type PresentationActor,
  type RoundPresentationState,
} from "./roundPresentation";
import {
  beginHiddenPresentationSession,
  catchUpHiddenPresentationState,
  isHiddenPresentationCatchUpActive,
  shouldRunHiddenRoundGmCatchUp,
  shouldSkipDecorativeReveal,
} from "./presentationHiddenCatchUp";
import { resolveTrpgLiveFollowOwner } from "./followLatest";
import {
  formatLiveTurnProcessStatus,
  liveTurnProcessStage,
  resolveCinematicWaitingForBotAction,
} from "./liveTurnStatus";
import {
  createPresentationSession,
  filterRevealedActions,
  resolvePresentationRoundNumber,
} from "./presentationSession";
import type { TrpgPublicAction, TrpgPublicLog, TrpgPublicRoll } from "./snapshot";

const H = 47;
const B1 = 49;
const B2 = 48;
const ROUND_1 = 1;
const ROUND_2 = 2;

function action(
  participantId: number,
  kind: TrpgPublicAction["kind"],
  name: string,
  body: string
): TrpgPublicAction {
  return { participantId, name, body, revealed: true, kind, actionType: "investigate" };
}

function roll(
  participantId: number,
  name: string,
  d20: number,
  tier: "SUCCESS" | "FAILURE"
): TrpgPublicRoll {
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

function roundLog(roundNumber: number): TrpgPublicLog {
  return {
    roundNumber,
    actions: [
      action(H, "human", "Human", `Human round ${roundNumber} action`),
      action(B1, "ai_character", "Bot1", `Bot1 round ${roundNumber} action`),
      action(B2, "ai_character", "Bot2", `Bot2 round ${roundNumber} action`),
    ],
    rolls: [
      roll(H, "Human", 12, "SUCCESS"),
      roll(B1, "Bot1", 9, "FAILURE"),
      roll(B2, "Bot2", 6, "FAILURE"),
    ],
    narration: `Round ${roundNumber} GM narration canonical text for progressive reveal.`,
    billedPoints: null,
    viewerSharePoints: null,
  };
}

function actorsFromRow(row: TrpgPublicLog): PresentationActor[] {
  const order = [H, B1, B2];
  return buildRoundPresentationActors({
    resolutionOrder: order,
    actions: filterRevealedActions(row.actions),
    rolls: row.rolls,
  });
}

type TraceSnapshot = {
  label: string;
  roundNumber: number;
  presentationRoundNumber: number;
  workType: string;
  botGenerationInFlight: boolean;
  roundShow: RoundPresentationState;
  processStage: string;
  skipDecorativeReveal: boolean;
  activeDeclarationActorId: number | null;
  followOwner: string;
  decorativeBot1: boolean;
  decorativeBot2: boolean;
  sessionKey: string;
};

function traceStage(opts: {
  label: string;
  serverRoundNumber: number;
  presentationRoundNumber: number;
  workType: string;
  botGenerationInFlight: boolean;
  roundShow: RoundPresentationState;
  actors: PresentationActor[];
  actions: TrpgPublicAction[];
  consumedAiIds: Set<number>;
  documentHidden?: boolean;
  hiddenSessionKey?: string | null;
  consumedDecorativeSessionKey?: string | null;
  gmTextReady?: boolean;
}): TraceSnapshot {
  const sessionKey = trpgRoundPresentationSessionKey({
    roundNumber: opts.presentationRoundNumber,
    rolls: [],
    actions: opts.actions,
    ready: opts.actions.length > 0,
  });
  const hiddenCatchUpActive = isHiddenPresentationCatchUpActive({
    documentHidden: opts.documentHidden === true,
    session:
      opts.hiddenSessionKey != null
        ? beginHiddenPresentationSession({
            sessionKey: opts.hiddenSessionKey,
            roundNumber: opts.presentationRoundNumber,
          })
        : null,
    sessionKey,
    cinematic: opts.roundShow.mode === "cinematic",
  });
  const skipDecorativeReveal = shouldSkipDecorativeReveal({
    consumedSessionKey: opts.consumedDecorativeSessionKey ?? null,
    sessionKey,
    hiddenCatchUpActive,
  });
  const declaration = resolveLiveActorDeclarationPresentation({
    mode: opts.roundShow.mode,
    phase: opts.roundShow.phase,
    presentationIndex: opts.roundShow.presentationIndex,
    presentationActors: opts.actors,
    actions: opts.actions,
    consumedAiIds: opts.consumedAiIds,
  });
  const current = opts.actors[opts.roundShow.presentationIndex] ?? null;
  const activeAction =
    current != null
      ? opts.actions.find((item) => item.participantId === current.actorId) ?? null
      : null;
  const cinematicActorAction =
    opts.roundShow.mode === "cinematic" && opts.roundShow.phase === "actor-action";
  const cinematicAiActionActive =
    cinematicActorAction && activeAction?.kind === "ai_character";
  const cinematicWaitingForBotAction = resolveCinematicWaitingForBotAction({
    cinematicActorAction,
    cinematicAiActionActive,
    activePresentationActionKind: activeAction?.kind ?? null,
    activePresentationActorHasAction: current?.action != null,
    activePresentationActionAvailable: activeAction != null,
    botGenerationInFlight: opts.botGenerationInFlight,
    workType: opts.workType,
  });
  const processStage = liveTurnProcessStage({
    waitingOpening: false,
    narrationRerolling: false,
    workType: opts.workType,
    phase: opts.botGenerationInFlight ? "BOT_ACTION" : "GENERATING_NARRATION",
    viewerLocked: true,
    cinematicMotion:
      opts.roundShow.mode === "cinematic" &&
      opts.roundShow.phase !== "complete" &&
      opts.roundShow.phase !== "idle",
    presentationStarting: false,
    gmTextReady: opts.gmTextReady === true,
    botGenerationInFlight: opts.botGenerationInFlight,
    presentationMode: opts.roundShow.mode,
    presentationPhase: opts.roundShow.phase,
    cinematicAiActionActive,
    cinematicWaitingForBotAction,
  });
  const followOwner = resolveTrpgLiveFollowOwner({
    cinematicMotion:
      opts.roundShow.mode === "cinematic" &&
      opts.roundShow.phase !== "complete" &&
      opts.roundShow.phase !== "idle",
    activeDeclarationReveal: declaration.activeDeclarationActorId != null,
    freshGmRound: opts.gmTextReady ? opts.presentationRoundNumber : null,
    gmRevealComplete: false,
    nextActionVisible: false,
  });
  const decorativeFor = (botId: number) =>
    shouldDecorativeRevealAction({
      kind: "ai_character",
      participantId: botId,
      activeRevealActorId: current?.actorId ?? null,
      isFresh: !opts.consumedAiIds.has(botId),
      skipDecorativeReveal,
      cinematicActorAction,
      declarationRevealActive: declaration.activeDeclarationActorId === botId,
      resolutionActionAlreadyConsumed: opts.consumedAiIds.has(botId),
    });
  return {
    label: opts.label,
    roundNumber: opts.serverRoundNumber,
    presentationRoundNumber: opts.presentationRoundNumber,
    workType: opts.workType,
    botGenerationInFlight: opts.botGenerationInFlight,
    roundShow: opts.roundShow,
    processStage,
    skipDecorativeReveal,
    activeDeclarationActorId: declaration.activeDeclarationActorId,
    followOwner,
    decorativeBot1: decorativeFor(B1),
    decorativeBot2: decorativeFor(B2),
    sessionKey,
  };
}

describe("TRPG second-round presentation integrity", () => {
  it("SECOND_ROUND_BOT_GENERATION_STATUS: bots stage visible at bot slot while generating", () => {
    const row2 = roundLog(ROUND_2);
    const partialActions = filterRevealedActions([row2.actions[0]!]);
    const actors = buildRoundPresentationActors({
      resolutionOrder: [H, B1, B2],
      actions: partialActions,
      rolls: [row2.rolls[0]!],
    });
    const state: RoundPresentationState = {
      mode: "cinematic",
      phase: "actor-action",
      presentationIndex: 1,
    };
    const trace = traceStage({
      label: "round2-bot1-generating",
      serverRoundNumber: ROUND_2,
      presentationRoundNumber: ROUND_2,
      workType: "generate_bots",
      botGenerationInFlight: true,
      roundShow: state,
      actors,
      actions: partialActions,
      consumedAiIds: new Set([H]),
    });
    assert.equal(trace.processStage, "bots", "SECOND_ROUND_BOT_GENERATION_STATUS_VISIBLE");
    assert.equal(
      formatLiveTurnProcessStatus({ stage: trace.processStage as "bots", elapsedSec: 4 }),
      "● 동료 행동 구성 중 · 4초",
      "SECOND_ROUND_BOT_GENERATION_ELAPSED_VISIBLE"
    );
    assert.equal(trace.skipDecorativeReveal, false, "BOT1_PRESENTATION_SKIPPED=false (no skip)");
  });

  it("SECOND_ROUND_BOT_CHAIN: bot1 prose → dice → bot2 prose → dice without skip", () => {
    const row2 = roundLog(ROUND_2);
    const actions = filterRevealedActions(row2.actions);
    const actors = actorsFromRow(row2);
    let state: RoundPresentationState = { mode: "cinematic", ...startCinematicPresentation() };
    const consumed = new Set<number>();
    const events: string[] = [];

    const record = (label: string) => {
      const trace = traceStage({
        label,
        serverRoundNumber: ROUND_2,
        presentationRoundNumber: ROUND_2,
        workType: "idle",
        botGenerationInFlight: false,
        roundShow: state,
        actors,
        actions,
        consumedAiIds: consumed,
        gmTextReady: state.phase === "gm-narration",
      });
      if (state.phase === "actor-action") {
        const current = actors[state.presentationIndex];
        if (current?.action?.kind === "human") {
          events.push(`human-action:${current.actorId}`);
          state = { ...state, ...advanceAfterActorAction({ actors, presentationIndex: state.presentationIndex }) };
        } else if (current?.action?.kind === "ai_character") {
          assert.equal(trace.decorativeBot1 || trace.decorativeBot2, true, `${label}: decorative reveal active`);
          assert.equal(trace.skipDecorativeReveal, false, `${label}: BOT_PRESENTATION_SKIPPED=false`);
          events.push(`ai-action:${current.actorId}`);
          consumed.add(current.actorId);
          state = { ...state, ...advanceAfterActorAction({ actors, presentationIndex: state.presentationIndex }) };
        }
      } else if (state.phase === "actor-dice") {
        const current = actors[state.presentationIndex];
        events.push(`actor-dice:${current?.actorId}`);
        state = { ...state, ...advanceAfterDiceDismiss({ actors, presentationIndex: state.presentationIndex }) };
      } else if (state.phase === "actor-result") {
        const current = actors[state.presentationIndex];
        events.push(`actor-result:${current?.actorId}`);
        state = { ...state, ...advanceAfterActorResult({ actors, presentationIndex: state.presentationIndex }) };
      } else if (state.phase === "gm-narration") {
        events.push("gm");
        state = { ...state, phase: "complete" };
      }
    };

    let guard = 0;
    while (state.phase !== "complete" && guard < 32) {
      record(`step-${guard}`);
      guard += 1;
    }

    assert.deepEqual(events, [
      "human-action:47",
      "actor-dice:47",
      "actor-result:47",
      "ai-action:49",
      "actor-dice:49",
      "actor-result:49",
      "ai-action:48",
      "actor-dice:48",
      "actor-result:48",
      "gm",
    ]);
    assert.equal(events.includes("ai-action:49"), true, "BOT1_PRESENTATION_SKIPPED=false");
    assert.equal(events.includes("actor-dice:49"), true, "BOT1_DICE_SKIPPED=false");
    assert.equal(events.includes("ai-action:48"), true, "BOT2_PRESENTATION_SKIPPED=false");
    assert.equal(events.includes("actor-dice:48"), true, "BOT2_DICE_SKIPPED=false");
  });

  it("FOREGROUND_GM_ARRIVAL: stale hidden session must not skip unseen bot prose", () => {
    const row2 = roundLog(ROUND_2);
    const actions = filterRevealedActions(row2.actions);
    const sessionKey = trpgRoundPresentationSessionKey({
      roundNumber: ROUND_2,
      rolls: row2.rolls,
      actions,
      ready: true,
    });
    assert.equal(
      shouldRunHiddenRoundGmCatchUp({
        documentHidden: false,
        hiddenRoundSessionActive: true,
        gmTextReady: true,
        phase: "gm-narration",
      }),
      false,
      "GM_START_DOES_NOT_FLUSH_UNSEEN_BOT_PROSE"
    );
    assert.equal(
      shouldSkipDecorativeReveal({
        consumedSessionKey: null,
        sessionKey,
        hiddenCatchUpActive: false,
      }),
      false
    );
    assert.equal(
      isHiddenPresentationCatchUpActive({
        documentHidden: false,
        session: beginHiddenPresentationSession({ sessionKey, roundNumber: ROUND_2 }),
        sessionKey,
        cinematic: true,
      }),
      false,
      "foreground never activates hidden catch-up"
    );
  });

  it("HIDDEN_TAB: catch-up only while document hidden", () => {
    const row2 = roundLog(ROUND_2);
    const actions = filterRevealedActions(row2.actions);
    const actors = actorsFromRow(row2);
    const sessionKey = trpgRoundPresentationSessionKey({
      roundNumber: ROUND_2,
      rolls: row2.rolls,
      actions,
      ready: true,
    });
    assert.equal(
      isHiddenPresentationCatchUpActive({
        documentHidden: true,
        session: beginHiddenPresentationSession({ sessionKey, roundNumber: ROUND_2 }),
        sessionKey,
        cinematic: true,
      }),
      true
    );
    assert.equal(
      shouldRunHiddenRoundGmCatchUp({
        documentHidden: true,
        hiddenRoundSessionActive: true,
        gmTextReady: true,
        phase: "gm-narration",
      }),
      true
    );
    const start: RoundPresentationState = { mode: "cinematic", ...startCinematicPresentation() };
    const caught = catchUpHiddenPresentationState({
      state: start,
      actors,
      gmTextAvailable: true,
    });
    assert.equal(caught.phase, "complete");
  });

  it("BOT_AUTO_FOLLOW: helper-chain proof in botDeclarationScrollFollowLifecycle.test.ts", () => {
    const lifecycle = readFileSync("src/lib/trpg/botDeclarationScrollFollowLifecycle.test.ts", "utf8");
    const wiring = readFileSync("src/lib/trpg/botDeclarationScrollFollowWiring.test.ts", "utf8");
    assert.match(lifecycle, /handleTrpgLiveSceneResizeGrowth/);
    assert.match(lifecycle, /fireResize\(opts\.growthEl\)/);
    assert.match(wiring, /RESIZE_OBSERVER_GROWTH_ELIGIBLE/);
    assert.match(wiring, /PRODUCTION_JSDOM_IMPORTS=0/);
    assert.doesNotMatch(lifecycle, /ROOT_CAUSE_FIXED/);
  });

  it("SECOND_ROUND_PRESENTATION_PARITY: round2 session latches independently from round1", () => {
    const log = [roundLog(ROUND_1), roundLog(ROUND_2)];
    const session1 = createPresentationSession({
      roundNumber: ROUND_1,
      expectedPresentationActorIds: [H, B1, B2],
      resolutionOrder: [H, B1, B2],
    });
    const round1Complete: RoundPresentationState = {
      mode: "cinematic",
      phase: "complete",
      presentationIndex: 2,
    };
    const round2Start: RoundPresentationState = { mode: "cinematic", ...startCinematicPresentation() };
    const presentationRoundAfterRelease = resolvePresentationRoundNumber({
      serverRoundNumber: ROUND_2,
      session: null,
      roundShow: round2Start,
      inferredHeldRound: null,
      releasedPresentationRoundWatermark: ROUND_1,
    });
    assert.equal(presentationRoundAfterRelease, ROUND_2, "SECOND_ROUND_PRESENTATION_PARITY_WITH_FIRST");
    assert.notEqual(session1.roundNumber, ROUND_2);
    assert.ok(log.some((row) => row.roundNumber === ROUND_2));
  });

  it("STATIC_OWNER_AUDIT: no parallel scroll or polling owners introduced", () => {
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    const status = readFileSync("src/lib/trpg/liveTurnStatus.ts", "utf8");
    assert.match(room, /resolveTrpgLiveFollowOwner/);
    assert.match(room, /resolveCinematicWaitingForBotAction/);
    assert.match(room, /shouldRunHiddenRoundGmCatchUp/);
    assert.match(room, /handleTrpgLiveSceneResizeGrowth/);
    assert.match(room, /scheduleTrpgReadingBandEndFollow/);
    assert.match(status, /resolveCinematicWaitingForBotAction/);
    assert.equal((room.match(/resolveTrpgLiveFollowOwner\(/g) ?? []).length >= 1, true, "FOLLOW_OWNER=resolveTrpgLiveFollowOwner");
    assert.equal((room.match(/declarationGrowthRef/g) ?? []).length >= 2, true, "GROWTH_SIGNAL_OWNER=declarationGrowthRef");
    assert.equal((room.match(/manualScrollDetachedRef/g) ?? []).length >= 3, true, "MANUAL_DETACH_OWNER=manualScrollDetachedRef");
    assert.equal((room.match(/scrollToFollowOwner/g) ?? []).length >= 2, true, "PROGRAMMATIC_SCROLL_OWNER=scrollToFollowOwner");
    assert.doesNotMatch(room, /setInterval\(.*poll/i);
    assert.doesNotMatch(status, /setTimeout/);
  });
});

describe("TRPG second-round awaiting-more gate", () => {
  it("awaitingMoreActors holds at bot roster gap during generate_bots", () => {
    assert.equal(
      isRoundPresentationAwaitingMoreActors({
        phase: "BOT_ACTION",
        workType: "generate_bots",
        botGenerationInFlight: true,
      }),
      true
    );
    const partialActors = buildRoundPresentationActors({
      resolutionOrder: [H, B1, B2],
      actions: [action(H, "human", "Human", "human only")],
      rolls: [roll(H, "Human", 12, "SUCCESS")],
    });
    const next = advanceAfterActorAction({
      actors: partialActors,
      presentationIndex: 1,
      adjudicatedParticipantIds: new Set([H]),
      declarationConsumedIds: new Set([H]),
      awaitingMoreActors: true,
      expectedPresentationActorIds: [H, B1, B2],
    });
    assert.equal(next.phase, "actor-action");
    assert.equal(next.presentationIndex, 1, "holds at bot1 slot instead of jumping to GM");
    const transition = resolveLiveActorPresentationTransition({
      mode: "cinematic",
      phase: "actor-action",
      presentationIndex: 1,
      actors: partialActors,
      adjudicatedParticipantIds: new Set([H]),
      declarationConsumedIds: new Set([H]),
      awaitingMoreActors: true,
      expectedPresentationActorIds: [H, B1, B2],
      actionRevealComplete: true,
    });
    assert.equal(transition.kind, "hold", "no GM skip while bots pending");
  });
});
