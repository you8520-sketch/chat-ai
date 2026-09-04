/**
 * Browser-safe streaming helpers — generation status predicates, client request ids,
 * and sessionStorage stream drafts. No DB, settlement, or server-only imports.
 */

export type GenerationStatus =
  | "submitted"
  | "generating"
  | "completed"
  | "completed_with_postprocess_error"
  | "failed"
  | "failed_partial"
  | "interrupted"
  | "ok"; // legacy synonym for completed

export type StreamingPersistenceDiag = {
  requestId: string;
  userMessageSaved: boolean;
  assistantPlaceholderCreated: boolean;
  partialSaveCount: number;
  lastPartialChars: number;
  finalized: boolean;
  interrupted: boolean;
  postprocessError: boolean;
  recoveredOnLoad: boolean;
  reusedExisting: boolean;
};

export function isTerminalGenerationStatus(status: string | null | undefined): boolean {
  const s = (status ?? "completed").toLowerCase();
  return (
    s === "completed" ||
    s === "ok" ||
    s === "completed_with_postprocess_error" ||
    s === "failed" ||
    s === "failed_partial" ||
    s === "interrupted"
  );
}

export function isInFlightGenerationStatus(status: string | null | undefined): boolean {
  const s = (status ?? "").toLowerCase();
  return s === "generating" || s === "submitted";
}

export function normalizeClientRequestId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length < 8 || trimmed.length > 80) return null;
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) return null;
  return trimmed;
}

export function createClientRequestId(): string {
  return `cr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function logStreamingPersistence(diag: StreamingPersistenceDiag): void {
  if (process.env.NODE_ENV === "production" && !diag.interrupted && !diag.postprocessError) {
    // Keep production quiet for happy path
  }
  console.log("[StreamingPersistence]", {
    request_id: diag.requestId,
    userMessageSaved: diag.userMessageSaved,
    assistantPlaceholderCreated: diag.assistantPlaceholderCreated,
    partialSaveCount: diag.partialSaveCount,
    lastPartialChars: diag.lastPartialChars,
    finalized: diag.finalized,
    interrupted: diag.interrupted,
    postprocessError: diag.postprocessError,
    recoveredOnLoad: diag.recoveredOnLoad,
    reusedExisting: diag.reusedExisting,
  });
}

const STREAM_DRAFT_PREFIX = "chat-stream-draft:v1:";

export type ChatStreamDraft = {
  requestId: string;
  chatId: number;
  userText: string;
  assistantPartial: string;
  updatedAt: number;
};

export function streamDraftStorageKey(characterId: number, chatId: number | null): string {
  return `${STREAM_DRAFT_PREFIX}${characterId}:${chatId ?? "new"}`;
}

export function writeChatStreamDraft(
  characterId: number,
  chatId: number | null,
  draft: ChatStreamDraft
): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(streamDraftStorageKey(characterId, chatId), JSON.stringify(draft));
  } catch {
    /* ignore quota */
  }
}

export function readChatStreamDraft(
  characterId: number,
  chatId: number | null
): ChatStreamDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(streamDraftStorageKey(characterId, chatId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ChatStreamDraft;
    if (!parsed?.requestId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearChatStreamDraft(characterId: number, chatId: number | null): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(streamDraftStorageKey(characterId, chatId));
  } catch {
    /* ignore quota */
  }
}
