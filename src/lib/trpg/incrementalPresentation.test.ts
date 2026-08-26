import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decideLiveRoundPresentation,
  incrementalCanonicalActionIds,
  isIncrementalCanonicalActionPhase,
  isLiveRoundPresentationReady,
  liveRoundCanonicalVisibleCount,
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
  pinnedIds: number[];
  visibleActionIds: number[];
  gmVisible: boolean;
  diceActive: boolean;
  cinematicStarted: boolean;
  cinematicRestarted: boolean;
};

function simulateIncrementalPresentationSteps(
  snaps: readonly { label: string; snap: LiveRoundSnapshotInput }[]
): PresentationStep[] {
  let pinnedIds: number[] = [];
  let roundShow: RoundPresentationState = idlePresentation();
  let prevKey = "";
  let prevMode = roundShow.mode;
  const out: PresentationStep[] = [];

  for (const { label, snap } of snaps) {
    const decided = decideLiveRoundPresentation(snap);
    const incremental =
      !decided.ready && isIncrementalCanonicalActionPhase(snap.phase) && snap.actions.length > 0;
    const actions = snap.actions.filter((action) => action.revealed && action.body.trim());

    if (incremental) {
      pinnedIds = incrementalCanonicalActionIds(actions, snap.resolutionOrder);
      roundShow = idlePresentation();
    } else if (decided.ready && decided.actorCount > 0) {
      if (roundShow.mode !== "cinematic") {
        roundShow = { mode: "cinematic", ...startCinematicPresentation() };
      }
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
      pinnedVisibleActorIds: pinnedIds,
    });
    const resolved = resolveLiveRevealedActionIds({
      isLiveRow: true,
      mode: roundShow.mode,
      cinematicRevealedIds,
      incrementalCanonicalVisible: incremental,
      pinnedVisibleActorIds: pinnedIds,
    });
    const visibleActionIds =
      resolved == null
        ? incrementalCanonicalActionIds(actions, snap.resolutionOrder)
        : resolved;

    out.push({
      label,
      snap,
      roundShow: { ...roundShow },
      pinnedIds: [...pinnedIds],
      visibleActionIds,
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

describe("TRPG incremental partial round presentation state", () => {
  it("T0: human only — visible, no cinematic, no GM, no dice", () => {
    const steps = simulateIncrementalPresentationSteps([
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
    assert.equal(t0.roundShow.phase, "idle");
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
      true
    );
    assert.equal(
      liveRoundCanonicalVisibleCount({
        gated: true,
        mode: "idle",
        actions: [human],
        revealedActorIds: [],
        incrementalCanonical: true,
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

  it("T1: human + bot1 — both visible, no cinematic restart, GM hidden", () => {
    const steps = simulateIncrementalPresentationSteps([
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
    assert.equal(t1.cinematicRestarted, false);
  });

  it("T2: human + bot1 + bot2 — resolution order preserved, GM still hidden", () => {
    const steps = simulateIncrementalPresentationSteps([
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
    assert.deepEqual(t2.visibleActionIds, order);
    assert.equal(t2.gmVisible, false);
    assert.equal(t2.diceActive, false);
    assert.equal(t2.cinematicRestarted, false);
  });

  it("T3: rolls final — cinematic starts once, pinned actions stay visible, dice order preserved", () => {
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
    assert.deepEqual(partial?.incrementalVisibleActionIds, order);
    assert.equal(rolling?.ready, true);
    assert.equal(rolling?.mode, "cinematic");
    assert.equal(rolling?.started, true);
    assert.equal(rolling?.restarted, false);

    const pinned = order;
    const actors = rolling!.actors;
    const startState = { mode: "cinematic" as const, ...startCinematicPresentation() };
    const firstFrame = revealedActorIds({
      actors,
      state: startState,
      pinnedVisibleActorIds: pinned,
    });
    assert.deepEqual(firstFrame, order, "ACTION_DISAPPEAR_AFTER_ROLLS");

    const frames = walkCinematicPresentation(actors);
    assert.equal(frames.some((frame) => frame.gmVisible), true);
    assert.equal(frames.filter((frame) => frame.gmVisible).length, 1);
    assert.equal(frames.at(-1)?.gmVisible, true);
    const diceFrames = frames.filter((frame) => frame.phase === "actor-dice");
    assert.deepEqual(
      diceFrames.map((frame) => frame.activeRollActorId),
      [10, 20, 30],
      "DICE_ORDER_PRESERVED"
    );
    assert.equal(
      frames.some((frame) => frame.phase === "gm-narration" && frame.revealedActorIds.length < 3),
      false,
      "EARLY_GM_FROM_PARTIAL_ACTORS"
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
    const preGm = frames.slice(0, -1);
    assert.equal(preGm.every((frame) => !frame.gmVisible), true, "GM_ORDER_PRESERVED");
    assert.equal(frames.at(-1)?.gmVisible, true);

    const gmStep = simulateIncrementalPresentationSteps([
      {
        label: "GM",
        snap: {
          phase: "GENERATING_NARRATION",
          roundNumber: 4,
          actions: [human, bot1, bot2],
          rolls: [humanRoll, bot1Roll, bot2Roll],
          resolutionOrder: order,
        },
      },
    ]);
    assert.equal(gmStep[0]?.cinematicStarted, true);
    assert.equal(gmStep[0]?.cinematicRestarted, false);
  });

  it("partial BOT_ACTION snapshots never start cinematic or enter gm-narration", () => {
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
    assert.equal(walked.startCount, 0, "PARTIAL_ACTOR_QUEUE_STARTS_CINEMATIC");
    assert.equal(walked.restartCount, 0);
    for (const step of walked.steps) {
      assert.equal(step.mode, "idle");
      assert.equal(step.ready, false);
      assert.equal(step.visibleCanonicalActionIds.length, 0);
      assert.ok(step.incrementalVisibleActionIds.length >= 1);
    }
  });
});
