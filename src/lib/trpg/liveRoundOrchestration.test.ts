import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  advanceAfterActorAction,
  advanceAfterActorResult,
  advanceAfterDiceDismiss,
  buildRoundPresentationActors,
  earlyVisibleHumanActionIds,
  idlePresentation,
  isActorActionRevealBeatSatisfied,
  isLiveRoundPresentationReady,
  isLiveRoundPresentationStarting,
  resolveLiveRevealedActionIds,
  resultLaneActorIds,
  revealedActorIds,
  shouldDecorativeRevealAction,
  shouldGateLiveRoundPresentation,
  shouldShowActionJudgeBlock,
  shouldShowGmNarration,
  startCinematicPresentation,
  type PresentationActor,
  type RoundPresentationState,
} from "./roundPresentation";
import {
  formatLiveTurnProcessStatus,
  liveTurnProcessStage,
  shouldHideProcessTimerForPresentation,
} from "./liveTurnStatus";
import {
  shouldAdvanceActorDiceAfterOverlayDismiss,
  trpgDiceOverlayPlaybackReport,
  trpgDiceOverlayPlayOwnerSessionKey,
  trpgDiceOverlaySessionAction,
  applyTrpgDiceOverlaySession,
  trpgDiceRollSessionKey,
} from "./diceRollUx";
import {
  beginHiddenPresentationSession,
  catchUpHiddenPresentationState,
  isHiddenPresentationCatchUpActive,
  shouldSkipDecorativeReveal,
} from "./presentationHiddenCatchUp";
import { holdCurrentRoundReveal, shouldHideIncomingRollSession } from "./diceRevealGate";
import { resolveTrpgMountSeenKeys } from "../../app/trpg/useRevealedText";

type ActionKind = "human" | "ai_character";
type ActionType = "attack" | "talk";

type FixtureAction = {
  actorId: number;
  kind: ActionKind;
  actionType: ActionType;
  body: string;
  roll: { d20: number; dc: number; tier: "SUCCESS" | "FAILURE" } | null;
};

type VisibleEvent =
  | `human-action:${number}`
  | `human-action-replay:${number}`
  | `ai-action-progressive:${number}`
  | `actor-dice:${number}`
  | `actor-result:${number}`
  | `no-roll-meta:${number}`
  | `judge-meta:${number}`
  | "gm"
  | `status:${string}`;

function publicAction(spec: FixtureAction) {
  return {
    participantId: spec.actorId,
    name: `actor-${spec.actorId}`,
    body: spec.body,
    revealed: true,
    kind: spec.kind,
    actionType: spec.actionType,
  };
}

function publicRoll(spec: FixtureAction) {
  if (!spec.roll) return null;
  return {
    participantId: spec.actorId,
    name: `actor-${spec.actorId}`,
    d20: spec.roll.d20,
    dc: spec.roll.dc,
    tier: spec.roll.tier,
    statKey: "str",
    finalScore: spec.roll.d20 + 2,
    success: spec.roll.tier === "SUCCESS",
    actionBody: spec.body,
    actionType: spec.actionType,
    kind: spec.kind,
  };
}

function actorsFrom(order: readonly number[], roster: readonly FixtureAction[]): PresentationActor[] {
  const actions = roster.filter((row) => order.includes(row.actorId)).map(publicAction);
  const rolls = roster
    .filter((row) => order.includes(row.actorId))
    .map(publicRoll)
    .filter((row): row is NonNullable<typeof row> => row != null);
  return buildRoundPresentationActors({
    resolutionOrder: order,
    actions,
    rolls,
  });
}

