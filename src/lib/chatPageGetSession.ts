import { getDb } from "@/lib/db";

export type ChatPageGetQuery = {
  chatParam?: string;
  freshParam?: string;
};

/**
 * GET /chat/[characterId] session decision — read-only.
 * Missing rooms and ?fresh=1 never create chats or schedule provider work.
 */
export type ChatPageGetDecision =
  | { kind: "open"; chatId: number }
  | { kind: "redirect-existing"; chatId: number }
  | { kind: "unknown-chat" }
  | { kind: "missing-room" };

export function isChatPageFreshParam(freshParam?: string): boolean {
  return freshParam === "1" || freshParam === "true";
}

function parseRequestedChatId(chatParam?: string): number {
  if (!chatParam) return 0;
  const requestedId = Number(chatParam);
  return requestedId && Number.isFinite(requestedId) ? requestedId : 0;
}

function loadOwnedChatId(
  userId: number,
  characterId: number,
  chatId: number
): number | undefined {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT id FROM chats WHERE id=? AND user_id=? AND character_id=?"
    )
    .get(chatId, userId, characterId) as { id: number } | undefined;
  return row?.id;
}

function loadLatestOwnedChatId(userId: number, characterId: number): number | undefined {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT id FROM chats WHERE user_id=? AND character_id=? ORDER BY id DESC LIMIT 1"
    )
    .get(userId, characterId) as { id: number } | undefined;
  return row?.id;
}

/** Current /chat/[id] GET room decision. Keep page.tsx as the render owner. */
export function resolveChatPageGetDecision(
  input: {
    userId: number;
    characterId: number;
  } & ChatPageGetQuery
): ChatPageGetDecision {
  const startFresh = isChatPageFreshParam(input.freshParam);
  const requestedChatId = parseRequestedChatId(input.chatParam);

  let chatId: number | undefined;
  if (!startFresh) {
    if (requestedChatId) {
      chatId = loadOwnedChatId(input.userId, input.characterId, requestedChatId);
    }
    if (!chatId) {
      chatId = loadLatestOwnedChatId(input.userId, input.characterId);
    }
  }

  if (chatId && !startFresh) {
    if (requestedChatId !== chatId) {
      return { kind: "redirect-existing", chatId };
    }
    return { kind: "open", chatId };
  }

  if (!startFresh && requestedChatId && !chatId) {
    return { kind: "unknown-chat" };
  }

  return { kind: "missing-room" };
}
