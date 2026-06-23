import type Database from "better-sqlite3";

/** 공지 게시판 최신 글 ID */
export function getLatestNoticeId(db: Database.Database): number {
  const row = db.prepare("SELECT MAX(id) AS id FROM posts WHERE board='notice'").get() as {
    id: number | null;
  };
  return row?.id ?? 0;
}

/** 읽지 않은 공지가 있는지 */
export function hasUnreadNotices(latestId: number, readId: number): boolean {
  return latestId > 0 && latestId > readId;
}

/** 공지 확인 처리 */
export function markNoticesRead(db: Database.Database, userId: number | null, latestId: number) {
  if (userId) {
    db.prepare("UPDATE users SET notice_last_read_id=? WHERE id=?").run(latestId, userId);
  }
}