function visibleSurface(opts: {
  persisted: readonly FixtureAction[];
  liveReady: boolean;
  state: RoundPresentationState;
  actors: readonly PresentationActor[];
  overlayVisible?: boolean;
  phase?: string;
  gmText?: string;
  gmProseRevealing?: boolean;
}) {
  const earlyHumans = earlyVisibleHumanActionIds(opts.persisted.map(publicAction));
  const cinematicIds = revealedActorIds({ actors: opts.actors, state: opts.state });
  const visibleIds =
    resolveLiveRevealedActionIds({
      isLiveRow: true,
      mode: opts.state.mode,
      cinematicRevealedIds: cinematicIds,
      earlyVisibleHumanIds: earlyHumans,
    }) ?? [];
  const laneIds =
    opts.state.mode === "cinematic" ? resultLaneActorIds({ actors: opts.actors, state: opts.state }) : [];
  const current =
    opts.state.mode === "cinematic" ? opts.actors[opts.state.presentationIndex] ?? null : null;
  const decorativeIds = opts.persisted
    .filter((row) =>
      shouldDecorativeRevealAction({
        kind: row.kind,
        participantId: row.actorId,
        activeRevealActorId: current?.actorId ?? null,
        isFresh: true,
        skipDecorativeReveal: false,
        cinematicActorAction: opts.state.mode === "cinematic" && opts.state.phase === "actor-action",
      })
    )
    .map((row) => row.actorId);
  const judgeIds = opts.persisted
    .filter((row) =>
      shouldShowActionJudgeBlock({
        kind: row.kind,
        hasIntent: row.kind === "ai_character",
        hasRoll: row.roll != null,
        resultRevealed: laneIds.includes(row.actorId),
      })
    )
    .map((row) => row.actorId);
  const diceActorId =
    opts.state.mode === "cinematic" && opts.state.phase === "actor-dice" ? current?.actorId ?? null : null;
  const status = liveTurnProcessStage({
    waitingOpening: false,
    narrationRerolling: false,
    workType: opts.liveReady ? "idle" : "generate_bots",
    phase: opts.phase ?? (opts.liveReady ? "ROLLING" : "BOT_ACTION"),
    viewerLocked: true,
    cinematicMotion: opts.state.mode === "cinematic" && opts.state.phase !== "complete" && opts.state.phase !== "idle",
    presentationStarting: isLiveRoundPresentationStarting({
      liveReady: opts.liveReady,
      mode: opts.state.mode,
      queueSessionKey: opts.liveReady ? "ready" : "",
    }),
    gmTextReady: Boolean(opts.gmText) && shouldShowGmNarration(opts.state),
    overlayVisible: opts.overlayVisible === true,
    presentationMode: opts.state.mode,
    presentationPhase: opts.state.phase,
    cinematicAiActionActive:
      opts.state.mode === "cinematic" &&
      opts.state.phase === "actor-action" &&
      current?.action?.kind === "ai_character",
    gmProseRevealing: opts.gmProseRevealing === true,
  });
  return {
    visibleIds,
    laneIds,
    decorativeIds,
    judgeIds,
    diceActorId,
    gm: shouldShowGmNarration(opts.state),
    status,
  };
}

