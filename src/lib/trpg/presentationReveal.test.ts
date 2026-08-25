import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  trpgRevealCountForElapsed,
  trpgRevealDurationMs,
  resolveTrpgRevealVisibleCount,
  shouldConsumeFinishLockOnPrefixExtension,
  trpgRevealTextExtended,
} from "./revealTiming";
import {
  catchUpHiddenPresentationState,
  isHiddenPresentationCatchUpActive,
  shouldSkipDecorativeReveal,
} from "./presentationHiddenCatchUp";
import {
  advanceAfterActorAction,
  buildRoundPresentationActors,
  revealedActorIds,
  resultLaneActorIds,
  shouldShowGmNarration,
  startCinematicPresentation,
  type PresentationActor,
  type RoundPresentationState,
} from "./roundPresentation";

function action(participantId: number, name: string, kind: "human" | "ai_character" = "ai_character") {
  return {
    participantId,
    name,
    kind,
    actionType: "talk",
    body: `${name} 행동`,
    revealed: true,
  };
}

function roll(participantId: number, name: string, d20: number) {
  return {
    participantId,
    name,
    statKey: "str",
    d20,
    dc: 12,
    tier: "SUCCESS",
    finalScore: d20,
  };
}

function actorsFor(
  ids: number[],
  rolls: Array<[number, string, number]> = [],
  names?: string[]
): PresentationActor[] {
  const actions = ids.map((id, i) => action(id, names?.[i] ?? `Actor${id}`));
  const rollRows = rolls.map(([id, name, d20]) => roll(id, name, d20));
  return buildRoundPresentationActors({
    resolutionOrder: ids,
    actions,
    rolls: rollRows,
  });
}

function cinematicState(
  phase: RoundPresentationState["phase"],
  presentationIndex: number
): RoundPresentationState {
  return { mode: "cinematic", phase, presentationIndex };
}

function countLiveProgressiveOwners(opts: {
  state: RoundPresentationState;
  actors: PresentationActor[];
  freshActionKeys: Set<string>;
  freshGm: boolean;
  roundNumber: number;
}): number {
  if (opts.state.mode !== "cinematic") return 0;
  if (opts.state.phase === "gm-narration" || opts.state.phase === "complete") {
    return opts.freshGm ? 1 : 0;
  }
  if (opts.state.phase === "actor-action") {
    const actorId = opts.actors[opts.state.presentationIndex]?.actorId;
    if (actorId == null) return 0;
    return opts.freshActionKeys.has(`a:${opts.roundNumber}:${actorId}`) ? 1 : 0;
  }
  return 0;
}

