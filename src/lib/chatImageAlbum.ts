import { getDb } from "@/lib/db";

export type ChatImageAlbumMode =
  | "sd"
  | "emoticon"
  | "couple_stamp"
  | "comic"
  | "illustration";

export function ensureCharacterImageAlbumTable() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS character_image_album (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      character_id INTEGER NOT NULL,
      persona_id INTEGER,
      chat_id INTEGER,
      generation_id INTEGER,
      image_url TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'sd',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, character_id, image_url)
    );

    CREATE INDEX IF NOT EXISTS idx_character_image_album_recent
      ON character_image_album(user_id, character_id, created_at DESC, id DESC);
  `);
}

export function saveGeneratedImageToCharacterAlbum(input: {
  userId: number;
  characterId: number;
  personaId: number | null;
  chatId: number | null;
  generationId: number | null;
  imageUrl: string;
  mode: ChatImageAlbumMode;
}) {
  ensureCharacterImageAlbumTable();
  getDb()
    .prepare(
      `INSERT INTO character_image_album (
         user_id, character_id, persona_id, chat_id, generation_id, image_url, mode
       ) VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(user_id, character_id, image_url)
       DO UPDATE SET
         persona_id=excluded.persona_id,
         chat_id=excluded.chat_id,
         generation_id=excluded.generation_id,
         mode=excluded.mode`
    )
    .run(
      input.userId,
      input.characterId,
      input.personaId,
      input.chatId,
      input.generationId,
      input.imageUrl,
      input.mode
    );
}
