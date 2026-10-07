import { getDb } from "@/lib/db";
import { registerCharacterChatUser } from "@/lib/characterEngagementStats";
import { getUserChatSelectedAI } from "@/lib/userSelectedAI";
import { isAdminUser } from "@/lib/isAdminUser";
import {
  DEFAULT_TARGET_RESPONSE_CHARS,
  normalizeTargetResponseChars,
} from "@/lib/responseLength";
import { MEMORY_CAPACITY_DEFAULT } from "@/lib/memory/memory-capacity-shared";
import {
  resolveRpDiagnosticCanary,
  resolveRpDiagnosticGreeting,
} from "@/lib/rpDiagnosticCanary";
import { scheduleGreetingSuggestedRepliesExtraction } from "@/lib/suggestedReplies/job";
import {
  DEFAULT_AUTO_PROGRESSION_USER_AUTHORING_LEVEL,
  DEFAULT_USER_AUTHORING_LEVEL,
  parseUserAuthoringLevel,
  type UserAuthoringLevel,
} from "@/lib/userAuthoringPolicy";

export type CreateChatSessionInput = {
  userId: number;
  characterId: number;
  greeting?: string;
  mode?: "safe" | "nsfw";
  userNote?: string;
  selectedPersonaId?: number | null;
  targetResponseChars?: number;
  adultHandoffEnabled?: boolean;
  userAuthoringLevel?: UserAuthoringLevel;
  autoProgressionAuthoringLevel?: UserAuthoringLevel;
  /** Test spy only — replaces the real greeting scheduler so tests never start provider work. */
  __testOnGreetingSchedule?: (messageId: number, chatId: number) => void;
};

/** 새 채팅방 생성 + 첫 메시지(greeting) 삽입 */
export function createChatSession(input: CreateChatSessionInput): number {
  const db = getDb();
  const userRow = db
    .prepare("SELECT email, is_admin FROM users WHERE id=?")
    .get(input.userId) as { email: string; is_admin: number } | undefined;
  const isAdmin = isAdminUser({
    email: userRow?.email ?? "",
    is_admin: userRow?.is_admin ?? 0,
  });
  /** 전역 선택 미러 — 라우팅은 request-time user-chat model */
  const selectedAI = getUserChatSelectedAI(db, input.userId);
  const mode = input.mode ?? "safe";
  const targetResponseChars = normalizeTargetResponseChars(
    input.targetResponseChars ?? DEFAULT_TARGET_RESPONSE_CHARS
  );

  const contentKindRow = db
    .prepare("SELECT content_kind FROM characters WHERE id=?")
    .get(input.characterId) as { content_kind?: string } | undefined;
  const contentKind = contentKindRow?.content_kind === "simulation" ? "simulation" : "character";
  const rpCanary = resolveRpDiagnosticCanary({
    userId: input.userId,
    modelId: selectedAI,
    contentKind,
  });
  const greetingForInsert = rpCanary
    ? resolveRpDiagnosticGreeting(rpCanary.variant, input.characterId, input.greeting ?? "") ??
      (input.greeting ?? "")
    : (input.greeting ?? "");

  const info = db
    .prepare(
      `INSERT INTO chats (user_id, character_id, mode, gemini_model, user_note, selected_persona_id, target_response_chars, memory_capacity, adult_handoff_enabled, user_authoring_level, auto_progression_authoring_level)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      input.userId,
      input.characterId,
      mode,
      selectedAI,
      input.userNote ?? "",
      input.selectedPersonaId ?? null,
      targetResponseChars,
      MEMORY_CAPACITY_DEFAULT,
      input.adultHandoffEnabled === true ? 1 : 0,
      parseUserAuthoringLevel(input.userAuthoringLevel ?? DEFAULT_USER_AUTHORING_LEVEL),
      parseUserAuthoringLevel(
        input.autoProgressionAuthoringLevel ??
          DEFAULT_AUTO_PROGRESSION_USER_AUTHORING_LEVEL
      )
    );

  const chatId = Number(info.lastInsertRowid);
  registerCharacterChatUser(db, input.characterId, input.userId);

  if (greetingForInsert.trim()) {
    const greetingInfo = db
      .prepare("INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)")
      .run(chatId, "assistant", greetingForInsert, "greeting");
    const greetingMessageId = Number(greetingInfo.lastInsertRowid);
    if (Number.isFinite(greetingMessageId) && greetingMessageId > 0) {
      if (input.__testOnGreetingSchedule) {
        input.__testOnGreetingSchedule(greetingMessageId, chatId);
      } else {
        scheduleGreetingSuggestedRepliesExtraction(greetingMessageId, chatId);
      }
    }
  }

  return chatId;
}
