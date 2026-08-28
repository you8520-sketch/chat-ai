import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  advanceAfterActorAction,
  buildRoundPresentationActors,
  decideLiveRoundPresentation,
  earlyVisibleHumanActionIds,
  isLiveRoundPresentationReady,
  resolveLiveActorDeclarationPresentation,
  resolveLiveRevealedActionIds,
  revealedActorIds,
  shouldDecorativeRevealAction,
  isActorActionRevealBeatSatisfied,
  startCinematicPresentation,
  idlePresentation,
  walkCinematicPresentation,
  type RoundPresentationState,
} from "./roundPresentation";
import { resolveTrpgMountSeenKeys } from "../../app/trpg/useRevealedText";

/**
 * Production-shape regression (campaign 38):
 * human@t0, bot1@t+10s, bot2+rolls@t+35s, cinematic@rolls-ready.
 * Pre-cinematic: human early visibility only. AI declarations buffer until cinematic slot.
 */
const order = [10, 20, 30];
const human = { participantId: 10, name: "Human", kind: "human" as const, body: "조사한다.", revealed: true };
const bot1 = { participantId: 20, name: "BotAlpha", kind: "ai_character" as const, body: "앞을 본다.", revealed: true };
const bot2 = { participantId: 30, name: "BotBeta", kind: "ai_character" as const, body: "뒤를 본다.", revealed: true };
const humanRoll = { participantId: 10, d20: 14, dc: 12, tier: "SUCCESS" as const, statKey: "dex", finalScore: 16 };
const bot1Roll = { participantId: 20, d20: 8, dc: 12, tier: "FAILURE" as const, statKey: "dex", finalScore: 10 };
const bot2Roll = { participantId: 30, d20: 17, dc: 12, tier: "SUCCESS" as const, statKey: "dex", finalScore: 19 };

function visibleAt(
  actions: typeof human[],
  rolls: typeof humanRoll[],
  phase: string,
  consumedAiIds: readonly number[] = [],
  cinematicState?: RoundPresentationState
) {
  const decided = decideLiveRoundPresentation({
    phase,
    roundNumber: 1,
    actions,
    rolls,
    resolutionOrder: order,
  });
  const declaration = resolveLiveActorDeclarationPresentation({
    mode: cinematicState?.mode ?? (decided.ready ? "cinematic" : "idle"),
    phase: cinematicState?.phase ?? "idle",
    presentationIndex: cinematicState?.presentationIndex ?? 0,
    presentationActors: decided.actors,
    actions,
    consumedAiIds: new Set(consumedAiIds),
  });
  const preIds = declaration.visibleActionIds;
  const mode = cinematicState?.mode ?? (decided.ready ? "cinematic" : "idle");
  const state: RoundPresentationState =
    cinematicState ??
    (decided.ready ? { mode: "cinematic", ...startCinematicPresentation() } : idlePresentation());
  const cinematicIds = revealedActorIds({ actors: decided.actors, state });
  const visible =
    resolveLiveRevealedActionIds({
      isLiveRow: true,
      mode: state.mode,
      cinematicRevealedIds: cinematicIds,
      preCinematicVisibleIds: preIds,
    }) ?? [];
  return { decided, declaration, preIds, visible, state, mode };
}

