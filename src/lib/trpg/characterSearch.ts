import type Database from "better-sqlite3";
import { listableWhere } from "@/lib/characterVisibility";
import { sanitizeSearchQuery, searchSqlLikePattern } from "@/lib/tagSearch";

export type TrpgCharacterSearchScope = "mine" | "search";

export type TrpgCharacterSearchHit = {
  id: number;
  name: string;
  tagline: string;
  emoji: string;
  creatorName: string;
  mine: boolean;
};

function tableExists(db: Database.Database, name: string): boolean {
  const row = db
    .prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?`)
    .get(name) as { ok: number } | undefined;
  return Boolean(row);
}

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return cols.some((c) => c.name === column);
}

export function searchTrpgCharacters(
  db: Database.Database,
  opts: { viewerUserId: number; scope: TrpgCharacterSearchScope; query?: string }
): TrpgCharacterSearchHit[] {
  if (!tableExists(db, "characters")) return [];
  const query = sanitizeSearchQuery(opts.query ?? "");
  const like = searchSqlLikePattern(query);
  const kindFilter = hasColumn(db, "characters", "content_kind")
    ? `AND COALESCE(content_kind, 'character')='character'`
    : "";
  const emojiSql = hasColumn(db, "characters", "emoji") ? `COALESCE(emoji, '✨')` : `'✨'`;
  const creatorSql = hasColumn(db, "characters", "creator_name")
    ? `COALESCE(creator_name, '')`
    : `''`;
  const reuseSql = hasColumn(db, "characters", "trpg_reuse_allowed")
    ? `COALESCE(trpg_reuse_allowed, 0)=1`
    : `1=1`;
  const createdOrder = hasColumn(db, "characters", "created_at") ? `created_at DESC, id DESC` : `id DESC`;
  const searchOrder = hasColumn(db, "characters", "likes") ? `likes DESC, id DESC` : `id DESC`;
  const nameMatch = query
    ? `AND (name LIKE ? OR tagline LIKE ? OR ${creatorSql} LIKE ?)`
    : "";
  const matchParams = query ? [like, like, like] : [];

  const sql =
    opts.scope === "mine"
      ? `SELECT id, name, tagline, ${emojiSql} AS emoji, ${creatorSql} AS creator_name, 1 AS mine
         FROM characters
         WHERE creator_id=? ${kindFilter} ${nameMatch}
         ORDER BY ${createdOrder}
         LIMIT 60`
      : `SELECT id, name, tagline, ${emojiSql} AS emoji, ${creatorSql} AS creator_name,
                CASE WHEN creator_id=? THEN 1 ELSE 0 END AS mine
         FROM characters
         WHERE ${listableWhere(`official=1 OR ${reuseSql}`)}
           AND (creator_id IS NULL OR creator_id!=?)
           ${kindFilter} ${nameMatch}
         ORDER BY ${searchOrder}
         LIMIT 60`;

  const rows =
    opts.scope === "mine"
      ? (db.prepare(sql).all(opts.viewerUserId, ...matchParams) as Array<{
          id: number;
          name: string;
          tagline: string;
          emoji: string;
          creator_name: string;
          mine: number;
        }>)
      : (db.prepare(sql).all(opts.viewerUserId, opts.viewerUserId, ...matchParams) as Array<{
          id: number;
          name: string;
          tagline: string;
          emoji: string;
          creator_name: string;
          mine: number;
        }>);

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    tagline: row.tagline ?? "",
    emoji: row.emoji || "✨",
    creatorName: (row.creator_name ?? "").trim() || "제작자",
    mine: row.mine === 1,
  }));
}

export function parseTrpgCharacterSearchScope(raw: unknown): TrpgCharacterSearchScope {
  return raw === "search" ? "search" : "mine";
}
