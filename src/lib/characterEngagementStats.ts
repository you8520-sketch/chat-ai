import type Database from "better-sqlite3";

/** 유저 메시지 1건 저장 시 캐릭터 누적 턴 +1 */
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

/** 채팅방 삭제 시 누적 턴·이용 유저 수 보정 */
export function adjustCharacterStatsOnChatDelete(
  db: Database.Database,
  characterId: number,
  userId: number,
  chatId: number
): void {
  const userTurns = db
    .prepare("SELECT COUNT(*) AS n FROM messages WHERE chat_id=? AND role='user'")
    .get(chatId) as { n: number };
  incrementCharacterTotalTurns(db, characterId, -userTurns.n);

  const remaining = db
    .prepare("SELECT COUNT(*) AS n FROM chats WHERE character_id=? AND user_id=? AND id != ?")
    .get(characterId, userId, chatId) as { n: number };
  if (remaining.n === 0) {
    db.prepare(
      "UPDATE characters SET chats_count = CASE WHEN chats_count > 0 THEN chats_count - 1 ELSE 0 END WHERE id=?"
    ).run(characterId);
  }
}

/** 기존 DB — messages·chats 기준 일회 백필 */
export function backfillCharacterEngagementStats(db: Database.Database): void {
  db.exec(`
    UPDATE characters SET total_turns = COALESCE((
      SELECT COUNT(*)
      FROM messages m
      JOIN chats ch ON ch.id = m.chat_id
      WHERE ch.character_id = characters.id AND m.role = 'user'
    ), 0);

    UPDATE characters SET chats_count = COALESCE((
      SELECT COUNT(DISTINCT ch.user_id)
      FROM chats ch
      WHERE ch.character_id = characters.id
    ), 0);
  `);
}
