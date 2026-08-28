import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { buildTrpgBotActionUserBlock } from "./botActions";
import {
  advanceTrpgCampaign,
  startTrpgCampaign,
  submitTrpgAction,
  type TrpgEngineDeps,
} from "./engineAdvance";
import { loadTrpgSnapshot } from "./engineSnapshot";
import {
  EVEN_STATS,
  createTrpgCampaign,
  saveTrpgSheet,
  writeSheet,
} from "./engineCreate";
import { insertParticipant, loadLatestRound } from "./store";
import { ensureTrpgTables } from "./schema";
import {
  adjudicateCanonicalSubmission,
  ensureRoundAdjudicationContext,
  isSubmissionAdjudicated,
  loadAdjudicatedParticipantIds,
} from "./roundAdjudication";
import {
  isLiveRoundPresentationReady,
  isActorPresentationReady,
  buildRoundPresentationActors,
  advanceAfterActorAction,
  advanceAfterActorResult,
  advanceAfterDiceDismiss,
  startCinematicPresentation,
  historicalPresentation,
  shouldShowGmNarration,
  trpgRoundPresentationSessionKey,
  isRoundPresentationAwaitingMoreActors,
  simulateCinematicQueueSession,
  walkCinematicPresentation,
  type LiveRoundSnapshotInput,
} from "./roundPresentation";
import { nextTrpgRoundWork } from "./roundLock";
import { shouldConsumeMountRollSession } from "./diceRollUx";
import { TRPG_RESULT_HOLD_MS } from "./diceRollUx";

function gmText(narration = "장면"): string {
  return `<<<NARRATION>>>\n${narration}\n<<<DELTA>>>\n${JSON.stringify({
    players: [],
    location: "문턱",
    next_round_context: "다음",
    questsAdd: [],
    flagsAdd: [],
    campaign_finished: false,
  })}`;
}

function memoryDb(): Database.Database {
  const db = new Database(":memory:");
  ensureTrpgTables(db);
  return db;
}

async function setupTwoBotCampaign(db: Database.Database, deps: TrpgEngineDeps) {
  const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1 });
  saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
  const bot1 = insertParticipant(db, {
    campaignId,
    slotIndex: 1,
    kind: "ai_character",
    userId: null,
    characterId: null,
    displayName: "동료1",
  });
  const bot2 = insertParticipant(db, {
    campaignId,
    slotIndex: 2,
    kind: "ai_character",
    userId: null,
    characterId: null,
    displayName: "동료2",
  });
  writeSheet(db, campaignId, bot1, "동료1", EVEN_STATS, "");
  writeSheet(db, campaignId, bot2, "동료2", EVEN_STATS, "");
  await startTrpgCampaign(db, { campaignId, userId: 1, deps });
  return { campaignId, bot1, bot2 };
}

