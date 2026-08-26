import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  buildRoundPresentationActors,
  decideLiveRoundPresentation,
  idlePresentation,
  incrementalDecorativeRevealArrivalOrder,
  isIncrementalCanonicalActionPhase,
  isLiveRoundPresentationReady,
  isLiveRoundPresentationStarting,
  isSequentialActionRevealPending,
  mergeIncrementalCanonicalPinIds,
  resolveActivePresentationActorId,
  resolveLiveRevealedActionIds,
  resolveSequentialActionRevealQueue,
  revealedActorIds,
  shouldDecorativeRevealAction,
  shouldHoldDecorativeRevealAction,
  startCinematicPresentation,
  trpgRoundPresentationSessionKey,
  type LiveRoundSnapshotInput,
} from "./roundPresentation";
import { resolveTrpgRevealVisibleCount } from "./revealTiming";
import { trpgLogRevealKeys } from "../../app/trpg/useRevealedText";

const order = [10, 20, 30];
const human = {
  participantId: 10,
  name: "유저",
  kind: "human" as const,
  body: "문을 연다.",
  revealed: true,
  actionType: "free" as const,
};
const bot1 = {
  participantId: 20,
  name: "동료1",
  kind: "ai_character" as const,
  body: "뒤를 본다.",
  revealed: true,
  actionType: "talk" as const,
};
const bot2 = {
  participantId: 30,
  name: "동료2",
  kind: "ai_character" as const,
  body: "조용히 움직인다.",
  revealed: true,
  actionType: "talk" as const,
};

