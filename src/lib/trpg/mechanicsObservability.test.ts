import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { auditTrpgMechanicsRollEconomy, logTrpgMechanicsCheckTelemetry } from "./mechanicsObservability";
import Database from "better-sqlite3";
import { ensureTrpgTables } from "./schema";

function seedAuditCampaign(db: Database.Database): number {
  db.prepare(`INSERT INTO trpg_campaigns (id, host_user_id, title) VALUES (1,1,'t')`).run();
  db.prepare(
    `INSERT INTO trpg_participants (id, campaign_id, slot_index, kind, user_id, display_name, status, can_act)
     VALUES (1,1,0,'human',1,'렌','active',1),
            (2,1,1,'ai_character',NULL,'솔','active',1),
            (3,1,2,'human',2,'태현','active',1)`
  ).run();
  return 1;
}

function seedRound(
  db: Database.Database,
  roundNumber: number,
  rows: Array<{
    participantId: number;
    actionType?: string;
    tier?: string | null;
  }>
): void {
  const roundId = roundNumber;
  db.prepare(
    `INSERT INTO trpg_rounds (id, campaign_id, round_number, phase) VALUES (?,?,?,'ROLLING')`
  ).run(roundId, 1, roundNumber);
  let submissionId = roundNumber * 10;
  for (const row of rows) {
    submissionId += 1;
    db.prepare(
      `INSERT INTO trpg_action_submissions
        (id, round_id, participant_id, body, action_type, locked, source)
       VALUES (?,?,?,?,?,1,'human')`
    ).run(submissionId, roundId, row.participantId, "action", row.actionType ?? "attack");
    if (row.tier) {
      db.prepare(
        `INSERT INTO trpg_dice_rolls
          (round_id, submission_id, d20, stat_key, stat_modifier, condition_modifier, final_score, dc, tier)
         VALUES (?,?,10,'str',0,0,5,11,?)`
      ).run(roundId, submissionId, row.tier);
    }
  }
}

describe("TRPG M1 mechanics observability", () => {
  it("logs sanitized check fields without prose", () => {
    const rows: unknown[] = [];
    const prev = console.info;
    console.info = ((label: unknown, payload: unknown) => {
      if (label === "[trpg-mechanics-check]") rows.push(payload);
    }) as typeof console.info;
    logTrpgMechanicsCheckTelemetry({
      action_type: "attack",
      check_required: true,
      check_reason: "explicit_resolution",
      stat_key: "str",
      stat_modifier: 2,
      condition_modifier: 0,
      final_score: 14,
      dc: 11,
      tier: "SUCCESS",
    });
    console.info = prev;
    const payload = JSON.stringify(rows[0]);
    assert.match(payload, /"action_type":"attack"/);
    assert.doesNotMatch(payload, /마체테|권태현|prose|body/);
  });

  it("audit helper reports zeroed totals on an empty campaign", () => {
    const db = new Database(":memory:");
    ensureTrpgTables(db);
    db.prepare(`INSERT INTO trpg_campaigns (id, host_user_id, title) VALUES (1,1,'t')`).run();
    const audit = auditTrpgMechanicsRollEconomy(db, 1);
    assert.equal(audit.TOTAL_ACTIONS, 0);
    assert.equal(audit.TOTAL_CHECKS, 0);
    assert.equal(audit.CHECK_RATE, 0);
    db.close();
  });

  it("A: human fail streak ignores intervening bot successes", () => {
    const db = new Database(":memory:");
    ensureTrpgTables(db);
    seedAuditCampaign(db);
    seedRound(db, 1, [
      { participantId: 1, tier: "FAILURE" },
      { participantId: 2, tier: "SUCCESS" },
    ]);
    seedRound(db, 2, [
      { participantId: 1, tier: "FAILURE" },
      { participantId: 2, tier: "SUCCESS" },
    ]);
    seedRound(db, 3, [{ participantId: 1, tier: "FAILURE" }]);
    const audit = auditTrpgMechanicsRollEconomy(db, 1);
    assert.equal(audit.MAX_HUMAN_CONSECUTIVE_FULL_FAILURES, 3);
    db.close();
  });

  it("B: no-check human action does not reset fail streak", () => {
    const db = new Database(":memory:");
    ensureTrpgTables(db);
    seedAuditCampaign(db);
    seedRound(db, 1, [{ participantId: 1, tier: "FAILURE" }]);
    seedRound(db, 2, [{ participantId: 1, tier: null }]);
    seedRound(db, 3, [{ participantId: 1, tier: "FAILURE" }]);
    const audit = auditTrpgMechanicsRollEconomy(db, 1);
    assert.equal(audit.MAX_HUMAN_CONSECUTIVE_FULL_FAILURES, 2);
    db.close();
  });

  it("C: human success resets streak", () => {
    const db = new Database(":memory:");
    ensureTrpgTables(db);
    seedAuditCampaign(db);
    seedRound(db, 1, [{ participantId: 1, tier: "FAILURE" }]);
    seedRound(db, 2, [{ participantId: 1, tier: "SUCCESS" }]);
    seedRound(db, 3, [{ participantId: 1, tier: "FAILURE" }]);
    const audit = auditTrpgMechanicsRollEconomy(db, 1);
    assert.equal(audit.MAX_HUMAN_CONSECUTIVE_FULL_FAILURES, 1);
    db.close();
  });

  it("D: two human participants track streaks independently", () => {
    const db = new Database(":memory:");
    ensureTrpgTables(db);
    seedAuditCampaign(db);
    seedRound(db, 1, [
      { participantId: 1, tier: "FAILURE" },
      { participantId: 3, tier: "FAILURE" },
    ]);
    seedRound(db, 2, [
      { participantId: 1, tier: "FAILURE" },
      { participantId: 3, tier: "SUCCESS" },
    ]);
    seedRound(db, 3, [{ participantId: 1, tier: "FAILURE" }]);
    const audit = auditTrpgMechanicsRollEconomy(db, 1);
    assert.equal(audit.MAX_HUMAN_CONSECUTIVE_FULL_FAILURES, 3);
    db.close();
  });
});
