import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { createTrpgCampaign, saveTrpgSheet } from "./engineCreate";
import { ensureTrpgTables } from "./schema";
import {
  TRPG_COMPLETION_XP,
  grantTrpgCampaignCompletionXp,
  spendTrpgStatPoint,
  trpgLevelForXp,
} from "./progression";

function memoryDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, nickname TEXT, points INTEGER NOT NULL DEFAULT 0)`);
  db.prepare(`INSERT INTO users (id,email,nickname,points) VALUES (1,'a@t','렌',50000)`).run();
  ensureTrpgTables(db);
  return db;
}

describe("campaign-sheet progression", () => {
  it("awards 100 XP once, levels, grants one point, and never double-grants", () => {
    const db = memoryDb();
    const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1 });
    saveTrpgSheet(db, {
      campaignId,
      userId: 1,
      name: "렌",
      stats: { str: 8, dex: 9, con: 8, int: 7, wis: 7, cha: 6 },
    });
    assert.equal(grantTrpgCampaignCompletionXp(db, campaignId), true);
    assert.equal(grantTrpgCampaignCompletionXp(db, campaignId), false);
    const row = db
      .prepare(
        `SELECT sh.level, sh.xp, sh.stat_points
         FROM trpg_character_sheets sh JOIN trpg_participants p ON p.id=sh.participant_id
         WHERE p.campaign_id=? AND p.user_id=1`
      )
      .get(campaignId) as { level: number; xp: number; stat_points: number };
    assert.equal(row.xp, TRPG_COMPLETION_XP);
    assert.equal(row.level, trpgLevelForXp(TRPG_COMPLETION_XP));
    assert.equal(row.stat_points, 1);
    db.close();
  });

  it("spends one point on the owning human sheet and respects the stat cap", () => {
    const db = memoryDb();
    const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1 });
    saveTrpgSheet(db, {
      campaignId,
      userId: 1,
      name: "렌",
      stats: { str: 8, dex: 9, con: 8, int: 7, wis: 7, cha: 6 },
    });
    grantTrpgCampaignCompletionXp(db, campaignId);
    const result = spendTrpgStatPoint(db, { campaignId, userId: 1, statKey: "dex" });
    assert.equal(result.statKey, "dex");
    assert.equal(result.value, 10);
    assert.equal(result.statPoints, 0);
    assert.throws(() => spendTrpgStatPoint(db, { campaignId, userId: 1, statKey: "dex" }), /포인트/);
    db.close();
  });
});
