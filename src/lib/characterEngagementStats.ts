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

/** 유저 메시지 저장 또는 성공한 재생성 1건당 캐릭터 누적 턴 +1 */
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

/** 새 채팅방 생성 직전 호출 — 해당 유저가 캐릭터와 처음 대화하면 chats_count(이용 유저 수) +1 */
export function registerCharacterChatUser(
  db: Database.Database,
  characterId: number,
  userId: number
): boolean {
  const prior = db
    .prepare("SELECT COUNT(*) AS n FROM chats WHERE character_id=? AND user_id=?")
    .get(characterId, userId) as { n: number };
  if (prior.n > 0) return false;
  db.prepare("UPDATE characters SET chats_count = chats_count + 1 WHERE id=?").run(characterId);
  return true;
}

/** 채팅방 삭제 시 누적 턴·이용 유저 수 보정 (재생성 턴 포함) */
export function adjustCharacterStatsOnChatDelete(
  db: Database.Database,
  characterId: number,
  userId: number,
  chatId: number
): void {
  const turns = countChatEngagementTurns(db, chatId);
  incrementCharacterTotalTurns(db, characterId, -turns);

  const remaining = db
    .prepare("SELECT COUNT(*) AS n FROM chats WHERE character_id=? AND user_id=? AND id != ?")
    .get(characterId, userId, chatId) as { n: number };
  if (remaining.n === 0) {
    db.prepare(
      "UPDATE characters SET chats_count = CASE WHEN chats_count > 0 THEN chats_count - 1 ELSE 0 END WHERE id=?"
    ).run(characterId);
  }
}

/** 기존 DB — messages·chats 기준 일회 백필 (재생성 variant 포함) */
export function backfillCharacterEngagementStats(db: Database.Database): void {
  db.exec(`
    UPDATE characters SET chats_count = COALESCE((
      SELECT COUNT(DISTINCT ch.user_id)
      FROM chats ch
      WHERE ch.character_id = characters.id
    ), 0);
  `);

  const characters = db.prepare("SELECT id FROM characters").all() as Array<{ id: number }>;
  const chatsForCharacter = db.prepare(
    "SELECT id FROM chats WHERE character_id=?"
  );
  const updateTurns = db.prepare("UPDATE characters SET total_turns=? WHERE id=?");

  for (const character of characters) {
    const chats = chatsForCharacter.all(character.id) as Array<{ id: number }>;
    let total = 0;
    for (const chat of chats) {
      total += countChatEngagementTurns(db, chat.id);
    }
    updateTurns.run(total, character.id);
  }
}
