import type Database from "better-sqlite3";

import { USER_NOTE_FOCUS_MAX, USER_NOTE_ZONE_SEPARATOR } from "@/lib/userNoteStatusWindow";

const USER_NOTE_REFERENCE_CLEANUP_FLAG = "user_note_reference_zone_cleanup_v1";

function ensureSchemaFlagsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _schema_flags (
      key TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

/** Strip legacy reference zone — preserve focus only (approved destructive cleanup). */
export function stripLegacyUserNoteReferenceZone(raw: string): string {
  const body = String(raw ?? "");
  const sepIdx = body.indexOf(USER_NOTE_ZONE_SEPARATOR);
  if (sepIdx >= 0) {
    return body.slice(0, sepIdx).slice(0, USER_NOTE_FOCUS_MAX);
  }
  if (body.length <= USER_NOTE_FOCUS_MAX) {
    return body;
  }
  return body.slice(0, USER_NOTE_FOCUS_MAX);
}

export type UserNoteReferenceCleanupStats = {
  usersUpdated: number;
  chatsUpdated: number;
  presetsUpdated: number;
};

/** One-time cleanup of old User Note reference expansion data. */
export function migrateUserNoteReferenceZoneCleanup(
  db: Database.Database
): UserNoteReferenceCleanupStats {
  ensureSchemaFlagsTable(db);
  const already = db
    .prepare(`SELECT 1 AS ok FROM _schema_flags WHERE key=?`)
    .get(USER_NOTE_REFERENCE_CLEANUP_FLAG);
  if (already) {
    return { usersUpdated: 0, chatsUpdated: 0, presetsUpdated: 0 };
  }

  const stats: UserNoteReferenceCleanupStats = {
    usersUpdated: 0,
    chatsUpdated: 0,
    presetsUpdated: 0,
  };

  const tx = db.transaction(() => {
    if (db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='users'`).get()) {
      const users = db
        .prepare(`SELECT id, user_note FROM users WHERE COALESCE(user_note, '') <> ''`)
        .all() as Array<{ id: number; user_note: string }>;
      const updateUser = db.prepare(`UPDATE users SET user_note=? WHERE id=?`);
      for (const row of users) {
        const cleaned = stripLegacyUserNoteReferenceZone(row.user_note);
        if (cleaned !== row.user_note) {
          updateUser.run(cleaned, row.id);
          stats.usersUpdated += 1;
        }
      }
    }

    if (db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='chats'`).get()) {
      const chats = db
        .prepare(`SELECT id, user_note FROM chats WHERE COALESCE(user_note, '') <> ''`)
        .all() as Array<{ id: number; user_note: string }>;
      const updateChat = db.prepare(`UPDATE chats SET user_note=? WHERE id=?`);
      for (const row of chats) {
        const cleaned = stripLegacyUserNoteReferenceZone(row.user_note);
        if (cleaned !== row.user_note) {
          updateChat.run(cleaned, row.id);
          stats.chatsUpdated += 1;
        }
      }
    }

    if (db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='user_note_presets'`).get()) {
      const presets = db
        .prepare(`SELECT id, content FROM user_note_presets WHERE COALESCE(content, '') <> ''`)
        .all() as Array<{ id: number; content: string }>;
      const updatePreset = db.prepare(`UPDATE user_note_presets SET content=? WHERE id=?`);
      for (const row of presets) {
        const cleaned = stripLegacyUserNoteReferenceZone(row.content);
        if (cleaned !== row.content) {
          updatePreset.run(cleaned, row.id);
          stats.presetsUpdated += 1;
        }
      }
    }

    db.prepare(`INSERT INTO _schema_flags (key) VALUES (?)`).run(USER_NOTE_REFERENCE_CLEANUP_FLAG);
  });

  tx();
  return stats;
}
