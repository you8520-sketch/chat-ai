import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildRoundPresentationActors,
  decideLiveRoundPresentation,
  earlyVisibleHumanActionIds,
  isLiveRoundPresentationReady,
  liveRoundCanonicalVisibleCount,
  preCinematicVisibleActionIds,
  resolveLiveRevealedActionIds,
  revealedActorIds,
  shouldGateLiveRoundPresentation,
  shouldShowGmNarration,
  shouldShowLiveRoundWaitCopy,
  startCinematicPresentation,
  walkCinematicPresentation,
  walkLiveRoundSnapshots,
  idlePresentation,
  type LiveRoundSnapshotInput,
  type RoundPresentationState,
} from "./roundPresentation";

const order = [10, 20, 30];
const human = { participantId: 10, name: "유저", kind: "human" as const, body: "문을 연다.", revealed: true };
const bot1 = { participantId: 20, name: "동료1", kind: "ai_character" as const, body: "뒤를 본다.", revealed: true };
const bot2 = { participantId: 30, name: "동료2", kind: "ai_character" as const, body: "조용히 움직인다.", revealed: true };
const humanRoll = { participantId: 10, d20: 14, dc: 12, tier: "SUCCESS" as const, statKey: "dex", finalScore: 16 };
const bot1Roll = { participantId: 20, d20: 8, dc: 12, tier: "FAILURE" as const, statKey: "dex", finalScore: 10 };
const bot2Roll = { participantId: 30, d20: 17, dc: 12, tier: "SUCCESS" as const, statKey: "dex", finalScore: 19 };

type PresentationStep = {
  label: string;
  snap: LiveRoundSnapshotInput;
  roundShow: RoundPresentationState;
  visibleActionIds: number[];
  gmVisible: boolean;
  diceActive: boolean;
  cinematicStarted: boolean;
  cinematicRestarted: boolean;
};

function simulateLivePresentationSteps(
  snaps: readonly { label: string; snap: LiveRoundSnapshotInput }[]
): PresentationStep[] {
  let roundShow: RoundPresentationState = idlePresentation();
  let prevKey = "";
  let prevMode = roundShow.mode;
  const out: PresentationStep[] = [];

  for (const { label, snap } of snaps) {
    const decided = decideLiveRoundPresentation(snap);
    const actions = snap.actions.filter((action) => action.revealed && action.body.trim());
    const earlyHumans = earlyVisibleHumanActionIds(actions);
    const preCinematicIds = preCinematicVisibleActionIds(actions);

    if (!decided.ready) {
      roundShow = idlePresentation();
    } else if (decided.actorCount > 0 && roundShow.mode !== "cinematic") {
      roundShow = { mode: "cinematic", ...startCinematicPresentation() };
    }

    const cinematicStarted = roundShow.mode === "cinematic" && prevMode !== "cinematic";
    const cinematicRestarted =
      roundShow.mode === "cinematic" &&
      prevMode === "cinematic" &&
      decided.sessionKey !== "" &&
      decided.sessionKey !== prevKey;

    const cinematicRevealedIds = revealedActorIds({
      actors: decided.actors,
      state: roundShow,
    });
    const resolved = resolveLiveRevealedActionIds({
      isLiveRow: true,
      mode: roundShow.mode,
      cinematicRevealedIds,
      preCinematicVisibleIds: preCinematicIds,
    });

    out.push({
      label,
      snap,
      roundShow: { ...roundShow },
      visibleActionIds: resolved ?? actions.map((action) => action.participantId),
      gmVisible: shouldShowGmNarration(roundShow),
      diceActive: roundShow.mode === "cinematic" && roundShow.phase === "actor-dice",
      cinematicStarted,
      cinematicRestarted,
    });

    prevKey = decided.sessionKey;
    prevMode = roundShow.mode;
  }

  return out;
}

