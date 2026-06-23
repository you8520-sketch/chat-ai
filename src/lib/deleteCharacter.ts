import { getDb } from "@/lib/db";

export type DeleteCharacterResult =
  | { ok: true }
  | { ok: false; error: string; status: number };

export function deleteUserCharacter(
  characterId: number,
  userId: number
): DeleteCharacterResult {
  const db = getDb();

  const row = db
    .prepare("SELECT id, creator_id, official FROM characters WHERE id=?")
    .get(characterId) as
    | { id: number; creator_id: number | null; official: number }
    | undefined;

  if (!row) {
    return { ok: false, error: "캐릭터를 찾을 수 없습니다.", status: 404 };
  }
  if (row.creator_id !== userId) {
    return { ok: false, error: "본인 캐릭터만 삭제할 수 있습니다.", status: 403 };
  }
  if (row.official === 1) {
    return { ok: false, error: "공식 캐릭터는 삭제할 수 없습니다.", status: 403 };
  }

  const chatSub = "SELECT id FROM chats WHERE character_id=?";
  const msgSub = `SELECT id FROM messages WHERE chat_id IN (${chatSub})`;

  db.transaction(() => {
    db.prepare(
      `DELETE FROM party_messages WHERE room_id IN (SELECT id FROM party_rooms WHERE character_id=?)`
    ).run(characterId);
    db.prepare(
      `DELETE FROM party_members WHERE room_id IN (SELECT id FROM party_rooms WHERE character_id=?)`
    ).run(characterId);
    db.prepare("DELETE FROM party_rooms WHERE character_id=?").run(characterId);

    db.prepare(`DELETE FROM bookmarks WHERE message_id IN (${msgSub})`).run(characterId);
    db.prepare(`DELETE FROM message_feedback WHERE chat_id IN (${chatSub})`).run(characterId);
    db.prepare(`DELETE FROM message_scores WHERE message_id IN (${msgSub})`).run(characterId);
    db.prepare(`DELETE FROM training_message_tags WHERE message_id IN (${msgSub})`).run(
      characterId
    );
    db.prepare("DELETE FROM message_generations WHERE character_id=?").run(characterId);
    db.prepare(`DELETE FROM preference_events WHERE chat_id IN (${chatSub})`).run(characterId);
    db.prepare(
      `DELETE FROM reports WHERE chat_id IN (${chatSub}) OR message_id IN (${msgSub})`
    ).run(characterId, characterId);
    db.prepare(`DELETE FROM report_refunds WHERE chat_id IN (${chatSub})`).run(characterId);
    db.prepare(`DELETE FROM chat_turn_summaries WHERE chat_id IN (${chatSub})`).run(characterId);
    db.prepare("DELETE FROM chat_memories WHERE character_id=?").run(characterId);
    db.prepare(`DELETE FROM messages WHERE chat_id IN (${chatSub})`).run(characterId);
    db.prepare("DELETE FROM chats WHERE character_id=?").run(characterId);

    db.prepare("DELETE FROM likes WHERE character_id=?").run(characterId);
    db.prepare(
      "DELETE FROM profile_comments WHERE target_type='character' AND target_id=?"
    ).run(characterId);
    db.prepare("DELETE FROM creator_earnings WHERE character_id=?").run(characterId);
    db.prepare("DELETE FROM character_memories WHERE character_id=?").run(characterId);
    db.prepare("DELETE FROM memory_buffer WHERE character_id=?").run(characterId);

    db.prepare("DELETE FROM characters WHERE id=? AND creator_id=? AND official=0").run(
      characterId,
      userId
    );
  })();

  return { ok: true };
}
