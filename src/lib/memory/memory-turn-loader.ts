import { getDb } from "@/lib/db";
import { OPENING_TURN_USER } from "@/lib/chatGreetingContext";

export function loadChatTurnsWithMessageIds(chatId: number): {
  turnNumber: number;
  user: string;
  assistant: string;
  assistantMessageId: number;
}[] {
  const rows = getDb()
    .prepare("SELECT id, role, content, model FROM messages WHERE chat_id=? ORDER BY id ASC")
    .all(chatId) as { id: number; role: string; content: string; model: string }[];

  const turns: {
    turnNumber: number;
    user: string;
    assistant: string;
    assistantMessageId: number;
  }[] = [];
  let pendingUser: string | null = null;

  for (const row of rows) {
    if (row.role === "user") {
      pendingUser = row.content;
    } else if (row.role === "assistant") {
      if (row.model === "greeting") {
        turns.push({
          turnNumber: 0,
          user: OPENING_TURN_USER,
          assistant: row.content,
          assistantMessageId: row.id,
        });
        continue;
      }
      if (pendingUser !== null) {
        turns.push({
          turnNumber: turns.length,
          user: pendingUser,
          assistant: row.content,
          assistantMessageId: row.id,
        });
        pendingUser = null;
      }
    }
  }
  return turns;
}

export function countChatTurns(chatId: number): number {
  const all = loadChatTurnsWithMessageIds(chatId);
  return all.filter((t) => t.turnNumber > 0).length;
}