describe("TRPG live pre-ready action visibility", () => {
  it("T0: human only — visible, no cinematic, no GM, no dice", () => {
    const steps = simulateLivePresentationSteps([
      {
        label: "T0",
        snap: {
          phase: "BOT_ACTION",
          roundNumber: 4,
          actions: [human],
          rolls: [],
          resolutionOrder: order,
        },
      },
    ]);
    const t0 = steps[0]!;
    assert.equal(isLiveRoundPresentationReady({ phase: "BOT_ACTION", hasLockedActorSet: true }), false);
    assert.equal(t0.roundShow.mode, "idle");
    assert.deepEqual(t0.visibleActionIds, [10]);
    assert.equal(t0.gmVisible, false);
    assert.equal(t0.diceActive, false);
    assert.equal(t0.cinematicStarted, false);
    assert.equal(
      shouldShowLiveRoundWaitCopy({
        waitKind: "bots",
        mode: "idle",
        presentationStarting: false,
      }),
      false,
      "process pill owns normal wait copy"
    );
    assert.equal(
      liveRoundCanonicalVisibleCount({
        gated: true,
        mode: "idle",
        actions: [human],
        revealedActorIds: [],
      }),
      1
    );
    assert.equal(
      shouldGateLiveRoundPresentation({
        mode: "idle",
        previewReady: true,
        livePending: true,
        presentationStarting: false,
      }),
      true
    );
  });

  it("T1: human + bot1 — bot1 visible on persist before liveReady", () => {
    const steps = simulateLivePresentationSteps([
      {
        label: "T0",
        snap: {
          phase: "BOT_ACTION",
          roundNumber: 4,
          actions: [human],
          rolls: [],
          resolutionOrder: order,
        },
      },
      {
        label: "T1",
        snap: {
          phase: "BOT_ACTION",
          roundNumber: 4,
          actions: [human, bot1],
          rolls: [],
          resolutionOrder: order,
        },
      },
    ]);
    const t1 = steps[1]!;
    assert.deepEqual(t1.visibleActionIds, [10, 20]);
    assert.equal(t1.roundShow.mode, "idle");
    assert.equal(t1.gmVisible, false);
    assert.equal(t1.diceActive, false);
    assert.equal(t1.cinematicStarted, false);
    assert.equal(isLiveRoundPresentationReady({ phase: "BOT_ACTION", hasLockedActorSet: true }), false);
  });

  it("T2: bot2 persist adds bot2 while bot1 stays visible", () => {
    const steps = simulateLivePresentationSteps([
      {
        label: "T0",
        snap: { phase: "BOT_ACTION", roundNumber: 4, actions: [human], rolls: [], resolutionOrder: order },
      },
      {
        label: "T1",
        snap: {
          phase: "BOT_ACTION",
          roundNumber: 4,
          actions: [human, bot1],
          rolls: [],
          resolutionOrder: order,
        },
      },
      {
        label: "T2",
        snap: {
          phase: "BOT_ACTION",
          roundNumber: 4,
          actions: [human, bot1, bot2],
          rolls: [],
          resolutionOrder: order,
        },
      },
    ]);
    const t2 = steps[2]!;
    assert.deepEqual(t2.visibleActionIds, [10, 20, 30]);
    assert.equal(t2.gmVisible, false);
    assert.equal(t2.diceActive, false);
    assert.equal(t2.roundShow.mode, "idle");
  });

  it("T3: rolls final — cinematic starts once, human stays, AI wait for release", () => {
    const walked = walkLiveRoundSnapshots([
      {
        phase: "BOT_ACTION",
        roundNumber: 4,
        actions: [human, bot1, bot2],
        rolls: [],
        resolutionOrder: order,
      },
      {
        phase: "ROLLING",
        roundNumber: 4,
        actions: [human, bot1, bot2],
        rolls: [humanRoll, bot1Roll, bot2Roll],
        resolutionOrder: order,
      },
    ]);
    const [partial, rolling] = walked.steps;
    assert.equal(partial?.ready, false);
    assert.equal(partial?.mode, "idle");
    assert.deepEqual(partial?.incrementalVisibleActionIds, [10, 20, 30]);
    assert.equal(rolling?.ready, true);
    assert.equal(rolling?.mode, "cinematic");
    assert.equal(rolling?.started, true);
    assert.equal(rolling?.restarted, false);

    const actors = rolling!.actors;
    const startState = { mode: "cinematic" as const, ...startCinematicPresentation() };
    const firstCinematic = revealedActorIds({ actors, state: startState });
    const firstVisible = resolveLiveRevealedActionIds({
      isLiveRow: true,
      mode: startState.mode,
      cinematicRevealedIds: firstCinematic,
      preCinematicVisibleIds: [10, 20, 30],
    });
    assert.deepEqual(firstVisible, [10, 20, 30], "declaration-visible actors stay; resolution releases dice");

    const frames = walkCinematicPresentation(actors);
    assert.equal(frames.filter((frame) => frame.gmVisible).length, 1);
    assert.deepEqual(
      frames.filter((frame) => frame.phase === "actor-dice").map((frame) => frame.activeRollActorId),
      [10, 20, 30]
    );
  });

  it("T4: GM opens only after dice/result cinematic completes", () => {
    const actors = walkLiveRoundSnapshots([
      {
        phase: "ROLLING",
        roundNumber: 4,
        actions: [human, bot1, bot2],
        rolls: [humanRoll, bot1Roll, bot2Roll],
        resolutionOrder: order,
      },
    ]).steps[0]!.actors;

    const frames = walkCinematicPresentation(actors);
    assert.equal(frames.slice(0, -1).every((frame) => !frame.gmVisible), true);
    assert.equal(frames.at(-1)?.gmVisible, true);
  });

  it("partial BOT_ACTION snapshots never start cinematic", () => {
    const walked = walkLiveRoundSnapshots([
      {
        phase: "BOT_ACTION",
        roundNumber: 4,
        actions: [human],
        rolls: [],
        resolutionOrder: order,
      },
      {
        phase: "BOT_ACTION",
        roundNumber: 4,
        actions: [human, bot1],
        rolls: [],
        resolutionOrder: order,
      },
      {
        phase: "BOT_ACTION",
        roundNumber: 4,
        actions: [human, bot1, bot2],
        rolls: [],
        resolutionOrder: order,
      },
    ]);
    assert.equal(walked.startCount, 0, "PARTIAL_BOT_SNAPSHOT_CANNOT_START_ACTOR_CINEMATIC");
    assert.deepEqual(walked.steps[0]?.incrementalVisibleActionIds, [10]);
    assert.deepEqual(walked.steps[1]?.incrementalVisibleActionIds, [10, 20]);
    assert.deepEqual(walked.steps[2]?.incrementalVisibleActionIds, [10, 20, 30]);
    for (const step of walked.steps) {
      assert.equal(step.mode, "idle");
      assert.equal(step.ready, false);
      assert.deepEqual(step.visibleCanonicalActionIds, []);
    }
  });

  it("round N+1 cinematic does not inherit prior AI visibility", () => {
    const actors = buildRoundPresentationActors({
      resolutionOrder: order,
      actions: [human, bot1, bot2],
      rolls: [humanRoll, bot1Roll, bot2Roll],
    });
    const roundShow = { mode: "cinematic" as const, ...startCinematicPresentation() };
    const cinematicRevealed = revealedActorIds({ actors, state: roundShow });
    assert.deepEqual(cinematicRevealed, [10]);
    const resolved = resolveLiveRevealedActionIds({
      isLiveRow: true,
      mode: roundShow.mode,
      cinematicRevealedIds: cinematicRevealed,
      preCinematicVisibleIds: [10, 20, 30],
    });
    assert.deepEqual(resolved, [10, 20, 30]);
  });
});
