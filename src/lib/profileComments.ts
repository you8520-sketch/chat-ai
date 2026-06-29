import type Database from "better-sqlite3";
import { getDb } from "./db";
import { checkCommentWriteEligibility } from "@/lib/commentPolicy";

export type ProfileCommentTarget = "creator" | "character";

export type ProfileComment = {
  id: number;
  target_type: ProfileCommentTarget;
  target_id: number;
  author_id: number;
  author_name: string;
  content: string;
  is_private: number;
  created_at: string;
  is_blinded: number;
  report_count: number;
  moderation_status: string;
  normalized_content: string | null;
  delete_reason: string | null;
};

export function isUserCommentBanned(db: Database.Database, userId: number): boolean {
  const row = db.prepare("SELECT comment_banned FROM users WHERE id=?").get(userId) as
    | { comment_banned: number }
    | undefined;
  return (row?.comment_banned ?? 0) !== 0;
}

export function getCreatorCommentsEnabled(db: Database.Database, creatorId: number): boolean {
  const row = db.prepare("SELECT creator_comments_enabled FROM users WHERE id=?").get(creatorId) as
    | { creator_comments_enabled: number }
    | undefined;
  return (row?.creator_comments_enabled ?? 1) !== 0;
}

export function getCharacterCommentsEnabled(db: Database.Database, characterId: number): boolean {
  const row = db
    .prepare(
      `SELECT c.comments_enabled, c.creator_id, u.creator_comments_enabled
       FROM characters c
       LEFT JOIN users u ON u.id = c.creator_id
       WHERE c.id=?`
    )
    .get(characterId) as
    | { comments_enabled: number; creator_id: number | null; creator_comments_enabled: number | null }
    | undefined;
  if (!row) return false;
  if (row.creator_id != null && row.creator_comments_enabled === 0) return false;
  return (row.comments_enabled ?? 1) !== 0;
}

export function isProfileCommentsEnabled(
  db: Database.Database,
  targetType: ProfileCommentTarget,
  targetId: number
): boolean {
  if (targetType === "creator") return getCreatorCommentsEnabled(db, targetId);
  return getCharacterCommentsEnabled(db, targetId);
}

export function resolveTargetOwnerId(
  db: Database.Database,
  targetType: ProfileCommentTarget,
  targetId: number
): number | null {
  if (targetType === "creator") return targetId;
  const row = db.prepare("SELECT creator_id FROM characters WHERE id=?").get(targetId) as
    | { creator_id: number | null }
    | undefined;
  return row?.creator_id ?? null;
}

/** 유저가 해당 캐릭터 채팅방에서 1회 이상 발화했는지 */
export function userHasCharacterChatHistory(
  db: Database.Database,
  userId: number,
  characterId: number
): boolean {
  const row = db
    .prepare(
      `SELECT 1 AS ok
       FROM chats ch
       INNER JOIN messages m ON m.chat_id = ch.id AND m.role = 'user'
       WHERE ch.user_id = ? AND ch.character_id = ?
       LIMIT 1`
    )
    .get(userId, characterId) as { ok: number } | undefined;
  return row != null;
}

/** 댓글 외 실질적인 사이트 이용(대화·좋아요·제작·포인트 사용 등) */
export function userHasMeaningfulSiteActivity(db: Database.Database, userId: number): boolean {
  const chatted = db
    .prepare(
      `SELECT 1 AS ok FROM chats ch
       INNER JOIN messages m ON m.chat_id = ch.id AND m.role = 'user'
       WHERE ch.user_id = ?
       LIMIT 1`
    )
    .get(userId) as { ok: number } | undefined;
  if (chatted) return true;

  const liked = db
    .prepare("SELECT 1 AS ok FROM likes WHERE user_id=? LIMIT 1")
    .get(userId) as { ok: number } | undefined;
  if (liked) return true;

  const created = db
    .prepare("SELECT 1 AS ok FROM characters WHERE creator_id=? LIMIT 1")
    .get(userId) as { ok: number } | undefined;
  if (created) return true;

  const spent = db
    .prepare("SELECT 1 AS ok FROM point_logs WHERE user_id=? AND delta < 0 LIMIT 1")
    .get(userId) as { ok: number } | undefined;
  if (spent) return true;

  const gifted = db
    .prepare("SELECT 1 AS ok FROM point_gifts WHERE sender_id=? OR recipient_id=? LIMIT 1")
    .get(userId, userId) as { ok: number } | undefined;
  if (gifted) return true;

  const followed = db
    .prepare("SELECT 1 AS ok FROM follows WHERE user_id=? LIMIT 1")
    .get(userId) as { ok: number } | undefined;
  if (followed) return true;

  return false;
}

