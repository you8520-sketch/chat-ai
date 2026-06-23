import { getDb } from "@/lib/db";
import { registerCharacterChatUser } from "@/lib/characterEngagementStats";
import { DEFAULT_SELECTED_AI, resolveSelectedAI } from "@/lib/chatModels";
import {
  DEFAULT_TARGET_RESPONSE_CHARS,
  normalizeTargetResponseChars,
} from "@/lib/responseLength";
import { MEMORY_CAPACITY_DEFAULT } from "@/lib/memory/memory-capacity-shared";

export type CreateChatSessionInput = {
  userId: number;
  characterId: number;
  greeting?: string;
  mode?: "safe" | "nsfw";
  selectedAI?: string;
  userNote?: string;
  selectedPersonaId?: number | null;
  targetResponseChars?: number;
};

/** 새 채팅방 생성 + 첫 메시지(greeting) 삽입 */
export function createChatSession(input: CreateChatSessionInput): number {
  const db = getDb();
  const selectedAI = resolveSelectedAI(input.selectedAI, DEFAULT_SELECTED_AI);
  const mode = input.mode ?? "safe";
  const targetResponseChars = normalizeTargetResponseChars(
    input.targetResponseChars ?? DEFAULT_TARGET_RESPONSE_CHARS
  );

  registerCharacterChatUser(db, input.characterId, input.userId);

  const info = db
    .prepare(
      `INSERT INTO chats (user_id, character_id, mode, gemini_model, user_note, selected_persona_id, user_impersonation, target_response_chars, memory_capacity)
       VALUES (?,?,?,?,?,?,?,?,?)`
    )
    .run(
      input.userId,
      input.characterId,
      mode,
      selectedAI,
      input.userNote ?? "",
      input.selectedPersonaId ?? null,
      0,
      targetResponseChars,
      MEMORY_CAPACITY_DEFAULT
    );

  const chatId = Number(info.lastInsertRowid);

  if (input.greeting?.trim()) {
    db.prepare("INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)").run(
      chatId,
      "assistant",
      input.greeting,
      "greeting"
    );
  }

  return chatId;
}
