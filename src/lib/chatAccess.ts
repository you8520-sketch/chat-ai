import { getDb } from "./db";

export function assertMessageAccess(userId: number, messageId: number) {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT m.id, m.chat_id, m.role, m.content, m.model, m.usage, m.is_refunded,
              c.user_id, c.character_id
       FROM messages m
       JOIN chats c ON c.id = m.chat_id
       WHERE m.id = ? AND c.user_id = ?`
    )
    .get(messageId, userId) as
    | {
        id: number;
        chat_id: number;
        role: string;
        content: string;
        model: string;
        usage: string | null;
        is_refunded: number;
        user_id: number;
        character_id: number;
      }
    | undefined;
  return row ?? null;
}

export function getLastTurnMessageIds(chatId: number): { userId: number; assistantId: number | null } | null {
  const db = getDb();
  const rows = db
    .prepare("SELECT id, role, model FROM messages WHERE chat_id=? ORDER BY id ASC")
    .all(chatId) as { id: number; role: string; model: string }[];

  let lastUserId: number | null = null;
  let lastAssistantId: number | null = null;

  for (const row of rows) {
    if (row.role === "user") {
      lastUserId = row.id;
      lastAssistantId = null;
    } else if (row.role === "assistant" && row.model !== "greeting") {
      if (lastUserId != null) lastAssistantId = row.id;
    }
  }

  if (lastUserId == null) return null;
  return { userId: lastUserId, assistantId: lastAssistantId };
}
