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
  resolveCanaryGreeting,
  resolveTerraPromptCanary,
} from "@/lib/terraPromptCanary";
import {
  resolveRpDiagnosticCanary,
  resolveRpDiagnosticGreeting,
} from "@/lib/rpDiagnosticCanary";
import { requeueSuggestedRepliesExtractionIfNeeded } from "@/lib/suggestedReplies/job";

export type CreateChatSessionInput = {
  userId: number;
  characterId: number;
  greeting?: string;
  mode?: "safe" | "nsfw";
  userNote?: string;
  selectedPersonaId?: number | null;
  targetResponseChars?: number;
  adultHandoffEnabled?: boolean;
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
  /** 전역 선택 미러 — 라우팅은 request-time user-chat model (Opus 5 may be remapped) */
  const selectedAI = getUserChatSelectedAI(db, input.userId, { isAdmin });
  const mode = input.mode ?? "safe";
  const targetResponseChars = normalizeTargetResponseChars(
    input.targetResponseChars ?? DEFAULT_TARGET_RESPONSE_CHARS
  );

  registerCharacterChatUser(db, input.characterId, input.userId);

  const contentKindRow = db
    .prepare("SELECT content_kind FROM characters WHERE id=?")
    .get(input.characterId) as { content_kind?: string } | undefined;
  const contentKind = contentKindRow?.content_kind === "simulation" ? "simulation" : "character";
  const terraCanary = resolveTerraPromptCanary({
    userId: input.userId,
    modelId: selectedAI,
    contentKind,
  });
  const rpCanary = resolveRpDiagnosticCanary({
    userId: input.userId,
    modelId: selectedAI,
    contentKind,
  });
  const greetingForInsert = rpCanary
    ? resolveRpDiagnosticGreeting(rpCanary.variant, input.characterId, input.greeting ?? "") ??
      (input.greeting ?? "")
    : resolveCanaryGreeting({
        canary: terraCanary,
        characterId: input.characterId,
        greeting: input.greeting ?? "",
      });

  const info = db
    .prepare(
      `INSERT INTO chats (user_id, character_id, mode, gemini_model, user_note, selected_persona_id, user_impersonation, target_response_chars, memory_capacity, adult_handoff_enabled)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
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
      MEMORY_CAPACITY_DEFAULT,
      input.adultHandoffEnabled === true ? 1 : 0
    );

  const chatId = Number(info.lastInsertRowid);

  if (greetingForInsert.trim()) {
    const greetingInfo = db
      .prepare("INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)")
      .run(chatId, "assistant", greetingForInsert, "greeting");
    const greetingMessageId = Number(greetingInfo.lastInsertRowid);
    if (Number.isFinite(greetingMessageId) && greetingMessageId > 0) {
      requeueSuggestedRepliesExtractionIfNeeded(greetingMessageId);
    }
  }

  return chatId;
}
