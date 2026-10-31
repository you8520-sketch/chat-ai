import type Database from "better-sqlite3";
import { loadParticipants, loadScenario } from "./store";
import {
  TRPG_COMPLETION_XP,
  TRPG_STAT_POINTS_PER_LEVEL,
  TRPG_XP_PER_LEVEL,
  trpgLevelForXp,
} from "./progressionMath";

export {
  TRPG_COMPLETION_XP,
  TRPG_STAT_POINTS_PER_LEVEL,
  TRPG_XP_PER_LEVEL,
  trpgLevelForXp,
  trpgXpIntoLevel,
  trpgXpToNextLevel,
} from "./progressionMath";

/**
 * Minimal campaign-scoped progression owner.
 *
 * One scenario completion awards XP once per campaign sheet. XP, level and
 * unspent stat points belong to the campaign sheet; nothing carries between
 * campaigns. The GM never writes these fields. The only writers are
 * `grantTrpgCampaignCompletionXp` (server completion) and
 * `spendTrpgStatPoint` (the owning human player's explicit allocation).
 */

/**
 * Idempotent completion award. `completion_xp_awarded` is the campaign-level
 * once flag; a retry, refresh, recovery or duplicate finalize cannot grant a
 * second time.
 */
export function grantTrpgCampaignCompletionXp(db: Database.Database, campaignId: number): boolean {
  const award = (): boolean => {
    const claim = db
      .prepare(`UPDATE trpg_campaigns SET completion_xp_awarded=1 WHERE id=? AND completion_xp_awarded=0`)
      .run(campaignId);
    if (claim.changes !== 1) return false;
    const sheets = db
      .prepare(
        `SELECT id, level, xp, stat_points
         FROM trpg_character_sheets WHERE campaign_id=? ORDER BY id`
      )
      .all(campaignId) as Array<{ id: number; level: number; xp: number; stat_points: number }>;
    for (const sheet of sheets) {
      const beforeLevel = trpgLevelForXp(sheet.xp ?? 0);
      const nextXp = (sheet.xp ?? 0) + TRPG_COMPLETION_XP;
      const nextLevel = trpgLevelForXp(nextXp);
      const gained = Math.max(0, nextLevel - beforeLevel) * TRPG_STAT_POINTS_PER_LEVEL;
      db.prepare(
        `UPDATE trpg_character_sheets
         SET xp=?, level=?, stat_points=stat_points+?, updated_at=datetime('now')
         WHERE id=?`
      ).run(nextXp, nextLevel, gained, sheet.id);
    }
    return true;
  };
  if (db.inTransaction) return award();
  return db.transaction(award).immediate();
}

export type TrpgStatAllocationResult = {
  statKey: string;
  value: number;
  statPoints: number;
  level: number;
  xp: number;
};

/**
 * Spend one unspent point on the viewer's own human sheet. Existing stat caps
 * are enforced; bots and other players' sheets cannot be edited.
 */
export function spendTrpgStatPoint(
  db: Database.Database,
  opts: { campaignId: number; userId: number; statKey: string }
): TrpgStatAllocationResult {
  const statKey = opts.statKey.trim();
  if (!statKey) throw new Error("능력치를 선택하세요.");
  return db.transaction(() => {
    const participant = loadParticipants(db, opts.campaignId).find(
      (row) => row.kind === "human" && row.user_id === opts.userId
    );
    if (!participant) throw new Error("이 캠페인의 플레이어가 아닙니다.");
    const sheet = db
      .prepare(
        `SELECT id, level, xp, stat_points FROM trpg_character_sheets WHERE participant_id=?`
      )
      .get(participant.id) as
      | { id: number; level: number; xp: number; stat_points: number }
      | undefined;
    if (!sheet) throw new Error("시트를 찾을 수 없습니다.");
    if ((sheet.stat_points ?? 0) < 1) throw new Error("배분할 능력치 포인트가 없습니다.");
    const scenario = loadScenario(db, opts.campaignId);
    const def = scenario.statDefs.find((row) => row.key === statKey);
    if (!def) throw new Error("이 시나리오에 없는 능력치입니다.");
    const current = db
      .prepare(
        `SELECT st.value FROM trpg_character_stats st
         WHERE st.sheet_id=? AND st.stat_key=?`
      )
      .get(sheet.id, statKey) as { value: number } | undefined;
    const value = current?.value ?? 5;
    if (value >= def.max) throw new Error(`${def.label}은(는) 이미 최대치입니다.`);
    db.prepare(
      `UPDATE trpg_character_stats SET value=? WHERE sheet_id=? AND stat_key=?`
    ).run(value + 1, sheet.id, statKey);
    db.prepare(
      `UPDATE trpg_character_sheets
       SET stat_points=stat_points-1, revision=revision+1, updated_at=datetime('now')
       WHERE id=?`
    ).run(sheet.id);
    return {
      statKey,
      value: value + 1,
      statPoints: (sheet.stat_points ?? 0) - 1,
      level: sheet.level,
      xp: sheet.xp ?? 0,
    };
  }).immediate();
}
