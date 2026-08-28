import assert from "node:assert/strict";
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
  ensureRoundAdjudicationContext,
  loadAdjudicatedParticipantIds,
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
        text: `<<<NARRATION>>>x\n<<<DELTA>>>\n${JSON.stringify({
          players: [],
          location: "",
          next_round_context: "",
          questsAdd: [],
          flagsAdd: [],
          campaign_finished: false,
        })}`,
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
});
