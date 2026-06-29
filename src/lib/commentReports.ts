import type Database from "better-sqlite3";
import { matchCommentBannedWords } from "@/lib/commentBannedWords";
import {
  insertCommentModerationLog,
  maybeBanCommentAuthor,
  moderateCommentWithAi,
} from "@/lib/commentModeration";
import {
  COMMENT_AUTHOR_BLOCK_STRIKES,
  COMMENT_REPORT_BLIND_THRESHOLD,
} from "@/lib/commentModerationPolicy";
import { checkCommentReportEligibility, penalizeCommentReporterTrust } from "@/lib/commentPolicy";
import { getProfileCommentById, resolveTargetOwnerId, type ProfileComment } from "@/lib/profileComments";

export type ReportCommentResult =
  | { ok: true; blinded: boolean; message: string }
  | { ok: false; error: string; status: number };

function resolveCharacterIdForComment(db: Database.Database, comment: ProfileComment): number | undefined {
  if (comment.target_type === "character") return comment.target_id;
  return undefined;
}

export async function reportProfileComment(
  db: Database.Database,
  reporterId: number,
  commentId: number
): Promise<ReportCommentResult> {
  const comment = getProfileCommentById(db, commentId);
  if (!comment) return { ok: false, error: "댓글을 찾을 수 없습니다.", status: 404 };
  if (comment.moderation_status === "deleted") {
    return { ok: false, error: "삭제된 댓글입니다.", status: 410 };
  }
  if (comment.author_id === reporterId) {
    return { ok: false, error: "본인 댓글은 신고할 수 없습니다.", status: 400 };
  }

  const ownerId = resolveTargetOwnerId(db, comment.target_type, comment.target_id);
  if (ownerId === reporterId) {
    return { ok: false, error: "본인 페이지 댓글은 신고 대신 차단 기능을 사용하세요.", status: 400 };
  }

  const eligibility = checkCommentReportEligibility(db, reporterId, {
    characterId: resolveCharacterIdForComment(db, comment),
  });
  if (!eligibility.ok) {
    return { ok: false, error: eligibility.message, status: 403 };
  }

  const existing = db
    .prepare("SELECT id FROM profile_comment_reports WHERE comment_id=? AND reporter_id=?")
    .get(commentId, reporterId);
  if (existing) {
    return { ok: false, error: "이미 신고한 댓글입니다.", status: 409 };
  }

  db.prepare(
    "INSERT INTO profile_comment_reports (comment_id, reporter_id) VALUES (?,?)"
  ).run(commentId, reporterId);

  const reportCountRow = db
    .prepare("SELECT COUNT(*) AS c FROM profile_comment_reports WHERE comment_id=?")
    .get(commentId) as { c: number };
  const reportCount = reportCountRow?.c ?? 0;

  db.prepare("UPDATE profile_comments SET report_count=? WHERE id=?").run(reportCount, commentId);

  insertCommentModerationLog(db, {
    comment_id: commentId,
    user_id: reporterId,
    event_type: "report",
    original_content: comment.content,
    normalized_content: comment.normalized_content ?? "",
    report_count: reportCount,
    action: "reported",
  });

  if (reportCount < COMMENT_REPORT_BLIND_THRESHOLD) {
    return { ok: true, blinded: false, message: "신고가 접수되었습니다." };
  }

  db.prepare(
    "UPDATE profile_comments SET is_blinded=1, moderation_status='blinded' WHERE id=?"
  ).run(commentId);

  const { normalized, matches } = matchCommentBannedWords(db, comment.content);
  const ai = await moderateCommentWithAi({
    content: comment.content,
    normalized,
    matchedWords: matches.map((m) => m.word),
    trigger: "report_threshold",
  });

  if (ai.verdict === "BLOCK") {
    db.transaction(() => {
      db.prepare(
        `UPDATE profile_comments
         SET moderation_status='deleted', is_blinded=1, delete_reason=?, normalized_content=?
         WHERE id=?`
      ).run(ai.reason || "신고 임계치 AI 차단", normalized, commentId);
      maybeBanCommentAuthor(db, comment.author_id, COMMENT_AUTHOR_BLOCK_STRIKES);
    })();

    insertCommentModerationLog(db, {
      comment_id: commentId,
      user_id: comment.author_id,
      event_type: "report_threshold",
      original_content: comment.content,
      normalized_content: normalized,
      matched_words_json: JSON.stringify(matches.map((m) => m.word)),
      report_count: reportCount,
      ai_verdict: ai.verdict,
      ai_reason: ai.reason,
      action: "deleted_report",
      delete_reason: ai.reason || "신고 임계치 AI 차단",
    });

    return {
      ok: true,
      blinded: true,
      message: "신고가 누적되어 해당 댓글이 삭제되었습니다.",
    };
  }

  db.prepare(
    "UPDATE profile_comments SET is_blinded=0, moderation_status='visible' WHERE id=?"
  ).run(commentId);

  const reporters = db
    .prepare("SELECT reporter_id FROM profile_comment_reports WHERE comment_id=?")
    .all(commentId) as { reporter_id: number }[];
  for (const r of reporters) {
    penalizeCommentReporterTrust(db, r.reporter_id);
  }

  insertCommentModerationLog(db, {
    comment_id: commentId,
    user_id: comment.author_id,
    event_type: "report_threshold",
    original_content: comment.content,
    normalized_content: normalized,
    matched_words_json: JSON.stringify(matches.map((m) => m.word)),
    report_count: reportCount,
    ai_verdict: ai.verdict,
    ai_reason: ai.reason,
    action: "unblinded",
  });

  return {
    ok: true,
    blinded: false,
    message: "신고가 검토되었으며 댓글이 유지됩니다.",
  };
}

export function userHasReportedComment(
  db: Database.Database,
  commentId: number,
  userId: number
): boolean {
  const row = db
    .prepare("SELECT 1 AS ok FROM profile_comment_reports WHERE comment_id=? AND reporter_id=?")
    .get(commentId, userId) as { ok: number } | undefined;
  return row != null;
}
