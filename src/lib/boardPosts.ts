import type Database from "better-sqlite3";
import { ADMIN_MANAGED_BOARDS, type AdminManagedBoard } from "./boardConfig";

export const DEFAULT_BOARD_POSTS = [
  {
    board: "notice" as const,
    title: "클로즈베타 테스트중",
    content:
      "클로즈베타 테스트가 진행 중입니다. 메인 화면의 「무료 포인트 신청하기」에서 신청하시면 관리자 검토 후 무료 포인트가 지급됩니다.",
  },
] as const;

/** Idempotent — same board+title only inserted once (fresh DB / one-time migrate). */
export function ensureDefaultBoardPost(
  db: Database.Database,
  board: AdminManagedBoard,
  title: string,
  content: string
): void {
  const exists = db
    .prepare("SELECT 1 AS ok FROM posts WHERE board=? AND title=? LIMIT 1")
    .get(board, title) as { ok: number } | undefined;
  if (exists?.ok) return;
  db.prepare("INSERT INTO posts (board, title, content, author_name) VALUES (?,?,?,?)").run(
    board,
    title,
    content,
    "운영팀"
  );
}

/** Keep oldest row per board+title; drop duplicate notice rows. */
export function dedupeAdminBoardPostsByTitle(db: Database.Database): number {
  const result = db
    .prepare(
      `DELETE FROM posts
       WHERE board = 'notice'
         AND id NOT IN (
           SELECT MIN(id) FROM posts
           WHERE board = 'notice'
           GROUP BY board, title
         )`
    )
    .run();
  return result.changes;
}

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

const POST_SELECT =
  "SELECT id, board, title, content, author_name, author_id, created_at FROM posts";

export function listPostsByBoard(db: Database.Database, board: AdminManagedBoard): BoardPostRow[] {
  return db
    .prepare(`${POST_SELECT} WHERE board=? ORDER BY id DESC LIMIT 100`)
    .all(board) as BoardPostRow[];
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
