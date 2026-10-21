import "server-only";

import type { Database } from "better-sqlite3";
import {
  CHAT_SHORTCUT_MAX_PER_USER,
  validateChatShortcutDraft,
  type ChatShortcutDraft,
} from "@/lib/chatShortcutComposer";

export type ChatShortcut = ChatShortcutDraft & {
  id: number;
  favorite: boolean;
  updatedAt: string;
};

type ShortcutRow = {
  id: number;
  name: string;
  description: string;
  content: string;
  favorite: number;
  updated_at: string;
};

export function ensureChatShortcutsSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_chat_shortcuts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL,
      favorite INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_user_chat_shortcuts_user
      ON user_chat_shortcuts(user_id, favorite DESC, updated_at DESC, id DESC);
  `);
}

export function listChatShortcuts(db: Database, userId: number): ChatShortcut[] {
  ensureChatShortcutsSchema(db);
  const rows = db
    .prepare(
      `SELECT id, name, description, content, favorite, updated_at
       FROM user_chat_shortcuts
       WHERE user_id = ?
       ORDER BY favorite DESC, updated_at DESC, id DESC`
    )
    .all(userId) as ShortcutRow[];
  return rows.map(toShortcut);
}

export function createChatShortcut(
  db: Database,
  userId: number,
  input: { name: unknown; description?: unknown; content: unknown }
): { ok: true; shortcut: ChatShortcut } | { ok: false; status: number; error: string } {
  const parsed = validateChatShortcutDraft(input);
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };
  ensureChatShortcutsSchema(db);
  const count = db
    .prepare("SELECT COUNT(*) AS c FROM user_chat_shortcuts WHERE user_id = ?")
    .get(userId) as { c: number };
  if (count.c >= CHAT_SHORTCUT_MAX_PER_USER) {
    return {
      ok: false,
      status: 400,
      error: `개인 단축어는 ${CHAT_SHORTCUT_MAX_PER_USER}개까지 저장할 수 있습니다.`,
    };
  }
  const result = db
    .prepare(
      `INSERT INTO user_chat_shortcuts (user_id, name, description, content, favorite)
       VALUES (?, ?, ?, ?, 0)`
    )
    .run(userId, parsed.value.name, parsed.value.description, parsed.value.content);
  const shortcut = getOwnedShortcut(db, userId, Number(result.lastInsertRowid));
  if (!shortcut) return { ok: false, status: 500, error: "단축어를 저장하지 못했습니다." };
  return { ok: true, shortcut };
}

export function updateChatShortcut(
  db: Database,
  userId: number,
  shortcutId: number,
  patch: {
    name?: unknown;
    description?: unknown;
    content?: unknown;
    favorite?: unknown;
  }
): { ok: true; shortcut: ChatShortcut } | { ok: false; status: number; error: string } {
  if (!Number.isInteger(shortcutId) || shortcutId <= 0) {
    return { ok: false, status: 400, error: "잘못된 단축어입니다." };
  }
  ensureChatShortcutsSchema(db);
  const existing = getOwnedShortcut(db, userId, shortcutId);
  if (!existing) return { ok: false, status: 404, error: "단축어를 찾을 수 없습니다." };

  const nextDraft = validateChatShortcutDraft(
    {
      name: patch.name !== undefined ? patch.name : existing.name,
      description: patch.description !== undefined ? patch.description : existing.description,
      content: patch.content !== undefined ? patch.content : existing.content,
    },
    existing
  );
  if (!nextDraft.ok) return { ok: false, status: 400, error: nextDraft.error };

  let favorite = existing.favorite;
  if (patch.favorite !== undefined) {
    if (typeof patch.favorite !== "boolean") {
      return { ok: false, status: 400, error: "즐겨찾기 값이 올바르지 않습니다." };
    }
    favorite = patch.favorite;
  }

  const changed = db
    .prepare(
      `UPDATE user_chat_shortcuts
       SET name = ?, description = ?, content = ?, favorite = ?, updated_at = datetime('now')
       WHERE id = ? AND user_id = ?`
    )
    .run(
      nextDraft.value.name,
      nextDraft.value.description,
      nextDraft.value.content,
      favorite ? 1 : 0,
      shortcutId,
      userId
    );
  if (changed.changes !== 1) return { ok: false, status: 404, error: "단축어를 찾을 수 없습니다." };
  const shortcut = getOwnedShortcut(db, userId, shortcutId);
  if (!shortcut) return { ok: false, status: 404, error: "단축어를 찾을 수 없습니다." };
  return { ok: true, shortcut };
}

export function deleteChatShortcut(
  db: Database,
  userId: number,
  shortcutId: number
): { ok: true } | { ok: false; status: number; error: string } {
  if (!Number.isInteger(shortcutId) || shortcutId <= 0) {
    return { ok: false, status: 400, error: "잘못된 단축어입니다." };
  }
  ensureChatShortcutsSchema(db);
  const changed = db
    .prepare("DELETE FROM user_chat_shortcuts WHERE id = ? AND user_id = ?")
    .run(shortcutId, userId);
  if (changed.changes !== 1) return { ok: false, status: 404, error: "단축어를 찾을 수 없습니다." };
  return { ok: true };
}

function getOwnedShortcut(db: Database, userId: number, shortcutId: number): ChatShortcut | null {
  const row = db
    .prepare(
      `SELECT id, name, description, content, favorite, updated_at
       FROM user_chat_shortcuts
       WHERE id = ? AND user_id = ?`
    )
    .get(shortcutId, userId) as ShortcutRow | undefined;
  return row ? toShortcut(row) : null;
}

function toShortcut(row: ShortcutRow): ChatShortcut {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    content: row.content,
    favorite: row.favorite === 1,
    updatedAt: row.updated_at,
  };
}
