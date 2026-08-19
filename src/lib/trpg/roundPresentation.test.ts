import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import type { TrpgPublicAction, TrpgPublicRoll } from "./snapshot";
import {
  actorOrderEqualsResolutionOrder,
  buildRoundPresentationActors,
  decideRoundPresentationMode,
  historicalPresentation,
  isRoundPresentationComplete,
  resultLaneActorIds,
  revealedActorIds,
  shouldShowActorResultLane,
  shouldShowGmNarration,
  startCinematicPresentation,
  trpgRoundPresentationSessionKey,
  trpgRoundPresentationWatchdogMs,
  walkCinematicPresentation,
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

function roll(participantId: number, name: string, d20: number): TrpgPublicRoll {
  return {
    participantId,
    name,
    d20,
    statKey: "str",
    finalScore: d20 + 2,
    dc: 12,
    tier: d20 === 20 ? "CRITICAL_SUCCESS" : d20 === 1 ? "CRITICAL_FAILURE" : "SUCCESS",
    success: d20 >= 10,
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
    const action = frames.find((frame) => frame.phase === "actor-action");
    assert.deepEqual(action?.resultLaneActorIds, []);
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
    assert.match(room, /visibleSceneRows = sceneRows/);
    assert.doesNotMatch(room, /sceneRows\.filter\(\(row\) => row\.roundNumber !== gatedRoundNumber\)/);
    assert.match(overlay, /TrpgDiceBoxScene/);
    assert.match(overlay, /trpgPredeterminedD20Notation/);
    assert.doesNotMatch(advance, /presentationIndex/);
    assert.doesNotMatch(advance, /RoundPresentationPhase/);
    assert.match(advance, /if \(!actionNeedsCheck/);
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
