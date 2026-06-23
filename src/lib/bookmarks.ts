import type Database from "better-sqlite3";
import { sanitizeChatTitle } from "@/lib/chatTitle";

export const BOOKMARK_TITLE_MAX = 64;
export const BOOKMARK_CONTENT_PREVIEW_MAX = 65;

export type UserBookmarkRow = {
  message_id: number;
  title: string;
  created_at: string;
  role: string;
  content: string;
  chat_id: number;
  character_id: number;
  character_name: string;
  character_emoji: string;
  chat_title: string;
};

export function sanitizeBookmarkTitle(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, BOOKMARK_TITLE_MAX);
}

export function defaultBookmarkTitle(content: string): string {
  const line = content.replace(/\s+/g, " ").trim().split(/\n/)[0] ?? "";
  const base = line || "북마크";
  if (base.length <= BOOKMARK_TITLE_MAX) return base;
  return `${base.slice(0, BOOKMARK_TITLE_MAX - 1)}…`;
}

export function bookmarkContentPreview(
  content: string,
  max = BOOKMARK_CONTENT_PREVIEW_MAX
): string {
  const text = content.replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function fetchUserBookmarks(db: Database.Database, userId: number): UserBookmarkRow[] {
  return db
    .prepare(
      `SELECT b.message_id, b.title, b.created_at,
              m.role, m.content, m.chat_id,
              c.character_id, c.title AS chat_title,
              ch.name AS character_name, ch.emoji AS character_emoji
       FROM bookmarks b
       INNER JOIN messages m ON m.id = b.message_id
       INNER JOIN chats c ON c.id = m.chat_id
       INNER JOIN characters ch ON ch.id = c.character_id
       WHERE b.user_id = ?
       ORDER BY b.created_at DESC`
    )
    .all(userId) as UserBookmarkRow[];
}

export function formatBookmarkChatLabel(row: UserBookmarkRow): string {
  const branch = sanitizeChatTitle(row.chat_title);
  if (branch) return branch;
  return row.character_name;
}
