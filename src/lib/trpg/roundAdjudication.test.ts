import { buildTrpgGmStructuredWireText } from "./gmStructuredOutput";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import {
  EVEN_STATS,
  createTrpgCampaign,
  saveTrpgSheet,
  writeSheet,
} from "./engineCreate";
import { startTrpgCampaign, submitTrpgAction } from "./engineAdvance";
import { insertParticipant, loadLatestRound } from "./store";
import { ensureTrpgTables } from "./schema";
import {
  adjudicateLockedHumanSubmissions,
  computeExpectedPresentationActorIds,
  deriveAdjudicatedParticipantIds,
  ensureRoundAdjudicationContext,
  loadAdjudicatedParticipantIds,
  loadExpectedPresentationActorIds,
  loadParticipantAdjudicationOutcomes,
} from "./roundAdjudication";

function memoryDb(): Database.Database {
  const db = new Database(":memory:");
  ensureTrpgTables(db);
  return db;
}

describe("roundAdjudication human pre-bot", () => {
  it("persists human roll before any bot submission exists", async () => {
    const db = memoryDb();
    const deps = {
      skipBilling: true,
      rollD20: () => 14,
      gmCall: async () => ({
        text: buildTrpgGmStructuredWireText("x", {
          players: [],
          location: "",
          next_round_context: "",
          questsAdd: [],
          flagsAdd: [],
          campaign_finished: false,
        }),
      }),
    };
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
    writeSheet(db, campaignId, bot1, "동료1", EVEN_STATS, "");
    await startTrpgCampaign(db, { campaignId, userId: 1, deps });
    submitTrpgAction(db, { campaignId, userId: 1, body: "문을 연다.", actionType: "investigate" });
    const round = loadLatestRound(db, campaignId)!;
    const ctx = ensureRoundAdjudicationContext(db, {
      campaignId,
      roundId: round.id,
      roundNumber: round.round_number,
      deps,
    });
    adjudicateLockedHumanSubmissions(db, {
      campaignId,
      roundId: round.id,
      pre: ctx.pre,
      deps,
    });
    const botSubs = db
      .prepare(`SELECT COUNT(*) AS n FROM trpg_action_submissions WHERE round_id=? AND locked=1`)
      .get(round.id) as { n: number };
    assert.equal(botSubs.n, 1);
    const rolls = db.prepare(`SELECT COUNT(*) AS n FROM trpg_dice_rolls WHERE round_id=?`).get(round.id) as {
      n: number;
    };
    assert.equal(rolls.n, 1);
    assert.ok(loadAdjudicatedParticipantIds(db, round.id).length >= 1);
    db.close();
  });

  it("PERSISTED_ROLL_PRECEDENCE: physical roll row wins over stale no_roll mark", () => {
    const db = memoryDb();
    const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1 });
    saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
    const humanId = (
      db
        .prepare(`SELECT id FROM trpg_participants WHERE campaign_id=? AND slot_index=0`)
        .get(campaignId) as { id: number }
    ).id;
    db.prepare(
      `INSERT INTO trpg_rounds (campaign_id, round_number, phase, input_snapshot_json) VALUES (?, 1, 'ROLLING', '{}')`
    ).run(campaignId);
    const roundId = (
      db.prepare(`SELECT id FROM trpg_rounds WHERE campaign_id=?`).get(campaignId) as { id: number }
    ).id;
    db.prepare(
      `INSERT INTO trpg_action_submissions (round_id, participant_id, body, action_type, locked, source) VALUES (?, ?, 'acts', 'investigate', 1, 'human')`
    ).run(roundId, humanId);
    const submissionId = (
      db.prepare(`SELECT id FROM trpg_action_submissions WHERE round_id=?`).get(roundId) as { id: number }
    ).id;
    db.prepare(
      `INSERT INTO trpg_dice_rolls (round_id, submission_id, d20, stat_key, final_score, dc, tier) VALUES (?, ?, 14, 'nerve', 14, 11, 'SUCCESS')`
    ).run(roundId, submissionId);
    db.prepare(`UPDATE trpg_rounds SET input_snapshot_json=? WHERE id=?`).run(
      JSON.stringify({ adjudicationMarks: { [submissionId]: "no_roll" } }),
      roundId
    );

    const outcomes = loadParticipantAdjudicationOutcomes(db, roundId);
    assert.equal(outcomes[humanId], "roll");
    assert.deepEqual(deriveAdjudicatedParticipantIds(outcomes), [humanId]);
    db.close();
  });
});