function walkCinematicVisibleEvents(opts: {
  order: readonly number[];
  roster: readonly FixtureAction[];
  persisted: readonly FixtureAction[];
  phase?: string;
  gmText?: string;
  preReadyVisibleHumanIds?: readonly number[];
}): { events: VisibleEvent[]; frames: RoundPresentationState[] } {
  const actors = actorsFrom(opts.order, opts.persisted);
  let state: RoundPresentationState = { mode: "cinematic", ...startCinematicPresentation() };
  const events: VisibleEvent[] = [];
  const frames: RoundPresentationState[] = [];
  const seenHumanAction = new Set<number>();
  if (opts.preReadyVisibleHumanIds) {
    for (const id of opts.preReadyVisibleHumanIds) {
      events.push(`human-action:${id}`);
      seenHumanAction.add(id);
    }
  }
  const seenAiAction = new Set<number>();
  let guard = 0;
  while (state.phase !== "complete" && guard < 64) {
    frames.push({ ...state });
    const surface = visibleSurface({
      persisted: opts.persisted,
      liveReady: true,
      state,
      actors,
      overlayVisible: state.phase === "actor-dice",
      phase: opts.phase ?? "GENERATING_NARRATION",
      gmText: opts.gmText,
    });
    const current = actors[state.presentationIndex];
    if (state.phase === "actor-action" && current) {
      if (current.action?.kind === "human") {
        if (!seenHumanAction.has(current.actorId)) {
          events.push(`human-action:${current.actorId}`);
          seenHumanAction.add(current.actorId);
        }
        assert.equal(
          isActorActionRevealBeatSatisfied({
            actionKind: "human",
            isFreshAiAction: false,
            alreadyCompleted: false,
            effectiveActorRevealComplete: false,
          }),
          true
        );
        state = { ...state, ...advanceAfterActorAction({ actors, presentationIndex: state.presentationIndex }) };
      } else {
        assert.equal(surface.decorativeIds.includes(current.actorId), true);
        assert.equal(surface.diceActorId, null);
        if (!seenAiAction.has(current.actorId)) {
          events.push(`ai-action-progressive:${current.actorId}`);
          seenAiAction.add(current.actorId);
        }
        assert.equal(
          isActorActionRevealBeatSatisfied({
            actionKind: "ai_character",
            isFreshAiAction: true,
            alreadyCompleted: false,
            effectiveActorRevealComplete: false,
          }),
          false,
          "dice cannot start before #628 complete"
        );
        assert.equal(
          isActorActionRevealBeatSatisfied({
            actionKind: "ai_character",
            isFreshAiAction: true,
            alreadyCompleted: false,
            effectiveActorRevealComplete: true,
          }),
          true
        );
        state = { ...state, ...advanceAfterActorAction({ actors, presentationIndex: state.presentationIndex }) };
        const after = visibleSurface({
          persisted: opts.persisted,
          liveReady: true,
          state,
          actors,
          phase: opts.phase ?? "GENERATING_NARRATION",
          gmText: opts.gmText,
        });
        if (!current.roll && after.judgeIds.includes(current.actorId)) {
          events.push(`no-roll-meta:${current.actorId}`);
        }
      }
    } else if (state.phase === "actor-dice" && current) {
      events.push(`actor-dice:${current.actorId}`);
      state = { ...state, ...advanceAfterDiceDismiss({ actors, presentationIndex: state.presentationIndex }) };
    } else if (state.phase === "actor-result" && current) {
      events.push(`actor-result:${current.actorId}`);
      const afterHold = visibleSurface({
        persisted: opts.persisted,
        liveReady: true,
        state,
        actors,
        phase: opts.phase ?? "GENERATING_NARRATION",
        gmText: opts.gmText,
      });
      if (afterHold.judgeIds.includes(current.actorId)) events.push(`judge-meta:${current.actorId}`);
      state = { ...state, ...advanceAfterActorResult({ actors, presentationIndex: state.presentationIndex }) };
    } else if (state.phase === "gm-narration") {
      if (surface.gm) events.push("gm");
      state = { ...state, phase: "complete" };
    } else {
      break;
    }
    guard += 1;
  }
  return { events, frames };
}

const HUMAN_10: FixtureAction = {
  actorId: 10,
  kind: "human",
  actionType: "attack",
  body: "인간 공격",
  roll: { d20: 16, dc: 12, tier: "SUCCESS" },
};
const BOT_20_TALK: FixtureAction = {
  actorId: 20,
  kind: "ai_character",
  actionType: "talk",
  body: "동료 대화",
  roll: null,
};
const BOT_30_ATTACK: FixtureAction = {
  actorId: 30,
  kind: "ai_character",
  actionType: "attack",
  body: "동료 공격",
  roll: { d20: 14, dc: 12, tier: "SUCCESS" },
};

