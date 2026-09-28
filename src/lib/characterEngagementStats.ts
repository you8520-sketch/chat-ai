import type Database from "better-sqlite3";
import { parseMessageVariants } from "@/lib/messageAlternates";

/** Completed generations for one assistant row (initial + successful regens). */
export function countAssistantGenerationTurns(
  alternatesJson: string | null | undefined,
  content: string | null | undefined
): number {
  const variants = parseMessageVariants(alternatesJson);
  if (variants.length > 0) return variants.length;
  return content?.trim() ? 1 : 0;
}

/**
 * Engagement turns for a chat:
 * - each user message counts as 1 (initial send)
 * - each successful regenerate adds +1 (extra assistant variants beyond the first)
 * Greeting-only assistant rows with a single variant do not add extras.
 */
export function countChatEngagementTurns(db: Database.Database, chatId: number): number {
  const userTurns = db
    .prepare("SELECT COUNT(*) AS n FROM messages WHERE chat_id=? AND role='user'")
    .get(chatId) as { n: number };
  const assistants = db
    .prepare(
      `SELECT content, alternates FROM messages WHERE chat_id=? AND role='assistant'`
    )
    .all(chatId) as Array<{ content: string; alternates: string | null }>;

  let regenExtra = 0;
  for (const row of assistants) {
    const gens = countAssistantGenerationTurns(row.alternates, row.content);
    if (gens > 1) regenExtra += gens - 1;
  }
  return userTurns.n + regenExtra;
}

export function ensureCharacterChatUsersTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS character_chat_users (
      character_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (character_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_character_chat_users_user
      ON character_chat_users(user_id);
  `);
}

/** Best-effort seed from remaining chats. Deleted rooms cannot restore lost unique users. */
export function seedCharacterChatUsersLedgerFromChats(db: Database.Database): void {
  ensureCharacterChatUsersTable(db);
  db.exec(`
    INSERT OR IGNORE INTO character_chat_users (character_id, user_id)
    SELECT DISTINCT character_id, user_id
    FROM chats
    WHERE character_id IS NOT NULL AND user_id IS NOT NULL
  `);
}

/** 유저 메시지 저장 또는 성공한 재생성 1건당 캐릭터 누적 턴 +1. 채팅방 삭제로 깎지 않는다. */
export function incrementCharacterTotalTurns(
  db: Database.Database,
  characterId: number,
  delta = 1
): void {
  if (!characterId || delta === 0) return;
  db.prepare(
    "UPDATE characters SET total_turns = CASE WHEN total_turns + ? < 0 THEN 0 ELSE total_turns + ? END WHERE id=?"
  ).run(delta, delta, characterId);
}

/**
 * 해당 캐릭터와 한 번이라도 대화를 시작한 유저면 chats_count(누적 이용자수) +1.
 * chats 행이 아니라 (character_id, user_id) ledger가 first-user owner다.
 */
export function registerCharacterChatUser(
  db: Database.Database,
  characterId: number,
  userId: number
): boolean {
  if (!characterId || !userId) return false;
  ensureCharacterChatUsersTable(db);
  const result = db
    .prepare(
      "INSERT OR IGNORE INTO character_chat_users (character_id, user_id) VALUES (?, ?)"
    )
    .run(characterId, userId);
  if (result.changes === 0) return false;
  db.prepare("UPDATE characters SET chats_count = chats_count + 1 WHERE id=?").run(characterId);
  return true;
}

/**
 * @deprecated Lifetime counters are not adjusted on room delete.
 * Kept as a no-op so leftover callers cannot decrement totals.
 */
export function adjustCharacterStatsOnChatDelete(
  _db: Database.Database,
  _characterId: number,
  _userId: number,
  _chatId: number
): void {
  return;
}

/**
 * One-time / repair helper: seed the unique-user ledger from remaining chats.
 * Does not overwrite characters.chats_count or characters.total_turns —
 * those are lifetime accumulators and must not be recounted from live rooms.
 */
export function backfillCharacterEngagementStats(db: Database.Database): void {
  seedCharacterChatUsersLedgerFromChats(db);
}
