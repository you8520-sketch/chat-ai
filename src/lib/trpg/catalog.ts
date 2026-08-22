import type Database from "better-sqlite3";
import { canUseCharacterInTrpg, type CharacterAccessRow } from "@/lib/characterVisibility";
import { parseGenresJson, type CharacterGenre } from "@/lib/characterGenres";
import { sanitizeWorldCoverUrl } from "@/lib/worlds";
import { listMyScenarioTemplates, listPublicScenarioTemplates } from "./scenarioTemplates";
import type { TrpgScenarioTemplate } from "./scenarioTypes";
import { parseTrpgVisibility, type TrpgVisibility } from "./types";
import {
  EMPTY_TRPG_CATALOG_PLAY_SCORES,
  type TrpgCatalogPlayScore,
  type TrpgCatalogPlayScores,
} from "./catalogPlayScores";

export type { TrpgCatalogPlayScore, TrpgCatalogPlayScores } from "./catalogPlayScores";
export { EMPTY_TRPG_CATALOG_PLAY_SCORES } from "./catalogPlayScores";

export type TrpgCatalogWorld = {
  id: number;
  name: string;
  summary: string;
  content: string;
  creatorId: number;
  creatorName: string;
  visibility: TrpgVisibility;
  trpgEnabled: boolean;
  mine: boolean;
  genres: CharacterGenre[];
  coverUrl: string;
  updatedAt: string;
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

/** Campaign-start window used by the TRPG lobby “실시간 랭킹” row. */
export const TRPG_LIVE_RANKING_SINCE_SQL = "datetime('now', '-1 day')";

function tableExists(db: Database.Database, name: string): boolean {
  const row = db
    .prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?`)
    .get(name) as { ok: number } | undefined;
  return Boolean(row);
}

function tableColumns(db: Database.Database, name: string): Set<string> {
  return new Set(
    (db.prepare(`PRAGMA table_info(${name})`).all() as { name: string }[]).map((col) => col.name)
  );
}

function mapPlayScores(
  rows: Array<{ id: number; all_starts: number; recent_starts: number }>
): Record<number, TrpgCatalogPlayScore> {
  const out: Record<number, TrpgCatalogPlayScore> = {};
  for (const row of rows) {
    if (!Number.isInteger(row.id) || row.id <= 0) continue;
    out[row.id] = {
      recent: Number(row.recent_starts) || 0,
      all: Number(row.all_starts) || 0,
    };
  }
  return out;
}

/** Public catalog ranking scores: campaign starts in the last 24h, then all-time. */
export function loadTrpgCatalogPlayScores(db: Database.Database): TrpgCatalogPlayScores {
  if (!tableExists(db, "trpg_campaigns")) return EMPTY_TRPG_CATALOG_PLAY_SCORES;
  const cols = tableColumns(db, "trpg_campaigns");
  if (!cols.has("source_world_id") || !cols.has("created_at")) {
    return EMPTY_TRPG_CATALOG_PLAY_SCORES;
  }

  const worldRows = db
    .prepare(
      `SELECT source_world_id AS id,
              COUNT(*) AS all_starts,
              COALESCE(SUM(CASE WHEN created_at >= ${TRPG_LIVE_RANKING_SINCE_SQL} THEN 1 ELSE 0 END), 0) AS recent_starts
       FROM trpg_campaigns
       WHERE source_world_id IS NOT NULL
       GROUP BY source_world_id`
    )
    .all() as Array<{ id: number; all_starts: number; recent_starts: number }>;

  const scenarioRows = cols.has("template_id")
    ? (db
        .prepare(
          `SELECT template_id AS id,
                  COUNT(*) AS all_starts,
                  COALESCE(SUM(CASE WHEN created_at >= ${TRPG_LIVE_RANKING_SINCE_SQL} THEN 1 ELSE 0 END), 0) AS recent_starts
           FROM trpg_campaigns
           WHERE template_id IS NOT NULL
           GROUP BY template_id`
        )
        .all() as Array<{ id: number; all_starts: number; recent_starts: number }>)
    : [];

  return {
    worlds: mapPlayScores(worldRows),
    scenarios: mapPlayScores(scenarioRows),
  };
}

function mapWorld(row: {
  id: number;
  creator_id: number;
  name: string;
  summary: string;
  content?: string | null;
  trpg_enabled: number;
  trpg_visibility: string;
  creator_name: string | null;
  mine: number;
  genres: string | null;
  cover_url?: string | null;
  updated_at?: string | null;
}): TrpgCatalogWorld {
  return {
    id: row.id,
    name: row.name,
    summary: row.summary,
    content: String(row.content ?? ""),
    creatorId: row.creator_id,
    creatorName: (row.creator_name ?? "").trim() || "제작자",
    visibility: parseTrpgVisibility(row.trpg_visibility),
    trpgEnabled: row.trpg_enabled === 1,
    mine: row.mine === 1,
    genres: parseGenresJson(row.genres),
    coverUrl: sanitizeWorldCoverUrl(row.cover_url),
    updatedAt: String(row.updated_at ?? ""),
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
    publicScenarios: listPublicScenarioTemplates(db, 80),
    myScenarios: listMyScenarioTemplates(db, userId),
  };
  if (!tableExists(db, "worlds")) return empty;

  const hasUsers = tableExists(db, "users");
  const creatorNameSql = hasUsers
    ? `COALESCE((SELECT nickname FROM users WHERE id = w.creator_id), '')`
    : `''`;

  const publicWorlds = db
    .prepare(
      `SELECT w.id, w.creator_id, w.name, w.summary, w.content,
              COALESCE(w.trpg_enabled, 0) AS trpg_enabled,
              COALESCE(w.trpg_visibility, 'private') AS trpg_visibility,
              COALESCE(w.genres, '[]') AS genres,
              COALESCE(w.cover_url, '') AS cover_url,
              COALESCE(w.updated_at, '') AS updated_at,
              ${creatorNameSql} AS creator_name,
              CASE WHEN w.creator_id=? THEN 1 ELSE 0 END AS mine
       FROM worlds w
       WHERE COALESCE(w.trpg_enabled, 0)=1 AND COALESCE(w.trpg_visibility, 'private')='public'
       ORDER BY w.updated_at DESC, w.id DESC
       LIMIT 80`
    )
    .all(userId) as Array<{
    id: number;
    creator_id: number;
    name: string;
    summary: string;
    content: string | null;
    trpg_enabled: number;
    trpg_visibility: string;
    creator_name: string | null;
    mine: number;
    genres: string | null;
    cover_url: string | null;
    updated_at: string | null;
  }>;

  const myWorlds = db
    .prepare(
      `SELECT w.id, w.creator_id, w.name, w.summary, w.content,
              COALESCE(w.trpg_enabled, 0) AS trpg_enabled,
              COALESCE(w.trpg_visibility, 'private') AS trpg_visibility,
              COALESCE(w.genres, '[]') AS genres,
              COALESCE(w.cover_url, '') AS cover_url,
              COALESCE(w.updated_at, '') AS updated_at,
              ${creatorNameSql} AS creator_name,
              1 AS mine
       FROM worlds w
       WHERE w.creator_id=?
       ORDER BY w.updated_at DESC, w.id DESC
       LIMIT 80`
    )
    .all(userId) as Array<{
    id: number;
    creator_id: number;
    name: string;
    summary: string;
    content: string | null;
    trpg_enabled: number;
    trpg_visibility: string;
    creator_name: string | null;
    mine: number;
    genres: string | null;
    cover_url: string | null;
    updated_at: string | null;
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

export function loadAccessibleTrpgCharacter(
  db: Database.Database,
  id: number,
  viewerUserId: number
): TrpgCatalogCharacter | null {
  if (!tableExists(db, "characters")) return null;
  const row = db
    .prepare(
      `SELECT id, name, tagline, COALESCE(emoji, '✨') AS emoji,
              creator_id, visibility, moderation_status, share_slug, official, trpg_reuse_allowed
       FROM characters WHERE id=?`
    )
    .get(id) as
    | (CharacterAccessRow & { name: string; tagline: string; emoji: string })
    | undefined;
  if (!row) return null;
  if (!canUseCharacterInTrpg(row, viewerUserId)) return null;
  return {
    id: row.id,
    name: row.name,
    tagline: row.tagline ?? "",
    emoji: row.emoji || "✨",
  };
}

export function mergeCatalogCharacters(
  catalog: TrpgCatalog,
  extras: Array<TrpgCatalogCharacter | null | undefined>
): TrpgCatalog {
  const seen = new Set(catalog.myCharacters.map((c) => c.id));
  const myCharacters = [...catalog.myCharacters];
  for (const extra of extras) {
    if (!extra || seen.has(extra.id)) continue;
    seen.add(extra.id);
    myCharacters.unshift(extra);
  }
  return { ...catalog, myCharacters };
}
