/**
 * Recovery draft write lifetime + scope ownership per consumeChatStream session.
 * ChatStreamDraft is room-global (single slot); scope is characterId:chatId|null→"new".
 */
import type { ChatStreamDraft } from "@/lib/streamingPersistence";

/** Owner map — one in-flight request = one active recovery draft scope. */
export const STREAM_DRAFT_STORAGE_KEY_OWNER =
  "streamingPersistence.streamDraftStorageKey(characterId, chatId ?? 'new')" as const;
export const STREAM_DRAFT_WRITE_LIFETIME_OWNER =
  "streamDraftLifecycle.createStreamDraftWriteGate (per consumeChatStream)" as const;
export const STREAM_DRAFT_SCOPE_OWNER =
  "streamDraftLifecycle.createSessionRecoveryDraftScope (per consumeChatStream)" as const;
export const STREAM_DRAFT_SCOPE_MIGRATION_OWNER =
  "streamDraftLifecycle.adoptSessionRecoveryDraftChatId" as const;
export const STREAM_DRAFT_SCOPE_MIGRATION_EVENT_OWNER =
  "consumeChatStream SSE/request lifecycle (NOT React setState updater)" as const;
export const STREAM_DRAFT_CLEAR_OWNER =
  "streamDraftLifecycle.clearRecoveryDraftScopes (via closeSessionRecoveryDraft)" as const;
export const STREAM_DRAFT_RECOVERY_OWNER =
  "ChatClient.writeSessionRecoveryDraft / closeSessionRecoveryDraft" as const;

export type StreamDraftWriteGate = {
  isActive: () => boolean;
  tryWrite: (write: () => void) => void;
  closeAndClear: (clear: () => void) => void;
};

export function createStreamDraftWriteGate(): StreamDraftWriteGate {
  let active = true;
  return {
    isActive: () => active,
    tryWrite(write) {
      if (active) write();
    },
    closeAndClear(clear) {
      if (!active) return;
      active = false;
      clear();
    },
  };
}

export type SessionRecoveryDraftScope = {
  chatId: number | null;
};

export function createSessionRecoveryDraftScope(
  initialChatId: number | null
): SessionRecoveryDraftScope {
  return { chatId: initialChatId };
}

export type RecoveryDraftScopeOps = {
  clearScope: (chatId: number | null) => void;
  readScope: (chatId: number | null) => ChatStreamDraft | null;
  writeScope: (chatId: number | null, draft: ChatStreamDraft) => void;
};

/** One-way `new`/null → real chatId ownership transfer. Clears previous scope. */
export function adoptSessionRecoveryDraftChatId(
  scope: SessionRecoveryDraftScope,
  nextChatId: number | null,
  ops: RecoveryDraftScopeOps,
  overrideSnapshot?: ChatStreamDraft | null
): boolean {
  if (scope.chatId === nextChatId) return false;
  const previous = scope.chatId;
  const migrated =
    overrideSnapshot ??
    (previous === nextChatId ? null : ops.readScope(previous));
  ops.clearScope(previous);
  scope.chatId = nextChatId;
  if (migrated) {
    ops.writeScope(nextChatId, {
      ...migrated,
      chatId: nextChatId ?? migrated.chatId ?? 0,
      updatedAt: Date.now(),
    });
  }
  return true;
}

/** Terminal clear — current scope plus defensive stale `new` when scope is real chatId. */
export function clearRecoveryDraftScopes(
  scope: SessionRecoveryDraftScope,
  clearScope: (chatId: number | null) => void
): void {
  clearScope(scope.chatId);
  if (scope.chatId != null) {
    clearScope(null);
  }
}