describe("TRPG live round orchestration — single owner", () => {
  it("static ownership: deleted pre-cinematic owners stay gone", () => {
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    const presentation = readFileSync("src/lib/trpg/roundPresentation.ts", "utf8");
    const status = readFileSync("src/lib/trpg/liveTurnStatus.ts", "utf8");
    const forbidden = [
      "resolveSequentialActionRevealQueue",
      "stickySequentialRevealActorRef",
      "consumedSequentialRevealBeatRef",
      "sequentialRevealCompletedRef",
      "incrementalDecorativeRevealArrivalOrder",
      "mergeIncrementalCanonicalPinIds",
      "isSequentialActionRevealPending",
      "resolveActivePresentationActorId",
      "shouldHoldDecorativeRevealAction",
      "LIVE_ROUND_INCREMENTAL_ACTION_PHASES",
      "isIncrementalCanonicalActionPhase",
      "incrementalCanonicalActionIds",
      "pinnedVisibleActorIdsRef",
    ];
    for (const symbol of forbidden) {
      assert.doesNotMatch(room, new RegExp(symbol));
      assert.doesNotMatch(presentation, new RegExp(symbol));
      assert.doesNotMatch(status, new RegExp(symbol));
    }
    assert.equal((room.match(/advanceAfterActorAction\(/g) ?? []).length, 1, "NORMAL_ACTION_BEAT_CONSUMER_COUNT");
    assert.equal((room.match(/shouldAdvanceActorDiceAfterOverlayDismiss\(/g) ?? []).length, 1, "NORMAL_DICE_DISMISS_OWNER_COUNT");
    assert.equal((room.match(/resultLaneActorIds\(\{/g) ?? []).length, 1, "NORMAL_RESULT_VISIBILITY_OWNER_COUNT");
    assert.equal((room.match(/shouldShowGmNarration\(/g) ?? []).length, 1, "NORMAL_GM_VISIBILITY_OWNER_COUNT");
    assert.doesNotMatch(room, /revealGateReleaseReason !== "watchdog"[\s\S]{0,180}phase: "complete"/);
    assert.match(room, /#509 Outcome B/);
    assert.match(room, /earlyVisibleHumanActionIds/);
    assert.match(room, /resolveLiveRevealedActionIds/);
    assert.match(room, /resolveTrpgMountSeenKeys/);
    assert.doesNotMatch(presentation, /computeResolutionOrder/);
  });

  it("T_NO_AI_PRE_READY: persisted AI stays hidden during BOT_ACTION", () => {
    const persisted = [HUMAN_10, BOT_30_ATTACK];
    const actors = actorsFrom([10, 20, 30], persisted);
    const surface = visibleSurface({
      persisted,
      liveReady: false,
      state: idlePresentation(),
      actors,
      phase: "BOT_ACTION",
    });
    assert.deepEqual(surface.visibleIds, [10]);
    assert.deepEqual(surface.decorativeIds, []);
    assert.deepEqual(surface.laneIds, []);
    assert.equal(surface.gm, false);
    assert.equal(surface.diceActorId, null);
    assert.deepEqual(surface.judgeIds, []);

    const afterBot20 = visibleSurface({
      persisted: [HUMAN_10, BOT_30_ATTACK, BOT_20_TALK],
      liveReady: false,
      state: idlePresentation(),
      actors: actorsFrom([10, 20, 30], [HUMAN_10, BOT_30_ATTACK, BOT_20_TALK]),
      phase: "BOT_ACTION",
    });
    assert.deepEqual(afterBot20.visibleIds, [10]);
    assert.equal(afterBot20.visibleIds.includes(20), false);
    assert.equal(afterBot20.visibleIds.includes(30), false);
    assert.deepEqual(afterBot20.decorativeIds, []);
  });

  it("T_FULL_ROUND_SINGLE_OWNER: resolutionOrder wins over arrival order", () => {
    const order = [10, 20, 30];
    const persisted = [HUMAN_10, BOT_30_ATTACK, BOT_20_TALK];
    assert.equal(isLiveRoundPresentationReady({ phase: "BOT_ACTION", hasLockedActorSet: true }), false);
    const pre = visibleSurface({
      persisted,
      liveReady: false,
      state: idlePresentation(),
      actors: actorsFrom(order, persisted),
      phase: "BOT_ACTION",
    });
    assert.deepEqual(pre.visibleIds, [10]);
    assert.equal(pre.gm, false);
    assert.deepEqual(pre.laneIds, []);

    const { events } = walkCinematicVisibleEvents({
      order,
      roster: persisted,
      persisted,
      phase: "GENERATING_NARRATION",
      gmText: "장면",
      preReadyVisibleHumanIds: [10],
    });
    assert.equal(events.filter((event) => event === "human-action:10").length, 1);
    assert.equal(events.includes("human-action-replay:10"), false);
    assert.deepEqual(events, [
      "human-action:10",
      "actor-dice:10",
      "actor-result:10",
      "judge-meta:10",
      "ai-action-progressive:20",
      "no-roll-meta:20",
      "ai-action-progressive:30",
      "actor-dice:30",
      "actor-result:30",
      "judge-meta:30",
      "gm",
    ]);
    const ai30 = events.indexOf("ai-action-progressive:30");
    const ai20 = events.indexOf("ai-action-progressive:20");
    const humanDice = events.indexOf("actor-dice:10");
    assert.ok(humanDice >= 0 && ai20 > humanDice && ai30 > humanDice);
    assert.ok(ai20 < ai30, "PERSISTENCE_ORDER_NOT_DISPLAY_ORDER");
    assert.equal(events.includes("human-action-replay:10"), false);
  });

  it("T_HUMAN_RO_NOT_FIRST: early human body does not mutate initiative", () => {
    const order = [20, 10, 30];
    const persisted = [HUMAN_10, BOT_20_TALK, BOT_30_ATTACK];
    const pre = visibleSurface({
      persisted,
      liveReady: false,
      state: idlePresentation(),
      actors: actorsFrom(order, persisted),
      phase: "BOT_ACTION",
    });
    assert.deepEqual(pre.visibleIds, [10], "human body visible pre-ready");

    const { events, frames } = walkCinematicVisibleEvents({
      order,
      roster: persisted,
      persisted,
      gmText: "장면",
      preReadyVisibleHumanIds: [10],
    });
    assert.equal(events.filter((event) => event === "human-action:10").length, 1);
    assert.equal(events[0], "human-action:10");
    assert.equal(events[1], "ai-action-progressive:20");
    assert.equal(events.includes("human-action-replay:10"), false);
    const humanDice = events.indexOf("actor-dice:10");
    const bot20 = events.indexOf("ai-action-progressive:20");
    assert.ok(bot20 >= 0 && humanDice > bot20, "HUMAN_BODY_EARLY != HUMAN_RESULT_EARLY");
    const first = frames[0]!;
    const firstSurface = visibleSurface({
      persisted,
      liveReady: true,
      state: first,
      actors: actorsFrom(order, persisted),
    });
    assert.ok(firstSurface.visibleIds.includes(10), "human body stays visible");
    assert.ok(firstSurface.visibleIds.includes(20));
    assert.equal(firstSurface.visibleIds.includes(30), false);
    assert.equal(first.presentationIndex, 0);
    assert.equal(actorsFrom(order, persisted)[0]?.actorId, 20);
  });

  it("T_AI_ATTACK: progressive reveal, then same-actor dice, then result", () => {
    const roster = [BOT_30_ATTACK];
    const actors = actorsFrom([30], roster);
    let state: RoundPresentationState = { mode: "cinematic", ...startCinematicPresentation() };
    const duringAction = visibleSurface({ persisted: roster, liveReady: true, state, actors });
    assert.deepEqual(duringAction.decorativeIds, [30]);
    assert.equal(duringAction.diceActorId, null);
    assert.deepEqual(duringAction.laneIds, []);
    state = { ...state, ...advanceAfterActorAction({ actors, presentationIndex: 0 }) };
    assert.equal(state.phase, "actor-dice");
    const duringDice = visibleSurface({
      persisted: roster,
      liveReady: true,
      state,
      actors,
      overlayVisible: true,
    });
    assert.equal(duringDice.diceActorId, 30);
    assert.deepEqual(duringDice.laneIds, []);
    state = { ...state, ...advanceAfterDiceDismiss({ actors, presentationIndex: 0 }) };
    assert.equal(state.phase, "actor-result");
    const duringResult = visibleSurface({ persisted: roster, liveReady: true, state, actors });
    assert.deepEqual(duringResult.laneIds, [30]);
    const next = advanceAfterActorResult({ actors, presentationIndex: 0 });
    assert.equal(next.phase, "gm-narration");
  });

  it("T_AI_NO_ROLL: no fake dice; metadata at #660 allowed point; then next actor", () => {
    const roster = [BOT_20_TALK, BOT_30_ATTACK];
    const actors = actorsFrom([20, 30], roster);
    let state: RoundPresentationState = { mode: "cinematic", ...startCinematicPresentation() };
    assert.equal(state.phase, "actor-action");
    assert.equal(actors[0]?.roll, null);
    state = { ...state, ...advanceAfterActorAction({ actors, presentationIndex: 0 }) };
    assert.equal(state.phase, "actor-action");
    assert.equal(state.presentationIndex, 1);
    const afterTalk = visibleSurface({ persisted: roster, liveReady: true, state, actors });
    assert.ok(afterTalk.judgeIds.includes(20));
    assert.equal(afterTalk.diceActorId, null);
    assert.equal(afterTalk.visibleIds.includes(30), true);
    assert.equal(afterTalk.laneIds.includes(30), false);
  });

  it("T_BACKEND_AHEAD_UI: future AI/result/GM stay hidden; status is companion presentation", () => {
    const order = [10, 20, 30];
    const persisted = [HUMAN_10, BOT_20_TALK, BOT_30_ATTACK];
    const actors = actorsFrom(order, persisted);
    const state: RoundPresentationState = {
      mode: "cinematic",
      phase: "actor-action",
      presentationIndex: 1,
    };
    const surface = visibleSurface({
      persisted,
      liveReady: true,
      state,
      actors,
      phase: "GENERATING_NARRATION",
      gmText: "이미 준비된 GM",
    });
    assert.ok(surface.visibleIds.includes(10));
    assert.ok(surface.visibleIds.includes(20));
    assert.equal(surface.visibleIds.includes(30), false);
    assert.equal(surface.gm, false);
    assert.equal(surface.laneIds.includes(30), false);
    assert.equal(surface.status, "presenting");
    assert.equal(
      formatLiveTurnProcessStatus({ stage: surface.status, elapsedSec: 4 }),
      "● 동료 행동 표시 중 · 4초"
    );
  });

  it("T_DICE_SESSION_PER_ACTOR: dismissed A cannot skip B", () => {
    const keyA = trpgDiceRollSessionKey(4, [{ participantId: 10, d20: 16, dc: 12, tier: "SUCCESS" }]);
    const keyB = trpgDiceRollSessionKey(4, [{ participantId: 30, d20: 14, dc: 12, tier: "SUCCESS" }]);
    let play = { started: false, dismissed: true, index: 0 };
    let playOwner = "";
    const startA = trpgDiceOverlaySessionAction({
      rollSessionKey: keyA,
      prevRollSessionKey: "",
      consumed: false,
      started: play.started,
      dismissed: play.dismissed,
    });
    play = applyTrpgDiceOverlaySession(play, startA);
    playOwner = trpgDiceOverlayPlayOwnerSessionKey(startA, keyA);
    play = { ...play, dismissed: true };
    const doneA = trpgDiceOverlayPlaybackReport({
      incomingSessionKey: keyA,
      playOwnerSessionKey: playOwner,
      play,
      settled: true,
      rollCount: 1,
    });
    assert.equal(
      shouldAdvanceActorDiceAfterOverlayDismiss({
        mode: "cinematic",
        phase: "actor-dice",
        overlayDismissed: doneA.dismissed,
        overlaySessionKey: doneA.sessionKey,
        activeRollSessionKey: keyA,
      }),
      true
    );
    assert.equal(
      shouldAdvanceActorDiceAfterOverlayDismiss({
        mode: "cinematic",
        phase: "actor-dice",
        overlayDismissed: doneA.dismissed,
        overlaySessionKey: doneA.sessionKey,
        activeRollSessionKey: keyB,
      }),
      false,
      "previous session dismissed cannot skip B"
    );
  });

  it("T_WATCHDOG_CANNOT_COMPLETE_ROUND: watchdog must not skip remaining dice/GM", () => {
    const actors = actorsFrom([10, 30], [HUMAN_10, BOT_30_ATTACK]);
    const midDice: RoundPresentationState = {
      mode: "cinematic",
      phase: "actor-dice",
      presentationIndex: 0,
    };
    const afterWatchdog = midDice;
    assert.notEqual(afterWatchdog.phase, "complete");
    assert.equal(shouldShowGmNarration(afterWatchdog), false);
    assert.equal(actors[1]?.roll != null, true);
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.doesNotMatch(room, /setRoundShow\(\(prev\) => \(prev\.mode === "cinematic" \? \{ \.\.\.prev, phase: "complete" \}/);
  });

  it("T_FIRST_READY_RENDER_NO_LEAK: idle→cinematic bootstrap keeps future surfaces hidden", () => {
    const persisted = [HUMAN_10, BOT_20_TALK, BOT_30_ATTACK];
    const actors = actorsFrom([10, 20, 30], persisted);
    const starting = isLiveRoundPresentationStarting({
      liveReady: true,
      mode: "idle",
      queueSessionKey: "3|1:16:12:SUCCESS",
    });
    assert.equal(starting, true);
    assert.equal(
      shouldGateLiveRoundPresentation({
        mode: "idle",
        previewReady: true,
        livePending: false,
        presentationStarting: starting,
      }),
      true
    );
    const first = visibleSurface({
      persisted,
      liveReady: true,
      state: idlePresentation(),
      actors,
      phase: "ROLLING",
      gmText: "장면",
    });
    assert.deepEqual(first.visibleIds, [10]);
    assert.equal(first.gm, false);
    assert.deepEqual(first.laneIds, []);
    assert.deepEqual(first.decorativeIds, []);
    assert.equal(
      holdCurrentRoundReveal({
        incomingSessionHidden: shouldHideIncomingRollSession({
          rollSessionKey: "3|1:16:12:SUCCESS",
          presentationSessionKey: "",
          isFirstObservation: false,
          replayOnMount: false,
        }),
        presentationHidesRound: true,
        revealGateReleased: false,
      }),
      true
    );
  });

  it("T_REFRESH / T_HIDDEN_TAB: historical/hidden recovery does not become a second owner", () => {
    const sessionKey = "5|1:16:12:SUCCESS";
    const hidden = beginHiddenPresentationSession({ sessionKey, roundNumber: 5 });
    assert.equal(
      isHiddenPresentationCatchUpActive({
        documentHidden: true,
        session: hidden,
        sessionKey,
        cinematic: true,
      }),
      true
    );
    assert.equal(
      isHiddenPresentationCatchUpActive({
        documentHidden: false,
        session: hidden,
        sessionKey,
        cinematic: true,
      }),
      false,
      "HIDDEN_RECOVERY_OWNER_ACTIVE_ONLY_WHEN_HIDDEN"
    );
    const actors = actorsFrom([10, 20], [HUMAN_10, BOT_20_TALK]);
    const caught = catchUpHiddenPresentationState({
      state: { mode: "cinematic", ...startCinematicPresentation() },
      actors,
      gmTextAvailable: true,
    });
    assert.equal(caught.phase, "complete");
    assert.equal(
      shouldSkipDecorativeReveal({
        consumedSessionKey: sessionKey,
        sessionKey,
        hiddenCatchUpActive: false,
      }),
      true
    );
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.match(room, /shouldConsumeMountRollSession/);
    assert.match(room, /isHiddenPresentationCatchUpActive/);
    const ownership = readFileSync("src/lib/trpg/botGenerationLease.ts", "utf8");
    assert.match(ownership, /tryClaimBotGeneration/);
  });

  it("T_REFRESH_PRE_READY_HIDDEN_AI: refresh must not consume never-visible AI", () => {
    const log = [
      {
        roundNumber: 4,
        narration: null,
        actions: [
          { participantId: 10, kind: "human", revealed: true, body: "human10" },
          { participantId: 20, kind: "ai_character", revealed: true, body: "bot20" },
        ],
      },
    ];
    const seenKeys = new Set(
      resolveTrpgMountSeenKeys({
        log,
        currentRoundNumber: 4,
        liveReady: false,
      })
    );
    const isFreshLogKey = (key: string) => !seenKeys.has(key);

    assert.ok(seenKeys.has("a:4:10"), "human early visibility may be consumed on mount");
    assert.equal(seenKeys.has("a:4:20"), false, "PRE_READY_HIDDEN_AI_MARKED_SEEN=false");

    const botKey = "a:4:20";
    assert.equal(isFreshLogKey(botKey), true);
    assert.equal(
      shouldDecorativeRevealAction({
        kind: "ai_character",
        participantId: 20,
        activeRevealActorId: 20,
        isFresh: isFreshLogKey(botKey),
        skipDecorativeReveal: false,
        cinematicActorAction: true,
      }),
      true,
      "BOT20_PROGRESSIVE_REVEAL_COUNT=1"
    );
    assert.equal(
      isActorActionRevealBeatSatisfied({
        actionKind: "ai_character",
        isFreshAiAction: isFreshLogKey(botKey),
        alreadyCompleted: false,
        effectiveActorRevealComplete: false,
      }),
      false,
      "BOT20_ACTION_SKIP=false before #628"
    );
    assert.equal(
      isActorActionRevealBeatSatisfied({
        actionKind: "ai_character",
        isFreshAiAction: isFreshLogKey(botKey),
        alreadyCompleted: false,
        effectiveActorRevealComplete: true,
      }),
      true
    );

    const actors = actorsFrom([10, 20], [HUMAN_10, BOT_20_TALK]);
    let state: RoundPresentationState = {
      mode: "cinematic",
      phase: "actor-action",
      presentationIndex: 1,
    };
    const during = visibleSurface({
      persisted: [HUMAN_10, BOT_20_TALK],
      liveReady: true,
      state,
      actors,
      phase: "ROLLING",
    });
    assert.equal(during.diceActorId, null);
    state = { ...state, ...advanceAfterActorAction({ actors, presentationIndex: 1 }) };
    assert.equal(state.phase, "gm-narration");
  });

  it("T_REFRESH_AT_READY_DOES_NOT_REPLAY: liveReady mount preserves mount-consume semantics", () => {
    const log = [
      {
        roundNumber: 4,
        narration: "장면",
        actions: [
          { participantId: 10, kind: "human", revealed: true, body: "human10" },
          { participantId: 20, kind: "ai_character", revealed: true, body: "bot20" },
        ],
      },
    ];
    const seenPreReady = new Set(
      resolveTrpgMountSeenKeys({ log, currentRoundNumber: 4, liveReady: false })
    );
    const seenReady = new Set(
      resolveTrpgMountSeenKeys({ log, currentRoundNumber: 4, liveReady: true })
    );

    assert.equal(seenPreReady.has("a:4:20"), false);
    assert.ok(seenReady.has("a:4:20"), "READY_MOUNT_DOES_NOT_REPLAY via mount-consume");
    assert.ok(seenReady.has("n:4"));

    const isFreshAfterReadyMount = (key: string) => !seenReady.has(key);
    assert.equal(isFreshAfterReadyMount("a:4:20"), false);
    assert.equal(
      shouldDecorativeRevealAction({
        kind: "ai_character",
        participantId: 20,
        activeRevealActorId: 20,
        isFresh: isFreshAfterReadyMount("a:4:20"),
        skipDecorativeReveal: false,
        cinematicActorAction: true,
      }),
      false
    );
  });

  it("T_HUMAN_ACTOR_ACTION_STATUS_NOT_COMPANION: presenting is AI-only", () => {
    const humanState: RoundPresentationState = {
      mode: "cinematic",
      phase: "actor-action",
      presentationIndex: 0,
    };
    const humanSurface = visibleSurface({
      persisted: [HUMAN_10],
      liveReady: true,
      state: humanState,
      actors: actorsFrom([10], [HUMAN_10]),
      phase: "GENERATING_NARRATION",
    });
    assert.notEqual(humanSurface.status, "presenting");
    assert.equal(
      formatLiveTurnProcessStatus({ stage: humanSurface.status, elapsedSec: 3 }),
      null
    );

    const aiState: RoundPresentationState = {
      mode: "cinematic",
      phase: "actor-action",
      presentationIndex: 0,
    };
    const aiSurface = visibleSurface({
      persisted: [BOT_20_TALK],
      liveReady: true,
      state: aiState,
      actors: actorsFrom([20], [BOT_20_TALK]),
      phase: "GENERATING_NARRATION",
    });
    assert.equal(aiSurface.status, "presenting");
    assert.equal(
      liveTurnProcessStage({
        waitingOpening: false,
        narrationRerolling: false,
        workType: "idle",
        phase: "GENERATING_NARRATION",
        viewerLocked: true,
        cinematicMotion: true,
        presentationStarting: false,
        gmTextReady: false,
        presentationMode: "cinematic",
        presentationPhase: "actor-action",
        cinematicAiActionActive: false,
      }),
      "none",
      "HUMAN_ACTOR_ACTION_STATUS_NOT_COMPANION"
    );
  });

  it("T_MULTI_HUMAN: wait_humans stays excluded from companion process copy", () => {
    assert.equal(
      liveTurnProcessStage({
        waitingOpening: false,
        narrationRerolling: false,
        workType: "wait_humans",
        phase: "ACTION_INPUT",
        viewerLocked: true,
        cinematicMotion: false,
        presentationStarting: false,
        gmTextReady: false,
      }),
      "wait_humans"
    );
    assert.equal(
      shouldHideProcessTimerForPresentation({
        overlayVisible: false,
        presentationMode: "idle",
        presentationPhase: "idle",
        gmProseRevealing: false,
      }),
      false
    );
  });
});