describe("TRPG presentation reveal integration", () => {
  const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
  const hook = readFileSync("src/app/trpg/useRevealedText.ts", "utf8");
  const named = readFileSync("src/app/trpg/TrpgNamedProse.tsx", "utf8");

  it("uses reveal completion instead of fixed 700ms actor-action timeout", () => {
    assert.match(room, /activeActorRevealComplete/);
    assert.match(room, /handleActiveActorRevealChange/);
    assert.match(room, /onActiveActorRevealChange/);
    assert.match(room, /hiddenCatchUpActive/);
    assert.match(room, /skipDecorativeReveal/);
    assert.match(room, /catchUpHiddenPresentationState/);
    assert.match(named, /onRevealChange/);
    assert.doesNotMatch(room, /ROUND_ACTION_REVEAL_MS/);
    assert.doesNotMatch(room, /setTimeout\([\s\S]{0,200}advanceAfterActorAction/);
  });

  it("1: AI1 reveal incomplete keeps AI1 visible and hides GM", () => {
    const actors = actorsFor([1, 2], [[1, "AI1", 14]]);
    const state = cinematicState("actor-action", 0);
    assert.deepEqual(revealedActorIds({ actors, state }), [1]);
    assert.equal(shouldShowGmNarration(state), false);
    assert.equal(
      countLiveProgressiveOwners({
        state,
        actors,
        freshActionKeys: new Set(["a:3:1"]),
        freshGm: true,
        roundNumber: 3,
      }),
      1
    );
  });

  it("2: after AI1 lane completes, AI2 may enter presentation", () => {
    const actors = actorsFor([1, 2]);
    const afterAi1 = {
      ...cinematicState("actor-action", 0),
      ...advanceAfterActorAction({ actors, presentationIndex: 0 }),
    };
    assert.equal(afterAi1.presentationIndex, 1);
    assert.deepEqual(revealedActorIds({ actors, state: afterAi1 }), [1, 2]);
  });

  it("3: last AI reveal incomplete keeps GM hidden", () => {
    const actors = actorsFor([1, 2]);
    const state = cinematicState("actor-action", 1);
    assert.equal(shouldShowGmNarration(state), false);
    assert.deepEqual(revealedActorIds({ actors, state }), [1, 2]);
  });

  it("4: last AI + dice/result complete allows GM", () => {
    const actors = actorsFor([1, 2], [[1, "AI1", 14], [2, "AI2", 9]]);
    const gmReady = cinematicState("gm-narration", 1);
    assert.equal(shouldShowGmNarration(gmReady), true);
    assert.deepEqual(resultLaneActorIds({ actors, state: gmReady }), [1, 2]);
  });

  it("5: slow reveal longer than 700ms does not advance before completion", () => {
    const chars = 2500;
    const duration = trpgRevealDurationMs(chars, "bot", 50);
    assert.ok(duration > 700);
    const at700 = trpgRevealCountForElapsed({ elapsedMs: 700, charCount: chars, streamIntervalMs: 50 });
    assert.ok(at700 < chars);
    assert.equal(
      trpgRevealCountForElapsed({ elapsedMs: duration, charCount: chars, streamIntervalMs: 50 }),
      chars
    );
  });

  it("6: finish clears interval and prevents rollback from stale ticks", () => {
    assert.match(hook, /clearRevealInterval/);
    assert.match(hook, /finishRequestedRef\.current = true/);
    assert.match(hook, /Math\.max\(countRef\.current/);
    assert.match(hook, /shouldConsumeFinishLockOnPrefixExtension/);
    assert.match(hook, /finishRequestedRef\.current = false/);
  });

  it("7: finished prefix stays visible while suffix streams after finish lock consumed", () => {
    const prefix = "A".repeat(2500);
    const extended = prefix + "B".repeat(200);
    assert.equal(trpgRevealTextExtended(prefix, extended), true);
    assert.equal(
      shouldConsumeFinishLockOnPrefixExtension({
        sessionChanged: true,
        textExtended: true,
        finishOwned: true,
      }),
      true
    );
    assert.equal(
      resolveTrpgRevealVisibleCount({
        previousSession: { text: prefix, active: true, kind: "gm" },
        nextSession: { text: extended, active: true, kind: "gm" },
        storedCount: 2500,
        finishOwned: true,
        reducedMotion: false,
      }),
      2500
    );
  });

  it("8: same-round replacement starts fresh reveal", () => {
    const previous = "A".repeat(2500);
    const replacement = "B".repeat(2500);
    assert.equal(
      resolveTrpgRevealVisibleCount({
        previousSession: { text: previous, active: true, kind: "gm" },
        nextSession: { text: replacement, active: true, kind: "gm" },
        storedCount: 2500,
        finishOwned: false,
        reducedMotion: false,
      }),
      0
    );
  });

  it("9-10: room-level hidden owner fast-forwards queue without replay", () => {
    assert.match(hook, /shouldConsumeFinishLockOnPrefixExtension/);
    const actors = actorsFor([1, 2]);
    const start = { mode: "cinematic" as const, ...startCinematicPresentation() };
    const caught = catchUpHiddenPresentationState({ state: start, actors, gmTextAvailable: true });
    assert.equal(caught.phase, "complete");
    assert.equal(
      shouldSkipDecorativeReveal({
        consumedSessionKey: "5|actions:1,2",
        sessionKey: "5|actions:1,2",
        hiddenCatchUpActive: false,
      }),
      true
    );
  });

  it("11: hidden fast-forward does not fabricate unavailable GM text", () => {
    const emptyGm = resolveTrpgRevealVisibleCount({
      previousSession: { text: "", active: true, kind: "gm" },
      nextSession: { text: "", active: true, kind: "gm" },
      storedCount: 0,
      finishOwned: false,
      reducedMotion: false,
    });
    assert.equal(emptyGm, 0);
    assert.equal(trpgRevealCountForElapsed({ elapsedMs: 60_000, charCount: 0, kind: "gm" }), 0);
  });

  it("12: at most one progressive prose owner per cinematic frame", () => {
    const actors = actorsFor([1, 2, 3], [
      [1, "AI1", 12],
      [2, "AI2", 14],
      [3, "AI3", 10],
    ]);
    const freshKeys = new Set(["a:5:1", "a:5:2", "a:5:3"]);
    const frames: RoundPresentationState[] = [
      cinematicState("actor-action", 0),
      cinematicState("actor-action", 1),
      cinematicState("actor-action", 2),
      cinematicState("actor-dice", 0),
      cinematicState("actor-result", 0),
      cinematicState("gm-narration", 2),
      cinematicState("complete", 2),
    ];
    for (const frame of frames) {
      const owners = countLiveProgressiveOwners({
        state: frame,
        actors,
        freshActionKeys: freshKeys,
        freshGm: true,
        roundNumber: 5,
      });
      assert.ok(owners <= 1, `frame ${frame.phase}@${frame.presentationIndex} owners=${owners}`);
    }
  });
});