describe("TRPG latency-hiding adjudication pipeline", () => {
  it("exposes resolution order and adjudicated participants after incremental advance", async () => {
    const db = memoryDb();
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      rollD20: () => 17,
      gmCall: async () => ({ text: gmText() }),
      botCall: async () => ({
        text: "동료1은 앞을 본다.\n\n<<<INTENT>>>\n앞을 본다.\n\n<<<ACTION_TYPE>>>\ninvestigate",
      }),
    };
    const { campaignId } = await setupTwoBotCampaign(db, deps);
    submitTrpgAction(db, { campaignId, userId: 1, body: "문을 연다.", actionType: "investigate" });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    const round1 = db
      .prepare(`SELECT id, input_snapshot_json FROM trpg_rounds WHERE campaign_id=? AND round_number=1`)
      .get(campaignId) as { id: number; input_snapshot_json: string };
    assert.ok(loadAdjudicatedParticipantIds(db, round1.id).length >= 1);
    assert.match(round1.input_snapshot_json, /resolutionOrder/);
    db.close();
  });

  it("reuses persisted human d20 on duplicate advance (exactly-once)", async () => {
    const db = memoryDb();
    let rngCalls = 0;
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      rollD20: () => {
        rngCalls += 1;
        return 11;
      },
      gmCall: async () => ({ text: gmText() }),
      botCall: async (_s, _u) => ({
        text: "동료1은 움직인다.\n\n<<<INTENT>>>\n움직인다.\n\n<<<ACTION_TYPE>>>\ninvestigate",
      }),
    };
    const { campaignId } = await setupTwoBotCampaign(db, deps);
    submitTrpgAction(db, { campaignId, userId: 1, body: "조사한다.", actionType: "investigate" });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    const firstCount = rngCalls;
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(rngCalls, firstCount);
    const round1 = db
      .prepare(`SELECT id FROM trpg_rounds WHERE campaign_id=? AND round_number=1`)
      .get(campaignId) as { id: number };
    const humanRolls = db
      .prepare(
        `SELECT COUNT(*) AS n FROM trpg_dice_rolls r
         JOIN trpg_action_submissions s ON s.id = r.submission_id
         JOIN trpg_participants p ON p.id = s.participant_id
         WHERE r.round_id=? AND p.kind='human'`
      )
      .get(round1.id) as { n: number };
    assert.equal(humanRolls.n, 1);
    db.close();
  });

  it("BOT1 prompt contains human action but not human d20/result", () => {
    const humanBody = "문을 연다.";
    const user = buildTrpgBotActionUserBlock({
      characterName: "동료1",
      description: "desc",
      greeting: "hi",
      systemPrompt: "sys",
      previousGmNarration: "이전 장면",
      campaignMemory: "",
      humanActions: [{ playerName: "렌", text: humanBody }],
      companionActions: [],
    });
    assert.match(user, /문을 연다/);
    assert.doesNotMatch(user, /d20/i);
    assert.doesNotMatch(user, /CRITICAL_SUCCESS|CRITICAL_FAILURE|SUCCESS|FAILURE/);
    assert.doesNotMatch(user, /최종\s*\d+/);
  });

  it("BOT2 prompt contains bot1 action but not bot1 d20/tier", () => {
    const bot1Body = "동료1은 창문을 본다.\n\n<<<INTENT>>>\n창문을 본다.";
    const user = buildTrpgBotActionUserBlock({
      characterName: "동료2",
      description: "desc",
      greeting: "hi",
      systemPrompt: "sys",
      previousGmNarration: "이전 장면",
      campaignMemory: "",
      humanActions: [{ playerName: "렌", text: "문을 연다." }],
      companionActions: [{ name: "동료1", text: bot1Body }],
    });
    assert.match(user, /창문을 본다/);
    assert.match(user, /문을 연다/);
    assert.doesNotMatch(user, /d20\s*[:=]?\s*\d+/i);
    assert.doesNotMatch(user, /FAILURE|SUCCESS/);
  });

  it("marks no-roll adjudication without fabricating d20", () => {
    const db = memoryDb();
    const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1 });
    saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
    const roundId = db
      .prepare(`INSERT INTO trpg_rounds (campaign_id, round_number, phase) VALUES (?, 1, 'ACTION_INPUT')`)
      .run(campaignId).lastInsertRowid as number;
    const humanId = db
      .prepare(`SELECT id FROM trpg_participants WHERE campaign_id=? AND kind='human'`)
      .get(campaignId) as { id: number };
    const subId = db
      .prepare(
        `INSERT INTO trpg_action_submissions (round_id, participant_id, body, action_type, locked, source)
         VALUES (?, ?, ?, 'free', 1, 'human')`
      )
      .run(
        roundId,
        humanId.id,
        "안전가옥을 찾아볼까?? *모두를 향해 물어본다*"
      ).lastInsertRowid as number;
    const { pre } = ensureRoundAdjudicationContext(db, {
      campaignId,
      roundId,
      roundNumber: 1,
    });
    const outcome = adjudicateCanonicalSubmission(db, {
      campaignId,
      roundId,
      submissionId: subId,
      pre,
    });
    assert.equal(outcome, "no_roll");
    assert.equal(isSubmissionAdjudicated(db, roundId, subId), true);
    const rolls = db.prepare(`SELECT COUNT(*) AS n FROM trpg_dice_rolls WHERE round_id=?`).get(roundId) as {
      n: number;
    };
    assert.equal(rolls.n, 0);
    assert.deepEqual(loadAdjudicatedParticipantIds(db, roundId), [humanId.id]);
    db.close();
  });

  it("allows live presentation when first resolution actor is adjudicated during BOT_ACTION", () => {
    const order = [10, 20, 30];
    assert.equal(
      isLiveRoundPresentationReady({
        phase: "BOT_ACTION",
        hasLockedActorSet: true,
        resolutionOrder: order,
        adjudicatedParticipantIds: [10],
      }),
      true
    );
    assert.equal(
      isLiveRoundPresentationReady({
        phase: "BOT_ACTION",
        hasLockedActorSet: true,
        resolutionOrder: [20, 10, 30],
        adjudicatedParticipantIds: [10],
      }),
      false
    );
  });

  it("blocks bot dice until declaration is consumed even when roll exists", () => {
    const actors = buildRoundPresentationActors({
      resolutionOrder: [20],
      actions: [
        {
          participantId: 20,
          name: "동료1",
          body: "앞을 본다.",
          revealed: true,
          kind: "ai_character",
          actionType: "investigate",
        },
      ],
      rolls: [
        {
          participantId: 20,
          name: "동료1",
          d20: 14,
          statKey: "dex",
          finalScore: 16,
          dc: 12,
          tier: "SUCCESS",
          success: true,
          actionBody: "앞을 본다.",
          actionType: "investigate",
          kind: "ai_character",
        },
      ],
    });
    assert.equal(
      isActorPresentationReady({
        actor: actors[0],
        adjudicatedParticipantIds: new Set([20]),
        declarationConsumedIds: new Set(),
      }),
      false
    );
    assert.equal(
      isActorPresentationReady({
        actor: actors[0],
        adjudicatedParticipantIds: new Set([20]),
        declarationConsumedIds: new Set([20]),
      }),
      true
    );
  });
});

