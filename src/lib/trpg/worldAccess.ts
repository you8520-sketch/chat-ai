import type Database from "better-sqlite3";
import { isLegacyBorrowedWorld } from "@/lib/worldPermissions";
import { parseTrpgVisibility } from "./types";

function tableExists(db: Database.Database, name: string): boolean {
  const row = db
    .prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?`)
    .get(name) as { ok: number } | undefined;
  return Boolean(row);
}

export type TrpgWorldAccessRow = {
  id: number;
  creator_id: number;
  name: string;
  summary: string;
  content: string;
  trpg_enabled: number;
  trpg_visibility: string;
  shared_from_nickname?: string;
};

export function canUseWorldForTrpg(
  world: {
    creator_id: number;
    trpg_enabled?: number | null;
    trpg_visibility?: string | null;
    shared_from_nickname?: string | null;
  },
  viewerUserId: number
): boolean {
  if (isLegacyBorrowedWorld({ shared_from_nickname: world.shared_from_nickname ?? "" })) return false;
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
                COALESCE(trpg_visibility, 'private') AS trpg_visibility,
                COALESCE(shared_from_nickname, '') AS shared_from_nickname
         FROM worlds WHERE id=?`
      )
      .get(id) as TrpgWorldAccessRow | undefined) ?? null
  );
}
