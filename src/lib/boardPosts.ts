import type Database from "better-sqlite3";
import { ADMIN_MANAGED_BOARDS, type AdminManagedBoard } from "./boardConfig";

export type BoardPostRow = {
  id: number;
  board: string;
  title: string;
  content: string;
  author_name: string;
  author_id: number | null;
  created_at: string;
};

export type BoardCommentRow = {
  id: number;
  post_id: number;
  author_id: number;
  author_name: string;
  content: string;
  created_at: string;
  is_staff_reply: number;
};

export type InquiryAdminRow = BoardPostRow & {
  user_nickname: string | null;
  user_email: string | null;
  reply_count: number;
};

const POST_SELECT =
  "SELECT id, board, title, content, author_name, author_id, created_at FROM posts";

export function listPostsByBoard(db: Database.Database, board: AdminManagedBoard): BoardPostRow[] {
  return db
    .prepare(`${POST_SELECT} WHERE board=? ORDER BY id DESC LIMIT 100`)
    .all(board) as BoardPostRow[];
}

export function listInquiriesForAdmin(db: Database.Database): InquiryAdminRow[] {
  return db
    .prepare(
      `SELECT p.id, p.board, p.title, p.content, p.author_name, p.author_id, p.created_at,
              u.nickname AS user_nickname, u.email AS user_email,
              (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS reply_count
       FROM posts p
       LEFT JOIN users u ON u.id = p.author_id
       WHERE p.board = 'inquiry'
       ORDER BY p.id DESC
       LIMIT 200`
    )
    .all() as InquiryAdminRow[];
}

export function getPostById(db: Database.Database, id: number): BoardPostRow | undefined {
  return db.prepare(`${POST_SELECT} WHERE id=?`).get(id) as BoardPostRow | undefined;
}

export function createAdminBoardPost(
  db: Database.Database,
  board: AdminManagedBoard,
  title: string,
  content: string,
  adminId: number
): number {
  if (!(ADMIN_MANAGED_BOARDS as readonly string[]).includes(board)) {
    throw new Error("invalid board");
  }
  const result = db
    .prepare(
      "INSERT INTO posts (board, title, content, author_name, author_id) VALUES (?,?,?,?,?)"
    )
    .run(board, title, content, "운영팀", adminId);
  return Number(result.lastInsertRowid);
}

export function deleteAdminBoardPost(db: Database.Database, id: number): boolean {
  const post = getPostById(db, id);
  if (!post || !isAdminManagedBoardPost(post.board)) return false;
  db.prepare("DELETE FROM comments WHERE post_id=?").run(id);
  db.prepare("DELETE FROM posts WHERE id=?").run(id);
  return true;
}

function isAdminManagedBoardPost(board: string): board is AdminManagedBoard {
  return (ADMIN_MANAGED_BOARDS as readonly string[]).includes(board);
}

export function listCommentsForPost(db: Database.Database, postId: number): BoardCommentRow[] {
  return db
    .prepare(
      `SELECT id, post_id, author_id, author_name, content, created_at,
              COALESCE(is_staff_reply, 0) AS is_staff_reply
       FROM comments WHERE post_id=? ORDER BY id ASC`
    )
    .all(postId) as BoardCommentRow[];
}

export function addInquiryStaffReply(
  db: Database.Database,
  postId: number,
  adminId: number,
  content: string
): number {
  const post = getPostById(db, postId);
  if (!post || post.board !== "inquiry") {
    throw new Error("invalid inquiry");
  }
  const result = db
    .prepare(
      `INSERT INTO comments (post_id, author_id, author_name, content, is_staff_reply)
       VALUES (?,?,?,?,1)`
    )
    .run(postId, adminId, "운영팀", content);
  return Number(result.lastInsertRowid);
}
