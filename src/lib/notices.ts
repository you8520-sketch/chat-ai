import type Database from "better-sqlite3";

/** 공지 게시판 최신 글 ID */
export function getLatestNoticeId(db: Database.Database): number {
  const row = db.prepare("SELECT MAX(id) AS id FROM posts WHERE board='notice'").get() as {
    id: number | null;
  };
  return row?.id ?? 0;
}

export function getUnreadNoticeCount(db: Database.Database, userId: number | null, cookieReadId = 0): number {
  if (userId) {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS c
         FROM posts p
         WHERE p.board='notice'
           AND NOT EXISTS (
             SELECT 1 FROM notice_reads r
             WHERE r.user_id=? AND r.notice_id=p.id
           )`
      )
      .get(userId) as { c: number };
    return row.c;
  }
  const row = db
    .prepare("SELECT COUNT(*) AS c FROM posts WHERE board='notice' AND id > ?")
    .get(cookieReadId) as { c: number };
  return row.c;
}

export function isNoticeRead(db: Database.Database, userId: number | null, noticeId: number, cookieReadId = 0): boolean {
  if (!userId) return noticeId <= cookieReadId;
  const row = db
    .prepare("SELECT 1 AS ok FROM notice_reads WHERE user_id=? AND notice_id=?")
    .get(userId, noticeId) as { ok: number } | undefined;
  return !!row;
}

/** 읽지 않은 공지가 있는지 */
export function hasUnreadNotices(latestId: number, readId: number, unreadCount?: number): boolean {
  if (unreadCount !== undefined) return unreadCount > 0;
  return latestId > 0 && latestId > readId;
}

/** 공지 확인 처리 */
export function markNoticesRead(db: Database.Database, userId: number | null, latestId: number) {
  if (userId && latestId > 0) {
    db.prepare(
      `INSERT OR IGNORE INTO notice_reads (user_id, notice_id)
       SELECT ?, id FROM posts WHERE board='notice' AND id <= ?`
    ).run(userId, latestId);
    db.prepare("UPDATE users SET notice_last_read_id=? WHERE id=?").run(latestId, userId);
  }
}