/** 캐릭터 프로필 댓글 작성 가능 여부 (제작자는 예외) */
export function canWriteCharacterProfileComment(
  db: Database.Database,
  userId: number,
  characterId: number,
  ownerId: number | null
): boolean {
  if (ownerId != null && userId === ownerId) return true;
  return checkCommentWriteEligibility(db, userId, { characterId }).ok;
}

/** 크리에이터 프로필 댓글 작성 가능 여부 */
export function canWriteCreatorProfileComment(
  db: Database.Database,
  userId: number,
  ownerId: number
): boolean {
  if (userId === ownerId) return true;
  return checkCommentWriteEligibility(db, userId, {}).ok;
}

export function getCommentWriteBlockedMessage(
  db: Database.Database,
  userId: number,
  opts: { characterId?: number; isOwner?: boolean }
): string {
  const result = checkCommentWriteEligibility(db, userId, opts);
  return result.ok ? "" : result.message;
}

export function listProfileCommentsForViewer(
  db: Database.Database,
  targetType: ProfileCommentTarget,
  targetId: number,
  viewerId: number | null,
  ownerId: number | null,
  limit = 100
): ProfileComment[] {
  const isOwner = viewerId != null && ownerId != null && viewerId === ownerId;
  const rows = db
    .prepare(
      `SELECT id, target_type, target_id, author_id, author_name, content, is_private, created_at,
              COALESCE(is_blinded, 0) AS is_blinded,
              COALESCE(report_count, 0) AS report_count,
              COALESCE(moderation_status, 'visible') AS moderation_status,
              normalized_content, delete_reason
       FROM profile_comments
       WHERE target_type=? AND target_id=? AND COALESCE(moderation_status, 'visible') != 'deleted'
       ORDER BY created_at ASC, id ASC
       LIMIT ?`
    )
    .all(targetType, targetId, limit) as ProfileComment[];

  if (isOwner) return rows;
  return rows.filter((c) => c.is_private === 0 && c.is_blinded === 0);
}

/** @deprecated use listProfileCommentsForViewer */
export function listProfileComments(
  db: Database.Database,
  targetType: ProfileCommentTarget,
  targetId: number,
  limit = 100
): ProfileComment[] {
  return listProfileCommentsForViewer(db, targetType, targetId, null, null, limit).filter(
    (c) => c.is_private === 0
  );
}

export function getProfileCommentById(db: Database.Database, commentId: number): ProfileComment | null {
  return (
    (db
      .prepare(
        `SELECT id, target_type, target_id, author_id, author_name, content, is_private, created_at,
                COALESCE(is_blinded, 0) AS is_blinded,
                COALESCE(report_count, 0) AS report_count,
                COALESCE(moderation_status, 'visible') AS moderation_status,
                normalized_content, delete_reason
         FROM profile_comments WHERE id=?`
      )
      .get(commentId) as ProfileComment | undefined) ?? null
  );
}

export type BlockCommentAuthorResult =
  | { ok: true }
  | { ok: false; error: string; status: number };

/** 악성 댓글 작성자 차단 — 댓글만 단 계정(이용 내역 없음)만 가능 */
export function blockProfileCommentAuthor(
  db: Database.Database,
  ownerId: number,
  commentId: number
): BlockCommentAuthorResult {
  const comment = getProfileCommentById(db, commentId);
  if (!comment) return { ok: false, error: "댓글을 찾을 수 없습니다.", status: 404 };

  const targetOwnerId = resolveTargetOwnerId(db, comment.target_type, comment.target_id);
  if (targetOwnerId !== ownerId) {
    return { ok: false, error: "차단 권한이 없습니다.", status: 403 };
  }
  if (comment.author_id === ownerId) {
    return { ok: false, error: "본인 댓글은 차단할 수 없습니다.", status: 400 };
  }
  if (isUserCommentBanned(db, comment.author_id)) {
    return { ok: true };
  }
  if (userHasMeaningfulSiteActivity(db, comment.author_id)) {
    return {
      ok: false,
      error: "대화·좋아요 등 이용 기록이 있는 사용자는 차단할 수 없습니다.",
      status: 409,
    };
  }

  db.transaction(() => {
    db.prepare("UPDATE users SET comment_banned=1 WHERE id=?").run(comment.author_id);
    db.prepare("DELETE FROM profile_comments WHERE author_id=?").run(comment.author_id);
  })();

  return { ok: true };
}

export function mapProfileCommentForClient(
  c: ProfileComment,
  viewerIsOwner: boolean
): {
  id: number;
  author_id: number;
  author_name: string;
  content: string;
  created_at: string;
  is_private: boolean;
  is_blinded: boolean;
  report_count: number;
  moderation_status: string;
} {
  return {
    id: c.id,
    author_id: c.author_id,
    author_name: c.author_name,
    content: c.content,
    created_at: c.created_at,
    is_private: viewerIsOwner ? c.is_private !== 0 : false,
    is_blinded: c.is_blinded !== 0,
    report_count: c.report_count,
    moderation_status: c.moderation_status,
  };
}
