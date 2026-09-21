import type Database from "better-sqlite3";
import {
  addGuestSparseNoticeRead,
  isGuestNoticeRead,
  markAllGuestNoticesRead,
  type GuestNoticeReadState,
} from "./noticeGuestReadCookies";

export type { GuestNoticeReadState } from "./noticeGuestReadCookies";
export {
  NOTICE_READ_ID_COOKIE,
  NOTICE_READ_IDS_COOKIE,
  MAX_SPARSE_NOTICE_READ_IDS,
  parseNoticeReadWatermark,
  parseSparseNoticeReadIds,
  readGuestNoticeReadState,
  serializeSparseNoticeReadIds,
} from "./noticeGuestReadCookies";

/** 공지 게시판 최신 글 ID */
export function getLatestNoticeId(db: Database.Database): number {
  const row = db.prepare("SELECT MAX(id) AS id FROM posts WHERE board='notice'").get() as {
    id: number | null;
  };
  return row?.id ?? 0;
}

export function isNoticeRead(
  db: Database.Database,
  userId: number | null,
  noticeId: number,
  guestState: GuestNoticeReadState = { watermarkId: 0, sparseReadIds: [] }
): boolean {
  if (userId) {
    const row = db
      .prepare("SELECT 1 AS ok FROM notice_reads WHERE user_id=? AND notice_id=?")
      .get(userId, noticeId) as { ok: number } | undefined;
    return !!row;
  }
  return isGuestNoticeRead(noticeId, guestState);
}

export function getUnreadNoticeCount(
  db: Database.Database,
  userId: number | null,
  guestState: GuestNoticeReadState = { watermarkId: 0, sparseReadIds: [] }
): number {
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

  const notices = db
    .prepare("SELECT id FROM posts WHERE board='notice'")
    .all() as { id: number }[];
  return notices.filter((notice) => !isGuestNoticeRead(notice.id, guestState)).length;
}

/** 읽지 않은 공지가 있는지 */
export function hasUnreadNotices(latestId: number, readId: number, unreadCount?: number): boolean {
  if (unreadCount !== undefined) return unreadCount > 0;
  return latestId > 0 && latestId > readId;
}

/** 공지 확인 처리 — logged-in DB + guest watermark mark-all */
export function markNoticesRead(db: Database.Database, userId: number | null, latestId: number) {
  if (userId && latestId > 0) {
    db.prepare(
      `INSERT OR IGNORE INTO notice_reads (user_id, notice_id)
       SELECT ?, id FROM posts WHERE board='notice' AND id <= ?`
    ).run(userId, latestId);
    db.prepare("UPDATE users SET notice_last_read_id=? WHERE id=?").run(latestId, userId);
  }
}

export function getNoticeById(db: Database.Database, id: number) {
  return db
    .prepare(
      `SELECT id, title, content, author_name, created_at
       FROM posts WHERE id=? AND board='notice'`
    )
    .get(id) as
    | { id: number; title: string; content: string; author_name: string; created_at: string }
    | undefined;
}

/** 단일 공지 읽음 — logged-in notice_reads; guest sparse cookie state */
export function markSingleNoticeRead(
  db: Database.Database,
  userId: number | null,
  noticeId: number,
  guestState: GuestNoticeReadState = { watermarkId: 0, sparseReadIds: [] }
): GuestNoticeReadState {
  if (noticeId <= 0) return guestState;
  if (userId) {
    db.prepare("INSERT OR IGNORE INTO notice_reads (user_id, notice_id) VALUES (?, ?)").run(
      userId,
      noticeId
    );
    const row = db
      .prepare("SELECT notice_last_read_id FROM users WHERE id=?")
      .get(userId) as { notice_last_read_id: number } | undefined;
    if (noticeId > (row?.notice_last_read_id ?? 0)) {
      db.prepare("UPDATE users SET notice_last_read_id=? WHERE id=?").run(noticeId, userId);
    }
    return guestState;
  }
  return addGuestSparseNoticeRead(guestState, noticeId);
}

/** Guest mark-all cookie state after latest notice id is known. */
export function markAllGuestNoticeReads(latestId: number): GuestNoticeReadState {
  return markAllGuestNoticesRead(latestId);
}
