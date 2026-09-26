import { CHAT_MESSAGE_MAX } from "@/lib/chatModels";

/**
 * Canonical browser owner for UNSENT user-written text.
 *
 * Owner map:
 * - USER_INPUT_DRAFT_STORAGE_OWNER → load/save/clear primitives below (sessionStorage).
 * - USER_INPUT_SEND_CUSTODY_OWNER → resolveSendCustodyBackup (pure owner-map for the
 *   send → durable-bootstrap gap; no storage side effects).
 * - TRPG_ACTION_SCOPE_OWNER → trpgActionDraftKey (campaign + round).
 * - TRPG_PARTY_SCOPE_OWNER → trpgPartyDraftKey (campaign).
 *
 * Non-owners (separate responsibilities, must not be merged here):
 * - assistant partial / in-flight recovery → chatStreamDraft (streamingPersistenceShared).
 * - authoritative submitted turns/actions → DB (messages / trpg_action_submissions).
 * - durable clear ACK → turn_persisted SSE (general RP) / successful POST response (TRPG).
 */

export const CHAT_MESSAGE_DRAFT_PREFIX = "playai-chat-draft";
const TRPG_ACTION_DRAFT_PREFIX = "trpg-action-draft:v1";
const TRPG_PARTY_DRAFT_PREFIX = "trpg-party-draft:v1";

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function readKey(key: string): string {
  if (!isBrowser()) return "";
  try {
    return sessionStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function writeKey(key: string, text: string, maxChars: number): void {
  if (!isBrowser()) return;
  try {
    const trimmed = text.slice(0, maxChars);
    if (!trimmed.trim()) {
      sessionStorage.removeItem(key);
    } else {
      sessionStorage.setItem(key, trimmed);
    }
  } catch {
    /* ignore quota / private mode */
  }
}

function removeKey(key: string): void {
  if (!isBrowser()) return;
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function loadUserInputDraft(key: string, maxChars: number): string {
  return readKey(key).slice(0, maxChars);
}

export function saveUserInputDraft(key: string, text: string, maxChars: number): void {
  writeKey(key, text, maxChars);
}

export function clearUserInputDraft(key: string): void {
  removeKey(key);
}

export function chatMessageDraftStorageKey(characterId: number, chatId: number | null): string {
  return `${CHAT_MESSAGE_DRAFT_PREFIX}:${characterId}:${chatId ?? "pending"}`;
}

/** Canonical RP composer draft — storage key preserved from the legacy helper. */
export function chatMessageDraftKey(characterId: number, chatId: number | null): string {
  return chatMessageDraftStorageKey(characterId, chatId);
}

export function loadChatMessageDraft(characterId: number, chatId: number | null): string {
  return loadUserInputDraft(chatMessageDraftKey(characterId, chatId), CHAT_MESSAGE_MAX);
}

export function saveChatMessageDraft(
  characterId: number,
  chatId: number | null,
  text: string
): void {
  saveUserInputDraft(chatMessageDraftKey(characterId, chatId), text, CHAT_MESSAGE_MAX);
}

export function clearChatMessageDraft(characterId: number, chatId: number | null): void {
  clearUserInputDraft(chatMessageDraftKey(characterId, chatId));
  clearUserInputDraft(chatMessageDraftKey(characterId, null));
}

/** 첫 메시지로 chatId가 생길 때 pending 초안을 해당 방으로 이전 */
export function migrateChatMessageDraft(characterId: number, chatId: number): void {
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

export function trpgActionDraftKey(campaignId: number, roundNumber: number): string {
  return `${TRPG_ACTION_DRAFT_PREFIX}:${campaignId}:${roundNumber}`;
}

export function trpgPartyDraftKey(campaignId: number): string {
  return `${TRPG_PARTY_DRAFT_PREFIX}:${campaignId}`;
}

export type TrpgActionUnsentDraft = {
  body: string;
  actionType: string;
  inputOrigin: string;
};

/** Structured TRPG action draft (body + type + origin) in one scoped key. */
export function saveTrpgActionDraft(
  key: string,
  draft: TrpgActionUnsentDraft,
  maxChars: number
): void {
  if (!isBrowser()) return;
  try {
    const body = draft.body.slice(0, maxChars);
    if (!body.trim()) {
      sessionStorage.removeItem(key);
      return;
    }
    sessionStorage.setItem(
      key,
      JSON.stringify({ body, actionType: draft.actionType, inputOrigin: draft.inputOrigin })
    );
  } catch {
    /* ignore quota / private mode */
  }
}

export function loadTrpgActionDraft(key: string, maxChars: number): TrpgActionUnsentDraft | null {
  if (!isBrowser()) return null;
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TrpgActionUnsentDraft>;
    const body = typeof parsed.body === "string" ? parsed.body.slice(0, maxChars) : "";
    if (!body.trim()) return null;
    return {
      body,
      actionType: typeof parsed.actionType === "string" ? parsed.actionType : "",
      inputOrigin: typeof parsed.inputOrigin === "string" ? parsed.inputOrigin : "",
    };
  } catch {
    return null;
  }
}

export type SendCustodyOwners = {
  reactInput: string;
  messageDraft: string;
  streamDraftUserText: string;
  dbUserRow: string | null;
  inFlightBackupText: string;
};

export type SendCustodyResolution =
  | { hasOwner: true; owner: "react-input" | "message-draft" | "stream-draft" | "db" | "in-flight-backup" }
  | { hasOwner: false; owner: null };

/**
 * Deterministic owner map for the send → durable-bootstrap gap.
 * No storage side effects; used by tests and by the ChatClient guard.
 * Priority follows custody transfer order: DB > react > message draft >
 * stream backup > in-flight backup.
 */
export function resolveSendCustodyBackup(owners: SendCustodyOwners): SendCustodyResolution {
  if (owners.dbUserRow != null && owners.dbUserRow.trim()) return { hasOwner: true, owner: "db" };
  if (owners.reactInput.trim()) return { hasOwner: true, owner: "react-input" };
  if (owners.messageDraft.trim()) return { hasOwner: true, owner: "message-draft" };
  if (owners.streamDraftUserText.trim()) return { hasOwner: true, owner: "stream-draft" };
  if (owners.inFlightBackupText.trim()) return { hasOwner: true, owner: "in-flight-backup" };
  return { hasOwner: false, owner: null };
}

/**
 * TRPG action composer precedence: a server locked/current-round draft
 * always wins over a local unsent draft. Empty server drafts fall back
 * to the local draft (same round only — callers scope by round key).
 */
export function resolveTrpgActionInitialBody(
  serverDraftBody: string | null | undefined,
  localDraftBody: string | null | undefined
): string {
  if (serverDraftBody != null && serverDraftBody.trim()) return serverDraftBody;
  if (localDraftBody != null && localDraftBody.trim()) return localDraftBody;
  return "";
}
