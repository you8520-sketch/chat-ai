import type Database from "better-sqlite3";
import {
  getCharacterRepresentativeImageUrl,
  parseAssets,
  type CharacterAsset,
} from "@/lib/characterAssets";
import {
  notifyCharacterReviewResult,
  notifyFollowersOfNewCharacter,
} from "@/lib/userNotifications";
import type { ModerationStatus } from "@/lib/characterVisibility";

export type CharacterModerationReviewAsset = {
  url: string;
  tag: string;
  adultFlagged: boolean | null;
  moderationReject: boolean | null;
  moderationReason: string;
};

export type CharacterModerationAdminRow = {
  id: number;
  name: string;
  nsfw: number;
  official: number;
  visibility: string;
  moderation_status: ModerationStatus;
  moderation_note: string;
  creator_id: number;
  creator_name: string;
  creator_email: string;
  updated_at: string;
  representative_image_url: string | null;
  assets: CharacterModerationReviewAsset[];
};

function reviewAssetView(asset: CharacterAsset): CharacterModerationReviewAsset {
  return {
    url: asset.url,
    tag: asset.tag,
    adultFlagged: typeof asset.adultFlagged === "boolean" ? asset.adultFlagged : null,
    moderationReject: typeof asset.moderationReject === "boolean" ? asset.moderationReject : null,
    moderationReason: asset.moderationReason ?? "",
  };
}

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${JSON.stringify(table)})`).all() as Array<{
    name?: string;
  }>;
  return rows.some((row) => row.name === column);
}

function pendingQueueWhere(): string {
  // Every pending row must be reviewable, including leftover official=1 pending.
  return `c.moderation_status='pending'`;
}

function nonPendingQueueWhere(status: Exclude<ModerationStatus, "pending"> | "all"): string {
  if (status === "all") {
    return `(c.moderation_status IN ('pending','approved','rejected') AND (c.official=0 OR c.moderation_status='pending'))`;
  }
  return `c.moderation_status=? AND c.official=0`;
}

function decorateRow(
  row: Omit<CharacterModerationAdminRow, "assets" | "representative_image_url" | "moderation_note"> & {
    moderation_note: string | null;
    assets_json?: string | null;
    images_json?: string | null;
  }
): CharacterModerationAdminRow {
  const assets = parseAssets(row.assets_json).map(reviewAssetView);
  return {
    id: row.id,
    name: row.name,
    nsfw: row.nsfw,
    official: row.official,
    visibility: row.visibility,
    moderation_status: row.moderation_status,
    moderation_note: row.moderation_note ?? "",
    creator_id: row.creator_id,
    creator_name: row.creator_name,
    creator_email: row.creator_email,
    updated_at: row.updated_at,
    representative_image_url:
      getCharacterRepresentativeImageUrl(row.assets_json, row.images_json) ?? assets[0]?.url ?? null,
    assets,
  };
}

export function listCharactersForModeration(
  db: Database.Database,
  status: ModerationStatus | "all"
): CharacterModerationAdminRow[] {
  const where = status === "pending" ? pendingQueueWhere() : nonPendingQueueWhere(status);
  const orderBy = hasColumn(db, "characters", "updated_at")
    ? `COALESCE(NULLIF(c.updated_at, ''), c.created_at) DESC, c.id DESC`
    : `c.created_at DESC, c.id DESC`;
  const updatedSelect = hasColumn(db, "characters", "updated_at")
    ? `COALESCE(NULLIF(c.updated_at, ''), c.created_at, '') AS updated_at`
    : `COALESCE(c.created_at, '') AS updated_at`;
  const sql = `SELECT c.id, c.name, c.nsfw, COALESCE(c.official, 0) AS official, c.visibility,
                      c.moderation_status, c.moderation_note,
                      c.creator_id, COALESCE(c.creator_name, '') AS creator_name,
                      COALESCE(u.email, '') AS creator_email, ${updatedSelect},
                      c.assets AS assets_json, c.images AS images_json
               FROM characters c
               LEFT JOIN users u ON u.id = c.creator_id
               WHERE ${where}
               ORDER BY ${orderBy}
               LIMIT 200`;
  const raw =
    status === "all" || status === "pending"
      ? (db.prepare(sql).all() as Array<Parameters<typeof decorateRow>[0]>)
      : (db.prepare(sql).all(status) as Array<Parameters<typeof decorateRow>[0]>);
  return raw.map(decorateRow);
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
  if (!row) {
    return { ok: false, error: "캐릭터를 찾을 수 없습니다.", status: 404 };
  }
  if (row.moderation_status !== "pending") {
    return { ok: false, error: "검수 대기 중인 캐릭터만 처리할 수 있습니다.", status: 400 };
  }

  const note = adminNote.trim().slice(0, 300);
  const stamp = hasColumn(db, "characters", "updated_at")
    ? ", updated_at=datetime('now')"
    : "";
  switch (action) {
    case "approve": {
      db.prepare(
        `UPDATE characters
         SET moderation_status='approved', moderation_note=?${stamp}
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
         SET visibility='private', moderation_status='rejected', moderation_note=?, share_slug=NULL${stamp}
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
