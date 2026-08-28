import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import type { TrpgPublicAction, TrpgPublicRoll } from "./snapshot";
import {
  actorOrderEqualsResolutionOrder,
  buildRoundPresentationActors,
  decideRoundPresentationMode,
  freezeLivePresentationActors,
  historicalPresentation,
  isLiveRoundPresentationReady,
  isLiveRoundPresentationStarting,
  isRoundPresentationComplete,
  earlyVisibleHumanActionIds,
  isActorActionRevealBeatSatisfied,
  liveRoundCanonicalVisibleCount,
  liveRoundWaitCopy,
  liveRoundWaitKind,
  resolveLiveRevealedActionIds,
  shouldDecorativeRevealAction,
  shouldShowLiveRoundWaitCopy,
  compactRollActorIds,
  resultLaneActorIds,
  revealedActorIds,
  shouldShowActionJudgeBlock,
  shouldShowActorResultLane,
  shouldShowCompactRoll,
  shouldGateLiveRoundPresentation,
  shouldShowGmNarration,
  startCinematicPresentation,
  trpgRoundPresentationSessionKey,
  trpgRoundPresentationWatchdogMs,
  walkCinematicPresentation,
  walkLiveRoundSnapshots,
  type PresentationActor,
} from "./roundPresentation";
import { shouldConsumeMountRollSession, trpgPredeterminedD20Notation } from "./diceRollUx";
import { nextDicePresentation, IDLE_DICE_PRESENTATION } from "./diceRevealGate";

function action(participantId: number, name: string): TrpgPublicAction {
  return {
    participantId,
    name,
    body: `${name} 행동`,
    revealed: true,
    kind: participantId === 1 ? "human" : "ai_character",
    actionType: "free",
  };
}

function roll(
  participantId: number,
  name: string,
  d20: number,
  opts?: { tier?: TrpgPublicRoll["tier"]; success?: boolean; dc?: number; finalScore?: number }
): TrpgPublicRoll {
  const dc = opts?.dc ?? 12;
  const finalScore = opts?.finalScore ?? d20 + 2;
  const tier =
    opts?.tier ??
    (d20 === 20 ? "CRITICAL_SUCCESS" : d20 === 1 ? "CRITICAL_FAILURE" : finalScore >= dc ? "SUCCESS" : "FAILURE");
  return {
    participantId,
    name,
    d20,
    statKey: "str",
    finalScore,
    dc,
    tier,
    success: opts?.success ?? finalScore >= dc,
    actionBody: `${name} 행동`,
    actionType: "free",
    kind: participantId === 1 ? "human" : "ai_character",
  };
}

function actorsFor(
  order: number[],
  rolls: Array<[number, string, number] | null>,
  names: string[]
): PresentationActor[] {
  return buildRoundPresentationActors({
    resolutionOrder: order,
    actions: order.map((id, index) => action(id, names[index] ?? `actor-${id}`)),
    rolls: rolls.flatMap((entry) => (entry ? [roll(entry[0], entry[1], entry[2])] : [])),
  });
}

function assertInterleaved(frames: ReturnType<typeof walkCinematicPresentation>, expectedOrder: number[]) {
  assert.equal(actorOrderEqualsResolutionOrder(
    expectedOrder.map((id) => ({ actorId: id, action: null, roll: null })),
    expectedOrder
  ), true);
  const actionBeats = frames.filter((frame) => frame.phase === "actor-action");
  const diceBeats = frames.filter((frame) => frame.phase === "actor-dice");
  assert.equal(actionBeats.length, expectedOrder.length);
  actionBeats.forEach((frame, index) => {
    assert.equal(frame.presentationIndex, index);
    assert.deepEqual(frame.revealedActorIds, expectedOrder.slice(0, index + 1));
    assert.equal(frame.gmVisible, false);
    const nextId = expectedOrder[index + 1];
    if (nextId != null) assert.equal(frame.revealedActorIds.includes(nextId), false);
  });
  const played = diceBeats.map((frame) => frame.activeRollActorId);
  const unique = new Set(played);
  assert.equal(unique.size, played.length, "NO_DUPLICATE_DICE");
  return { actionBeats, diceBeats, played };
}

