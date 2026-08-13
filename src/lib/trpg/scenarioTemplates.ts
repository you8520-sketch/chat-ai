import type Database from "better-sqlite3";
import { canAccessCharacter, type CharacterAccessRow } from "@/lib/characterVisibility";
import { parseGenresJson } from "@/lib/characterGenres";
import { parseJson } from "./store";
import {
  normalizeScenarioTemplateInput,
  parseCharacterIds,
  parseInventory,
  parseScenarioNpcs,
  parseStatRecord,
  type TrpgScenarioTemplate,
  type TrpgScenarioTemplateInput,
} from "./scenarioTypes";
import { parseTrpgVisibility } from "./types";

export {
  TRPG_SCENARIO_CONTENT_LIMIT,
  TRPG_SCENARIO_LOCATION_LIMIT,
  TRPG_SCENARIO_MAX_BOTS,
  TRPG_SCENARIO_SECRET_LIMIT,
  TRPG_SCENARIO_SUMMARY_LIMIT,
  TRPG_SCENARIO_TITLE_LIMIT,
  normalizeScenarioTemplateInput,
  parseCharacterIds,
  parseInventory,
  parseScenarioNpcs,
  parseStatRecord,
  type TrpgScenarioNpc,
  type TrpgScenarioTemplate,
  type TrpgScenarioTemplateInput,
} from "./scenarioTypes";

export type TrpgScenarioTemplateRow = {
  id: number;
  creator_id: number;
  world_id: number | null;
  title: string;
  summary: string;
  content: string;
  visibility: string;
  secret_content: string | null;
  start_location: string;
  start_inventory_json: string;
  default_pc_stats_json: string;
  npcs_json: string;
  character_ids_json: string;
  genres: string | null;
  created_at: string;
  updated_at: string;
};

export function rowToScenarioTemplate(
  row: TrpgScenarioTemplateRow,
  opts?: { includeSecret?: boolean }
): TrpgScenarioTemplate {
  return {
    id: row.id,
    creatorId: row.creator_id,
    worldId: row.world_id,
    title: row.title,
    summary: row.summary,
    content: row.content,
    secretContent: opts?.includeSecret === false ? "" : row.secret_content ?? "",
    visibility: parseTrpgVisibility(row.visibility),
    startLocation: row.start_location,
    startInventory: parseInventory(parseJson(row.start_inventory_json, [] as string[])),
    defaultPcStats: parseStatRecord(parseJson(row.default_pc_stats_json, null)),
    npcs: parseScenarioNpcs(parseJson(row.npcs_json, [] as unknown[])),
    characterIds: parseCharacterIds(parseJson(row.character_ids_json, [] as unknown[])),
    genres: parseGenresJson(row.genres),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function canAccessTrpgScenarioTemplate(
  row: { creator_id: number; visibility: string },
  viewerUserId: number
): boolean {
  if (row.creator_id === viewerUserId) return true;
  return parseTrpgVisibility(row.visibility) === "public";
}

export function loadScenarioTemplate(
  db: Database.Database,
  id: number
): TrpgScenarioTemplateRow | null {
  return (
    (db
      .prepare(`SELECT * FROM trpg_scenario_templates WHERE id=?`)
      .get(id) as TrpgScenarioTemplateRow | undefined) ?? null
  );
}

export function assertImportedCharactersAccessible(
  db: Database.Database,
  characterIds: number[],
  viewerUserId: number
): void {
  for (const id of characterIds) {
    const ch = db
      .prepare(
        `SELECT id, creator_id, visibility, moderation_status, share_slug, official
         FROM characters WHERE id=?`
      )
      .get(id) as CharacterAccessRow | undefined;
    if (!ch) throw new Error("데려올 캐릭터를 찾을 수 없습니다.");
    const access = canAccessCharacter(ch, viewerUserId);
    if (!access.ok) throw new Error("이 캐릭터를 시나리오에 데려올 수 없습니다.");
  }
}

export function insertScenarioTemplate(
  db: Database.Database,
  creatorId: number,
  input: TrpgScenarioTemplateInput
): number {
  const n = normalizeScenarioTemplateInput(input);
  assertImportedCharactersAccessible(db, n.characterIds, creatorId);
  const info = db
    .prepare(
      `INSERT INTO trpg_scenario_templates
        (creator_id, world_id, title, summary, content, secret_content, visibility, start_location,
         start_inventory_json, default_pc_stats_json, npcs_json, character_ids_json, genres, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`
    )
    .run(
      creatorId,
      n.worldId,
      n.title,
      n.summary,
      n.content,
      n.secretContent,
      n.visibility,
      n.startLocation,
      JSON.stringify(n.startInventory),
      n.defaultPcStats ? JSON.stringify(n.defaultPcStats) : "",
      JSON.stringify(n.npcs),
      JSON.stringify(n.characterIds),
      JSON.stringify(n.genres)
    );
  return Number(info.lastInsertRowid);
}

export function updateScenarioTemplate(
  db: Database.Database,
  id: number,
  creatorId: number,
  input: TrpgScenarioTemplateInput
): void {
  const existing = loadScenarioTemplate(db, id);
  if (!existing || existing.creator_id !== creatorId) {
    throw new Error("시나리오를 찾을 수 없습니다.");
  }
  const n = normalizeScenarioTemplateInput(input);
  assertImportedCharactersAccessible(db, n.characterIds, creatorId);
  db.prepare(
    `UPDATE trpg_scenario_templates
     SET world_id=?, title=?, summary=?, content=?, secret_content=?, visibility=?, start_location=?,
         start_inventory_json=?, default_pc_stats_json=?, npcs_json=?, character_ids_json=?, genres=?,
         updated_at=datetime('now')
     WHERE id=? AND creator_id=?`
  ).run(
    n.worldId,
    n.title,
    n.summary,
    n.content,
    n.secretContent,
    n.visibility,
    n.startLocation,
    JSON.stringify(n.startInventory),
    n.defaultPcStats ? JSON.stringify(n.defaultPcStats) : "",
    JSON.stringify(n.npcs),
    JSON.stringify(n.characterIds),
    JSON.stringify(n.genres),
    id,
    creatorId
  );
}

export function deleteScenarioTemplate(db: Database.Database, id: number, creatorId: number): void {
  const info = db
    .prepare(`DELETE FROM trpg_scenario_templates WHERE id=? AND creator_id=?`)
    .run(id, creatorId);
  if (info.changes === 0) throw new Error("시나리오를 찾을 수 없습니다.");
}

export function listPublicScenarioTemplates(db: Database.Database, limit = 80): TrpgScenarioTemplate[] {
  const rows = db
    .prepare(
      `SELECT * FROM trpg_scenario_templates
       WHERE visibility='public'
       ORDER BY updated_at DESC, id DESC
       LIMIT ?`
    )
    .all(limit) as TrpgScenarioTemplateRow[];
  return rows.map((row) => rowToScenarioTemplate(row, { includeSecret: false }));
}

export function listMyScenarioTemplates(db: Database.Database, creatorId: number): TrpgScenarioTemplate[] {
  const rows = db
    .prepare(
      `SELECT * FROM trpg_scenario_templates
       WHERE creator_id=?
       ORDER BY updated_at DESC, id DESC`
    )
    .all(creatorId) as TrpgScenarioTemplateRow[];
  return rows.map((row) => rowToScenarioTemplate(row, { includeSecret: true }));
}
