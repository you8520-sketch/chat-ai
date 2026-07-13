import { getDb } from "./db";
import {
  CREATOR_NOTICE_CONTENT_MAX,
  CREATOR_NOTICE_TITLE_MAX,
  type CreatorNoticeRow,
} from "./creatorShared";
export const CREATOR_NOTICE_LIST_LIMIT = 20;

function cleanNoticeText(input: unknown, max: number): string {
  return String(input ?? "").replace(/\r\n?/g, "\n").trim().slice(0, max);
}

export function listCreatorNotices(
  creatorId: number,
  limit = CREATOR_NOTICE_LIST_LIMIT
): CreatorNoticeRow[] {
  return getDb()
    .prepare(
      `SELECT id, creator_id, title, content, created_at, updated_at
       FROM creator_notices
       WHERE creator_id=?
       ORDER BY created_at DESC, id DESC
       LIMIT ?`
    )
    .all(creatorId, limit) as CreatorNoticeRow[];
}

export function createCreatorNotice(
  creatorId: number,
  input: { title: unknown; content: unknown }
): CreatorNoticeRow {
  const title = cleanNoticeText(input.title, CREATOR_NOTICE_TITLE_MAX);
  const content = cleanNoticeText(input.content, CREATOR_NOTICE_CONTENT_MAX);
  if (!title) throw new Error("공지 제목을 입력하세요.");
  if (!content) throw new Error("공지 내용을 입력하세요.");

  const db = getDb();
  const info = db
    .prepare("INSERT INTO creator_notices (creator_id, title, content) VALUES (?,?,?)")
    .run(creatorId, title, content);
  return db
    .prepare(
      `SELECT id, creator_id, title, content, created_at, updated_at
       FROM creator_notices
       WHERE id=? AND creator_id=?`
    )
    .get(Number(info.lastInsertRowid), creatorId) as CreatorNoticeRow;
}

export function deleteCreatorNotice(creatorId: number, noticeId: number): boolean {
  if (!Number.isFinite(noticeId) || noticeId <= 0) return false;
  const info = getDb()
    .prepare("DELETE FROM creator_notices WHERE id=? AND creator_id=?")
    .run(noticeId, creatorId);
  return info.changes > 0;
}