describe("TRPG round presentation queue", () => {
  it("keeps resolutionOrder as the only actor-order owner", () => {
    const order = [30, 10, 20];
    const built = actorsFor(order, [[10, "렌", 16], [20, "강이현", 8], [30, "권태현", 14]], ["권태현", "렌", "강이현"]);
    assert.equal(actorOrderEqualsResolutionOrder(built, order), true);
    assert.deepEqual(built.map((actor) => actor.actorId), order);
    assert.equal(actorOrderEqualsResolutionOrder(built, [10, 20, 30]), false);
  });

  it("1H: action → dice → result → GM", () => {
    const order = [7];
    const actors = actorsFor(order, [[7, "권태현", 16]], ["권태현"]);
    const frames = walkCinematicPresentation(actors);
    const { diceBeats } = assertInterleaved(frames, order);
    assert.deepEqual(frames.map((frame) => frame.phase), [
      "actor-action",
      "actor-dice",
      "actor-result",
      "gm-narration",
    ]);
    assert.equal(diceBeats[0]?.activeRollActorId, 7);
    const result = frames.find((frame) => frame.phase === "actor-result");
    assert.deepEqual(result?.resultLaneActorIds, [7]);
    assert.deepEqual(result?.compactRollActorIds, [7]);
    const action = frames.find((frame) => frame.phase === "actor-action");
    assert.deepEqual(action?.resultLaneActorIds, []);
    assert.deepEqual(action?.compactRollActorIds, []);
    const gm = frames.at(-1);
    assert.equal(gm?.gmVisible, true);
    assert.equal(gm?.phase, "gm-narration");
    assert.equal(frames.some((frame) => frame.gmVisible && frame.phase !== "gm-narration"), false);
  });

  it("1H + 1Bot: interleaves action/dice by resolutionOrder", () => {
    const order = [2, 1];
    const actors = actorsFor(order, [[2, "렌", 11], [1, "권태현", 18]], ["렌", "권태현"]);
    const frames = walkCinematicPresentation(actors);
    const { played } = assertInterleaved(frames, order);
    assert.deepEqual(played, [2, 1]);
    assert.equal(frames.some((frame) => frame.revealedActorIds.includes(1) && frame.presentationIndex === 0 && frame.phase !== "gm-narration"), false);
    const firstAction = frames.find((frame) => frame.phase === "actor-action" && frame.presentationIndex === 0);
    assert.equal(shouldShowActorResultLane({ actorId: 2, actors, state: { mode: "cinematic", phase: "actor-action", presentationIndex: 0 } }), false);
    assert.equal(firstAction?.gmVisible, false);
    assert.equal(frames.filter((frame) => frame.phase === "actor-dice").length, 2);
  });

  it("1H + 2Bot: three-actor interleaving then GM", () => {
    const order = [4, 8, 1];
    const actors = actorsFor(order, [[4, "렌", 9], [8, "강이현", 15], [1, "권태현", 20]], ["렌", "강이현", "권태현"]);
    const frames = walkCinematicPresentation(actors);
    const { played } = assertInterleaved(frames, order);
    assert.deepEqual(played, [4, 8, 1]);
    assert.equal(frames.filter((frame) => frame.phase === "actor-action").length, 3);
    assert.equal(frames.filter((frame) => frame.phase === "actor-dice").length, 3);
    const lastResult = frames.find((frame) => frame.phase === "actor-result" && frame.presentationIndex === 2);
    assert.equal(lastResult?.gmVisible, false);
    assert.deepEqual(lastResult?.revealedActorIds, order);
    assert.equal(frames.at(-1)?.gmVisible, true);
  });

  it("4H: four-actor interleaving", () => {
    const order = [1, 2, 3, 4];
    const actors = actorsFor(
      order,
      [[1, "A", 4], [2, "B", 12], [3, "C", 17], [4, "D", 8]],
      ["A", "B", "C", "D"]
    );
    const frames = walkCinematicPresentation(actors);
    const { played } = assertInterleaved(frames, order);
    assert.deepEqual(played, order);
    assert.equal(frames.filter((frame) => frame.phase === "actor-dice").length, 4);
    assert.equal(frames.at(-1)?.phase, "gm-narration");
  });

  it("mixed no-roll skips dice and does not invent a roll", () => {
    const order = [1, 2, 3];
    const actors = actorsFor(order, [[1, "렌", 13], [3, "권태현", 7]], ["렌", "강이현", "권태현"]);
    assert.equal(actors[1]?.roll, null);
    const frames = walkCinematicPresentation(actors);
    const played = frames.filter((frame) => frame.phase === "actor-dice").map((frame) => frame.activeRollActorId);
    assert.deepEqual(played, [1, 3]);
    assert.equal(played.includes(2), false);
    const talk = frames.find((frame) => frame.phase === "actor-action" && frame.presentationIndex === 1);
    assert.ok(talk);
    const afterTalk = frames[frames.indexOf(talk!) + 1];
    assert.equal(afterTalk?.phase, "actor-action");
    assert.equal(afterTalk?.presentationIndex, 2);
    assert.equal(frames.some((frame) => frame.activeRollActorId === 2), false);
  });

  it("hides GM until every actor presentation is complete", () => {
    const actors = actorsFor([1, 2], [[1, "A", 10], [2, "B", 11]], ["A", "B"]);
    const frames = walkCinematicPresentation(actors);
    assert.equal(frames.filter((frame) => frame.gmVisible).length, 1);
    assert.equal(frames.at(-1)?.gmVisible, true);
    assert.equal(isRoundPresentationComplete({ mode: "cinematic", phase: "actor-dice", presentationIndex: 1 }), false);
    assert.equal(isRoundPresentationComplete({ mode: "cinematic", phase: "gm-narration", presentationIndex: 1 }), true);
  });

  it("shows persistent result lanes only after that actor's dice", () => {
    const actors = actorsFor([5, 6], [[5, "A", 14], [6, "B", 2]], ["A", "B"]);
    const duringFirstAction = { mode: "cinematic" as const, phase: "actor-action" as const, presentationIndex: 0 };
    const duringFirstDice = { mode: "cinematic" as const, phase: "actor-dice" as const, presentationIndex: 0 };
    const afterFirstResult = { mode: "cinematic" as const, phase: "actor-result" as const, presentationIndex: 0 };
    assert.equal(shouldShowActorResultLane({ actorId: 5, actors, state: duringFirstAction }), false);
    assert.equal(shouldShowActorResultLane({ actorId: 5, actors, state: duringFirstDice }), false);
    assert.equal(shouldShowActorResultLane({ actorId: 5, actors, state: afterFirstResult }), true);
    assert.equal(shouldShowActorResultLane({ actorId: 6, actors, state: afterFirstResult }), false);
    assert.deepEqual(resultLaneActorIds({ actors, state: historicalPresentation() }), [5, 6]);
    assert.equal(shouldGateLiveRoundPresentation({ mode: "idle", previewReady: false }), true);
    assert.equal(shouldGateLiveRoundPresentation({ mode: "cinematic", previewReady: true }), true);
    assert.equal(shouldGateLiveRoundPresentation({ mode: "historical", previewReady: true }), false);
    assert.equal(
      shouldGateLiveRoundPresentation({ mode: "idle", previewReady: true, livePending: true }),
      true
    );
    assert.equal(
      shouldGateLiveRoundPresentation({ mode: "idle", previewReady: true, livePending: false }),
      false
    );
    assert.equal(
      shouldGateLiveRoundPresentation({
        mode: "historical",
        previewReady: true,
        livePending: true,
      }),
      false
    );
    assert.equal(
      shouldGateLiveRoundPresentation({
        mode: "idle",
        previewReady: true,
        livePending: false,
        presentationStarting: true,
      }),
      true
    );
  });

  it("hides compact roll numbers until the existing result-reveal owner", () => {
    const failed = buildRoundPresentationActors({
      resolutionOrder: [7],
      actions: [action(7, "권태현")],
      rolls: [roll(7, "권태현", 7, { finalScore: 10, dc: 12, tier: "FAILURE", success: false })],
    });
    const actionState = { mode: "cinematic" as const, phase: "actor-action" as const, presentationIndex: 0 };
    const diceState = { mode: "cinematic" as const, phase: "actor-dice" as const, presentationIndex: 0 };
    const resultState = { mode: "cinematic" as const, phase: "actor-result" as const, presentationIndex: 0 };
    assert.equal(shouldShowCompactRoll({ actorId: 7, actors: failed, state: actionState }), false);
    assert.equal(shouldShowActorResultLane({ actorId: 7, actors: failed, state: actionState }), false);
    assert.equal(shouldShowCompactRoll({ actorId: 7, actors: failed, state: diceState }), false);
    assert.equal(shouldShowActorResultLane({ actorId: 7, actors: failed, state: diceState }), false);
    assert.equal(shouldShowCompactRoll({ actorId: 7, actors: failed, state: resultState }), true);
    assert.equal(shouldShowActorResultLane({ actorId: 7, actors: failed, state: resultState }), true);
    const frames = walkCinematicPresentation(failed);
    const actionFrame = frames.find((frame) => frame.phase === "actor-action");
    const diceFrame = frames.find((frame) => frame.phase === "actor-dice");
    const resultFrame = frames.find((frame) => frame.phase === "actor-result");
    assert.deepEqual(actionFrame?.compactRollActorIds, []);
    assert.deepEqual(actionFrame?.resultLaneActorIds, []);
    assert.deepEqual(diceFrame?.compactRollActorIds, []);
    assert.deepEqual(diceFrame?.resultLaneActorIds, []);
    assert.deepEqual(resultFrame?.compactRollActorIds, [7]);
    assert.deepEqual(resultFrame?.resultLaneActorIds, [7]);

    const successActors = actorsFor([9], [[9, "렌", 16]], ["렌"]);
    const successFrames = walkCinematicPresentation(successActors);
    assert.deepEqual(successFrames.find((frame) => frame.phase === "actor-action")?.compactRollActorIds, []);
    assert.deepEqual(successFrames.find((frame) => frame.phase === "actor-dice")?.compactRollActorIds, []);
    assert.deepEqual(successFrames.find((frame) => frame.phase === "actor-result")?.compactRollActorIds, [9]);
    assert.deepEqual(compactRollActorIds({ actors: successActors, state: historicalPresentation() }), [9]);
    assert.equal(
      shouldShowCompactRoll({ actorId: 9, actors: successActors, state: historicalPresentation() }),
      true
    );
    assert.equal(
      shouldShowActionJudgeBlock({
        kind: "human",
        hasIntent: false,
        hasRoll: true,
        resultRevealed: false,
      }),
      false
    );
    assert.equal(
      shouldShowActionJudgeBlock({
        kind: "human",
        hasIntent: true,
        hasRoll: true,
        resultRevealed: false,
      }),
      false
    );
    assert.equal(
      shouldShowActionJudgeBlock({
        kind: "ai_character",
        hasIntent: false,
        hasRoll: true,
        resultRevealed: false,
      }),
      false
    );
  });

  it("does not autoplay historical remounts", () => {
    const rolls = [roll(1, "권태현", 16), roll(2, "렌", 9)];
    const key = trpgRoundPresentationSessionKey({
      roundNumber: 4,
      rolls,
      actions: [action(1, "권태현"), action(2, "렌")],
    });
    assert.equal(
      shouldConsumeMountRollSession({
        rollSessionKey: key,
        replayOnMount: false,
        isFirstObservation: true,
      }),
      true
    );
    assert.equal(decideRoundPresentationMode({ consumeOnMount: true, actorCount: 2 }), "historical");
    const hist = historicalPresentation();
    assert.equal(shouldShowGmNarration(hist), true);
    assert.deepEqual(
      revealedActorIds({
        actors: actorsFor([1, 2], [[1, "권태현", 16], [2, "렌", 9]], ["권태현", "렌"]),
        state: hist,
      }),
      [1, 2]
    );
    assert.equal(
      shouldConsumeMountRollSession({
        rollSessionKey: key,
        replayOnMount: false,
        isFirstObservation: false,
      }),
      false
    );
  });

  it("releases the outer reveal gate only after the presentation queue finishes", () => {
    const pending = nextDicePresentation(IDLE_DICE_PRESENTATION, {
      rollSessionKey: "3|1:16:12:SUCCESS",
      roundNumber: 3,
      overlayVisible: false,
      overlaySettled: false,
      overlayDismissed: false,
      mountConsume: false,
    });
    assert.equal(pending.state, "pending");
    const complete = nextDicePresentation(pending, {
      rollSessionKey: "3|1:16:12:SUCCESS",
      roundNumber: 3,
      overlayVisible: false,
      overlaySettled: false,
      overlayDismissed: false,
      mountConsume: false,
      roundPresentationComplete: true,
    });
    assert.equal(complete.state, "dismissed");
  });

  it("keeps server d20 notation and client-only sequencing", () => {
    assert.equal(trpgPredeterminedD20Notation(16), "1d20@16");
    const room = fs.readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    const overlay = fs.readFileSync("src/app/trpg/TrpgDiceOverlay.tsx", "utf8");
    const advance = fs.readFileSync("src/lib/trpg/engineAdvance.ts", "utf8");
    assert.match(room, /activePresentationRoll/);
    assert.match(room, /overlayRolls = activeRoll \? \[activeRoll\] : \[\]/);
    assert.match(room, /rolls=\{overlayRolls\}/);
    assert.match(room, /revealedActorIds/);
    assert.match(room, /showGmNarration/);
    assert.match(room, /shouldGateLiveRoundPresentation/);
    assert.match(room, /resolvePresentationLiveReady/);
    assert.match(room, /isLiveRoundPresentationStarting/);
    assert.match(room, /livePending/);
    assert.match(room, /presentationStarting/);
    assert.match(room, /actorCount: liveReady \? presentationActors\.length : 0/);
    assert.match(room, /visibleSceneRows = sceneRows/);
    assert.match(room, /showCompactRoll/);
    assert.match(room, /shouldShowActionJudgeBlock/);
    assert.match(room, /showCompactRoll && roll/);
    assert.match(room, /dicePreview\.ready/);
    assert.match(room, /window\.location\.search/);
    assert.doesNotMatch(room, /sceneRows\.filter\(\(row\) => row\.roundNumber !== gatedRoundNumber\)/);
    assert.match(overlay, /TrpgDiceBoxScene/);
    assert.match(overlay, /trpgPredeterminedD20Notation/);
    assert.doesNotMatch(advance, /presentationIndex/);
    assert.doesNotMatch(advance, /RoundPresentationPhase/);
    assert.match(advance, /resolveTrpgActionCheckDecision/);
  });

  it("budgets the sequential presentation watchdog above 1-4 actor queues", () => {
    for (const n of [1, 2, 3, 4] as const) {
      const watchdog = trpgRoundPresentationWatchdogMs({ actorCount: n, rollCount: n });
      assert.ok(watchdog >= 10_000);
      assert.ok(watchdog > n * 7000);
    }
    const start = startCinematicPresentation();
    assert.deepEqual(start, { phase: "actor-action", presentationIndex: 0 });
  });
});

