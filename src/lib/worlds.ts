import { parseGenresJson, type CharacterGenre } from "@/lib/characterGenres";
import type { WorldLibraryKind } from "@/lib/worldPermissions";
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
  /** owned = 직접 제작, borrowed = world_borrows 참조, legacy_borrowed = 예전 import 복사본 */
  libraryKind?: WorldLibraryKind;
  /** UI/서버 공통 읽기 전용 플래그 */
  readOnly?: boolean;
  borrowId?: number;
  shareId?: number;
  shareSlug?: string;
  /** revoked/source_deleted 시 false — 기존 캐릭터 스냅샷에는 영향 없음 */
  shareAvailable?: boolean;
};

/** Live borrow references with revoked/deleted shares cannot be used for new character/simulation creation. */
export function isBorrowAvailableForNewUse(
  item: Pick<WorldListItem, "libraryKind" | "shareAvailable">
): boolean {
  if (item.libraryKind !== "borrowed") return true;
  return item.shareAvailable !== false;
}

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

export function worldLibraryRef(world: WorldListItem): string {
  if (world.libraryKind === "borrowed" && world.borrowId) return `borrow:${world.borrowId}`;
  return `world:${world.id}`;
}

export function savedShareWorldLibraryRef(shareId: number): string {
  return `saved-share:${shareId}`;
}

export function parseWorldLibraryRef(ref: string): {
  worldId?: number;
  borrowId?: number;
  savedShareId?: number;
} {
  if (ref.startsWith("saved-share:")) {
    const savedShareId = Number(ref.slice("saved-share:".length));
    return Number.isInteger(savedShareId) && savedShareId > 0 ? { savedShareId } : {};
  }
  if (ref.startsWith("borrow:")) {
    const borrowId = Number(ref.slice("borrow:".length));
    return Number.isInteger(borrowId) && borrowId > 0 ? { borrowId } : {};
  }
  if (ref.startsWith("world:")) {
    const worldId = Number(ref.slice("world:".length));
    return Number.isInteger(worldId) && worldId > 0 ? { worldId } : {};
  }
  return {};
}

export function isReadOnlyWorldLibraryRef(ref: string): boolean {
  if (ref.startsWith("saved-share:")) return true;
  const parsed = parseWorldLibraryRef(ref);
  if (parsed.borrowId) return true;
  return false;
}
