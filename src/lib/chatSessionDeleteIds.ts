export const MAX_CHAT_SESSION_DELETE_COUNT = 100;

export type ChatSessionDeleteIdResult =
  | { ok: true; scope: "chats" | "characters"; ids: number[] }
  | { ok: false; error: string };

/** Accepts one chat, several chats, or every chat belonging to selected characters. */
export function parseChatSessionDeleteIds(body: unknown): ChatSessionDeleteIdResult {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "삭제할 대화를 선택해 주세요." };
  }

  const record = body as Record<string, unknown>;
  const deletingCharacters = Array.isArray(record.characterIds);
  const rawIds = deletingCharacters
    ? record.characterIds as unknown[]
    : Array.isArray(record.chatIds)
      ? record.chatIds
      : record.chatId == null
        ? []
        : [record.chatId];

  if (rawIds.length === 0) {
    return { ok: false, error: "삭제할 대화를 선택해 주세요." };
  }
  if (rawIds.length > MAX_CHAT_SESSION_DELETE_COUNT) {
    return {
      ok: false,
      error: `한 번에 ${MAX_CHAT_SESSION_DELETE_COUNT}개까지 삭제할 수 있습니다.`,
    };
  }

  const ids: number[] = [];
  const seen = new Set<number>();
  for (const rawId of rawIds) {
    const id = Number(rawId);
    if (!Number.isSafeInteger(id) || id <= 0) {
      return { ok: false, error: "올바르지 않은 대화가 포함되어 있습니다." };
    }
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }

  return {
    ok: true,
    scope: deletingCharacters ? "characters" : "chats",
    ids,
  };
}
