import type Database from "better-sqlite3";
import { parseJson } from "./store";
import { statModifier } from "./stats";
import type { TrpgSheetSnapshot } from "./types";

function modifiersNote(stats: Record<string, number>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(stats)) {
    const mod = statModifier(value);
    if (mod !== 0) parts.push(`${key}${mod > 0 ? `+${mod}` : String(mod)}`);
  }
  return parts.length ? parts.join(" ") : "+0";
}

export function loadSheetSnapshots(db: Database.Database, campaignId: number): TrpgSheetSnapshot[] {
  const rows = db
    .prepare(
      `SELECT s.id AS sheet_id, s.participant_id, s.name, s.level, s.hp, s.max_hp,
              s.conditions_json, s.inventory_json, s.location, p.display_name
       FROM trpg_character_sheets s
       JOIN trpg_participants p ON p.id = s.participant_id
       WHERE s.campaign_id=?
       ORDER BY p.slot_index ASC`
    )
    .all(campaignId) as Array<{
    sheet_id: number;
    participant_id: number;
    name: string;
    level: number;
    hp: number;
    max_hp: number;
    conditions_json: string;
    inventory_json: string;
    location: string;
    display_name: string;
  }>;
  const statStmt = db.prepare(`SELECT stat_key, value FROM trpg_character_stats WHERE sheet_id=?`);
  return rows.map((row) => {
    const stats: Record<string, number> = {};
    for (const st of statStmt.all(row.sheet_id) as Array<{ stat_key: string; value: number }>) {
      stats[st.stat_key] = st.value;
    }
    return {
      participantId: row.participant_id,
      name: row.name,
      playerName: row.display_name,
      level: row.level,
      hp: row.hp,
      maxHp: row.max_hp,
      stats,
      conditions: parseJson(row.conditions_json, [] as string[]),
      inventory: parseJson(row.inventory_json, [] as string[]),
      location: row.location,
      modifiersNote: modifiersNote(stats),
    };
  });
}

export function persistSheets(db: Database.Database, sheets: TrpgSheetSnapshot[]): void {
  const updateSheet = db.prepare(
    `UPDATE trpg_character_sheets
     SET hp=?, max_hp=?, conditions_json=?, inventory_json=?, location=?, revision=revision+1, updated_at=datetime('now')
     WHERE participant_id=?`
  );
  const updateStat = db.prepare(
    `UPDATE trpg_character_stats SET value=? WHERE sheet_id=(
       SELECT id FROM trpg_character_sheets WHERE participant_id=?
     ) AND stat_key=?`
  );
  for (const sheet of sheets) {
    updateSheet.run(
      sheet.hp,
      sheet.maxHp,
      JSON.stringify(sheet.conditions),
      JSON.stringify(sheet.inventory),
      sheet.location,
      sheet.participantId
    );
    for (const [key, value] of Object.entries(sheet.stats)) {
      updateStat.run(value, sheet.participantId, key);
    }
  }
}
