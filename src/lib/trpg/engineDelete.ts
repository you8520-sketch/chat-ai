import type Database from "better-sqlite3";
import { loadCampaign } from "./store";

function tableExists(db: Database.Database, name: string): boolean {
  const row = db
    .prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?`)
    .get(name) as { ok: number } | undefined;
  return Boolean(row);
}

function deleteTrpgCampaignRows(db: Database.Database, campaignId: number): void {
  db.prepare(
    `DELETE FROM trpg_character_stats WHERE sheet_id IN (
       SELECT id FROM trpg_character_sheets WHERE campaign_id=?
     )`
  ).run(campaignId);
  db.prepare(
    `DELETE FROM trpg_dice_rolls WHERE round_id IN (SELECT id FROM trpg_rounds WHERE campaign_id=?)`
  ).run(campaignId);
  db.prepare(
    `DELETE FROM trpg_action_submissions WHERE round_id IN (SELECT id FROM trpg_rounds WHERE campaign_id=?)`
  ).run(campaignId);
  db.prepare(
    `DELETE FROM trpg_gm_messages WHERE round_id IN (SELECT id FROM trpg_rounds WHERE campaign_id=?)`
  ).run(campaignId);
  db.prepare(`DELETE FROM trpg_state_change_log WHERE campaign_id=?`).run(campaignId);
  db.prepare(`DELETE FROM trpg_round_summaries WHERE campaign_id=?`).run(campaignId);
  if (tableExists(db, "trpg_creator_earnings")) {
    db.prepare(`DELETE FROM trpg_creator_earnings WHERE campaign_id=?`).run(campaignId);
  }
  if (tableExists(db, "trpg_party_messages")) {
    db.prepare(`DELETE FROM trpg_party_messages WHERE campaign_id=?`).run(campaignId);
  }
  db.prepare(`DELETE FROM trpg_rounds WHERE campaign_id=?`).run(campaignId);
  db.prepare(`DELETE FROM trpg_character_sheets WHERE campaign_id=?`).run(campaignId);
  db.prepare(`DELETE FROM trpg_participants WHERE campaign_id=?`).run(campaignId);
  db.prepare(`DELETE FROM trpg_campaign_state WHERE campaign_id=?`).run(campaignId);
  db.prepare(`DELETE FROM trpg_campaign_memories WHERE campaign_id=?`).run(campaignId);
  db.prepare(`DELETE FROM trpg_scenarios WHERE campaign_id=?`).run(campaignId);
  db.prepare(`DELETE FROM trpg_campaigns WHERE id=?`).run(campaignId);
}

export function deleteTrpgCampaign(
  db: Database.Database,
  opts: { campaignId: number; userId: number }
): void {
  const campaign = loadCampaign(db, opts.campaignId);
  if (!campaign) throw new Error("캠페인을 찾을 수 없습니다.");
  if (campaign.host_user_id !== opts.userId) throw new Error("방장만 캠페인을 삭제할 수 있습니다.");
  db.transaction(() => deleteTrpgCampaignRows(db, opts.campaignId))();
}

/**
 * Delete unstarted solo drafts from the DB (not a hide filter).
 * Kept: another human already joined, or host clicked 「캠페인 시작」(a round exists).
 */
export function purgeUnstartedSoloDrafts(
  db: Database.Database,
  hostUserId: number,
  keepCampaignId?: number | null
): number[] {
  const rows = db
    .prepare(
      `SELECT c.id
       FROM trpg_campaigns c
       WHERE c.host_user_id=?
         AND c.status = 'CHARACTER_SETUP'
         AND NOT EXISTS (SELECT 1 FROM trpg_rounds r WHERE r.campaign_id = c.id)
         AND (
           SELECT COUNT(*) FROM trpg_participants p
           WHERE p.campaign_id = c.id AND p.kind = 'human'
         ) <= 1`
    )
    .all(hostUserId) as Array<{ id: number }>;
  const ids = rows.map((row) => row.id).filter((id) => id !== keepCampaignId);
  if (ids.length === 0) return [];
  db.transaction(() => {
    for (const id of ids) deleteTrpgCampaignRows(db, id);
  })();
  return ids;
}

export function renameTrpgCampaign(
  db: Database.Database,
  opts: { campaignId: number; userId: number; title: string }
): string {
  const campaign = loadCampaign(db, opts.campaignId);
  if (!campaign) throw new Error("캠페인을 찾을 수 없습니다.");
  if (campaign.host_user_id !== opts.userId) throw new Error("방장만 제목을 바꿀 수 있습니다.");
  const title = opts.title.trim().slice(0, 80);
  if (!title) throw new Error("제목을 입력해 주세요.");
  db.prepare(`UPDATE trpg_campaigns SET title=?, updated_at=datetime('now') WHERE id=?`).run(title, opts.campaignId);
  return title;
}