describe("TRPG sequential action reveal (#628 owner extended for #646)", () => {
  const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");

  it("room extends the single actor reveal owner — no second queue module", () => {
    assert.match(room, /resolveSequentialActionRevealQueue/);
    assert.match(room, /resolveActivePresentationActorId/);
    assert.match(room, /sequentialRevealCompletedRef/);
    assert.match(room, /mergeActorRevealReport/);
    assert.match(room, /shouldDecorativeRevealAction/);
    assert.match(room, /stickySequentialRevealActorRef/);
    assert.match(room, /mergeIncrementalCanonicalPinIds/);
    assert.match(room, /incrementalDecorativeRevealArrivalOrder/);
    assert.doesNotMatch(room, /secondRevealQueue/);
  });

  it("T_SEQ_1: bot2 persists while bot1 progressive — only bot1 reveals, then bot2 starts", () => {
    const fresh = new Set<string>(["a:4:20", "a:4:30"]);
    let completed: number[] = [];
    let sticky: number | null = null;
    let report: {
      roundNumber: number;
      participantId: number;
      complete: boolean;
      progressive: boolean;
    } | null = null;

    const step = (botActions: typeof bot1[], phase: string) => {
      const snap: LiveRoundSnapshotInput = {
        phase,
        roundNumber: 4,
        actions: [human, ...botActions],
        rolls: [],
        resolutionOrder: order,
      };
      const persistedActions = snap.actions.filter((a) => a.revealed && a.body.trim());
      const input = {
        arrivalOrder: incrementalDecorativeRevealArrivalOrder(persistedActions),
        actions: persistedActions,
        completedRevealActorIds: completed,
        stickyActiveRevealActorId: sticky,
        isFreshAiAction: (id: number) => fresh.has(`a:4:${id}`),
        skipDecorativeReveal: false,
      };
      const queue = resolveSequentialActionRevealQueue(input);
      if (queue.activeRevealActorId != null) sticky = queue.activeRevealActorId;
      const owners = snap.actions
        .filter((a) =>
          shouldDecorativeRevealAction({
            kind: a.kind,
            participantId: a.participantId,
            activeRevealActorId: queue.activeRevealActorId,
            isFresh: fresh.has(`a:4:${a.participantId}`),
            skipDecorativeReveal: false,
          })
        )
        .map((a) => a.participantId);
      const held = snap.actions
        .filter((a) =>
          shouldHoldDecorativeRevealAction({
            kind: a.kind,
            participantId: a.participantId,
            activeRevealActorId: queue.activeRevealActorId,
            isFresh: fresh.has(`a:4:${a.participantId}`),
            skipDecorativeReveal: false,
          })
        )
        .map((a) => a.participantId);
      return { queue, owners, held, snap };
    };

    const bot1Only = step([bot1], "BOT_ACTION");
    assert.equal(bot1Only.queue.activeRevealActorId, 20);
    assert.deepEqual(bot1Only.owners, [20]);
    assert.deepEqual(bot1Only.held, []);

    const bothBots = step([bot1, bot2], "BOT_ACTION");
    assert.equal(bothBots.queue.activeRevealActorId, 20, "AI2_REVEAL_DOES_NOT_START_WHILE_AI1_PROGRESSIVE");
    assert.deepEqual(bothBots.queue.queuedRevealActorIds, [30]);
    assert.deepEqual(bothBots.owners, [20], "AT_MOST_ONE_AI_ACTION_DECORATIVE_REVEAL_ACTIVE");
    assert.deepEqual(bothBots.held, [30]);

    report = { roundNumber: 4, participantId: 20, complete: true, progressive: false };
    completed = [20];
    fresh.delete("a:4:20");
    sticky = null;

    const afterBot1 = step([bot1, bot2], "BOT_ACTION");
    assert.equal(afterBot1.queue.activeRevealActorId, 30);
    assert.deepEqual(afterBot1.owners, [30]);
    assert.deepEqual(afterBot1.held, []);
    assert.equal(completed.includes(20), true, "NO_AI_ACTION_REPLAY");
    assert.equal(report.participantId, 20);
  });

  it("T_SEQ_2: ROLLING while bot1 progressive — sequential owner blocks dice handoff until queue drains", () => {
    const fresh = new Set(["a:4:20", "a:4:30"]);
    const completed: number[] = [];
    const snapBotAction: LiveRoundSnapshotInput = {
      phase: "BOT_ACTION",
      roundNumber: 4,
      actions: [human, bot1, bot2],
      rolls: [],
      resolutionOrder: order,
    };
    const snapRolling: LiveRoundSnapshotInput = {
      phase: "ROLLING",
      roundNumber: 4,
      actions: [human, bot1, bot2],
      rolls: [
        { participantId: 10, name: "유저", d20: 14, dc: 12, tier: "SUCCESS", statKey: "dex", finalScore: 16, success: true, actionBody: "", actionType: "free", kind: "human" },
        { participantId: 20, name: "동료1", d20: 8, dc: 12, tier: "FAILURE", statKey: "dex", finalScore: 10, success: false, actionBody: "", actionType: "talk", kind: "ai_character" },
        { participantId: 30, name: "동료2", d20: 17, dc: 12, tier: "SUCCESS", statKey: "dex", finalScore: 19, success: true, actionBody: "", actionType: "talk", kind: "ai_character" },
      ],
      resolutionOrder: order,
    };

    const actions = snapBotAction.actions.filter((a) => a.revealed && a.body.trim());
    const inputPartial = {
      arrivalOrder: incrementalDecorativeRevealArrivalOrder(actions),
      actions,
      completedRevealActorIds: completed,
      stickyActiveRevealActorId: null,
      isFreshAiAction: (id: number) => fresh.has(`a:4:${id}`),
      skipDecorativeReveal: false,
    };
    const queuePartial = resolveSequentialActionRevealQueue(inputPartial);
    assert.equal(queuePartial.activeRevealActorId, 20);

    const rollingReady = decideLiveRoundPresentation(snapRolling);
    assert.equal(rollingReady.ready, true, "rolls persisted independently of UI reveal");

    const inputRolling = { ...inputPartial, actions: snapRolling.actions.filter((a) => a.revealed && a.body.trim()) };
    const queueRolling = resolveSequentialActionRevealQueue(inputRolling);
    assert.equal(queueRolling.activeRevealActorId, 20, "PARTIAL_ACTION_REVEAL_DOES_NOT_START_DICE_CINEMATIC");
    assert.deepEqual(queueRolling.queuedRevealActorIds, [30]);

    fresh.delete("a:4:20");
    completed.push(20);
    const afterBot1 = resolveSequentialActionRevealQueue({
      ...inputRolling,
      completedRevealActorIds: completed,
      isFreshAiAction: (id: number) => fresh.has(`a:4:${id}`),
    });
    assert.equal(afterBot1.activeRevealActorId, 30);

    fresh.delete("a:4:30");
    completed.push(30);
    const drained = resolveSequentialActionRevealQueue({
      ...inputRolling,
      completedRevealActorIds: completed,
      isFreshAiAction: (id: number) => fresh.has(`a:4:${id}`),
    });
    assert.equal(drained.activeRevealActorId, null);
    assert.equal(isSequentialActionRevealPending({ ...inputRolling, completedRevealActorIds: completed, isFreshAiAction: () => false }), false);

    const actors = buildRoundPresentationActors({
      resolutionOrder: order,
      actions: snapRolling.actions.filter((a) => a.revealed && a.body.trim()),
      rolls: snapRolling.rolls ?? [],
    });
    assert.equal(actors.length, 3, "FINAL_DICE_ORDER_FOLLOWS_RESOLUTION_ORDER");
    assert.equal(startCinematicPresentation().phase, "actor-action");
  });

  it("T_SEQ_2A: ROLLING first idle render keeps sequential owner — no full-text flash", () => {
    const fresh = new Set(["a:4:20", "a:4:30"]);
    const completed: number[] = [];
    const actions = [human, bot1, bot2].filter((a) => a.revealed && a.body.trim());
    const rolls = [
      {
        participantId: 10,
        name: "유저",
        d20: 14,
        dc: 12,
        tier: "SUCCESS" as const,
        statKey: "dex",
        finalScore: 16,
        success: true,
        actionBody: "",
        actionType: "free" as const,
        kind: "human" as const,
      },
      {
        participantId: 20,
        name: "동료1",
        d20: 8,
        dc: 12,
        tier: "FAILURE" as const,
        statKey: "dex",
        finalScore: 10,
        success: false,
        actionBody: "",
        actionType: "talk" as const,
        kind: "ai_character" as const,
      },
      {
        participantId: 30,
        name: "동료2",
        d20: 17,
        dc: 12,
        tier: "SUCCESS" as const,
        statKey: "dex",
        finalScore: 19,
        success: true,
        actionBody: "",
        actionType: "talk" as const,
        kind: "ai_character" as const,
      },
    ];

    const sequentialInput = {
      arrivalOrder: incrementalDecorativeRevealArrivalOrder(actions),
      actions,
      completedRevealActorIds: completed,
      stickyActiveRevealActorId: 20,
      isFreshAiAction: (id: number) => fresh.has(`a:4:${id}`),
      skipDecorativeReveal: false,
    };
    const queue = resolveSequentialActionRevealQueue(sequentialInput);
    assert.equal(isSequentialActionRevealPending(sequentialInput), true);
    assert.equal(queue.activeRevealActorId, 20);

    const liveReady = isLiveRoundPresentationReady({
      phase: "ROLLING",
      hasLockedActorSet: actions.length > 0 || rolls.length > 0,
    });
    assert.equal(liveReady, true);
    assert.equal(
      !liveReady && isIncrementalCanonicalActionPhase("BOT_ACTION") && actions.length > 0,
      false
    );

    const roundShow = idlePresentation();
    assert.equal(roundShow.mode, "idle");
    const rollSessionKey = trpgRoundPresentationSessionKey({
      roundNumber: 4,
      rolls,
      actions,
      ready: liveReady,
    });
    assert.notEqual(rollSessionKey, "");
    assert.equal(
      trpgRoundPresentationSessionKey({
        roundNumber: 4,
        rolls: [],
        actions,
        ready: false,
      }),
      ""
    );
    assert.equal(
      isLiveRoundPresentationStarting({
        liveReady,
        mode: roundShow.mode,
        queueSessionKey: rollSessionKey,
      }),
      true
    );

    const activeId = resolveActivePresentationActorId({
      sequentialActionRevealPending: true,
      sequentialActiveRevealActorId: queue.activeRevealActorId,
      cinematicActiveActorId: null,
    });
    assert.equal(activeId, 20, "ACTIVE_REVEAL_ACTOR=bot1");
    assert.equal(
      shouldDecorativeRevealAction({
        kind: bot1.kind,
        participantId: bot1.participantId,
        activeRevealActorId: activeId,
        isFresh: fresh.has("a:4:20"),
        skipDecorativeReveal: false,
      }),
      true,
      "BOT1_REVEAL_ACTIVE=true"
    );
    assert.equal(
      shouldHoldDecorativeRevealAction({
        kind: bot2.kind,
        participantId: bot2.participantId,
        activeRevealActorId: activeId,
        isFresh: fresh.has("a:4:30"),
        skipDecorativeReveal: false,
      }),
      true,
      "BOT2_REVEAL_HELD=true"
    );
    assert.equal(
      resolveTrpgRevealVisibleCount({
        previousSession: { text: bot2.body, active: false, kind: "bot" },
        nextSession: { text: bot2.body, active: false, kind: "bot" },
        storedCount: 0,
        finishOwned: false,
        reducedMotion: false,
        held: true,
      }),
      0,
      "BOT2_VISIBLE_COUNT=0"
    );

    const cinematicRoundShow = { mode: "cinematic" as const, ...startCinematicPresentation() };
    const activeAfterCinematic = resolveActivePresentationActorId({
      sequentialActionRevealPending: true,
      sequentialActiveRevealActorId: queue.activeRevealActorId,
      cinematicActiveActorId: order[cinematicRoundShow.presentationIndex] ?? null,
    });
    assert.equal(activeAfterCinematic, 20, "NO_FULL_TEXT_FLASH_ON_ROLLING_TRANSITION");

    fresh.delete("a:4:20");
    completed.push(20);
    const afterBot1 = resolveSequentialActionRevealQueue({
      ...sequentialInput,
      completedRevealActorIds: completed,
      isFreshAiAction: (id: number) => fresh.has(`a:4:${id}`),
    });
    assert.equal(afterBot1.activeRevealActorId, 30);
    assert.equal(
      resolveTrpgRevealVisibleCount({
        previousSession: { text: bot2.body, active: false, kind: "bot" },
        nextSession: { text: bot2.body, active: true, kind: "bot" },
        storedCount: 0,
        finishOwned: false,
        reducedMotion: false,
        held: false,
      }),
      0
    );
    assert.equal(fresh.has("a:4:20"), false, "NO_AI_ACTION_REPLAY");
  });

  it("revealHeld contract: held hides text; release starts progressive reveal from 0", () => {
    const text = "조용히 움직인다.";
    assert.equal(
      resolveTrpgRevealVisibleCount({
        previousSession: { text: "", active: false, kind: "bot" },
        nextSession: { text, active: false, kind: "bot" },
        storedCount: 0,
        finishOwned: false,
        reducedMotion: false,
        held: true,
      }),
      0
    );
    const released = resolveTrpgRevealVisibleCount({
      previousSession: { text, active: false, kind: "bot" },
      nextSession: { text, active: true, kind: "bot" },
      storedCount: 0,
      finishOwned: false,
      reducedMotion: false,
      held: false,
    });
    assert.equal(released, 0);
    assert.notEqual(released, Array.from(text).length);
  });

  it("T_SEQ_3: bot1 completes before bot2 persistence — bot2 starts immediately when available", () => {
    const fresh = new Set(["a:4:20"]);
    const completed = [20];
    fresh.delete("a:4:20");

    const beforeBot2 = resolveSequentialActionRevealQueue({
      arrivalOrder: incrementalDecorativeRevealArrivalOrder([human, bot1]),
      actions: [human, bot1].filter((a) => a.revealed && a.body.trim()),
      completedRevealActorIds: completed,
      isFreshAiAction: (id) => fresh.has(`a:4:${id}`),
      skipDecorativeReveal: false,
    });
    assert.equal(beforeBot2.activeRevealActorId, null);

    fresh.add("a:4:30");
    const afterBot2 = resolveSequentialActionRevealQueue({
      arrivalOrder: incrementalDecorativeRevealArrivalOrder([human, bot1, bot2]),
      actions: [human, bot1, bot2].filter((a) => a.revealed && a.body.trim()),
      completedRevealActorIds: completed,
      isFreshAiAction: (id) => fresh.has(`a:4:${id}`),
      skipDecorativeReveal: false,
    });
    assert.equal(afterBot2.activeRevealActorId, 30, "AI2_REVEAL_STARTS_WHEN_ELIGIBLE");
    assert.deepEqual(afterBot2.queuedRevealActorIds, []);
  });

  it("T_SEQ_4: refresh/re-entry consumes mount keys — no decorative replay", () => {
    const log = [
      {
        roundNumber: 4,
        narration: null as string | null,
        actions: [human, bot1, bot2],
      },
    ];
    const seen = new Set(trpgLogRevealKeys(log));
    assert.equal(seen.has("a:4:20"), true);
    assert.equal(seen.has("a:4:30"), true);

    const queue = resolveSequentialActionRevealQueue({
      arrivalOrder: incrementalDecorativeRevealArrivalOrder([human, bot1, bot2]),
      actions: [human, bot1, bot2],
      completedRevealActorIds: [],
      isFreshAiAction: (id) => !seen.has(`a:4:${id}`),
      skipDecorativeReveal: false,
    });
    assert.equal(queue.activeRevealActorId, null, "NO_AI_ACTION_REPLAY");
    assert.deepEqual(queue.queuedRevealActorIds, []);
  });

  it("T_SEQ_0_FIRST_ROUND_NO_RESOLUTION_ORDER: empty resolutionOrder still reveals first persisted bot", () => {
    const fresh = new Set(["a:1:20", "a:1:30"]);
    const actions = [human, bot1].filter((a) => a.revealed && a.body.trim());
    const input = {
      arrivalOrder: incrementalDecorativeRevealArrivalOrder(actions),
      actions,
      completedRevealActorIds: [],
      stickyActiveRevealActorId: null,
      isFreshAiAction: (id: number) => fresh.has(`a:1:${id}`),
      skipDecorativeReveal: false,
    };
    const queue = resolveSequentialActionRevealQueue(input);
    assert.equal(queue.activeRevealActorId, 20, "FIRST_ROUND_EMPTY_RESOLUTION_ORDER_SAFE");
    assert.equal(
      shouldDecorativeRevealAction({
        kind: bot1.kind,
        participantId: 20,
        activeRevealActorId: queue.activeRevealActorId,
        isFresh: true,
        skipDecorativeReveal: false,
      }),
      true
    );

    const bothActions = [human, bot1, bot2].filter((a) => a.revealed && a.body.trim());
    const withBot2 = resolveSequentialActionRevealQueue({
      arrivalOrder: incrementalDecorativeRevealArrivalOrder(bothActions),
      actions: bothActions,
      completedRevealActorIds: [],
      stickyActiveRevealActorId: 20,
      isFreshAiAction: (id: number) => fresh.has(`a:1:${id}`),
      skipDecorativeReveal: false,
    });
    assert.equal(withBot2.activeRevealActorId, 20);
    assert.equal(
      shouldHoldDecorativeRevealAction({
        kind: bot2.kind,
        participantId: 30,
        activeRevealActorId: withBot2.activeRevealActorId,
        isFresh: true,
        skipDecorativeReveal: false,
      }),
      true
    );
    assert.equal(
      resolveTrpgRevealVisibleCount({
        previousSession: { text: bot2.body, active: false, kind: "bot" },
        nextSession: { text: bot2.body, active: false, kind: "bot" },
        storedCount: 0,
        finishOwned: false,
        reducedMotion: false,
        held: true,
      }),
      0
    );
  });

  it("T_SEQ_GENERATION_ORDER_DIFFERS_FROM_RESOLUTION_ORDER: arrival order wins over resolutionOrder", () => {
    const fresh = new Set(["a:4:20", "a:4:30"]);
    let sticky: number | null = null;
    const completed: number[] = [];

    const step1Actions = [human, bot2].filter((a) => a.revealed && a.body.trim());
    const step1 = resolveSequentialActionRevealQueue({
      arrivalOrder: incrementalDecorativeRevealArrivalOrder(step1Actions),
      actions: step1Actions,
      completedRevealActorIds: completed,
      stickyActiveRevealActorId: sticky,
      isFreshAiAction: (id) => fresh.has(`a:4:${id}`),
      skipDecorativeReveal: false,
    });
    assert.equal(step1.activeRevealActorId, 30, "bot2 first by generation/persistence order");
    sticky = step1.activeRevealActorId;

    const step2Actions = [human, bot2, bot1].filter((a) => a.revealed && a.body.trim());
    const step2 = resolveSequentialActionRevealQueue({
      arrivalOrder: incrementalDecorativeRevealArrivalOrder(step2Actions),
      actions: step2Actions,
      completedRevealActorIds: completed,
      stickyActiveRevealActorId: sticky,
      isFreshAiAction: (id) => fresh.has(`a:4:${id}`),
      skipDecorativeReveal: false,
    });
    assert.equal(step2.activeRevealActorId, 30, "ACTIVE_DECORATIVE_REVEAL_IS_STICKY_UNTIL_COMPLETE");
    assert.equal(
      shouldHoldDecorativeRevealAction({
        kind: bot1.kind,
        participantId: 20,
        activeRevealActorId: step2.activeRevealActorId,
        isFresh: true,
        skipDecorativeReveal: false,
      }),
      true
    );
    assert.equal(
      resolveTrpgRevealVisibleCount({
        previousSession: { text: bot1.body, active: false, kind: "bot" },
        nextSession: { text: bot1.body, active: false, kind: "bot" },
        storedCount: 0,
        finishOwned: false,
        reducedMotion: false,
        held: true,
      }),
      0
    );

    fresh.delete("a:4:30");
    completed.push(30);
    sticky = null;
    const afterBot2 = resolveSequentialActionRevealQueue({
      arrivalOrder: incrementalDecorativeRevealArrivalOrder(step2Actions),
      actions: step2Actions,
      completedRevealActorIds: completed,
      stickyActiveRevealActorId: sticky,
      isFreshAiAction: (id) => fresh.has(`a:4:${id}`),
      skipDecorativeReveal: false,
    });
    assert.equal(afterBot2.activeRevealActorId, 20);
    assert.equal(
      resolveTrpgRevealVisibleCount({
        previousSession: { text: bot1.body, active: false, kind: "bot" },
        nextSession: { text: bot1.body, active: true, kind: "bot" },
        storedCount: 0,
        finishOwned: false,
        reducedMotion: false,
        held: false,
      }),
      0
    );

    const diceActors = buildRoundPresentationActors({
      resolutionOrder: order,
      actions: step2Actions,
      rolls: [],
    });
    assert.deepEqual(
      diceActors.map((a) => a.actorId),
      order,
      "FINAL_DICE_ORDER_FOLLOWS_RESOLUTION_ORDER"
    );
  });

  it("T_SEQ_ACTIVE_OWNER_CANNOT_BE_PREEMPTED: resolutionOrder change does not steal active stream", () => {
    const fresh = new Set(["a:4:20", "a:4:30"]);
    const actions = [human, bot2, bot1].filter((a) => a.revealed && a.body.trim());
    const sticky = 30;

    const wrongResolutionFirst = resolveSequentialActionRevealQueue({
      arrivalOrder: incrementalDecorativeRevealArrivalOrder(actions),
      actions,
      completedRevealActorIds: [],
      stickyActiveRevealActorId: sticky,
      isFreshAiAction: (id) => fresh.has(`a:4:${id}`),
      skipDecorativeReveal: false,
    });
    assert.equal(wrongResolutionFirst.activeRevealActorId, 30, "NO_ACTIVE_STREAM_PREEMPTION");

    const rollingFrame = resolveActivePresentationActorId({
      sequentialActionRevealPending: true,
      sequentialActiveRevealActorId: wrongResolutionFirst.activeRevealActorId,
      cinematicActiveActorId: 20,
    });
    assert.equal(rollingFrame, 30, "ROLLING transition cannot replace active owner");
  });

  it("T_SEQ_FIRST_ROUND_PIN_SURVIVES_ROLLING: empty resolutionOrder pins survive ROLLING idle render", () => {
    const fresh = new Set(["a:1:20", "a:1:30"]);
    const generationOrderActions = [human, bot2, bot1];
    const persistedActions = generationOrderActions.filter((a) => a.revealed && a.body.trim());
    const resolutionOrder = order;
    let pinnedIds: number[] = [];
    let pinnedRound: number | null = null;
    let sticky: number | null = null;
    const completed: number[] = [];

    const syncPins = (roundNumber: number, actions: typeof generationOrderActions, incremental: boolean) => {
      if (pinnedRound !== roundNumber) {
        pinnedRound = roundNumber;
        pinnedIds = [];
      }
      if (incremental) {
        pinnedIds = mergeIncrementalCanonicalPinIds(pinnedIds, actions);
      }
    };

    const queueInput = (actions: typeof persistedActions) => ({
      arrivalOrder: incrementalDecorativeRevealArrivalOrder(actions),
      actions,
      completedRevealActorIds: completed,
      stickyActiveRevealActorId: sticky,
      isFreshAiAction: (id: number) => fresh.has(`a:1:${id}`),
      skipDecorativeReveal: false,
    });

    syncPins(1, generationOrderActions, true);
    const botActionQueue = resolveSequentialActionRevealQueue(queueInput(persistedActions));
    if (botActionQueue.activeRevealActorId != null) sticky = botActionQueue.activeRevealActorId;

    assert.deepEqual(
      pinnedIds,
      [10, 30, 20],
      "ALL_INCREMENTALLY_VISIBLE_CANONICAL_ACTIONS_REMAIN_PINNED"
    );
    assert.equal(botActionQueue.activeRevealActorId, 30, "sticky active=bot2");
    assert.equal(
      shouldHoldDecorativeRevealAction({
        kind: bot1.kind,
        participantId: 20,
        activeRevealActorId: botActionQueue.activeRevealActorId,
        isFresh: true,
        skipDecorativeReveal: false,
      }),
      true,
      "bot1 held"
    );

    const rolls = [
      {
        participantId: 10,
        name: "유저",
        d20: 14,
        dc: 12,
        tier: "SUCCESS" as const,
        statKey: "dex",
        finalScore: 16,
        success: true,
        actionBody: "",
        actionType: "free" as const,
        kind: "human" as const,
      },
      {
        participantId: 20,
        name: "동료1",
        d20: 8,
        dc: 12,
        tier: "FAILURE" as const,
        statKey: "dex",
        finalScore: 10,
        success: false,
        actionBody: "",
        actionType: "talk" as const,
        kind: "ai_character" as const,
      },
      {
        participantId: 30,
        name: "동료2",
        d20: 17,
        dc: 12,
        tier: "SUCCESS" as const,
        statKey: "dex",
        finalScore: 19,
        success: true,
        actionBody: "",
        actionType: "talk" as const,
        kind: "ai_character" as const,
      },
    ];
    const liveReady = isLiveRoundPresentationReady({
      phase: "ROLLING",
      hasLockedActorSet: persistedActions.length > 0 || rolls.length > 0,
    });
    assert.equal(liveReady, true);

    const roundShowIdle = idlePresentation();
    assert.equal(roundShowIdle.mode, "idle", "roundShow still idle on first ROLLING render");

    syncPins(1, generationOrderActions, false);
    assert.deepEqual(pinnedIds, [10, 30, 20], "pins unchanged when not incremental");

    const actors = buildRoundPresentationActors({
      resolutionOrder,
      actions: persistedActions,
      rolls,
    });
    const cinematicRevealedAtIdle = revealedActorIds({
      actors,
      state: roundShowIdle,
      pinnedVisibleActorIds: pinnedIds,
    });
    const resolvedAtIdle = resolveLiveRevealedActionIds({
      isLiveRow: true,
      mode: roundShowIdle.mode,
      cinematicRevealedIds: cinematicRevealedAtIdle,
      incrementalCanonicalVisible: false,
      pinnedVisibleActorIds: pinnedIds,
    });
    assert.notDeepEqual(resolvedAtIdle, [], "NO_ACTION_CARD_DISAPPEAR_ON_ROLLING");
    assert.deepEqual(resolvedAtIdle, [10, 30, 20]);

    const rollingQueue = resolveSequentialActionRevealQueue(queueInput(persistedActions));
    assert.equal(rollingQueue.activeRevealActorId, 30, "active bot2 remains mounted");
    assert.equal(
      shouldHoldDecorativeRevealAction({
        kind: bot1.kind,
        participantId: 20,
        activeRevealActorId: rollingQueue.activeRevealActorId,
        isFresh: true,
        skipDecorativeReveal: false,
      }),
      true,
      "bot1 remains held"
    );

    const cinematicRoundShow = { mode: "cinematic" as const, ...startCinematicPresentation() };
    const activeAfterCinematic = resolveActivePresentationActorId({
      sequentialActionRevealPending: true,
      sequentialActiveRevealActorId: rollingQueue.activeRevealActorId,
      cinematicActiveActorId: resolutionOrder[cinematicRoundShow.presentationIndex] ?? null,
    });
    assert.equal(activeAfterCinematic, 30, "NO_ACTIVE_CARD_DISAPPEAR");
    assert.equal(
      shouldDecorativeRevealAction({
        kind: bot2.kind,
        participantId: 30,
        activeRevealActorId: activeAfterCinematic,
        isFresh: fresh.has("a:1:30"),
        skipDecorativeReveal: false,
      }),
      true,
      "NO_ACTIVE_STREAM_RESET"
    );

    const cinematicRevealed = revealedActorIds({
      actors,
      state: cinematicRoundShow,
      pinnedVisibleActorIds: pinnedIds,
    });
    assert.ok(cinematicRevealed.includes(30), "bot2 still mounted at cinematic start");
    assert.ok(cinematicRevealed.includes(20), "bot1 still mounted at cinematic start");

    fresh.delete("a:1:30");
    completed.push(30);
    sticky = null;
    const afterBot2 = resolveSequentialActionRevealQueue({
      ...queueInput(persistedActions),
      completedRevealActorIds: completed,
      stickyActiveRevealActorId: sticky,
      isFreshAiAction: (id: number) => fresh.has(`a:1:${id}`),
    });
    assert.equal(afterBot2.activeRevealActorId, 20, "bot1 starts after bot2 complete");

    assert.deepEqual(
      actors.map((a) => a.actorId),
      resolutionOrder,
      "FINAL_DICE_ORDER_FOLLOWS_RESOLUTION_ORDER"
    );

    const pinnedRoundRef = { current: 1 as number | null };
    const pinnedIdsRef = { current: [...pinnedIds] };
    pinnedRoundRef.current = 2;
    pinnedIdsRef.current = [];
    assert.deepEqual(pinnedIdsRef.current, [], "PREVIOUS_ROUND_PINS_CANNOT_LEAK");
  });
});
