import type Database from "better-sqlite3";

export function insertCommentModerationLog(
  db: Database.Database,
  row: {
    comment_id?: number | null;
    user_id?: number | null;
    event_type: string;
    original_content: string;
    normalized_content: string;
    matched_words_json?: string;
    report_count?: number | null;
    ai_verdict?: string | null;
    ai_reason?: string;
    action: string;
    delete_reason?: string;
  }
): number {
  const result = db.prepare(
    `INSERT INTO profile_comment_moderation_logs
     (comment_id, user_id, event_type, original_content, normalized_content,
      matched_words_json, report_count, ai_verdict, ai_reason, action, delete_reason)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    row.comment_id ?? null,
    row.user_id ?? null,
    row.event_type,
    row.original_content,
    row.normalized_content,
    row.matched_words_json ?? "[]",
    row.report_count ?? null,
    row.ai_verdict ?? null,
    row.ai_reason ?? "",
    row.action,
    row.delete_reason ?? ""
  );
  return Number(result.lastInsertRowid);
}

export function countAuthorModerationBlocks(db: Database.Database, authorId: number): number {
  const row = db.prepare(
    `SELECT COUNT(*) AS c FROM profile_comment_moderation_logs
     WHERE user_id = ? AND action IN ('blocked_post','deleted_report','deleted_admin')`
  ).get(authorId) as { c: number };
  return row?.c ?? 0;
}

export function maybeBanCommentAuthor(db: Database.Database, authorId: number, strikesNeeded: number): boolean {
  const strikes = countAuthorModerationBlocks(db, authorId);
  if (strikes >= strikesNeeded) {
    db.prepare("UPDATE users SET comment_banned=1 WHERE id=?").run(authorId);
    return true;
  }
  return false;
}
