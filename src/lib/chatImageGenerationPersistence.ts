import { getDb } from "@/lib/db";
import {
  ensureCharacterImageAlbumTable,
  type ChatImageAlbumMode,
} from "@/lib/chatImageAlbum";
import type { DeductionSlice } from "@/lib/points";

export type PersistChatImageGenerationInput = {
  userId: number;
  chatId: number | null;
  characterId: number;
  personaId: number;
  templateId: string;
  model: string;
  optionsJson: Record<string, unknown>;
  resultUrl: string;
  upstreamCostUsd: number | null;
  chargedPoints: number;
  deductionSlices: DeductionSlice[];
  exchangeRateKrwPerUsd: number;
  album: {
    mode: ChatImageAlbumMode;
    campaignId?: number | null;
    campaignTitle?: string | null;
  };
};

export function ensureChatImageGenerationsTable() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS chat_image_generations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      chat_id INTEGER,
      character_id INTEGER NOT NULL,
      persona_id INTEGER NOT NULL,
      template_id TEXT NOT NULL,
      model TEXT NOT NULL,
      options_json TEXT NOT NULL DEFAULT '{}',
      result_url TEXT NOT NULL,
      upstream_cost_usd REAL,
      charged_points INTEGER NOT NULL,
      deduction_slices TEXT,
      exchange_rate_krw_per_usd REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_chat_image_generations_user_recent
      ON chat_image_generations(user_id, created_at DESC, id DESC);
  `);
  const columns = new Set(
    (
      getDb().prepare("PRAGMA table_info(chat_image_generations)").all() as {
        name: string;
      }[]
    ).map((column) => column.name)
  );
  if (!columns.has("deduction_slices")) {
    getDb().exec("ALTER TABLE chat_image_generations ADD COLUMN deduction_slices TEXT");
  }
  if (!columns.has("exchange_rate_krw_per_usd")) {
    getDb().exec(
      "ALTER TABLE chat_image_generations ADD COLUMN exchange_rate_krw_per_usd REAL"
    );
  }
}

/** Atomic history + album persistence — throws on any failure (no silent partial success). */
export function persistChatImageGenerationResult(
  input: PersistChatImageGenerationInput
): { generationId: number } {
  ensureChatImageGenerationsTable();
  ensureCharacterImageAlbumTable();
  const db = getDb();

  return db.transaction(() => {
    const insert = db
      .prepare(
        `INSERT INTO chat_image_generations (
           user_id, chat_id, character_id, persona_id, template_id, model,
           options_json, result_url, upstream_cost_usd, charged_points,
           deduction_slices, exchange_rate_krw_per_usd
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        input.userId,
        input.chatId,
        input.characterId,
        input.personaId,
        input.templateId,
        input.model,
        JSON.stringify(input.optionsJson),
        input.resultUrl,
        input.upstreamCostUsd,
        input.chargedPoints,
        JSON.stringify(input.deductionSlices),
        input.exchangeRateKrwPerUsd
      );
    const generationId = Number(insert.lastInsertRowid);
    if (!Number.isInteger(generationId) || generationId <= 0) {
      throw new Error("chat_image_generations insert failed");
    }

    db.prepare(
      `INSERT INTO character_image_album (
         user_id, character_id, persona_id, chat_id, generation_id, image_url, mode, campaign_id, campaign_title
       ) VALUES (?,?,?,?,?,?,?,?,?)
       ON CONFLICT(user_id, character_id, image_url)
       DO UPDATE SET
         persona_id=excluded.persona_id,
         chat_id=excluded.chat_id,
         generation_id=excluded.generation_id,
         mode=excluded.mode,
         campaign_id=excluded.campaign_id,
         campaign_title=excluded.campaign_title`
    ).run(
      input.userId,
      input.characterId,
      input.personaId,
      input.chatId,
      generationId,
      input.resultUrl,
      input.album.mode,
      input.album.campaignId ?? null,
      input.album.campaignTitle ?? null
    );

    return { generationId };
  })();
}
