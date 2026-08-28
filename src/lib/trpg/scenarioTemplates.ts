import type Database from "better-sqlite3";
import { canUseCharacterInTrpg, type CharacterAccessRow } from "@/lib/characterVisibility";
import { parseGenresJson } from "@/lib/characterGenres";
import { defsFromKeys, isCanonicalStatKey, parseStatKeys, preservedLegacyStatKeysFromStored } from "./stats";
import { canUseWorldForTrpg, loadWorldForTrpg } from "@/lib/trpg/catalog";
import { parseJson } from "./store";
import { parseScenarioAssets } from "./scenarioAssets";
import { parseTrpgScenarioPlan, publicTrpgScenarioPlan } from "./scenarioPlan";
import {
  assertScenarioBundleLimit,
  countScenarioBundleChars,
  normalizeScenarioTemplateInput,
  parseCharacterIds,
  parseInventory,
  parseScenarioNpcs,
  parseStatRecord,
  type TrpgScenarioNpc,
  type TrpgScenarioTemplate,
  type TrpgScenarioTemplateInput,
} from "./scenarioTypes";
import { parseTrpgVisibility, type TrpgStatDefinition } from "./types";

export {
  TRPG_SCENARIO_BUNDLE_LIMIT,
  TRPG_SCENARIO_CONTENT_LIMIT,
  TRPG_SCENARIO_LOCATION_LIMIT,
  TRPG_SCENARIO_MAX_BOTS,
  TRPG_SCENARIO_MAX_NPCS,
  TRPG_SCENARIO_SECRET_LIMIT,
  TRPG_SCENARIO_SUMMARY_LIMIT,
  TRPG_SCENARIO_TITLE_LIMIT,
  countScenarioBundleChars,
  normalizeScenarioTemplateInput,
  parseCharacterIds,
  parseInventory,
  parseScenarioNpcs,
  parseStatRecord,
  scenarioMobNpcGmNotes,
  scenarioMobNpcNames,
  scenarioMobNpcWorldBrief,
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
  stat_keys_json?: string | null;
  npcs_json: string;
  character_ids_json: string;
  genres: string | null;
  assets_json?: string | null;
  scenario_plan_json?: string | null;
  created_at: string;
  updated_at: string;
};

export function rowToScenarioTemplate(
  row: TrpgScenarioTemplateRow,
  opts?: { includeSecret?: boolean }
): TrpgScenarioTemplate {
  const statKeys = parseStatKeys(parseJson(row.stat_keys_json, [] as unknown[]));
  const statDefs = defsFromKeys(statKeys);
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
    defaultPcStats: parseStatRecord(parseJson(row.default_pc_stats_json, null), statDefs),
    statKeys,
    npcs: parseScenarioNpcs(parseJson(row.npcs_json, [] as unknown[]), statDefs),
    characterIds: parseCharacterIds(parseJson(row.character_ids_json, [] as unknown[])),
    genres: parseGenresJson(row.genres),
    assets: parseScenarioAssets(row.assets_json),
    scenarioPlan: opts?.includeSecret === false ? publicTrpgScenarioPlan() : parseTrpgScenarioPlan(row.scenario_plan_json),
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

export function loadCampaignScenarioAssets(
  db: Database.Database,
  templateId: number | null | undefined
): import("@/lib/characterAssets").CharacterAsset[] {
  if (!templateId) return [];
  const row = loadScenarioTemplate(db, templateId);
  return row ? parseScenarioAssets(row.assets_json) : [];
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
        `SELECT id, creator_id, visibility, moderation_status, share_slug, official, trpg_reuse_allowed
         FROM characters WHERE id=?`
      )
      .get(id) as CharacterAccessRow | undefined;
    if (!ch) throw new Error("데려올 캐릭터를 찾을 수 없습니다.");
    if (!canUseCharacterInTrpg(ch, viewerUserId)) {
      throw new Error("이 캐릭터를 시나리오에 데려올 수 없습니다.");
    }
  }
}

function linkedWorldBundleText(
  db: Database.Database,
  worldId: number | null
): { worldSummary: string; worldContent: string } {
  if (!worldId) return { worldSummary: "", worldContent: "" };
  try {
    const row = db.prepare(`SELECT summary, content FROM worlds WHERE id=?`).get(worldId) as
      | { summary: string | null; content: string | null }
      | undefined;
    if (!row) return { worldSummary: "", worldContent: "" };
    return { worldSummary: String(row.summary ?? ""), worldContent: String(row.content ?? "") };
  } catch {
    return { worldSummary: "", worldContent: "" };
  }
}

function assertScenarioBundleFits(
  db: Database.Database,
  n: {
    summary: string;
    content: string;
    secretContent: string;
    npcs: TrpgScenarioNpc[];
    worldId: number | null;
    scenarioPlan?: import("./scenarioPlan").TrpgScenarioPlan | null;
  }
): void {
  const world = linkedWorldBundleText(db, n.worldId);
  assertScenarioBundleLimit(
    countScenarioBundleChars({
      worldSummary: world.worldSummary,
      worldContent: world.worldContent,
      summary: n.summary,
      content: n.content,
      secretContent: n.secretContent,
      npcs: n.npcs,
      scenarioPlan: n.scenarioPlan,
    })
  );
}