describe("expected presentation actor roster", () => {
  it("EXPECTED_ROSTER_EXCLUDES_NON_ACTORS and orders by resolutionOrder", async () => {
    const db = memoryDb();
    const deps = {
      skipBilling: true,
      rollD20: () => 14,
      gmCall: async () => ({
        text: buildTrpgGmStructuredWireText("x", {
          players: [],
          location: "",
          next_round_context: "",
          questsAdd: [],
          flagsAdd: [],
          campaign_finished: false,
        }),
      }),
    };
    const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1 });
    saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
    const humanId = (
      db.prepare(`SELECT id FROM trpg_participants WHERE campaign_id=? AND kind='human'`).get(campaignId) as {
        id: number;
      }
    ).id;
    const bot1 = insertParticipant(db, {
      campaignId,
      slotIndex: 1,
      kind: "ai_character",
      userId: null,
      characterId: null,
      displayName: "Bot1",
    });
    const bot2 = insertParticipant(db, {
      campaignId,
      slotIndex: 2,
      kind: "ai_character",
      userId: null,
      characterId: null,
      displayName: "Bot2",
    });
    const spectator = insertParticipant(db, {
      campaignId,
      slotIndex: 3,
      kind: "human",
      userId: null,
      characterId: null,
      displayName: "Spectator",
    });
    writeSheet(db, campaignId, bot1, "Bot1", EVEN_STATS, "");
    writeSheet(db, campaignId, bot2, "Bot2", EVEN_STATS, "");
    writeSheet(db, campaignId, spectator, "Spectator", EVEN_STATS, "");
    db.prepare(`UPDATE trpg_participants SET can_act=0, status='spectating' WHERE id=?`).run(spectator);
    await startTrpgCampaign(db, { campaignId, userId: 1, deps });
    submitTrpgAction(db, { campaignId, userId: 1, body: "acts", actionType: "investigate" });
    const round = loadLatestRound(db, campaignId)!;
    const ctx = ensureRoundAdjudicationContext(db, {
      campaignId,
      roundId: round.id,
      roundNumber: round.round_number,
      deps,
    });
    const expected = loadExpectedPresentationActorIds(db, { roundId: round.id, campaignId });
    assert.deepEqual(expected, [humanId, bot1, bot2]);
    assert.equal(expected.includes(spectator), false, "EXPECTED_ROSTER_EXCLUDES_NON_ACTORS");
    assert.ok(ctx.resolutionOrder.some((entry) => entry.participantId === spectator));
    db.close();
  });

  it("computeExpectedPresentationActorIds filters resolutionOrder by active can_act", () => {
    const resolutionOrder = [
      { participantId: 10, name: "H", slotIndex: 0 },
      { participantId: 15, name: "Spec", slotIndex: 1 },
      { participantId: 20, name: "B1", slotIndex: 2 },
      { participantId: 30, name: "B2", slotIndex: 3 },
    ];
    const expected = computeExpectedPresentationActorIds(
      [
        { id: 10, can_act: 1, status: "active" },
        { id: 15, can_act: 0, status: "spectating" },
        { id: 20, can_act: 1, status: "active" },
        { id: 30, can_act: 1, status: "disconnected" },
      ],
      resolutionOrder
    );
    assert.deepEqual(expected, [10, 20]);
  });
});