function botAction(id: number, name: string, body = "행동.") {
  return {
    participantId: id,
    name,
    body,
    revealed: true,
    kind: "ai_character" as const,
    actionType: "investigate",
  };
}

function humanAction(id: number, name: string, body = "문을 연다.") {
  return {
    participantId: id,
    name,
    body,
    revealed: true,
    kind: "human" as const,
    actionType: "investigate",
  };
}

function botRoll(id: number, name: string, d20: number) {
  return {
    participantId: id,
    name,
    d20,
    statKey: "dex",
    finalScore: d20 + 2,
    dc: 12,
    tier: "SUCCESS" as const,
    success: true,
    actionBody: "행동.",
    actionType: "investigate",
    kind: "ai_character" as const,
  };
}

function humanRoll(id: number, name: string, d20: number) {
  return { ...botRoll(id, name, d20), kind: "human" as const };
}

function deriveDeclarationConsumedIds(
  roundNumber: number,
  actions: readonly { participantId: number; kind: string }[],
  seenKeys: ReadonlySet<string>
): Set<number> {
  return new Set(
    actions
      .filter(
        (action) =>
          action.kind === "ai_character" &&
          seenKeys.has(`a:${roundNumber}:${action.participantId}`)
      )
      .map((action) => action.participantId)
  );
}

