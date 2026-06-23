import { CHAT_MESSAGE_MAX } from "@/lib/chatModels";

const STORAGE_PREFIX = "playai-chat-draft";

export function chatMessageDraftKey(characterId: number, chatId: number | null): string {
  return `${STORAGE_PREFIX}:${characterId}:${chatId ?? "pending"}`;
}

export function loadChatMessageDraft(characterId: number, chatId: number | null): string {
  if (typeof window === "undefined") return "";
  try {
    const text = sessionStorage.getItem(chatMessageDraftKey(characterId, chatId)) ?? "";
    return text.slice(0, CHAT_MESSAGE_MAX);
  } catch {
    return "";
  }
}

export function saveChatMessageDraft(
  characterId: number,
  chatId: number | null,
  text: string
): void {
  if (typeof window === "undefined") return;
  try {
    const key = chatMessageDraftKey(characterId, chatId);
    const trimmed = text.slice(0, CHAT_MESSAGE_MAX);
    if (!trimmed.trim()) {
      sessionStorage.removeItem(key);
    } else {
      sessionStorage.setItem(key, trimmed);
    }
  } catch {
    /* ignore quota / private mode */
  }
}

export function clearChatMessageDraft(characterId: number, chatId: number | null): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(chatMessageDraftKey(characterId, chatId));
    sessionStorage.removeItem(chatMessageDraftKey(characterId, null));
  } catch {
    /* ignore */
  }
}

/** 첫 메시지로 chatId가 생길 때 pending 초안을 해당 방으로 이전 */
export function migrateChatMessageDraft(
  characterId: number,
  chatId: number
): void {
  if (typeof window === "undefined") return;
  try {
    const pendingKey = chatMessageDraftKey(characterId, null);
    const targetKey = chatMessageDraftKey(characterId, chatId);
    const pending = sessionStorage.getItem(pendingKey);
    if (!pending) return;
    if (!sessionStorage.getItem(targetKey)) {
      sessionStorage.setItem(targetKey, pending.slice(0, CHAT_MESSAGE_MAX));
    }
    sessionStorage.removeItem(pendingKey);
  } catch {
    /* ignore */
  }
}