describe("TRPG live round presentation readiness", () => {
  const order = [10, 20, 30];
  const human = { ...action(10, "권태현"), kind: "human" as const };
  const bot1 = action(20, "렌");
  const bot2 = action(30, "강이현");
  const humanRoll = roll(10, "권태현", 16);
  const bot1Roll = roll(20, "렌", 9);
  const bot2Roll = roll(30, "강이현", 14);

  it("does not treat incremental BOT_ACTION as cinematic-ready (#530 gate preserved)", () => {
    assert.equal(
      isLiveRoundPresentationReady({ phase: "BOT_ACTION", hasLockedActorSet: true }),
      false
    );
    assert.equal(
      isLiveRoundPresentationReady({ phase: "ACTION_INPUT", hasLockedActorSet: true }),
      false
    );
    assert.equal(
      isLiveRoundPresentationReady({ phase: "LOCKING_ACTIONS", hasLockedActorSet: true }),
      false
    );
    assert.equal(
      isLiveRoundPresentationReady({ phase: "ADJUDICATING", hasLockedActorSet: true }),
      false
    );
    assert.equal(
      isLiveRoundPresentationReady({ phase: "GENERATING_NARRATION", hasLockedActorSet: true }),
      true
    );
    assert.equal(
      isLiveRoundPresentationReady({ phase: "ROLLING", hasLockedActorSet: true }),
      true
    );
    assert.equal(
      isLiveRoundPresentationReady({ phase: "ROLLING", hasLockedActorSet: false }),
      false
    );
    assert.equal(
      trpgRoundPresentationSessionKey({
        roundNumber: 3,
        rolls: [],
        actions: [human, bot1],
        ready: false,
      }),
      ""
    );
    assert.equal(
      trpgRoundPresentationSessionKey({
        roundNumber: 3,
        rolls: [],
        actions: [human, bot1],
        ready: true,
      }),
      "3|live-cinematic"
    );
    assert.equal(liveRoundWaitKind({
      phase: "BOT_ACTION",
      workType: "generate_bots",
      viewerLocked: true,
    }), "bots");
    assert.equal(liveRoundWaitCopy("bots"), "행동 제출됨 · 동료 행동 결정 중…");
    assert.equal(liveRoundWaitCopy("rolls"), "라운드 판정 준비 중…");
  });

  it("S1-S5 incremental snapshots show actions before rolls commit; cinematic starts at roll-final", () => {
    const walked = walkLiveRoundSnapshots([
      {
        phase: "ACTION_INPUT",
        roundNumber: 3,
        actions: [],
        rolls: [],
        resolutionOrder: order,
      },
      {
        phase: "BOT_ACTION",
        roundNumber: 3,
        actions: [human],
        rolls: [],
        resolutionOrder: order,
      },
      {
        phase: "BOT_ACTION",
        roundNumber: 3,
        actions: [human, bot1],
        rolls: [],
        resolutionOrder: order,
      },
      {
        phase: "BOT_ACTION",
        roundNumber: 3,
        actions: [human, bot1, bot2],
        rolls: [],
        resolutionOrder: order,
      },
      {
        phase: "ROLLING",
        roundNumber: 3,
        actions: [human, bot1, bot2],
        rolls: [humanRoll, bot1Roll, bot2Roll],
        resolutionOrder: order,
      },
      {
        phase: "GENERATING_NARRATION",
        roundNumber: 3,
        actions: [human, bot1, bot2],
        rolls: [humanRoll, bot1Roll, bot2Roll],
        resolutionOrder: order,
      },
    ]);
    const [s0, s1, s2, s3, s4, s5] = walked.steps;
    assert.equal(s0?.ready, false);
    assert.equal(s1?.ready, false);
    assert.equal(s1?.mode, "idle");
    assert.equal(s1?.started, false);
    assert.deepEqual(s1?.incrementalVisibleActionIds, [10]);
    assert.equal(s2?.ready, false);
    assert.equal(s2?.started, false);
    assert.equal(s2?.restarted, false);
    assert.deepEqual(s2?.incrementalVisibleActionIds, [10]);
    assert.equal(s3?.ready, false);
    assert.equal(s3?.started, false);
    assert.equal(s3?.restarted, false);
    assert.deepEqual(s3?.incrementalVisibleActionIds, [10]);
    assert.equal(s4?.ready, true);
    assert.equal(s4?.mode, "cinematic");
    assert.equal(s4?.started, true);
    assert.equal(s4?.restarted, false);
    assert.notEqual(s4?.sessionKey, "");
    assert.equal(s5?.started, false);
    assert.equal(s5?.restarted, false);
    assert.equal(walked.startCount, 1);
    assert.equal(walked.restartCount, 0);
    const frames = walkCinematicPresentation(s4!.actors);
    assert.deepEqual(frames.map((frame) => frame.phase), [
      "actor-action",
      "actor-dice",
      "actor-result",
      "actor-action",
      "actor-dice",
      "actor-result",
      "actor-action",
      "actor-dice",
      "actor-result",
      "gm-narration",
    ]);
    const dice = frames.filter((frame) => frame.phase === "actor-dice");
    assert.deepEqual(dice.map((frame) => frame.activeRollActorId), [10, 20, 30]);
    assert.equal(dice.every((frame) => frame.activeRollActorId != null), true);
    assert.equal(frames.filter((frame) => frame.gmVisible).length, 1);
    assert.equal(frames.at(-1)?.gmVisible, true);
  });

  it("does not restart a running cinematic after GM/log refresh", () => {
    const ready = {
      phase: "GENERATING_NARRATION",
      roundNumber: 5,
      actions: [human, bot1, bot2],
      rolls: [humanRoll, bot1Roll, bot2Roll],
      resolutionOrder: order,
    };
    const walked = walkLiveRoundSnapshots([
      ready,
      ready,
      { ...ready, phase: "ROUND_COMPLETE" },
      { ...ready, phase: "ROUND_COMPLETE" },
    ]);
    assert.equal(walked.startCount, 1);
    assert.equal(walked.restartCount, 0);
    assert.equal(walked.steps[1]?.sessionKey, walked.steps[2]?.sessionKey);
    const frozen = freezeLivePresentationActors({
      previous: walked.steps[1]?.actors ?? null,
      next: walked.steps[2]?.actors ?? [],
      ready: true,
      roundNumber: 5,
      frozenRound: 5,
    });
    assert.deepEqual(frozen.actors.map((actor) => actor.actorId), order);
  });

  it("can become ready with zero rolls when no actor needs a check", () => {
    const walked = walkLiveRoundSnapshots([
      {
        phase: "BOT_ACTION",
        roundNumber: 2,
        actions: [human, bot1],
        rolls: [],
        resolutionOrder: [10, 20],
      },
      {
        phase: "ROLLING",
        roundNumber: 2,
        actions: [human, bot1],
        rolls: [],
        resolutionOrder: [10, 20],
      },
    ]);
    assert.equal(walked.steps[0]?.ready, false);
    assert.equal(walked.steps[0]?.mode, "idle");
    assert.equal(walked.steps[1]?.ready, true);
    assert.equal(walked.startCount, 1);
    assert.match(walked.steps[1]?.sessionKey ?? "", /^2\|live-cinematic$/);
    const frames = walkCinematicPresentation(walked.steps[1]!.actors);
    assert.equal(frames.some((frame) => frame.phase === "actor-dice"), false);
    assert.deepEqual(frames.map((frame) => frame.phase), [
      "actor-action",
      "actor-action",
      "gm-narration",
    ]);
  });

  it("does not invent a D20 for a downed or no-check actor", () => {
    const actors = buildRoundPresentationActors({
      resolutionOrder: [10, 20, 30],
      actions: [human, bot1, bot2],
      rolls: [humanRoll, bot2Roll],
    });
    assert.equal(actors[1]?.roll, null);
    const frames = walkCinematicPresentation(actors);
    assert.deepEqual(
      frames.filter((frame) => frame.phase === "actor-dice").map((frame) => frame.activeRollActorId),
      [10, 30]
    );
    assert.equal(frames.some((frame) => frame.activeRollActorId === 20), false);
  });

  it("keeps historical remount complete with no autoplay", () => {
    const walked = walkLiveRoundSnapshots([
      {
        phase: "ROUND_COMPLETE",
        roundNumber: 4,
        actions: [human, bot1, bot2],
        rolls: [humanRoll, bot1Roll, bot2Roll],
        resolutionOrder: order,
        consumeOnMount: true,
      },
    ]);
    assert.equal(walked.steps[0]?.mode, "historical");
    assert.equal(walked.startCount, 0);
    assert.deepEqual(walked.steps[0]?.visibleCanonicalActionIds, order);
    assert.equal(shouldShowGmNarration(historicalPresentation()), true);
  });

  it("gates the first ready render before cinematic mode is established", () => {
    const actions = [human, bot1, bot2];
    const sessionKey = trpgRoundPresentationSessionKey({
      roundNumber: 3,
      rolls: [humanRoll, bot1Roll, bot2Roll],
      actions,
      ready: true,
    });
    assert.notEqual(sessionKey, "");

    const firstReady = {
      mode: "idle" as const,
      previewReady: true,
      livePending: false,
      liveReady: true,
      queueSessionKey: sessionKey,
    };
    const presentationStarting = isLiveRoundPresentationStarting(firstReady);
    assert.equal(presentationStarting, true);
    const firstGate = shouldGateLiveRoundPresentation({
      mode: firstReady.mode,
      previewReady: firstReady.previewReady,
      livePending: firstReady.livePending,
      presentationStarting,
    });
    assert.equal(firstGate, true);
    const firstVisible = liveRoundCanonicalVisibleCount({
      gated: firstGate,
      mode: firstReady.mode,
      actions,
      revealedActorIds: [],
    });
    assert.equal(firstVisible, 1, "early human visibility only before cinematic starts");
    assert.deepEqual(earlyVisibleHumanActionIds(actions), [10]);
    assert.deepEqual(
      resolveLiveRevealedActionIds({
        isLiveRow: true,
        mode: "idle",
        cinematicRevealedIds: [],
        preCinematicVisibleIds: [10],
      }),
      [10]
    );
    assert.equal(firstVisible === 1, true, "HUMAN_ONLY_AT_PRE_CINEMATIC");
    assert.equal(
      shouldShowLiveRoundWaitCopy({
        waitKind: "gm",
        mode: "idle",
        presentationStarting: true,
      }),
      false
    );
    assert.equal(
      shouldShowLiveRoundWaitCopy({
        waitKind: "reroll",
        mode: "idle",
        presentationStarting: true,
      }),
      true
    );

    const actors = buildRoundPresentationActors({
      resolutionOrder: order,
      actions,
      rolls: [humanRoll, bot1Roll, bot2Roll],
    });
    const cinematic = { mode: "cinematic" as const, ...startCinematicPresentation() };
    const afterStartGate = shouldGateLiveRoundPresentation({
      mode: cinematic.mode,
      previewReady: true,
      livePending: false,
      presentationStarting: isLiveRoundPresentationStarting({
        liveReady: true,
        mode: cinematic.mode,
        queueSessionKey: sessionKey,
      }),
    });
    assert.equal(afterStartGate, true);
    const actor1Only = liveRoundCanonicalVisibleCount({
      gated: afterStartGate,
      mode: cinematic.mode,
      actions,
      revealedActorIds: revealedActorIds({ actors, state: cinematic }),
    });
    assert.equal(actor1Only, 1);
    assert.deepEqual(revealedActorIds({ actors, state: cinematic }), [10]);
    assert.equal(cinematic.phase, "actor-action");
    assert.equal(
      shouldShowLiveRoundWaitCopy({
        waitKind: "gm",
        mode: "cinematic",
        presentationStarting: false,
      }),
      false
    );
  });

  it("single live action-id owner: early human pre-cinematic, cinematic releases resolution", () => {
    assert.deepEqual(earlyVisibleHumanActionIds([human, bot1, bot2]), [10]);
    assert.deepEqual(
      resolveLiveRevealedActionIds({
        isLiveRow: true,
        mode: "idle",
        cinematicRevealedIds: [],
        preCinematicVisibleIds: [10],
      }),
      [10]
    );
    assert.deepEqual(
      resolveLiveRevealedActionIds({
        isLiveRow: true,
        mode: "cinematic",
        cinematicRevealedIds: [20],
        preCinematicVisibleIds: [10, 30],
      }),
      [10, 30, 20]
    );
    assert.equal(
      resolveLiveRevealedActionIds({
        isLiveRow: false,
        mode: "cinematic",
        cinematicRevealedIds: [20],
        preCinematicVisibleIds: [10],
      }),
      undefined
    );
    assert.equal(
      shouldDecorativeRevealAction({
        kind: "ai_character",
        participantId: 20,
        activeRevealActorId: 20,
        isFresh: true,
        skipDecorativeReveal: false,
        cinematicActorAction: true,
      }),
      true
    );
    assert.equal(
      shouldDecorativeRevealAction({
        kind: "ai_character",
        participantId: 20,
        activeRevealActorId: 20,
        isFresh: true,
        skipDecorativeReveal: false,
        cinematicActorAction: false,
      }),
      false
    );
    assert.equal(
      shouldDecorativeRevealAction({
        kind: "human",
        participantId: 10,
        activeRevealActorId: 10,
        isFresh: true,
        skipDecorativeReveal: false,
        cinematicActorAction: true,
      }),
      false
    );
    assert.equal(
      isActorActionRevealBeatSatisfied({
        actionKind: "human",
        isFreshAiAction: false,
        alreadyCompleted: false,
        effectiveActorRevealComplete: false,
      }),
      true
    );
    assert.equal(
      isActorActionRevealBeatSatisfied({
        actionKind: "ai_character",
        isFreshAiAction: true,
        alreadyCompleted: false,
        effectiveActorRevealComplete: false,
      }),
      false
    );
    assert.equal(
      shouldDecorativeRevealAction({
        kind: "ai_character",
        participantId: 20,
        activeRevealActorId: 20,
        isFresh: true,
        skipDecorativeReveal: false,
        cinematicActorAction: true,
        resolutionActionAlreadyConsumed: true,
      }),
      false
    );
    assert.equal(
      isActorActionRevealBeatSatisfied({
        actionKind: "ai_character",
        isFreshAiAction: true,
        alreadyCompleted: false,
        effectiveActorRevealComplete: false,
        resolutionActionAlreadyConsumed: true,
      }),
      true
    );
    assert.equal(
      shouldShowLiveRoundWaitCopy({
        waitKind: "bots",
        mode: "idle",
        presentationStarting: false,
      }),
      false
    );
  });
});