function assertScenarioWorldAccess(
  db: Database.Database,
  creatorId: number,
  worldId: number | null
): void {
  if (worldId == null) return;
  const world = loadWorldForTrpg(db, worldId);
  if (!world || !canUseWorldForTrpg(world, creatorId)) {
    throw new Error("읽기 전용 또는 빌린 세계관은 TRPG에 사용할 수 없습니다.");
  }
}

export function insertScenarioTemplate(
  db: Database.Database,
  creatorId: number,
  input: TrpgScenarioTemplateInput
): number {
  const n = normalizeScenarioTemplateInput(input);
  assertScenarioWorldAccess(db, creatorId, n.worldId);
  assertImportedCharactersAccessible(db, n.characterIds, creatorId);
  assertScenarioBundleFits(db, n);
  const info = db
    .prepare(
      `INSERT INTO trpg_scenario_templates
        (creator_id, world_id, title, summary, content, secret_content, visibility, start_location,
         start_inventory_json, default_pc_stats_json, stat_keys_json, npcs_json, character_ids_json, genres, assets_json,
         scenario_plan_json, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`
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
      JSON.stringify(n.statKeys),
      JSON.stringify(n.npcs),
      JSON.stringify(n.characterIds),
      JSON.stringify(n.genres),
      JSON.stringify(n.assets),
      n.scenarioPlan ? JSON.stringify(n.scenarioPlan) : null
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
  const preservedLegacyStatKeys = preservedLegacyStatKeysFromStored(
    parseJson(existing.stat_keys_json, [] as unknown[])
  );
  const n = normalizeScenarioTemplateInput(input, { preservedLegacyStatKeys });
  assertScenarioWorldAccess(db, creatorId, n.worldId);
  const statDefs = defsFromKeys(n.statKeys);
  const defaultPcStats = restoreDefaultPcStatsOnUpdate(
    input.defaultPcStats,
    n.defaultPcStats,
    existing.default_pc_stats_json,
    statDefs
  );
  const npcs = restoreNpcLegacyStatsOnUpdate(n.npcs, existing.npcs_json, statDefs);
  assertImportedCharactersAccessible(db, n.characterIds, creatorId);
  assertScenarioBundleFits(db, { ...n, npcs });
  db.prepare(
    `UPDATE trpg_scenario_templates
     SET world_id=?, title=?, summary=?, content=?, secret_content=?, visibility=?, start_location=?,
         start_inventory_json=?, default_pc_stats_json=?, stat_keys_json=?, npcs_json=?, character_ids_json=?, genres=?,
         assets_json=?, scenario_plan_json=?,
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
    defaultPcStats ? JSON.stringify(defaultPcStats) : "",
    JSON.stringify(n.statKeys),
    JSON.stringify(npcs),
    JSON.stringify(n.characterIds),
    JSON.stringify(n.genres),
    JSON.stringify(n.assets),
    n.scenarioPlan ? JSON.stringify(n.scenarioPlan) : null,
    id,
    creatorId
  );
}

function restoreDefaultPcStatsOnUpdate(
  payload: Record<string, number> | null | undefined,
  normalized: Record<string, number> | null,
  existingJson: string,
  statDefs: TrpgStatDefinition[]
): Record<string, number> | null {
  const existingStats = parseStatRecord(parseJson(existingJson, null), statDefs);
  if (payload == null) {
    return existingStats ?? normalized;
  }
  if (!existingStats) return normalized;
  const merged = { ...(normalized ?? existingStats) };
  for (const def of statDefs) {
    if (isCanonicalStatKey(def.key)) continue;
    const value = existingStats[def.key];
    if (value != null) merged[def.key] = value;
  }
  return merged;
}

function restoreNpcLegacyStatsOnUpdate(
  incoming: TrpgScenarioNpc[],
  existingJson: string,
  statDefs: TrpgStatDefinition[]
): TrpgScenarioNpc[] {
  const preservedKeys = statDefs.filter((def) => !isCanonicalStatKey(def.key)).map((def) => def.key);
  if (preservedKeys.length === 0) return incoming;
  const existingNpcs = parseScenarioNpcs(parseJson(existingJson, [] as unknown[]), statDefs);
  if (existingNpcs.length === 0) return incoming;
  const byName = new Map(existingNpcs.map((npc) => [npc.name, npc]));
  return incoming.map((npc) => {
    const prev = byName.get(npc.name);
    if (!prev?.stats) return npc;
    const stats = { ...(npc.stats ?? prev.stats) };
    for (const key of preservedKeys) {
      const value = prev.stats[key];
      if (value != null) stats[key] = value;
    }
    return { ...npc, stats };
  });
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
