import type Database from "better-sqlite3";

export type ResumableChat = {
  chatId: number;
  messageCount: number;
  lastPreview: string;
};

/** 유저가 실제로 대화한 적 있는 최신 채팅 (user 메시지 1개 이상) */
export function findResumableChat(
  db: Database.Database,
  userId: number,
  characterId: number
): ResumableChat | null {
  const row = db
    .prepare(
      `SELECT c.id AS chat_id,
              (SELECT COUNT(*) FROM messages m WHERE m.chat_id = c.id) AS msg_count,
              (SELECT content FROM messages m WHERE m.chat_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_content
       FROM chats c
       WHERE c.user_id = ? AND c.character_id = ?
         AND EXISTS (SELECT 1 FROM messages m WHERE m.chat_id = c.id AND m.role = 'user')
       ORDER BY c.id DESC
       LIMIT 1`
    )
    .get(userId, characterId) as
    | { chat_id: number; msg_count: number; last_content: string | null }
    | undefined;

  if (!row) return null;

  const preview = (row.last_content ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  return {
    chatId: row.chat_id,
    messageCount: row.msg_count,
    lastPreview: preview || "이전 대화",
  };
}
