import type Database from "better-sqlite3";
import { parseMessageVariants } from "@/lib/messageAlternates";

/** Completed assistant generations for one playable turn (initial + successful regens). */
export function countAssistantGenerationTurns(
  alternatesJson: string | null | undefined,
  content: string | null | undefined
): number {
  const variants = parseMessageVariants(alternatesJson);
  if (variants.length > 0) return variants.length;
  return content?.trim() ? 1 : 0;
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
