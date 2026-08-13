import type Database from "better-sqlite3";
import { listMyScenarioTemplates, listPublicScenarioTemplates } from "./scenarioTemplates";
import type { TrpgScenarioTemplate } from "./scenarioTypes";
import { parseTrpgVisibility, type TrpgVisibility } from "./types";

export type TrpgCatalogWorld = {
  id: number;
  name: string;
  summary: string;
  creatorId: number;
  creatorName: string;
  visibility: TrpgVisibility;
  trpgEnabled: boolean;
  mine: boolean;
};

export type TrpgCatalogCharacter = {
  id: number;
  name: string;
  tagline: string;
  emoji: string;
};

export type TrpgCatalog = {
  publicWorlds: TrpgCatalogWorld[];
  myWorlds: TrpgCatalogWorld[];
  myCharacters: TrpgCatalogCharacter[];
  publicScenarios: TrpgScenarioTemplate[];
  myScenarios: TrpgScenarioTemplate[];
};

function tableExists(db: Database.Database, name: string): boolean {
  const row = db
    .prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?`)
    .get(name) as { ok: number } | undefined;
  return Boolean(row);
}

function mapWorld(row: {
  id: number;
  creator_id: number;
  name: string;
  summary: string;
  trpg_enabled: number;
  trpg_visibility: string;
  creator_name: string | null;
  mine: number;
}): TrpgCatalogWorld {
  return {
    id: row.id,
    name: row.name,
    summary: row.summary,
    creatorId: row.creator_id,
    creatorName: (row.creator_name ?? "").trim() || "제작자",
    visibility: parseTrpgVisibility(row.trpg_visibility),
    trpgEnabled: row.trpg_enabled === 1,
    mine: row.mine === 1,
  };
}

export type TrpgWorldAccessRow = {
  id: number;
  creator_id: number;
  name: string;
  summary: string;
  content: string;
  trpg_enabled: number;
  trpg_visibility: string;
};

export function canUseWorldForTrpg(
  world: { creator_id: number; trpg_enabled?: number | null; trpg_visibility?: string | null },
  viewerUserId: number
): boolean {
  if (world.creator_id === viewerUserId) return true;
  return world.trpg_enabled === 1 && parseTrpgVisibility(world.trpg_visibility) === "public";
}

export function loadWorldForTrpg(db: Database.Database, id: number): TrpgWorldAccessRow | null {
  if (!tableExists(db, "worlds")) return null;
  return (
    (db
      .prepare(
        `SELECT id, creator_id, name, summary, content,
                COALESCE(trpg_enabled, 0) AS trpg_enabled,
                COALESCE(trpg_visibility, 'private') AS trpg_visibility
         FROM worlds WHERE id=?`
      )
      .get(id) as TrpgWorldAccessRow | undefined) ?? null
  );
}

export function loadTrpgCatalog(db: Database.Database, userId: number): TrpgCatalog {
  const empty: TrpgCatalog = {
    publicWorlds: [],
    myWorlds: [],
    myCharacters: [],
    publicScenarios: listPublicScenarioTemplates(db, 40),
    myScenarios: listMyScenarioTemplates(db, userId),
  };
  if (!tableExists(db, "worlds")) return empty;

  const hasUsers = tableExists(db, "users");
  const creatorNameSql = hasUsers
    ? `COALESCE((SELECT nickname FROM users WHERE id = w.creator_id), '')`
    : `''`;

  const publicWorlds = db
    .prepare(
      `SELECT w.id, w.creator_id, w.name, w.summary,
              COALESCE(w.trpg_enabled, 0) AS trpg_enabled,
              COALESCE(w.trpg_visibility, 'private') AS trpg_visibility,
              ${creatorNameSql} AS creator_name,
              CASE WHEN w.creator_id=? THEN 1 ELSE 0 END AS mine
       FROM worlds w
       WHERE COALESCE(w.trpg_enabled, 0)=1 AND COALESCE(w.trpg_visibility, 'private')='public'
       ORDER BY w.updated_at DESC, w.id DESC
       LIMIT 60`
    )
    .all(userId) as Array<{
    id: number;
    creator_id: number;
    name: string;
    summary: string;
    trpg_enabled: number;
    trpg_visibility: string;
    creator_name: string | null;
    mine: number;
  }>;

  const myWorlds = db
    .prepare(
      `SELECT w.id, w.creator_id, w.name, w.summary,
              COALESCE(w.trpg_enabled, 0) AS trpg_enabled,
              COALESCE(w.trpg_visibility, 'private') AS trpg_visibility,
              ${creatorNameSql} AS creator_name,
              1 AS mine
       FROM worlds w
       WHERE w.creator_id=?
       ORDER BY w.updated_at DESC, w.id DESC
       LIMIT 60`
    )
    .all(userId) as Array<{
    id: number;
    creator_id: number;
    name: string;
    summary: string;
    trpg_enabled: number;
    trpg_visibility: string;
    creator_name: string | null;
    mine: number;
  }>;

  let myCharacters: TrpgCatalogCharacter[] = [];
  if (tableExists(db, "characters")) {
    const charCols = db.prepare(`PRAGMA table_info(characters)`).all() as { name: string }[];
    const kindFilter = charCols.some((c) => c.name === "content_kind")
      ? `AND COALESCE(content_kind, 'character')='character'`
      : "";
    myCharacters = (
      db
        .prepare(
          `SELECT id, name, tagline, COALESCE(emoji, '✨') AS emoji
           FROM characters
           WHERE creator_id=? ${kindFilter}
           ORDER BY created_at DESC, id DESC
           LIMIT 80`
        )
        .all(userId) as Array<{ id: number; name: string; tagline: string; emoji: string }>
    ).map((row) => ({
      id: row.id,
      name: row.name,
      tagline: row.tagline ?? "",
      emoji: row.emoji || "✨",
    }));
  }

  return {
    publicWorlds: publicWorlds.map(mapWorld),
    myWorlds: myWorlds.map(mapWorld),
    myCharacters,
    publicScenarios: empty.publicScenarios,
    myScenarios: empty.myScenarios,
  };
}