describe("TRPG two-bot production-shape declaration visibility", () => {
  it("uses the configured reveal interval through the existing prose owner", () => {
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.match(room, /declarationRevealActive: activeDeclarationRevealId === action\.participantId/);
    assert.match(room, /streamIntervalMs=\{streamIntervalMs\}/);
    assert.match(room, /onDeclarationRevealChange/);
  });

  it("pre-cinematic exposes human only; AI buffered until cinematic slot", () => {
    const t0 = visibleAt([human], [], "BOT_ACTION");
    assert.deepEqual(t0.preIds, [10]);
    assert.deepEqual(t0.visible, [10]);
    assert.equal(t0.decided.ready, false);

    const tBot1 = visibleAt([human, bot1], [], "BOT_ACTION");
    assert.deepEqual(tBot1.preIds, [10], "BOT1 buffered pre-cinematic");
    assert.deepEqual(tBot1.visible, [10]);
    assert.equal(tBot1.declaration.activeDeclarationActorId, null);
    assert.equal(tBot1.decided.ready, false);

    const tBot2NoRolls = visibleAt([human, bot1, bot2], [], "BOT_ACTION");
    assert.deepEqual(tBot2NoRolls.visible, [10], "bot2 buffered pre-cinematic");
    assert.equal(tBot2NoRolls.declaration.activeDeclarationActorId, null);
    assert.equal(tBot2NoRolls.decided.ready, false);

    const cinematicBot1 = visibleAt(
      [human, bot1, bot2],
      [humanRoll, bot1Roll, bot2Roll],
      "GENERATING_NARRATION",
      [],
      { mode: "cinematic", phase: "actor-action", presentationIndex: 1 }
    );
    assert.equal(cinematicBot1.declaration.activeDeclarationActorId, 20, "bot1 owns cinematic declaration slot");
    assert.ok(!cinematicBot1.preIds.includes(30), "bot2 still buffered during bot1 slot");
  });

  it("declarations stream one at a time during cinematic actor-action only", () => {
    const actions = [human, bot1, bot2];
    const rolls = [humanRoll, bot1Roll, bot2Roll];
    assert.deepEqual(earlyVisibleHumanActionIds(actions), [10]);

    const seen = new Set(
      resolveTrpgMountSeenKeys({
        log: [{ roundNumber: 1, narration: null, actions }],
        currentRoundNumber: 1,
        liveReady: false,
      })
    );
    assert.ok(seen.has("a:1:10"));
    assert.equal(seen.has("a:1:20"), false, "bot1 not pre-marked seen");
    assert.equal(seen.has("a:1:30"), false, "bot2 not pre-marked seen");

    const bot1Active = resolveLiveActorDeclarationPresentation({
      mode: "cinematic",
      phase: "actor-action",
      presentationIndex: 1,
      presentationActors: buildRoundPresentationActors({ resolutionOrder: order, actions, rolls }),
      actions,
      consumedAiIds: new Set(),
    });
    assert.equal(bot1Active.activeDeclarationActorId, 20);
    assert.equal(
      shouldDecorativeRevealAction({
        kind: "ai_character",
        participantId: 20,
        activeRevealActorId: 20,
        isFresh: true,
        skipDecorativeReveal: false,
        cinematicActorAction: true,
        declarationRevealActive: true,
      }),
      true,
      "BOT1_DECLARATION_STREAMED"
    );
    assert.equal(
      shouldDecorativeRevealAction({
        kind: "ai_character",
        participantId: 30,
        activeRevealActorId: 20,
        isFresh: true,
        skipDecorativeReveal: false,
        cinematicActorAction: true,
        declarationRevealActive: false,
      }),
      false,
      "DECLARATION_REVEAL_CONCURRENCY=1"
    );

    const bot2Active = resolveLiveActorDeclarationPresentation({
      mode: "cinematic",
      phase: "actor-action",
      presentationIndex: 2,
      presentationActors: buildRoundPresentationActors({ resolutionOrder: order, actions, rolls }),
      actions,
      consumedAiIds: new Set([20]),
    });
    assert.equal(bot2Active.activeDeclarationActorId, 30);

    for (const id of [20, 30]) {
      assert.equal(
        shouldDecorativeRevealAction({
          kind: "ai_character",
          participantId: id,
          activeRevealActorId: id,
          isFresh: !seen.has(`a:1:${id}`),
          skipDecorativeReveal: false,
          cinematicActorAction: true,
          resolutionActionAlreadyConsumed: true,
        }),
        false,
        "ALREADY_VISIBLE_ACTION_REPLAY=false"
      );
      assert.equal(
        isActorActionRevealBeatSatisfied({
          actionKind: "ai_character",
          isFreshAiAction: !seen.has(`a:1:${id}`),
          alreadyCompleted: false,
          effectiveActorRevealComplete: false,
          resolutionActionAlreadyConsumed: true,
        }),
        true
      );
    }

    const actors = buildRoundPresentationActors({ resolutionOrder: order, actions, rolls });
    const frames = walkCinematicPresentation(actors);
    assert.deepEqual(
      frames.filter((frame) => frame.phase === "actor-dice").map((frame) => frame.activeRollActorId),
      [10, 20, 30],
      "DICE_ORDER_PRESERVED"
    );
    assert.equal(frames.at(-1)?.phase, "gm-narration");
    assert.equal(frames.at(-1)?.gmVisible, true, "GM_ORDER_PRESERVED");
  });

  it("bot1 no-roll does not block resolution when pre-declared", () => {
    const bot1Talk = { ...bot1, body: "말한다." };
    const actions = [human, bot1Talk, bot2];
    const rolls = [humanRoll, bot2Roll];
    const consumedAiIds = new Set([20]);
    assert.equal(
      isActorActionRevealBeatSatisfied({
        actionKind: "ai_character",
        isFreshAiAction: true,
        alreadyCompleted: false,
        effectiveActorRevealComplete: false,
        resolutionActionAlreadyConsumed: consumedAiIds.has(20),
      }),
      true
    );
    const actors = buildRoundPresentationActors({
      resolutionOrder: order,
      actions,
      rolls,
    });
    let state: RoundPresentationState = { mode: "cinematic", ...startCinematicPresentation() };
    state = { ...state, ...advanceAfterActorAction({ actors, presentationIndex: 0 }) };
    assert.equal(state.phase, "actor-dice");
  });

  it("refresh after bot1 persist keeps human visible; bots not pre-seen", () => {
    const log = [
      {
        roundNumber: 1,
        narration: null,
        actions: [human, bot1],
      },
    ];
    const seen = resolveTrpgMountSeenKeys({ log, currentRoundNumber: 1, liveReady: false });
    assert.ok(seen.includes("a:1:10"));
    assert.equal(seen.includes("a:1:20"), false);
    assert.equal(seen.includes("a:1:30"), false);

    const afterBot2Log = [
      {
        roundNumber: 1,
        narration: null,
        actions: [human, bot1, bot2],
      },
    ];
    const seenAfter = resolveTrpgMountSeenKeys({
      log: afterBot2Log,
      currentRoundNumber: 1,
      liveReady: false,
    });
    assert.equal(seenAfter.includes("a:1:20"), false);
    assert.equal(seenAfter.includes("a:1:30"), false);
  });
});
