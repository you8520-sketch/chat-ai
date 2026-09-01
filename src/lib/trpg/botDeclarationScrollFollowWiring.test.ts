/**
 * Production wiring audit for Bot declaration scroll-follow.
 * Traces second-round Bot reveal conditions through canonical owners.
 * Does NOT claim ROOT_CAUSE_FIXED — identifies whether wiring preconditions hold.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  buildRoundPresentationActors,
  resolveLiveActorDeclarationPresentation,
  shouldDecorativeRevealAction,
  startCinematicPresentation,
  type PresentationActor,
  type RoundPresentationState,
} from "./roundPresentation";
import { shouldSkipDecorativeReveal } from "./presentationHiddenCatchUp";
import { resolveTrpgLiveFollowOwner } from "./followLatest";
import { filterRevealedActions } from "./presentationSession";
import type { TrpgPublicAction, TrpgPublicLog } from "./snapshot";

const H = 47;
const B1 = 49;
const B2 = 48;
const ROUND_2 = 2;

function round2Log(): TrpgPublicLog {
  return {
    roundNumber: ROUND_2,
    actions: [
      {
        participantId: H,
        name: "Human",
        body: "Human round 2",
        revealed: true,
        kind: "human",
        actionType: "investigate",
      },
      {
        participantId: B1,
        name: "Bot1",
        body: "Bot1 round 2 prose ".repeat(20),
        revealed: true,
        kind: "ai_character",
        actionType: "investigate",
      },
      {
        participantId: B2,
        name: "Bot2",
        body: "Bot2 round 2 prose ".repeat(20),
        revealed: true,
        kind: "ai_character",
        actionType: "investigate",
      },
    ],
    rolls: [],
    narration: "Round 2 GM",
    billedPoints: null,
    viewerSharePoints: null,
  };
}

type WiringDiagnostic = {
  ACTIVE_DECLARATION_ID: number | null;
  LIVE_FOLLOW_OWNER: string;
  FOLLOW_LATEST: boolean;
  MANUAL_DETACHED: boolean;
  DECLARATION_GROWTH_REF_MOUNTED: boolean;
  DECLARATION_END_REF_MOUNTED: boolean;
  RESIZE_OBSERVER_GROWTH_ELIGIBLE: boolean;
  SKIP_DECORATIVE_REVEAL: boolean;
  DECORATIVE_REVEAL_ACTIVE: boolean;
};

function auditBotDeclarationWiring(opts: {
  roundShow: RoundPresentationState;
  actors: PresentationActor[];
  actions: TrpgPublicAction[];
  presentationIndex: number;
  actorId: number;
  consumedAiIds: Set<number>;
  followLatest: boolean;
  manualDetached: boolean;
  skipDecorativeReveal: boolean;
}): WiringDiagnostic {
  const declaration = resolveLiveActorDeclarationPresentation({
    mode: opts.roundShow.mode,
    phase: opts.roundShow.phase,
    presentationIndex: opts.presentationIndex,
    presentationActors: opts.actors,
    actions: opts.actions,
    consumedAiIds: opts.consumedAiIds,
  });
  const cinematicActorAction =
    opts.roundShow.mode === "cinematic" && opts.roundShow.phase === "actor-action";
  const decorativeReveal = shouldDecorativeRevealAction({
    kind: "ai_character",
    participantId: opts.actorId,
    activeRevealActorId: opts.actors[opts.presentationIndex]?.actorId ?? null,
    isFresh: !opts.consumedAiIds.has(opts.actorId),
    skipDecorativeReveal: opts.skipDecorativeReveal,
    cinematicActorAction,
    declarationRevealActive: declaration.activeDeclarationActorId === opts.actorId,
    resolutionActionAlreadyConsumed: opts.consumedAiIds.has(opts.actorId),
  });
  const isActiveDeclarationCard = declaration.activeDeclarationActorId === opts.actorId;
  const liveFollowOwner = resolveTrpgLiveFollowOwner({
    cinematicMotion:
      opts.roundShow.mode === "cinematic" &&
      opts.roundShow.phase !== "complete" &&
      opts.roundShow.phase !== "idle",
    activeDeclarationReveal: declaration.activeDeclarationActorId != null,
    freshGmRound: null,
    gmRevealComplete: false,
    nextActionVisible: false,
  });
  const growthRefMounted = isActiveDeclarationCard && decorativeReveal;
  const endRefMounted = growthRefMounted;
  const growthObserverEligible =
    liveFollowOwner === "ACTIVE_DECLARATION_END" && declaration.activeDeclarationActorId != null;

  return {
    ACTIVE_DECLARATION_ID: declaration.activeDeclarationActorId,
    LIVE_FOLLOW_OWNER: liveFollowOwner,
    FOLLOW_LATEST: opts.followLatest,
    MANUAL_DETACHED: opts.manualDetached,
    DECLARATION_GROWTH_REF_MOUNTED: growthRefMounted,
    DECLARATION_END_REF_MOUNTED: endRefMounted,
    RESIZE_OBSERVER_GROWTH_ELIGIBLE: growthObserverEligible,
    SKIP_DECORATIVE_REVEAL: opts.skipDecorativeReveal,
    DECORATIVE_REVEAL_ACTIVE: decorativeReveal,
  };
}

describe("TRPG bot declaration scroll-follow production wiring audit", () => {
  it("round2 Bot1 reveal: wiring preconditions all satisfied when foreground + decorative reveal", () => {
    const row = round2Log();
    const actions = filterRevealedActions(row.actions);
    const actors = buildRoundPresentationActors({
      resolutionOrder: [H, B1, B2],
      actions,
      rolls: row.rolls,
    });
    const roundShow: RoundPresentationState = {
      mode: "cinematic",
      phase: "actor-action",
      presentationIndex: 1,
    };
    const diag = auditBotDeclarationWiring({
      roundShow,
      actors,
      actions,
      presentationIndex: 1,
      actorId: B1,
      consumedAiIds: new Set([H]),
      followLatest: true,
      manualDetached: false,
      skipDecorativeReveal: false,
    });

    assert.equal(diag.ACTIVE_DECLARATION_ID, B1);
    assert.equal(diag.LIVE_FOLLOW_OWNER, "ACTIVE_DECLARATION_END");
    assert.equal(diag.FOLLOW_LATEST, true);
    assert.equal(diag.MANUAL_DETACHED, false);
    assert.equal(diag.DECLARATION_GROWTH_REF_MOUNTED, true);
    assert.equal(diag.DECLARATION_END_REF_MOUNTED, true);
    assert.equal(diag.RESIZE_OBSERVER_GROWTH_ELIGIBLE, true);
    assert.equal(diag.SKIP_DECORATIVE_REVEAL, false);
    assert.equal(diag.DECORATIVE_REVEAL_ACTIVE, true);
  });

  it("round2 Bot2 reveal: same wiring after Bot1 consumed", () => {
    const row = round2Log();
    const actions = filterRevealedActions(row.actions);
    const actors = buildRoundPresentationActors({
      resolutionOrder: [H, B1, B2],
      actions,
      rolls: row.rolls,
    });
    const roundShow: RoundPresentationState = {
      mode: "cinematic",
      phase: "actor-action",
      presentationIndex: 2,
    };
    const diag = auditBotDeclarationWiring({
      roundShow,
      actors,
      actions,
      presentationIndex: 2,
      actorId: B2,
      consumedAiIds: new Set([H, B1]),
      followLatest: true,
      manualDetached: false,
      skipDecorativeReveal: false,
    });

    assert.equal(diag.ACTIVE_DECLARATION_ID, B2);
    assert.equal(diag.LIVE_FOLLOW_OWNER, "ACTIVE_DECLARATION_END");
    assert.equal(diag.DECLARATION_GROWTH_REF_MOUNTED, true);
    assert.equal(diag.RESIZE_OBSERVER_GROWTH_ELIGIBLE, true);
  });

  it("FIRST_DIVERGENCE candidate: skipDecorativeReveal breaks growth ref mount", () => {
    const row = round2Log();
    const actions = filterRevealedActions(row.actions);
    const actors = buildRoundPresentationActors({
      resolutionOrder: [H, B1, B2],
      actions,
      rolls: row.rolls,
    });
    const roundShow: RoundPresentationState = {
      mode: "cinematic",
      phase: "actor-action",
      presentationIndex: 1,
    };
    const diag = auditBotDeclarationWiring({
      roundShow,
      actors,
      actions,
      presentationIndex: 1,
      actorId: B1,
      consumedAiIds: new Set([H]),
      followLatest: true,
      manualDetached: false,
      skipDecorativeReveal: true,
    });

    assert.equal(diag.SKIP_DECORATIVE_REVEAL, true);
    assert.equal(diag.DECLARATION_GROWTH_REF_MOUNTED, false);
    assert.equal(diag.DECLARATION_END_REF_MOUNTED, false);
    assert.equal(diag.DECORATIVE_REVEAL_ACTIVE, false);
    assert.equal(
      shouldSkipDecorativeReveal({
        consumedSessionKey: "2|live-cinematic",
        sessionKey: "2|live-cinematic",
        hiddenCatchUpActive: false,
      }),
      true
    );
  });

  it("manual detach preserves follow gate without new scroll owner", () => {
    const diag = auditBotDeclarationWiring({
      roundShow: { mode: "cinematic", phase: "actor-action", presentationIndex: 1 },
      actors: buildRoundPresentationActors({
        resolutionOrder: [H, B1, B2],
        actions: filterRevealedActions(round2Log().actions),
        rolls: [],
      }),
      actions: filterRevealedActions(round2Log().actions),
      presentationIndex: 1,
      actorId: B1,
      consumedAiIds: new Set([H]),
      followLatest: false,
      manualDetached: true,
      skipDecorativeReveal: false,
    });
    assert.equal(diag.MANUAL_DETACHED, true);
    assert.equal(diag.FOLLOW_LATEST, false);
    assert.equal(diag.LIVE_FOLLOW_OWNER, "ACTIVE_DECLARATION_END");
  });

  it("PRODUCTION_JSDOM_IMPORTS=0 — jsdom test-only", () => {
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    const follow = readFileSync("src/lib/trpg/followLatest.ts", "utf8");
    const status = readFileSync("src/lib/trpg/liveTurnStatus.ts", "utf8");
    assert.doesNotMatch(room, /from ["']jsdom["']/);
    assert.doesNotMatch(follow, /from ["']jsdom["']/);
    assert.doesNotMatch(status, /from ["']jsdom["']/);
    assert.match(room, /handleTrpgLiveSceneResizeGrowth/);
    assert.match(room, /scheduleTrpgReadingBandEndFollow/);
    assert.match(room, /data-trpg-declaration-growth-observer-attached/);
  });

  it("AUTO_FOLLOW wiring complete but production root unconfirmed without browser mount", () => {
    const row = round2Log();
    const actions = filterRevealedActions(row.actions);
    const actors = buildRoundPresentationActors({
      resolutionOrder: [H, B1, B2],
      actions,
      rolls: [],
    });
    let state: RoundPresentationState = { mode: "cinematic", ...startCinematicPresentation() };
    state = { ...state, presentationIndex: 1 };
    const bot1 = auditBotDeclarationWiring({
      roundShow: state,
      actors,
      actions,
      presentationIndex: 1,
      actorId: B1,
      consumedAiIds: new Set([H]),
      followLatest: true,
      manualDetached: false,
      skipDecorativeReveal: false,
    });
    assert.equal(bot1.RESIZE_OBSERVER_GROWTH_ELIGIBLE, true);
    state = { ...state, presentationIndex: 2 };
    const bot2 = auditBotDeclarationWiring({
      roundShow: state,
      actors,
      actions,
      presentationIndex: 2,
      actorId: B2,
      consumedAiIds: new Set([H, B1]),
      followLatest: true,
      manualDetached: false,
      skipDecorativeReveal: false,
    });
    assert.equal(bot2.RESIZE_OBSERVER_GROWTH_ELIGIBLE, true);
  });
});
