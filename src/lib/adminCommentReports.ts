import type Database from "better-sqlite3";
import { insertCommentModerationLog, maybeBanCommentAuthor } from "@/lib/commentModerationStorage";
import { COMMENT_AUTHOR_BLOCK_STRIKES } from "@/lib/commentModerationPolicy";
import { penalizeCommentReporterTrust } from "@/lib/commentPolicy";
import { getProfileCommentById } from "@/lib/profileComments";
import { notifyCommentModerationResult } from "@/lib/userNotifications";

export type AdminCommentReportStatus = "pending" | "resolved" | "all";

export type AdminCommentReportRow = {
  id: number;
  author_id: number;
  author_name: string;
  content: string;
  created_at: string;
  moderation_status: string;
  report_count: number;
  total_report_count: number;
  target_type: "creator" | "character";
  target_id: number;
  target_label: string;
  comment_banned: number;
  strike_count: number;
  last_action: string | null;
  last_action_at: string | null;
};

export function countPendingCommentReviews(db: Database.Database): number {
  const row = db.prepare("SELECT COUNT(*) AS c FROM profile_comments WHERE moderation_status='blinded'").get() as { c: number };
  return row.c;
}

export function listAdminCommentReports(
  db: Database.Database,
  status: AdminCommentReportStatus = "pending",
  limit = 100
): AdminCommentReportRow[] {
  const where = status === "pending"
    ? "pc.moderation_status='blinded'"
    : status === "resolved"
      ? "pc.moderation_status IN ('visible','deleted') AND EXISTS (SELECT 1 FROM profile_comment_reports pr0 WHERE pr0.comment_id=pc.id)"
      : "EXISTS (SELECT 1 FROM profile_comment_reports pr0 WHERE pr0.comment_id=pc.id)";
  return db.prepare(
    `SELECT pc.id, pc.author_id, pc.author_name, pc.content, pc.created_at,
            pc.moderation_status, pc.target_type, pc.target_id,
            CASE WHEN pc.target_type='character' THEN COALESCE(c.name, '삭제된 캐릭터')
                 ELSE COALESCE(owner.nickname, '크리에이터 프로필') END AS target_label,
            COALESCE(u.comment_banned, 0) AS comment_banned,
            (SELECT COUNT(*) FROM profile_comment_reports pr
             WHERE pr.comment_id=pc.id AND pr.resolved_at IS NULL) AS report_count,
            (SELECT COUNT(*) FROM profile_comment_reports pr
             WHERE pr.comment_id=pc.id) AS total_report_count,
            (SELECT COUNT(*) FROM profile_comment_moderation_logs ml
             WHERE ml.user_id=pc.author_id AND ml.action IN ('blocked_post','deleted_report','deleted_admin')) AS strike_count,
            (SELECT ml.action FROM profile_comment_moderation_logs ml
             WHERE ml.comment_id=pc.id AND ml.event_type='admin_review'
             ORDER BY ml.id DESC LIMIT 1) AS last_action,
            (SELECT ml.created_at FROM profile_comment_moderation_logs ml
             WHERE ml.comment_id=pc.id AND ml.event_type='admin_review'
             ORDER BY ml.id DESC LIMIT 1) AS last_action_at
     FROM profile_comments pc
     LEFT JOIN users u ON u.id=pc.author_id
     LEFT JOIN characters c ON pc.target_type='character' AND c.id=pc.target_id
     LEFT JOIN users owner ON pc.target_type='creator' AND owner.id=pc.target_id
     WHERE ${where}
     ORDER BY CASE WHEN pc.moderation_status='blinded' THEN 0 ELSE 1 END,
              pc.created_at DESC, pc.id DESC
     LIMIT ?`
  ).all(limit) as AdminCommentReportRow[];
}

export type ReviewCommentResult =
  | { ok: true; banned: boolean }
  | { ok: false; status: number; error: string };

export function reviewReportedComment(
  db: Database.Database,
  adminId: number,
  commentId: number,
  action: "delete" | "restore",
  note = ""
): ReviewCommentResult {
  const comment = getProfileCommentById(db, commentId);
  if (!comment) return { ok: false, status: 404, error: "댓글을 찾을 수 없습니다." };
  if (comment.moderation_status !== "blinded") {
    return { ok: false, status: 409, error: "이미 검토가 끝난 댓글입니다." };
  }

  const reporters = db.prepare(
    "SELECT reporter_id FROM profile_comment_reports WHERE comment_id=? AND resolved_at IS NULL"
  ).all(commentId) as { reporter_id: number }[];
  const reason = note.trim() || (action === "delete" ? "신고 누적 관리자 삭제" : "관리자 검토 결과 위반 없음");
  let banned = false;

  db.transaction(() => {
    if (action === "delete") {
      db.prepare(
        "UPDATE profile_comments SET moderation_status='deleted', is_blinded=1, report_count=0, delete_reason=? WHERE id=?"
      ).run(reason, commentId);
      db.prepare(
        "UPDATE profile_comment_reports SET resolution='accepted', resolved_at=datetime('now') WHERE comment_id=? AND resolved_at IS NULL"
      ).run(commentId);
      insertCommentModerationLog(db, {
        comment_id: commentId,
        user_id: comment.author_id,
        event_type: "admin_review",
        original_content: comment.content,
        normalized_content: comment.normalized_content ?? "",
        report_count: reporters.length,
        action: "deleted_admin",
        delete_reason: reason,
        ai_reason: `reviewed_by:${adminId}`,
      });
      banned = maybeBanCommentAuthor(db, comment.author_id, COMMENT_AUTHOR_BLOCK_STRIKES);
    } else {
      db.prepare(
        "UPDATE profile_comments SET moderation_status='visible', is_blinded=0, report_count=0, delete_reason='' WHERE id=?"
      ).run(commentId);
      db.prepare(
        "UPDATE profile_comment_reports SET resolution='rejected', resolved_at=datetime('now') WHERE comment_id=? AND resolved_at IS NULL"
      ).run(commentId);
      for (const reporter of reporters) penalizeCommentReporterTrust(db, reporter.reporter_id);
      insertCommentModerationLog(db, {
        comment_id: commentId,
        user_id: comment.author_id,
        event_type: "admin_review",
        original_content: comment.content,
        normalized_content: comment.normalized_content ?? "",
        report_count: reporters.length,
        action: "restored_admin",
        ai_reason: `reviewed_by:${adminId}`,
        delete_reason: reason,
      });
    }
  })();

  notifyCommentModerationResult(db, {
    userId: comment.author_id,
    commentId,
    deleted: action === "delete",
    banned,
  });
  return { ok: true, banned };
}
