import { parseGenresJson, type CharacterGenre } from "@/lib/characterGenres";
import { isVercelPublicBlobUrl } from "@/lib/uploadUrls";

export const WORLD_NAME_LIMIT = 40;
export const WORLD_SUMMARY_LIMIT = 100;
export const WORLD_CONTENT_LIMIT = 10000;

export const WORLD_SELECT_COLUMNS = `id, creator_id, name, summary, content, created_at, updated_at,
              COALESCE(shared_from_nickname, '') AS shared_from_nickname,
              COALESCE(trpg_enabled, 0) AS trpg_enabled,
              COALESCE(trpg_visibility, 'private') AS trpg_visibility,
              COALESCE(genres, '[]') AS genres,
              COALESCE(cover_url, '') AS cover_url`;

export type WorldRow = {
  id: number;
  creator_id: number;
  name: string;
  summary: string;
  content: string;
  created_at: string;
  updated_at: string;
  shared_from_nickname?: string;
  trpg_enabled?: number;
  trpg_visibility?: string;
  genres?: string;
  cover_url?: string;
};

export type WorldListItem = {
  id: number;
  name: string;
  summary: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  /** 공유받아 추가된 경우 원 작성자 닉네임 */
  sharedFromNickname?: string;
  trpgEnabled: boolean;
  trpgVisibility: "public" | "private";
  genres: CharacterGenre[];
  coverUrl: string;
};

export type WorldStudioKind = "world" | "scenario";

export function parseWorldStudioKind(raw: unknown): WorldStudioKind {
  return raw === "scenario" || raw === "trpg" ? "scenario" : "world";
}

export function parseWorldTrpgVisibility(value: unknown): "public" | "private" {
  return value === "public" ? "public" : "private";
}

export function parseWorldTrpgFlags(body: { trpgEnabled?: unknown; trpgVisibility?: unknown }): {
  trpgEnabled: number;
  trpgVisibility: "public" | "private";
} {
  const trpgEnabled = body.trpgEnabled === true || body.trpgEnabled === 1 || body.trpgEnabled === "1" ? 1 : 0;
  return {
    trpgEnabled,
    trpgVisibility: trpgEnabled ? "public" : "private",
  };
}

const WORLD_COVER_URL_RE = /^\/uploads\/[A-Za-z0-9._-]+$/;

/** Accepts app-hosted paths and public Vercel Blob uploads. */
export function sanitizeWorldCoverUrl(raw: unknown): string {
  const value = String(raw ?? "").trim();
  return WORLD_COVER_URL_RE.test(value) || isVercelPublicBlobUrl(value)
    ? value
    : "";
}

export function rowToWorldListItem(row: WorldRow): WorldListItem {
  const sharedFrom = (row.shared_from_nickname ?? "").trim();
  return {
    id: row.id,
    name: row.name,
    summary: row.summary,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(sharedFrom ? { sharedFromNickname: sharedFrom } : {}),
    trpgEnabled: Number(row.trpg_enabled ?? 0) === 1,
    trpgVisibility: parseWorldTrpgVisibility(row.trpg_visibility),
    genres: parseGenresJson(row.genres),
    coverUrl: sanitizeWorldCoverUrl(row.cover_url),
  };
}
