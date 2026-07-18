import type Database from "better-sqlite3";

/** Persist a character card/detail/chat open as a recommendation taste signal. */
export function recordCharacterClick(
  db: Database.Database,
  userId: number,
  characterId: number
): void {
  if (!userId || !characterId) return;
  db.prepare(
    `INSERT INTO character_clicks (user_id, character_id, click_count, last_clicked_at)
     VALUES (?, ?, 1, datetime('now'))
     ON CONFLICT(user_id, character_id) DO UPDATE SET
       click_count = click_count + 1,
       last_clicked_at = datetime('now')`
  ).run(userId, characterId);
}

export function ensureCharacterClicksTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS character_clicks (
      user_id INTEGER NOT NULL,
      character_id INTEGER NOT NULL,
      click_count INTEGER NOT NULL DEFAULT 1,
      last_clicked_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, character_id)
    );
    CREATE INDEX IF NOT EXISTS idx_character_clicks_user_recent
      ON character_clicks(user_id, last_clicked_at DESC);
  `);
}
