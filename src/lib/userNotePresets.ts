import { getDb } from "@/lib/db";
import {
  sanitizeNotePresetTitle,
  USER_NOTE_PRESET_TITLE_MAX,
  type UserNotePresetItem,
} from "@/lib/userNotePresetTypes";
import {
  extractFocusZoneNote,
  validateUserNoteFocusPreset,
} from "@/lib/userNoteStatusWindow";

export {
  USER_NOTE_PRESET_TITLE_MAX,
  sanitizeNotePresetTitle,
  type UserNotePresetItem,
} from "@/lib/userNotePresetTypes";

export function listUserNotePresets(userId: number): UserNotePresetItem[] {
  ensureLegacyUserNotePreset(userId);
  const rows = getDb()
    .prepare(
      "SELECT id, user_id, title, content, created_at FROM user_note_presets WHERE user_id=? ORDER BY created_at ASC"
    )
    .all(userId) as UserNotePresetItem[];
  return rows.map((row) => ({
    ...row,
    content: extractFocusZoneNote(row.content),
  }));
}

export function getUserNotePresetById(
  userId: number,
  presetId: number
): UserNotePresetItem | null {
  const row = getDb()
    .prepare(
      "SELECT id, user_id, title, content, created_at FROM user_note_presets WHERE id=? AND user_id=?"
    )
    .get(presetId, userId) as UserNotePresetItem | undefined;
  return row ?? null;
}

export function ensureLegacyUserNotePreset(userId: number): void {
  const db = getDb();
  const count = (
    db.prepare("SELECT COUNT(*) AS c FROM user_note_presets WHERE user_id=?").get(userId) as {
      c: number;
    }
  ).c;
  if (count > 0) return;

  const legacy = db.prepare("SELECT user_note FROM users WHERE id=?").get(userId) as
    | { user_note: string }
    | undefined;
  const content = legacy?.user_note?.trim() ?? "";
  if (!content) return;

  db.prepare("INSERT INTO user_note_presets (user_id, title, content) VALUES (?,?,?)").run(
    userId,
    "기본",
    extractFocusZoneNote(content)
  );
}

export function validateNotePresetInput(
  title: string,
  content: string
): { ok: true } | { ok: false; error: string } {
  const trimmedTitle = sanitizeNotePresetTitle(title);
  if (!trimmedTitle) {
    return { ok: false, error: "유저 노트 제목을 입력하세요." };
  }
  return validateUserNoteFocusPreset(content);
}

function normalizePresetContent(content: string): string {
  return extractFocusZoneNote(content).trim();
}

export function createUserNotePreset(
  userId: number,
  title: string,
  content: string
): UserNotePresetItem | null {
  const check = validateNotePresetInput(title, content);
  if (!check.ok) return null;
  const db = getDb();
  const info = db
    .prepare("INSERT INTO user_note_presets (user_id, title, content) VALUES (?,?,?)")
    .run(userId, sanitizeNotePresetTitle(title), normalizePresetContent(content));
  return getUserNotePresetById(userId, Number(info.lastInsertRowid));
}

export function updateUserNotePreset(
  userId: number,
  presetId: number,
  patch: { title?: string; content?: string }
): UserNotePresetItem | null {
  const prev = getUserNotePresetById(userId, presetId);
  if (!prev) return null;
  const nextTitle = patch.title != null ? sanitizeNotePresetTitle(patch.title) : prev.title;
  const nextContent = patch.content != null ? normalizePresetContent(patch.content) : prev.content;
  const check = validateNotePresetInput(nextTitle, nextContent);
  if (!check.ok) return null;
  getDb()
    .prepare("UPDATE user_note_presets SET title=?, content=? WHERE id=? AND user_id=?")
    .run(nextTitle, nextContent, presetId, userId);
  return getUserNotePresetById(userId, presetId);
}

export function deleteUserNotePreset(userId: number, presetId: number): boolean {
  const info = getDb()
    .prepare("DELETE FROM user_note_presets WHERE id=? AND user_id=?")
    .run(presetId, userId);
  return info.changes > 0;
}
