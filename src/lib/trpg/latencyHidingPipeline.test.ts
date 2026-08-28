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
} from "./roundPresentation";

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
