import { getDb } from "@/lib/db";
import type { WorldRow } from "@/lib/worlds";

export type WorldLibraryKind = "owned" | "borrowed" | "legacy_borrowed";

export type CharacterWorldSourceKind =
  | "direct"
  | "owned"
  | "borrowed_snapshot"
  | "legacy_borrowed_snapshot";

export function isLegacyBorrowedWorld(row: Pick<WorldRow, "shared_from_nickname">): boolean {
  return Boolean((row.shared_from_nickname ?? "").trim());
}

export function loadOwnedWorldRow(userId: number, worldId: number): WorldRow | undefined {
  return getDb()
    .prepare(
      `SELECT id, creator_id, name, summary, content, created_at, updated_at,
              COALESCE(shared_from_nickname, '') AS shared_from_nickname,
              COALESCE(trpg_enabled, 0) AS trpg_enabled,
              COALESCE(trpg_visibility, 'private') AS trpg_visibility,
              COALESCE(genres, '[]') AS genres,
              COALESCE(cover_url, '') AS cover_url
       FROM worlds WHERE id = ? AND creator_id = ?`
    )
    .get(worldId, userId) as WorldRow | undefined;
}

export function getWorldLibraryKind(row: WorldRow): WorldLibraryKind {
  return isLegacyBorrowedWorld(row) ? "legacy_borrowed" : "owned";
}

export function isWorldReadOnly(row: WorldRow): boolean {
  return isLegacyBorrowedWorld(row);
}

export function canEditWorld(userId: number, worldId: number): boolean {
  const row = loadOwnedWorldRow(userId, worldId);
  if (!row) return false;
  return !isLegacyBorrowedWorld(row);
}

export function canDeleteWorldFromLibrary(userId: number, worldId: number): boolean {
  return loadOwnedWorldRow(userId, worldId) != null;
}

export function canShareWorld(userId: number, worldId: number): boolean {
  const row = loadOwnedWorldRow(userId, worldId);
  if (!row) return false;
  return !isLegacyBorrowedWorld(row);
}

export function deriveCharacterWorldSourceKind(row: {
  source_world_share_id?: number | null;
  world_id?: number | null;
  shared_from_nickname?: string | null;
}): CharacterWorldSourceKind {
  if (row.source_world_share_id != null && row.source_world_share_id > 0) {
    return "borrowed_snapshot";
  }
  if (row.world_id != null && row.world_id > 0) {
    if ((row.shared_from_nickname ?? "").trim()) return "legacy_borrowed_snapshot";
    return "owned";
  }
  return "direct";
}

export type WorldShareAvailability = {
  available: boolean;
  reason?: "revoked" | "source_deleted" | "not_found";
};

export function getWorldShareAvailability(shareId: number): WorldShareAvailability {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT s.id, s.revoked_at, s.world_id,
              w.id AS source_world_exists
       FROM world_shares s
       LEFT JOIN worlds w ON w.id = s.world_id
       WHERE s.id = ?`
    )
    .get(shareId) as
    | {
        id: number;
        revoked_at: string | null;
        world_id: number | null;
        source_world_exists: number | null;
      }
    | undefined;
  if (!row) return { available: false, reason: "not_found" };
  if (row.revoked_at) return { available: false, reason: "revoked" };
  if (row.world_id != null && row.source_world_exists == null) {
    return { available: false, reason: "source_deleted" };
  }
  return { available: true };
}

export function assertWorldShareAvailable(shareId: number): WorldShareAvailability {
  const status = getWorldShareAvailability(shareId);
  return status;
}
