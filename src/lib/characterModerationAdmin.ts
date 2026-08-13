import type Database from "better-sqlite3";
import {
  notifyCharacterReviewResult,
  notifyFollowersOfNewCharacter,
} from "@/lib/userNotifications";
import type { ModerationStatus } from "@/lib/characterVisibility";

export type CharacterModerationAdminRow = {
  id: number;
  name: string;
  nsfw: number;
  visibility: string;
  moderation_status: ModerationStatus;
  moderation_note: string;
  creator_id: number;
  creator_name: string;
  creator_email: string;
  updated_at: string;
};

export function listCharactersForModeration(
  db: Database.Database,
  status: ModerationStatus | "all"
): CharacterModerationAdminRow[] {
  const where =
    status === "all"
      ? `c.moderation_status IN ('pending','approved','rejected') AND c.official=0`
      : `c.moderation_status=? AND c.official=0`;
  const sql = `SELECT c.id, c.name, c.nsfw, c.visibility, c.moderation_status, c.moderation_note,
                      c.creator_id, COALESCE(c.creator_name, '') AS creator_name,
                      COALESCE(u.email, '') AS creator_email, c.updated_at
               FROM characters c
               LEFT JOIN users u ON u.id = c.creator_id
               WHERE ${where}
               ORDER BY c.updated_at DESC, c.id DESC
               LIMIT 200`;
  const rows =
    status === "all"
      ? (db.prepare(sql).all() as CharacterModerationAdminRow[])
      : (db.prepare(sql).all(status) as CharacterModerationAdminRow[]);
  return rows.map((row) => ({
    ...row,
    moderation_note: row.moderation_note ?? "",
  }));
}

export function reviewCharacterListing(
  db: Database.Database,
  characterId: number,
  _adminUserId: number,
  action: "approve" | "reject",
  adminNote: string
): { ok: true } | { ok: false; error: string; status: number } {
  const row = db
    .prepare(
      `SELECT id, name, creator_id, creator_name, visibility, moderation_status, nsfw, official
       FROM characters WHERE id=?`
    )
    .get(characterId) as
    | {
        id: number;
        name: string;
        creator_id: number | null;
        creator_name: string | null;
        visibility: string;
        moderation_status: ModerationStatus;
        nsfw: number;
        official: number;
      }
    | undefined;
  if (!row || row.official === 1) {
    return { ok: false, error: "캐릭터를 찾을 수 없습니다.", status: 404 };
  }
  if (row.moderation_status !== "pending") {
    return { ok: false, error: "검수 대기 중인 캐릭터만 처리할 수 있습니다.", status: 400 };
  }

  const note = adminNote.trim().slice(0, 300);
  switch (action) {
    case "approve": {
      db.prepare(
        `UPDATE characters
         SET moderation_status='approved', moderation_note=?, updated_at=datetime('now')
         WHERE id=?`
      ).run(note || "관리자 승인", characterId);
      if (row.creator_id) {
        notifyCharacterReviewResult(db, {
          userId: row.creator_id,
          characterId,
          characterName: row.name,
          approved: true,
          note,
        });
        if (row.visibility === "public") {
          notifyFollowersOfNewCharacter(
            db,
            row.creator_id,
            row.creator_name || "제작자",
            characterId,
            row.name
          );
        }
      }
      return { ok: true };
    }
    case "reject": {
      db.prepare(
        `UPDATE characters
         SET visibility='private', moderation_status='rejected', moderation_note=?, share_slug=NULL,
             updated_at=datetime('now')
         WHERE id=?`
      ).run(note || "관리자 반려", characterId);
      if (row.creator_id) {
        notifyCharacterReviewResult(db, {
          userId: row.creator_id,
          characterId,
          characterName: row.name,
          approved: false,
          note: note || "관리자 반려",
        });
      }
      return { ok: true };
    }
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}