describe("TRPG PR-C final correction regressions", () => {
  const order = [10, 20, 30];
  const human = humanAction(10, "렌");
  const bot1 = botAction(20, "동료1");
  const bot2 = botAction(30, "동료2");

  it("DECLARATION_EPOCH_RECOMPUTES_CONSUMED_IDS", () => {
    const actions = [bot1];
    const seen = new Set<string>();
    let epoch = 0;
    const consume = () => {
      seen.add(`a:1:20`);
      epoch += 1;
    };
    const consumedAtEpoch0 = deriveDeclarationConsumedIds(1, actions, seen);
    assert.equal(consumedAtEpoch0.has(20), false);
    consume();
    const consumedAtEpoch1 = deriveDeclarationConsumedIds(1, actions, seen);
    assert.equal(epoch, 1);
    assert.equal(consumedAtEpoch1.has(20), true);
    assert.equal(
      isActorPresentationReady({
        actor: buildRoundPresentationActors({
          resolutionOrder: [20],
          actions: [bot1],
          rolls: [botRoll(20, "동료1", 14)],
        })[0]!,
        adjudicatedParticipantIds: new Set([20]),
        declarationConsumedIds: consumedAtEpoch0,
      }),
      false
    );
    assert.equal(
      isActorPresentationReady({
        actor: buildRoundPresentationActors({
          resolutionOrder: [20],
          actions: [bot1],
          rolls: [botRoll(20, "동료1", 14)],
        })[0]!,
        adjudicatedParticipantIds: new Set([20]),
        declarationConsumedIds: consumedAtEpoch1,
      }),
      true
    );
  });

  it("ACTION_EXISTS_ADJUDICATION_PENDING_WAITS", () => {
    const actors = buildRoundPresentationActors({
      resolutionOrder: [20],
      actions: [bot1],
      rolls: [],
    });
    const next = advanceAfterActorAction({
      actors,
      presentationIndex: 0,
      adjudicatedParticipantIds: new Set(),
      declarationConsumedIds: new Set([20]),
    });
    assert.deepEqual(next, { phase: "actor-action", presentationIndex: 0 });
  });

  it("CONFIRMED_NO_ROLL_ADVANCES_WITHOUT_DIE", () => {
    const actors = buildRoundPresentationActors({
      resolutionOrder: [20, 30],
      actions: [bot1, bot2],
      rolls: [botRoll(30, "동료2", 11)],
    });
    const next = advanceAfterActorAction({
      actors,
      presentationIndex: 0,
      adjudicatedParticipantIds: new Set([20, 30]),
      declarationConsumedIds: new Set([20, 30]),
      awaitingMoreActors: false,
    });
    assert.deepEqual(next, { phase: "actor-action", presentationIndex: 1 });
    assert.notEqual(next.phase, "actor-dice");
  });

  it("INCREMENTAL_ROLL_APPEND_DOES_NOT_RESET_ROUND_SESSION", () => {
    const humanOnly: LiveRoundSnapshotInput = {
      phase: "BOT_ACTION",
      roundNumber: 3,
      actions: [human],
      rolls: [humanRoll(10, "렌", 16)],
      resolutionOrder: order,
      adjudicatedParticipantIds: [10],
    };
    const humanAndBot1: LiveRoundSnapshotInput = {
      ...humanOnly,
      actions: [human, bot1],
      rolls: [humanRoll(10, "렌", 16), botRoll(20, "동료1", 9)],
      adjudicatedParticipantIds: [10, 20],
    };
    const sim = simulateCinematicQueueSession({ snaps: [humanOnly, humanAndBot1] });
    assert.equal(sim.restartCount, 0);
    assert.equal(sim.sessionKeys[0], sim.sessionKeys[1]);
    assert.equal(sim.sessionKeys[0], "3|live-cinematic");
  });

  it("HUMAN_DICE_NOT_REPLAYED_WHEN_BOT1_ROLL_ARRIVES", () => {
    let queueKey = "";
    let state = { mode: "cinematic" as const, ...startCinematicPresentation() };
    const humanActors = buildRoundPresentationActors({
      resolutionOrder: order,
      actions: [human],
      rolls: [humanRoll(10, "렌", 16)],
    });
    const key1 = trpgRoundPresentationSessionKey({
      roundNumber: 3,
      rolls: humanActors.map((a) => a.roll!),
      actions: [human],
      ready: true,
    });
    queueKey = key1;
    state = {
      ...state,
      ...advanceAfterActorAction({
        actors: humanActors,
        presentationIndex: 0,
        adjudicatedParticipantIds: new Set([10]),
        declarationConsumedIds: new Set(),
      }),
    };
    assert.equal(state.phase, "actor-dice");
    assert.equal(state.presentationIndex, 0);

    const bothActors = buildRoundPresentationActors({
      resolutionOrder: order,
      actions: [human, bot1],
      rolls: [humanRoll(10, "렌", 16), botRoll(20, "동료1", 9)],
    });
    const key2 = trpgRoundPresentationSessionKey({
      roundNumber: 3,
      rolls: bothActors.map((a) => a.roll!).filter(Boolean),
      actions: [human, bot1],
      ready: true,
    });
    assert.equal(key1, key2);
    if (queueKey !== key2) {
      state = { mode: "cinematic", ...startCinematicPresentation() };
    }
    assert.equal(state.phase, "actor-dice");
    assert.equal(state.presentationIndex, 0, "Human dice must not replay from actor 0");
  });

  it("BOT1_DICE_NOT_REPLAYED_WHEN_BOT2_ROLL_ARRIVES", () => {
    let state = { mode: "cinematic" as const, ...startCinematicPresentation() };
    const twoBots = buildRoundPresentationActors({
      resolutionOrder: order,
      actions: [human, bot1],
      rolls: [humanRoll(10, "렌", 16), botRoll(20, "동료1", 9)],
    });
    state = { ...state, ...advanceAfterActorAction({
      actors: twoBots,
      presentationIndex: 0,
      adjudicatedParticipantIds: new Set([10, 20]),
      declarationConsumedIds: new Set([20]),
    }) };
    state = { ...state, ...advanceAfterDiceDismiss({
      actors: twoBots,
      presentationIndex: state.presentationIndex,
      adjudicatedParticipantIds: new Set([10, 20]),
      declarationConsumedIds: new Set([20]),
    }) };
    state = { ...state, ...advanceAfterActorResult({
      actors: twoBots,
      presentationIndex: state.presentationIndex,
      adjudicatedParticipantIds: new Set([10, 20]),
      declarationConsumedIds: new Set([20]),
    }) };
    state = { ...state, ...advanceAfterActorAction({
      actors: twoBots,
      presentationIndex: state.presentationIndex,
      adjudicatedParticipantIds: new Set([10, 20]),
      declarationConsumedIds: new Set([20]),
    }) };
    assert.equal(state.phase, "actor-dice");
    assert.equal(state.presentationIndex, 1);

    const threeBots = buildRoundPresentationActors({
      resolutionOrder: order,
      actions: [human, bot1, bot2],
      rolls: [humanRoll(10, "렌", 16), botRoll(20, "동료1", 9), botRoll(30, "동료2", 14)],
    });
    const keyBefore = trpgRoundPresentationSessionKey({ roundNumber: 3, rolls: twoBots.map(a => a.roll!).filter(Boolean), actions: [human, bot1], ready: true });
    const keyAfter = trpgRoundPresentationSessionKey({ roundNumber: 3, rolls: threeBots.map(a => a.roll!).filter(Boolean), actions: [human, bot1, bot2], ready: true });
    assert.equal(keyBefore, keyAfter);
    assert.equal(state.presentationIndex, 1, "Bot1 dice must not replay when Bot2 roll arrives");
  });

  it("CURRENT_ACTOR_LIST_END_DURING_BOT_ACTION_WAITS", () => {
    const actors = buildRoundPresentationActors({
      resolutionOrder: order,
      actions: [human],
      rolls: [humanRoll(10, "렌", 16)],
    });
    let state = { mode: "cinematic" as const, ...startCinematicPresentation() };
    state = { ...state, ...advanceAfterActorAction({
      actors,
      presentationIndex: 0,
      adjudicatedParticipantIds: new Set([10]),
      declarationConsumedIds: new Set(),
    }) };
    state = { ...state, ...advanceAfterDiceDismiss({
      actors,
      presentationIndex: state.presentationIndex,
      adjudicatedParticipantIds: new Set([10]),
      declarationConsumedIds: new Set(),
    }) };
    const afterHuman = advanceAfterActorResult({
      actors,
      presentationIndex: state.presentationIndex,
      adjudicatedParticipantIds: new Set([10]),
      declarationConsumedIds: new Set(),
      awaitingMoreActors: isRoundPresentationAwaitingMoreActors({
        phase: "BOT_ACTION",
        workType: "generate_bots",
      }),
    });
    assert.deepEqual(afterHuman, { phase: "actor-action", presentationIndex: 1 });
    assert.notEqual(afterHuman.phase, "gm-narration");
  });

  it("GM_NOT_VISIBLE_WHILE_FUTURE_BOT_ACTION_PENDING", () => {
    const actors = buildRoundPresentationActors({
      resolutionOrder: order,
      actions: [human],
      rolls: [humanRoll(10, "렌", 16)],
    });
    const waiting = advanceAfterActorResult({
      actors,
      presentationIndex: 0,
      adjudicatedParticipantIds: new Set([10]),
      declarationConsumedIds: new Set(),
      awaitingMoreActors: true,
    });
    assert.equal(shouldShowGmNarration({ mode: "cinematic", phase: waiting.phase, presentationIndex: waiting.presentationIndex }), false);
  });

  it("HISTORICAL_REMOUNT_NO_AUTOPLAY", () => {
    const key = trpgRoundPresentationSessionKey({
      roundNumber: 4,
      rolls: [humanRoll(10, "렌", 16), botRoll(20, "동료1", 9)],
      actions: [human, bot1],
      ready: true,
    });
    assert.equal(
      shouldConsumeMountRollSession({
        rollSessionKey: key,
        replayOnMount: false,
        isFirstObservation: true,
      }),
      true
    );
    assert.equal(shouldShowGmNarration(historicalPresentation()), true);
  });

  it("NON_ACTING_PARTICIPANT_DOES_NOT_BLOCK_GM", () => {
    const spectatorOrder = [10, 15, 20];
    const actors = buildRoundPresentationActors({
      resolutionOrder: spectatorOrder,
      actions: [human, bot1],
      rolls: [humanRoll(10, "렌", 16), botRoll(20, "동료1", 9)],
    });
    assert.equal(actors.some((actor) => actor.actorId === 15), false);
    assert.equal(
      isRoundPresentationAwaitingMoreActors({
        phase: "ROLLING",
        workType: "idle",
      }),
      false
    );
    const frames = walkCinematicPresentation(actors);
    assert.deepEqual(
      frames.filter((frame) => frame.phase === "actor-dice").map((frame) => frame.activeRollActorId),
      [10, 20]
    );
    assert.equal(frames.at(-1)?.gmVisible, true);
    assert.equal(frames.at(-1)?.phase, "gm-narration");
  });

  it("DISCONNECTED_OR_NON_ACTING_PARTICIPANT_DOES_NOT_WAIT_FOREVER", () => {
    const spectatorOrder = [10, 15, 20];
    const actors = buildRoundPresentationActors({
      resolutionOrder: spectatorOrder,
      actions: [human],
      rolls: [humanRoll(10, "렌", 16)],
    });
    assert.equal(
      isRoundPresentationAwaitingMoreActors({
        phase: "GENERATING_NARRATION",
        workType: "idle",
      }),
      false
    );
    const afterHuman = advanceAfterActorResult({
      actors,
      presentationIndex: 0,
      adjudicatedParticipantIds: new Set([10]),
      declarationConsumedIds: new Set(),
      awaitingMoreActors: false,
    });
    assert.equal(afterHuman.phase, "gm-narration");
    assert.notEqual(afterHuman.presentationIndex, 1);
  });

  it("resolutionOrder uses all participants while round work gates on canAct only", () => {
    const work = nextTrpgRoundWork({
      phase: "BOT_ACTION",
      humans: [
        { id: 10, kind: "human", canAct: true, submitted: true },
        { id: 15, kind: "human", canAct: false, submitted: false },
      ],
      bots: [{ id: 20, kind: "ai_character", canAct: true, submitted: true }],
    });
    assert.deepEqual(work, { type: "acquire_gm_lock" });
    assert.equal(
      isRoundPresentationAwaitingMoreActors({
        phase: "BOT_ACTION",
        workType: "acquire_gm_lock",
      }),
      false
    );
  });

  it("DEFERRED_BOT2_START_BEFORE_BOT1_PRESENTATION_COMPLETE", async () => {
    const db = memoryDb();
    let botCalls = 0;
    let bot2StartedResolve!: () => void;
    const bot2Started = new Promise<void>((resolve) => {
      bot2StartedResolve = resolve;
    });
    let releaseBot2!: () => void;
    const bot2Gate = new Promise<void>((resolve) => {
      releaseBot2 = resolve;
    });
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      rollD20: () => 15,
      gmCall: async () => ({ text: gmText() }),
      botCall: async (_s, user) => {
        botCalls += 1;
        if (botCalls === 1) {
          assert.doesNotMatch(user, /동료1-먼저/);
          return { text: "동료1-먼저.\n\n<<<INTENT>>>\n앞을 본다.\n\n<<<ACTION_TYPE>>>\ninvestigate" };
        }
        bot2StartedResolve();
        await bot2Gate;
        assert.doesNotMatch(user, /d20\s*[:=]?\s*\d+/i);
        assert.doesNotMatch(user, /SUCCESS|FAILURE/);
        assert.match(user, /동료1-먼저/);
        return { text: "동료2-나중.\n\n<<<INTENT>>>\n따라간다.\n\n<<<ACTION_TYPE>>>\ninvestigate" };
      },
    };
    const { campaignId } = await setupTwoBotCampaign(db, deps);
    submitTrpgAction(db, { campaignId, userId: 1, body: "문을 연다.", actionType: "investigate" });
    const advancePromise = advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    await bot2Started;
    assert.equal(botCalls, 2, "Bot2 provider starts before Bot1 presentation is consumed");
    const round = db
      .prepare(`SELECT id FROM trpg_rounds WHERE campaign_id=? AND round_number=1`)
      .get(campaignId) as { id: number };
    const bot1Sub = db
      .prepare(
        `SELECT locked FROM trpg_action_submissions s
         JOIN trpg_participants p ON p.id = s.participant_id
         WHERE s.round_id=? AND p.display_name='동료1'`
      )
      .get(round.id) as { locked: number };
    assert.equal(bot1Sub.locked, 1);
    const snap = loadTrpgSnapshot(db, campaignId, 1)!;
    assert.equal(snap.botGenerationInFlight, true);
    releaseBot2();
    await advancePromise;
    db.close();
  });

  it("concurrency model: sequential and stale-worker idempotency", async () => {
    const db = memoryDb();
    let rngCalls = 0;
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      rollD20: () => {
        rngCalls += 1;
        return 11;
      },
      gmCall: async () => ({ text: gmText() }),
      botCall: async () => ({
        text: "동료1은 움직인다.\n\n<<<INTENT>>>\n움직인다.\n\n<<<ACTION_TYPE>>>\ninvestigate",
      }),
    };
    const { campaignId } = await setupTwoBotCampaign(db, deps);
    submitTrpgAction(db, { campaignId, userId: 1, body: "조사한다.", actionType: "investigate" });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    const firstCount = rngCalls;
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(rngCalls, firstCount, "SEQUENTIAL_IDEMPOTENCY");
    const round1 = db
      .prepare(`SELECT id FROM trpg_rounds WHERE campaign_id=? AND round_number=1`)
      .get(campaignId) as { id: number };
    const ctx = ensureRoundAdjudicationContext(db, {
      campaignId,
      roundId: round1.id,
      roundNumber: 1,
      deps,
    });
    const humanSub = db
      .prepare(
        `SELECT s.id FROM trpg_action_submissions s
         JOIN trpg_participants p ON p.id = s.participant_id
         WHERE s.round_id=? AND p.kind='human'`
      )
      .get(round1.id) as { id: number };
    const stale = adjudicateCanonicalSubmission(db, {
      campaignId,
      roundId: round1.id,
      submissionId: humanSub.id,
      pre: ctx.pre,
      deps,
    });
    assert.equal(stale, "already", "STALE_WORKER_IDEMPOTENCY");
    db.close();
  });

  it("RESULT_CONFIRM_HOLD_MS remains 2200", () => {
    assert.equal(TRPG_RESULT_HOLD_MS[1], 2200);
  });
});
